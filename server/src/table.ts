import { nanoid } from "nanoid";
import type { TableState, PlayerState, Street, ShowChoice, TableSettings, PlayerAction, HandPositions, SidePot } from "./types.js";
import { appendEvent } from "./logger.js";
import { makeDeck, shuffle } from "./cards.js";
import { evaluateBest, findWinners } from "./hand.js";

function nextStreet(s: Street): Street {
  switch (s) {
    case "PREFLOP": return "FLOP";
    case "FLOP": return "TURN";
    case "TURN": return "RIVER";
    case "RIVER": return "SHOWDOWN";
    case "SHOWDOWN": return "DONE";
    case "DONE": return "DONE";
  }
}

function mod(n: number, m: number) {
  return ((n % m) + m) % m;
}

function isAllIn(p: PlayerState) {
  return p.inHand && !p.folded && p.stack === 0;
}

export class Table {
  public state: TableState;
  public ended = false;
  private pendingActors = new Set<string>();

  constructor(public tableId: string) {
    const sessionId = nanoid(10);
    const settings: TableSettings = { smallBlind: 1, bigBlind: 2, straddleEnabled: false };

    this.state = {
      tableId,
      sessionId,
      createdAt: Date.now(),
      bankPlayerId: undefined,
      settings,
      positions: null,
      street: "DONE",
      handNumber: 0,
      players: [],
      board: [],
      pot: 0,
      pots: [],
      streetBet: 0,
      lastRaiseSize: settings.bigBlind,
      currentTurnIndex: 0,
      roundComplete: true,
      showdownChoices: {},
      actionLog: [],
      dealerMessage: "Waiting for dealer to start the hand."
    };

    appendEvent({ ts: Date.now(), type: "SESSION_STARTED", tableId, sessionId, payload: { createdAt: this.state.createdAt } });
  }

  private pushLog(line: string) {
    this.state.actionLog = [line, ...this.state.actionLog].slice(0, 70);
  }

  private playerById(id: string) {
    return this.state.players.find(p => p.id === id);
  }

  private requireDealer(playerId: string) {
    const p = this.playerById(playerId);
    if (!p) throw new Error("No such player.");
    if (!p.isDealer) throw new Error("Only the dealer can do that.");
  }

  private requireBank(playerId: string) {
    if (!this.state.bankPlayerId) throw new Error("No bank set.");
    if (playerId !== this.state.bankPlayerId) throw new Error("Only the Bank can do that.");
  }

  addPlayer(name: string): PlayerState {
    const id = nanoid(8);
    const isDealer = this.state.players.length === 0;
    const p: PlayerState = {
      id, name, isDealer, connected: true,
      stack: 0,
      inHand: false,
      folded: false,
      currentBet: 0,
      totalBet: 0
    };
    this.state.players.push(p);

    if (!this.state.bankPlayerId) this.state.bankPlayerId = id;

    appendEvent({ ts: Date.now(), type: "PLAYER_JOINED", tableId: this.tableId, sessionId: this.state.sessionId, payload: { id, name, isDealer, isBank: id === this.state.bankPlayerId } });

    if (isDealer) this.state.dealerMessage = `Dealer is ${name}.`;
    if (id === this.state.bankPlayerId) this.pushLog(`${name} is the Bank.`);

    return p;
  }

  markDisconnected(playerId: string) {
    const p = this.playerById(playerId);
    if (!p) return;
    p.connected = false;
    appendEvent({ ts: Date.now(), type: "PLAYER_DISCONNECTED", tableId: this.tableId, sessionId: this.state.sessionId, payload: { playerId } });
  }

  setDealer(playerId: string) {
    const p = this.playerById(playerId);
    if (!p) throw new Error("No such player.");
    for (const pl of this.state.players) pl.isDealer = (pl.id === playerId);
    this.state.dealerMessage = `Dealer is now ${p.name}.`;
    this.pushLog(`Dealer changed to ${p.name}.`);
    appendEvent({ ts: Date.now(), type: "DEALER_CHANGED", tableId: this.tableId, sessionId: this.state.sessionId, payload: { playerId } });
  }

  setStack(bankId: string, targetPlayerId: string, stack: number) {
    this.requireBank(bankId);
    const p = this.playerById(targetPlayerId);
    if (!p) throw new Error("No such player.");
    if (!Number.isFinite(stack) || stack < 0) throw new Error("Stack must be a non-negative number.");
    p.stack = Math.floor(stack);
    this.pushLog(`Bank set ${p.name}'s stack to ${p.stack}.`);
    appendEvent({ ts: Date.now(), type: "STACK_SET", tableId: this.tableId, sessionId: this.state.sessionId, payload: { playerId: targetPlayerId, stack: p.stack } });
  }

  setBlinds(bankId: string, smallBlind: number, bigBlind: number, straddleEnabled: boolean) {
    this.requireBank(bankId);
    if (!Number.isFinite(smallBlind) || !Number.isFinite(bigBlind) || smallBlind < 0 || bigBlind <= 0) {
      throw new Error("Invalid blinds.");
    }
    if (smallBlind >= bigBlind) throw new Error("Small blind must be < big blind.");
    this.state.settings = { smallBlind: Math.floor(smallBlind), bigBlind: Math.floor(bigBlind), straddleEnabled: !!straddleEnabled };
    this.state.lastRaiseSize = this.state.settings.bigBlind;
    this.pushLog(`Blinds set to ${this.state.settings.smallBlind}/${this.state.settings.bigBlind}${this.state.settings.straddleEnabled ? " with straddle" : ""}.`);
    appendEvent({ ts: Date.now(), type: "BLINDS_SET", tableId: this.tableId, sessionId: this.state.sessionId, payload: this.state.settings });
  }

  private moveChipsToPot(player: PlayerState, amount: number) {
    const pay = Math.min(player.stack, amount);
    player.stack -= pay;
    player.currentBet += pay;
    player.totalBet += pay;
    this.state.pot += pay;
    return pay;
  }

  private calculatePots(): SidePot[] {
    const inHandPlayers = this.state.players.filter(p => p.inHand);
    if (inHandPlayers.length === 0) return [];

    // Get distinct contribution levels, sorted ascending
    const levels = [...new Set(inHandPlayers.map(p => p.totalBet))].sort((a, b) => a - b);

    const rawPots: SidePot[] = [];
    let prevLevel = 0;

    for (const level of levels) {
      if (level === 0) continue;
      const increment = level - prevLevel;
      const contributors = inHandPlayers.filter(p => p.totalBet >= level);
      const amount = increment * contributors.length;
      const eligible = contributors.filter(p => !p.folded).map(p => p.id);

      if (amount > 0) {
        rawPots.push({ amount, eligiblePlayerIds: eligible });
      }
      prevLevel = level;
    }

    // Merge consecutive pots with identical eligible players
    const pots: SidePot[] = [];
    for (const pot of rawPots) {
      const prev = pots[pots.length - 1];
      const sameEligible = prev &&
        prev.eligiblePlayerIds.length === pot.eligiblePlayerIds.length &&
        prev.eligiblePlayerIds.every(id => pot.eligiblePlayerIds.includes(id));
      if (sameEligible) {
        prev.amount += pot.amount;
      } else {
        pots.push(pot);
      }
    }

    return pots;
  }

  private updatePots() {
    this.state.pots = this.calculatePots();
    this.state.pot = this.state.pots.reduce((sum, p) => sum + p.amount, 0);
  }

  private returnUnclaimedChips() {
    const nonFolded = this.state.players.filter(p => p.inHand && !p.folded);
    if (nonFolded.length === 0) return;

    const maxEligibleBet = Math.max(...nonFolded.map(p => p.totalBet));

    for (const p of this.state.players) {
      if (!p.inHand) continue;
      const excess = Math.max(0, p.totalBet - maxEligibleBet);
      if (excess > 0) {
        p.stack += excess;
        p.totalBet -= excess;
        this.state.pot -= excess;
        this.pushLog(`${excess} returned to ${p.name} (uncalled).`);
      }
    }
  }

  private updateLiveHandRanks() {
    for (const p of this.state.players) {
      if (!p.inHand || p.folded || !p.holeCards) {
        p.bestHand = undefined;
        continue;
      }
      const allCards = [...p.holeCards, ...this.state.board];
      const result = evaluateBest(allCards);
      p.bestHand = result?.name ?? undefined;
    }
  }

  private autoEvaluateAndAwardPots() {
    const holeCardMap: Record<string, [string, string]> = {};
    for (const p of this.state.players) {
      if (p.holeCards) holeCardMap[p.id] = p.holeCards;
    }

    let topHandName: string | undefined;
    let topScore = -1;

    const potLabel = (i: number) =>
      this.state.pots.length === 1 ? "pot" : i === 0 ? "main pot" : `side pot #${i}`;

    for (let i = 0; i < this.state.pots.length; i++) {
      const pot = this.state.pots[i];

      // Skip pots with no eligible players (all contributors folded)
      if (pot.eligiblePlayerIds.length === 0) continue;

      // Single eligible player — auto-award
      if (pot.eligiblePlayerIds.length === 1) {
        const winner = this.playerById(pot.eligiblePlayerIds[0]);
        if (winner) {
          pot.winnerIds = [winner.id];
          winner.stack += pot.amount;
          this.pushLog(`${winner.name} wins ${potLabel(i)} (${pot.amount}) — uncontested.`);
          appendEvent({ ts: Date.now(), type: "POT_AWARDED", tableId: this.tableId, sessionId: this.state.sessionId, payload: { handNumber: this.state.handNumber, potIndex: i, winnerIds: [winner.id], amount: pot.amount, auto: true } });
        }
        continue;
      }

      // Contested pot — evaluate hands
      const winners = findWinners(pot.eligiblePlayerIds, holeCardMap, this.state.board);
      pot.winnerIds = winners;

      // Get the winning hand name
      let winHandName = "";
      if (winners.length > 0) {
        const hole = holeCardMap[winners[0]];
        if (hole) {
          const result = evaluateBest([...hole, ...this.state.board]);
          if (result) {
            winHandName = result.name;
            if (result.score > topScore) {
              topScore = result.score;
              topHandName = result.name;
            }
          }
        }
      }

      // Auto-show winners' cards (standard poker rules)
      for (const wId of winners) {
        if (!this.state.showdownChoices[wId]) {
          this.state.showdownChoices[wId] = { kind: "SHOW_2" };
          const wp = this.playerById(wId);
          if (wp?.holeCards) {
            const hand = evaluateBest([...wp.holeCards, ...this.state.board]);
            const handStr = hand ? ` — ${hand.name}` : "";
            this.pushLog(`${wp.name} shows ${wp.holeCards[0]} ${wp.holeCards[1]}${handStr}.`);
            appendEvent({ ts: Date.now(), type: "SHOWDOWN_CHOICE", tableId: this.tableId, sessionId: this.state.sessionId, payload: { playerId: wId, choice: { kind: "SHOW_2" }, auto: true } });
          }
        }
      }

      if (winners.length === 1) {
        const winner = this.playerById(winners[0])!;
        winner.stack += pot.amount;
        this.pushLog(`${winner.name} wins ${potLabel(i)} (${pot.amount}) with ${winHandName}.`);
        appendEvent({ ts: Date.now(), type: "POT_AWARDED", tableId: this.tableId, sessionId: this.state.sessionId, payload: { handNumber: this.state.handNumber, potIndex: i, winnerIds: winners, amount: pot.amount } });
      } else {
        // Split pot
        const share = Math.floor(pot.amount / winners.length);
        const remainder = pot.amount - share * winners.length;
        for (let w = 0; w < winners.length; w++) {
          const winner = this.playerById(winners[w])!;
          const amt = share + (w === 0 ? remainder : 0);
          winner.stack += amt;
        }
        const names = winners.map(id => this.playerById(id)!.name).join(", ");
        this.pushLog(`${potLabel(i)} (${pot.amount}) split between ${names} — ${winHandName}.`);
        appendEvent({ ts: Date.now(), type: "POT_AWARDED", tableId: this.tableId, sessionId: this.state.sessionId, payload: { handNumber: this.state.handNumber, potIndex: i, winnerIds: winners, amount: pot.amount, split: true } });
      }
    }

    this.state.winningHandName = topHandName;
  }

  private postBlind(player: PlayerState, amount: number, label: string) {
    const paid = this.moveChipsToPot(player, amount);
    this.pushLog(`${player.name} posts ${label} ${paid}.`);
    appendEvent({ ts: Date.now(), type: "POST", tableId: this.tableId, sessionId: this.state.sessionId, payload: { playerId: player.id, label, amount: paid } });
  }

  private nextToActFrom(startIndex: number): number {
    const n = this.state.players.length;
    for (let k = 0; k < n; k++) {
      const i = mod(startIndex + k, n);
      const p = this.state.players[i];
      if (!p.connected) continue;
      if (!p.inHand) continue;
      if (p.folded) continue;
      if (isAllIn(p)) continue;
      return i;
    }
    return startIndex;
  }

  private updateRoundComplete() {
    const elig = this.state.players.filter(p => p.connected && p.inHand && !p.folded && !isAllIn(p));
    if (elig.length === 0) { this.state.roundComplete = true; return; }
    // Round is complete when no one is left to act AND all bets match
    this.state.roundComplete = this.pendingActors.size === 0 && elig.every(p => p.currentBet === this.state.streetBet);
  }

  private initPendingActors() {
    this.pendingActors = new Set(
      this.state.players
        .filter(p => p.connected && p.inHand && !p.folded && !isAllIn(p))
        .map(p => p.id)
    );
  }

  private maybeEndHandByFolds() {
    const alive = this.state.players.filter(p => p.connected && p.inHand && !p.folded);
    if (alive.length === 1) {
      this.returnUnclaimedChips();
      this.updatePots();
      const winner = alive[0];
      const totalWon = this.state.pot;
      winner.stack += totalWon;
      this.pushLog(`${winner.name} wins ${totalWon} (everyone folded).`);
      appendEvent({ ts: Date.now(), type: "HAND_WON_UNCONTESTED", tableId: this.tableId, sessionId: this.state.sessionId, payload: { handNumber: this.state.handNumber, winnerId: winner.id, amount: totalWon } });

      this.state.pot = 0;
      this.state.pots = [];
      this.state.street = "DONE";
      this.state.positions = null;
      this.state.streetBet = 0;
      this.state.roundComplete = true;
      this.state.dealerMessage = "Hand ended (uncontested). Dealer may start next hand.";
      return true;
    }
    return false;
  }

  startHand(dealerId: string) {
    this.requireDealer(dealerId);
    const n = this.state.players.length;
    if (n < 2) throw new Error("Need at least 2 players.");
    const withChips = this.state.players.filter(p => p.connected && p.stack > 0);
    if (withChips.length < 2) throw new Error("Need at least 2 players with chips.");

    const prevButton = this.state.positions?.buttonIndex ?? -1;
    const buttonIndex = prevButton === -1 ? 0 : mod(prevButton + 1, n);
    const sbIndex = mod(buttonIndex + 1, n);
    const bbIndex = mod(buttonIndex + 2, n);

    this.state.pot = 0;
    this.state.pots = [];
    for (const p of this.state.players) {
      p.inHand = p.connected;
      p.folded = false;
      p.currentBet = 0;
      p.totalBet = 0;
    }

    const deck = shuffle(makeDeck());
    for (const p of this.state.players) {
      if (p.inHand) p.holeCards = [deck.pop()!, deck.pop()!];
      else p.holeCards = undefined;
    }

    this.state.handNumber += 1;
    this.state.street = "PREFLOP";
    this.state.board = [];
    this.state.deck = deck;
    this.state.showdownChoices = {};
    this.state.winningHandName = undefined;

    const sbPlayer = this.state.players[sbIndex];
    const bbPlayer = this.state.players[bbIndex];
    if (sbPlayer.inHand) this.postBlind(sbPlayer, this.state.settings.smallBlind, "SB");
    if (bbPlayer.inHand) this.postBlind(bbPlayer, this.state.settings.bigBlind, "BB");

    let straddleIndex: number | null = null;
    if (this.state.settings.straddleEnabled && n >= 3) {
      straddleIndex = mod(buttonIndex + 3, n);
      const strP = this.state.players[straddleIndex];
      if (strP.inHand) this.postBlind(strP, this.state.settings.bigBlind * 2, "Straddle");
    }

    this.state.positions = { buttonIndex, sbIndex, bbIndex, straddleIndex };

    const highest = Math.max(...this.state.players.map(p => p.currentBet));
    this.state.streetBet = highest;
    this.state.lastRaiseSize = (straddleIndex !== null) ? this.state.settings.bigBlind * 2 : this.state.settings.bigBlind;
    this.state.roundComplete = false;

    // Everyone needs to act preflop (including blind posters who can raise)
    this.initPendingActors();

    const start = straddleIndex !== null ? mod(straddleIndex + 1, n) : mod(bbIndex + 1, n);
    this.state.currentTurnIndex = this.nextToActFrom(start);

    this.updateLiveHandRanks();

    const buttonName = this.state.players[buttonIndex].name;
    this.state.dealerMessage = `Hand #${this.state.handNumber} started. Button: ${buttonName}. Action on ${this.state.players[this.state.currentTurnIndex].name}.`;
    this.pushLog(`--- Hand #${this.state.handNumber} (Button: ${buttonName}) ---`);

    appendEvent({ ts: Date.now(), type: "HAND_STARTED", tableId: this.tableId, sessionId: this.state.sessionId, payload: { handNumber: this.state.handNumber, positions: this.state.positions, settings: this.state.settings } });
  }

  act(playerId: string, action: PlayerAction) {
    if (this.state.street === "DONE" || this.state.street === "SHOWDOWN") throw new Error("Not in an active betting street.");
    if (this.state.roundComplete) throw new Error("Betting round is complete. Dealer must advance.");
    const n = this.state.players.length;
    const idx = this.state.players.findIndex(p => p.id === playerId);
    if (idx === -1) throw new Error("No such player.");
    if (idx !== this.state.currentTurnIndex) throw new Error("Not your turn.");

    const p = this.state.players[idx];
    if (!p.inHand || p.folded) throw new Error("You are not in the hand.");
    if (isAllIn(p)) throw new Error("You are all-in.");

    const toCall = Math.max(0, this.state.streetBet - p.currentBet);

    const logAct = (line: string, extra?: any) => {
      this.pushLog(line);
      appendEvent({ ts: Date.now(), type: "ACTION", tableId: this.tableId, sessionId: this.state.sessionId, payload: { playerId, street: this.state.street, action, ...extra } });
    };

    const advanceOrComplete = () => {
      this.updatePots();
      if (this.maybeEndHandByFolds()) return;

      this.updateRoundComplete();
      if (this.state.roundComplete) {
        // Auto-advance to next street (flop/turn/river/showdown)
        this.autoAdvance();
        return;
      }
      this.state.currentTurnIndex = this.nextToActFrom(mod(this.state.currentTurnIndex + 1, n));
      this.state.dealerMessage = `Action on ${this.state.players[this.state.currentTurnIndex].name}.`;
    };

    if (action.kind === "FOLD") {
      p.folded = true;
      this.pendingActors.delete(playerId);
      logAct(`${p.name} folds.`);
      return advanceOrComplete();
    }

    if (action.kind === "CHECK") {
      if (toCall !== 0) throw new Error("Cannot check; you must call, raise, or fold.");
      this.pendingActors.delete(playerId);
      logAct(`${p.name} checks.`);
      return advanceOrComplete();
    }

    if (action.kind === "CALL") {
      if (toCall === 0) throw new Error("Nothing to call. Check instead.");
      const paid = this.moveChipsToPot(p, toCall);
      this.pendingActors.delete(playerId);
      logAct(`${p.name} calls ${paid}.`);
      return advanceOrComplete();
    }

    const maxTo = p.currentBet + p.stack;
    const isBet = this.state.streetBet === 0;

    if (action.kind === "BET") {
      if (!isBet) throw new Error("Cannot bet; there is already a bet. Use raise.");
      let to = Math.floor(action.to);
      if (!Number.isFinite(to)) throw new Error("Invalid bet.");
      to = Math.max(0, Math.min(to, maxTo));

      const minBet = this.state.settings.bigBlind; // simplified
      if (to < minBet && to !== maxTo) throw new Error(`Minimum bet is ${minBet}.`);

      const delta = to - p.currentBet;
      if (delta <= 0) throw new Error("Bet must increase your wager.");

      const paid = this.moveChipsToPot(p, delta);
      const prevStreetBet = this.state.streetBet;
      this.state.streetBet = p.currentBet;
      this.state.lastRaiseSize = Math.max(this.state.settings.bigBlind, this.state.streetBet - prevStreetBet);
      logAct(`${p.name} bets to ${p.currentBet}.`, { to: p.currentBet });

      // Bet: everyone else needs to act again
      this.pendingActors.delete(playerId);
      for (const pl of this.state.players) {
        if (pl.id !== playerId && pl.connected && pl.inHand && !pl.folded && !isAllIn(pl)) {
          this.pendingActors.add(pl.id);
        }
      }
      this.state.roundComplete = false;
      return advanceOrComplete();
    }

    if (action.kind === "RAISE") {
      if (isBet) throw new Error("Nothing to raise. Use bet.");
      let to = Math.floor(action.to);
      if (!Number.isFinite(to)) throw new Error("Invalid raise.");
      to = Math.max(0, Math.min(to, maxTo));

      const minTo = this.state.streetBet + this.state.lastRaiseSize;
      if (to < minTo && to !== maxTo) throw new Error(`Minimum raise is to ${minTo}.`);
      if (to <= this.state.streetBet) throw new Error("Raise must be above current bet.");

      const delta = to - p.currentBet;
      const paid = this.moveChipsToPot(p, delta);

      const prevStreetBet = this.state.streetBet;
      this.state.streetBet = p.currentBet;
      const raiseSize = this.state.streetBet - prevStreetBet;
      if (raiseSize > 0) this.state.lastRaiseSize = raiseSize;

      logAct(`${p.name} raises to ${p.currentBet}.`, { to: p.currentBet });

      // Raise: everyone else needs to act again
      this.pendingActors.delete(playerId);
      for (const pl of this.state.players) {
        if (pl.id !== playerId && pl.connected && pl.inHand && !pl.folded && !isAllIn(pl)) {
          this.pendingActors.add(pl.id);
        }
      }
      this.state.roundComplete = false;
      return advanceOrComplete();
    }
  }

  private resetForNewStreet() {
    for (const p of this.state.players) p.currentBet = 0;
    this.state.streetBet = 0;
    this.state.lastRaiseSize = this.state.settings.bigBlind;
    this.state.roundComplete = false;

    this.initPendingActors();

    const n = this.state.players.length;
    const btn = this.state.positions?.buttonIndex ?? 0;
    const start = mod(btn + 1, n);
    this.state.currentTurnIndex = this.nextToActFrom(start);

    // If fewer than 2 can act (all-in scenarios), complete immediately
    if (this.pendingActors.size <= 1) {
      this.state.roundComplete = true;
      this.pendingActors.clear();
    }
  }

  /** Deal the next street automatically. Returns true if another auto-advance is needed (all-in runout). */
  private dealNextStreet(): boolean {
    const prev = this.state.street;
    const next = nextStreet(prev);

    if (next === "FLOP") {
      if (!this.state.deck || this.state.deck.length < 3) return false;
      this.state.board = [this.state.deck.pop()!, this.state.deck.pop()!, this.state.deck.pop()!];
      this.pushLog(`--- Flop: ${this.state.board.join(" ")} ---`);
      this.state.street = next;
      this.resetForNewStreet();
      this.updateLiveHandRanks();
      if (!this.state.roundComplete) {
        this.state.dealerMessage = `Flop dealt. Action on ${this.state.players[this.state.currentTurnIndex].name}.`;
      }
    } else if (next === "TURN" || next === "RIVER") {
      if (!this.state.deck || this.state.deck.length < 1) return false;
      const c = this.state.deck.pop()!;
      this.state.board.push(c);
      this.pushLog(`--- ${next === "TURN" ? "Turn" : "River"}: ${c} ---`);
      this.state.street = next;
      this.resetForNewStreet();
      this.updateLiveHandRanks();
      if (!this.state.roundComplete) {
        this.state.dealerMessage = `${next === "TURN" ? "Turn" : "River"} dealt. Action on ${this.state.players[this.state.currentTurnIndex].name}.`;
      }
    } else if (next === "SHOWDOWN") {
      this.state.street = next;
      this.returnUnclaimedChips();
      this.updatePots();
      this.autoEvaluateAndAwardPots();
      this.state.dealerMessage = "Showdown: pots awarded. Choose Show 0/1/2, then dealer ends hand.";
      this.state.roundComplete = true;
    } else {
      return false;
    }

    appendEvent({ ts: Date.now(), type: "STREET_ADVANCED", tableId: this.tableId, sessionId: this.state.sessionId, payload: { from: prev, to: next, handNumber: this.state.handNumber, board: this.state.board } });

    // If round is already complete (all-in runout), keep advancing
    return this.state.roundComplete && this.state.street !== "SHOWDOWN";
  }

  /** Auto-advance through streets when betting is complete (handles all-in runouts too). */
  private autoAdvance() {
    while (this.state.roundComplete && this.state.street !== "DONE" && this.state.street !== "SHOWDOWN") {
      if (!this.dealNextStreet()) break;
    }
  }

  nextStreet(dealerId: string) {
    this.requireDealer(dealerId);
    if (this.state.street === "DONE") throw new Error("No active hand.");

    // Void hand: dealer force-ends during an active betting street
    if (this.state.street !== "SHOWDOWN") {
      // Refund all bets to players
      for (const p of this.state.players) {
        if (p.inHand) {
          p.stack += p.totalBet;
          p.totalBet = 0;
          p.currentBet = 0;
        }
      }
      this.state.pot = 0;
      this.state.pots = [];
      this.state.street = "DONE";
      this.state.positions = null;
      this.state.streetBet = 0;
      this.state.roundComplete = true;
      this.state.winningHandName = undefined;
      this.state.dealerMessage = "Hand voided by dealer. All bets returned.";
      this.pushLog("--- Hand voided by dealer ---");
      appendEvent({ ts: Date.now(), type: "HAND_VOIDED", tableId: this.tableId, sessionId: this.state.sessionId, payload: { handNumber: this.state.handNumber } });
      return;
    }

    if (this.state.street === "SHOWDOWN") {
      // Only manual advance: SHOWDOWN → DONE
      this.state.street = "DONE";
      this.state.positions = null;
      this.state.pots = [];
      this.state.pot = 0;
      this.state.winningHandName = undefined;
      this.state.dealerMessage = "Hand ended. Dealer may start next hand.";
      this.pushLog("--- Hand ended ---");
      appendEvent({ ts: Date.now(), type: "HAND_ENDED", tableId: this.tableId, sessionId: this.state.sessionId, payload: { handNumber: this.state.handNumber } });
      appendEvent({ ts: Date.now(), type: "STREET_ADVANCED", tableId: this.tableId, sessionId: this.state.sessionId, payload: { from: "SHOWDOWN", to: "DONE", handNumber: this.state.handNumber, board: this.state.board } });
      return;
    }

    throw new Error("Streets advance automatically. Dealer only ends the hand from showdown.");
  }

  revealHand(playerId: string) {
    const p = this.playerById(playerId);
    if (!p) throw new Error("No such player.");
    if (!p.holeCards) throw new Error("You have no cards to reveal.");
    if (this.state.showdownChoices[playerId]?.kind === "SHOW_2") throw new Error("Cards already revealed.");

    this.state.showdownChoices[playerId] = { kind: "SHOW_2" };
    const hand = evaluateBest([...p.holeCards, ...this.state.board]);
    const handStr = hand ? ` — ${hand.name}` : "";
    this.pushLog(`${p.name} reveals ${p.holeCards[0]} ${p.holeCards[1]}${handStr}.`);
    appendEvent({ ts: Date.now(), type: "SHOWDOWN_CHOICE", tableId: this.tableId, sessionId: this.state.sessionId, payload: { playerId, choice: { kind: "SHOW_2" }, voluntary: true } });
  }

  setShowdownChoice(playerId: string, choice: ShowChoice) {
    if (this.state.street !== "SHOWDOWN") throw new Error("Not in showdown.");
    this.state.showdownChoices[playerId] = choice;
    const p = this.playerById(playerId);
    if (p) {
      const hole = p.holeCards;
      if (choice.kind === "SHOW_0") {
        this.pushLog(`${p.name} mucks.`);
      } else if (choice.kind === "SHOW_2" && hole) {
        const shown = [...hole];
        const hand = evaluateBest([...shown, ...this.state.board]);
        const handStr = hand ? ` — ${hand.name}` : "";
        this.pushLog(`${p.name} shows ${hole[0]} ${hole[1]}${handStr}.`);
      } else if (choice.kind === "SHOW_1" && hole) {
        const shown = [hole[choice.cardIndex]];
        const hand = evaluateBest([...shown, ...this.state.board]);
        const handStr = hand ? ` — ${hand.name}` : "";
        this.pushLog(`${p.name} shows ${hole[choice.cardIndex]}${handStr}.`);
      }
    }
    appendEvent({ ts: Date.now(), type: "SHOWDOWN_CHOICE", tableId: this.tableId, sessionId: this.state.sessionId, payload: { playerId, choice } });
  }

  endSession(dealerId: string) {
    this.requireDealer(dealerId);
    this.ended = true;
    this.pushLog("=== Session ended ===");
    appendEvent({ ts: Date.now(), type: "SESSION_ENDED", tableId: this.tableId, sessionId: this.state.sessionId, payload: {} });
  }
}
