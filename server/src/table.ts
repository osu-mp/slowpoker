import { nanoid } from "nanoid";
import type { TableState, PlayerState, Street, ShowChoice, TableSettings, PlayerAction, HandPositions, SidePot, GameConfigUpdate, HighCardRound } from "./types.js";
import { appendEvent } from "./logger.js";
import { makeDeck, shuffle } from "./cards.js";
import { calculateOuts } from "./outs.js";
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

const RANK_SCORES: Record<string, number> = { '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'T':10,'J':11,'Q':12,'K':13,'A':14 };
function cardRank(c: string): number { return RANK_SCORES[c.slice(0, -1)] ?? 0; }

function nextStreetLabel(s: Street): string {
  switch (s) {
    case "PREFLOP": return "Flop";
    case "FLOP": return "Turn";
    case "TURN": return "River";
    case "RIVER": return "Showdown";
    default: return "next street";
  }
}

export class Table {
  public state: TableState;
  public ended = false;
  public lastActivityAt: number = Date.now();
  private pendingActors = new Set<string>();
  private lastButtonIndex = -1;

  constructor(public tableId: string) {
    const sessionId = nanoid(10);
    const now = Date.now();
    const settings: TableSettings = {
      smallBlind: 1, bigBlind: 2, straddleEnabled: false,
      blindSchedule: [], blindTrigger: "manual",
      blindTriggerMinutes: 20, blindTriggerBusts: 1,
      blindLevelIndex: -1, blindLevelStartedAt: now, blindPlayersAtStart: 0,
      rebuysEnabled: false, rebuysOpenUntil: 0,
      homeRules: { allowMidHandReveal: false, showOuts: false },
      clockSeconds: 30,
    };

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
      stackRequests: {},
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

  addPlayer(name: string, emoji?: string, watchOnly = false): PlayerState {
    const id = nanoid(8);
    const isFirst = this.state.players.length === 0;
    const isDealer = isFirst;
    const p: PlayerState = {
      id, name, emoji, isDealer, connected: true, sittingOut: watchOnly,
      stack: 0,
      inHand: false,
      folded: false,
      currentBet: 0,
      totalBet: 0
    };
    this.state.players.push(p);

    if (isFirst) this.state.adminPlayerId = id;
    if (!this.state.bankPlayerId) this.state.bankPlayerId = id;

    appendEvent({ ts: Date.now(), type: "PLAYER_JOINED", tableId: this.tableId, sessionId: this.state.sessionId, payload: { id, name, isDealer, isBank: id === this.state.bankPlayerId } });

    if (isDealer) this.state.dealerMessage = `Dealer is ${name}.`;
    if (id === this.state.bankPlayerId) this.pushLog(`${name} is the Bank.`);

    return p;
  }

  reconnectPlayer(playerId: string, name: string, emoji?: string): PlayerState | null {
    const p = this.playerById(playerId);
    if (!p || p.name !== name) return null;
    p.connected = true;
    if (emoji) p.emoji = emoji;
    this.pushLog(`${p.name} reconnected.`);
    appendEvent({ ts: Date.now(), type: "PLAYER_RECONNECTED", tableId: this.tableId, sessionId: this.state.sessionId, payload: { playerId } });
    return p;
  }

  setProfile(playerId: string, emoji: string) {
    const p = this.playerById(playerId);
    if (!p) throw new Error("No such player.");
    p.emoji = emoji;
  }

  markDisconnected(playerId: string) {
    const p = this.playerById(playerId);
    if (!p) return;
    p.connected = false;
    appendEvent({ ts: Date.now(), type: "PLAYER_DISCONNECTED", tableId: this.tableId, sessionId: this.state.sessionId, payload: { playerId } });
  }

  bootPlayer(adminId: string, targetId: string) {
    if (adminId !== this.state.adminPlayerId) throw new Error("Only the admin can remove players.");
    if (targetId === adminId) throw new Error("Admin cannot remove themselves.");
    const idx = this.state.players.findIndex(p => p.id === targetId);
    if (idx === -1) throw new Error("Player not found.");
    const p = this.state.players[idx];
    if (this.state.street !== "DONE" && p.inHand && !p.folded) {
      throw new Error("Cannot remove a player who is currently in a hand. Wait for the hand to end.");
    }
    this.state.players.splice(idx, 1);
    this.pushLog(`${p.name} was removed by admin.`);
    appendEvent({ ts: Date.now(), type: "PLAYER_BOOTED", tableId: this.tableId, sessionId: this.state.sessionId, payload: { playerId: targetId } });
  }

  setConfig(adminId: string, config: GameConfigUpdate) {
    if (adminId !== this.state.adminPlayerId) throw new Error("Only the admin can change game config.");
    const s = this.state.settings;
    if (config.straddleEnabled !== undefined) s.straddleEnabled = config.straddleEnabled;
    if (config.homeRules !== undefined) s.homeRules = { ...s.homeRules, ...config.homeRules };
    if (config.clockSeconds !== undefined) s.clockSeconds = Math.max(0, Math.floor(config.clockSeconds));
    if (config.blindTrigger !== undefined) s.blindTrigger = config.blindTrigger;
    if (config.blindTriggerMinutes !== undefined) s.blindTriggerMinutes = Math.max(1, config.blindTriggerMinutes);
    if (config.blindTriggerBusts !== undefined) s.blindTriggerBusts = Math.max(1, config.blindTriggerBusts);
    if (config.blindSchedule !== undefined) {
      s.blindSchedule = config.blindSchedule;
      if (config.blindSchedule.length > 0) {
        s.blindLevelIndex = 0;
        s.smallBlind = config.blindSchedule[0].smallBlind;
        s.bigBlind = config.blindSchedule[0].bigBlind;
        this.state.lastRaiseSize = s.bigBlind;
        s.blindLevelStartedAt = Date.now();
        s.blindPlayersAtStart = this.state.players.filter(p => p.stack > 0).length;
        this.pushLog(`Blind schedule set. Starting at ${s.smallBlind}/${s.bigBlind}.`);
      } else {
        s.blindLevelIndex = -1;
        this.pushLog(`Blind schedule cleared. Using static ${s.smallBlind}/${s.bigBlind}.`);
      }
    }
    appendEvent({ ts: Date.now(), type: "CONFIG_SET", tableId: this.tableId, sessionId: this.state.sessionId, payload: config });
  }

  setRebuys(adminId: string, enabled: boolean, minutes: number) {
    if (adminId !== this.state.adminPlayerId) throw new Error("Only the admin can manage rebuys.");
    this.state.settings.rebuysEnabled = enabled;
    if (enabled && minutes > 0) {
      this.state.settings.rebuysOpenUntil = Date.now() + minutes * 60_000;
      this.pushLog(`Rebuys open for ${minutes} minute${minutes === 1 ? "" : "s"}.`);
    } else if (enabled && minutes === 0) {
      this.state.settings.rebuysOpenUntil = Number.MAX_SAFE_INTEGER;
      this.pushLog("Rebuys open indefinitely.");
    } else {
      this.state.settings.rebuysOpenUntil = 0;
      this.pushLog("Rebuys closed.");
    }
    appendEvent({ ts: Date.now(), type: "REBUYS_SET", tableId: this.tableId, sessionId: this.state.sessionId, payload: { enabled, minutes } });
  }

  advanceBlinds(adminId: string) {
    if (adminId !== this.state.adminPlayerId) throw new Error("Only the admin can advance blinds.");
    this.doAdvanceBlinds();
  }

  private doAdvanceBlinds() {
    const s = this.state.settings;
    if (s.blindSchedule.length === 0) return;
    const nextIdx = (s.blindLevelIndex < 0 ? 0 : s.blindLevelIndex) + (s.blindLevelIndex < 0 ? 0 : 1);
    if (nextIdx >= s.blindSchedule.length) {
      this.pushLog("Already at the final blind level.");
      return;
    }
    s.blindLevelIndex = nextIdx;
    const level = s.blindSchedule[nextIdx];
    s.smallBlind = level.smallBlind;
    s.bigBlind = level.bigBlind;
    this.state.lastRaiseSize = s.bigBlind;
    s.blindLevelStartedAt = Date.now();
    s.blindPlayersAtStart = this.state.players.filter(p => p.stack > 0).length;
    this.pushLog(`Blinds advanced to level ${nextIdx + 1}: ${s.smallBlind}/${s.bigBlind}.`);
    appendEvent({ ts: Date.now(), type: "BLINDS_ADVANCED", tableId: this.tableId, sessionId: this.state.sessionId, payload: { level: nextIdx, smallBlind: s.smallBlind, bigBlind: s.bigBlind } });
  }

  private checkAutoAdvanceBlinds() {
    const s = this.state.settings;
    if (s.blindSchedule.length === 0 || s.blindLevelIndex < 0) return;
    if (s.blindTrigger === "manual") return;
    const nextIdx = s.blindLevelIndex + 1;
    if (nextIdx >= s.blindSchedule.length) return;

    let shouldAdvance = false;
    if (s.blindTrigger === "time") {
      shouldAdvance = Date.now() - s.blindLevelStartedAt >= s.blindTriggerMinutes * 60_000;
    } else if (s.blindTrigger === "bust") {
      const playersWithChips = this.state.players.filter(p => p.stack > 0).length;
      shouldAdvance = (s.blindPlayersAtStart - playersWithChips) >= s.blindTriggerBusts;
    }
    if (shouldAdvance) this.doAdvanceBlinds();
  }

  setDealer(playerId: string) {
    const p = this.playerById(playerId);
    if (!p) throw new Error("No such player.");
    for (const pl of this.state.players) pl.isDealer = (pl.id === playerId);
    this.state.dealerMessage = `Dealer is now ${p.name}.`;
    this.pushLog(`Dealer changed to ${p.name}.`);
    appendEvent({ ts: Date.now(), type: "DEALER_CHANGED", tableId: this.tableId, sessionId: this.state.sessionId, payload: { playerId } });
  }

  setBank(currentBankId: string, newBankId: string) {
    this.requireBank(currentBankId);
    const p = this.playerById(newBankId);
    if (!p) throw new Error("No such player.");
    this.state.bankPlayerId = newBankId;
    this.pushLog(`Bank transferred to ${p.name}.`);
    appendEvent({ ts: Date.now(), type: "BANK_CHANGED", tableId: this.tableId, sessionId: this.state.sessionId, payload: { playerId: newBankId } });
  }

  adminSetDealer(playerId: string) {
    const p = this.playerById(playerId);
    if (!p) throw new Error("No such player.");
    for (const pl of this.state.players) pl.isDealer = (pl.id === playerId);
    this.state.dealerMessage = `Dealer reassigned to ${p.name} (admin).`;
    this.pushLog(`Dealer reassigned to ${p.name} (admin).`);
    appendEvent({ ts: Date.now(), type: "DEALER_CHANGED", tableId: this.tableId, sessionId: this.state.sessionId, payload: { playerId } });
  }

  adminSetBank(playerId: string) {
    const p = this.playerById(playerId);
    if (!p) throw new Error("No such player.");
    this.state.bankPlayerId = playerId;
    this.pushLog(`Bank reassigned to ${p.name} (admin).`);
    appendEvent({ ts: Date.now(), type: "BANK_CHANGED", tableId: this.tableId, sessionId: this.state.sessionId, payload: { playerId } });
  }

  setStack(bankId: string, targetPlayerId: string, stack: number) {
    this.requireBank(bankId);
    const p = this.playerById(targetPlayerId);
    if (!p) throw new Error("No such player.");
    if (!Number.isFinite(stack) || stack < 0) throw new Error("Stack must be a non-negative number.");
    const before = p.stack;
    p.stack = Math.floor(stack);
    delete this.state.stackRequests[targetPlayerId];
    this.pushLog(`Bank set ${p.name}'s stack to ${p.stack}.`);
    appendEvent({ ts: Date.now(), type: "STACK_SET", tableId: this.tableId, sessionId: this.state.sessionId, payload: { playerId: targetPlayerId, stack: p.stack, before } });
  }

  setBlinds(bankId: string, smallBlind: number, bigBlind: number, straddleEnabled: boolean) {
    this.requireBank(bankId);
    if (!Number.isFinite(smallBlind) || !Number.isFinite(bigBlind) || smallBlind < 0 || bigBlind <= 0) {
      throw new Error("Invalid blinds.");
    }
    if (smallBlind >= bigBlind) throw new Error("Small blind must be < big blind.");
    this.state.settings = { ...this.state.settings, smallBlind: Math.floor(smallBlind), bigBlind: Math.floor(bigBlind), straddleEnabled: !!straddleEnabled, blindLevelIndex: -1 };
    this.state.lastRaiseSize = this.state.settings.bigBlind;
    this.pushLog(`Blinds set to ${this.state.settings.smallBlind}/${this.state.settings.bigBlind}${this.state.settings.straddleEnabled ? " with straddle" : ""}.`);
    appendEvent({ ts: Date.now(), type: "BLINDS_SET", tableId: this.tableId, sessionId: this.state.sessionId, payload: this.state.settings });
  }

  setSitOut(playerId: string, sittingOut: boolean) {
    const p = this.playerById(playerId);
    if (!p) throw new Error("No such player.");
    if (this.state.street !== "DONE") throw new Error("Cannot change sit-out status during a hand.");
    p.sittingOut = sittingOut;
    this.pushLog(`${p.name} is ${sittingOut ? "sitting out" : "back in"}.`);
    appendEvent({ ts: Date.now(), type: sittingOut ? "SIT_OUT" : "SIT_IN", tableId: this.tableId, sessionId: this.state.sessionId, payload: { playerId } });
  }

  requestStack(playerId: string, amount: number) {
    const p = this.playerById(playerId);
    if (!p) throw new Error("No such player.");
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Amount must be a positive number.");
    this.state.stackRequests[playerId] = Math.floor(amount);
    this.pushLog(`${p.name} requests ${Math.floor(amount)} chips.`);
    appendEvent({ ts: Date.now(), type: "STACK_REQUESTED", tableId: this.tableId, sessionId: this.state.sessionId, payload: { playerId, amount: Math.floor(amount) } });
  }

  clearStackRequest(bankId: string, playerId: string) {
    this.requireBank(bankId);
    delete this.state.stackRequests[playerId];
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

  private updatePlayerOuts() {
    const board = this.state.board;
    const active = board.length === 3 || board.length === 4;
    for (const p of this.state.players) {
      if (active && this.state.settings.homeRules.showOuts && p.inHand && !p.folded && p.holeCards) {
        p.outs = calculateOuts(p.holeCards, board);
      } else {
        p.outs = undefined;
      }
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
            appendEvent({ ts: Date.now(), type: "SHOWDOWN_CHOICE", tableId: this.tableId, sessionId: this.state.sessionId, payload: { playerId: wId, choice: { kind: "SHOW_2" }, auto: true, cards: [...wp.holeCards], handName: hand?.name } });
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
    appendEvent({ ts: Date.now(), type: "POST", tableId: this.tableId, sessionId: this.state.sessionId, payload: { playerId: player.id, label, amount: paid, ...(player.stack === 0 ? { allIn: true } : {}) } });
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
      this.state.dealerMessage = "Hand ended (uncontested). Players may show cards. Dealer: start next hand when ready.";
      return true;
    }
    return false;
  }

  startHand(dealerId: string) {
    this.requireDealer(dealerId);
    this.checkAutoAdvanceBlinds();
    const n = this.state.players.length;
    if (n < 2) throw new Error("Need at least 2 players.");
    const activePlayers = this.state.players.filter(p => p.connected && !p.sittingOut && p.stack > 0);
    if (activePlayers.length < 2) throw new Error("Need at least 2 active players with chips (not sitting out).");

    const buttonIndex = mod(this.lastButtonIndex + 1, n);
    this.lastButtonIndex = buttonIndex;
    const sbIndex = mod(buttonIndex + 1, n);
    const bbIndex = mod(buttonIndex + 2, n);

    this.state.pot = 0;
    this.state.pots = [];
    for (const p of this.state.players) {
      p.inHand = p.connected && !p.sittingOut;
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
    this.state.highCardRound = undefined;
    this.state.clockEndsAt = undefined;
    this.state.clockCalledBy = undefined;

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

    // Clear any running clock — player acted in time
    this.state.clockEndsAt = undefined;
    this.state.clockCalledBy = undefined;

    const toCall = Math.max(0, this.state.streetBet - p.currentBet);

    const logAct = (line: string, extra?: any) => {
      this.pushLog(line);
      appendEvent({ ts: Date.now(), type: "ACTION", tableId: this.tableId, sessionId: this.state.sessionId, payload: { playerId, street: this.state.street, action, ...extra, ...(p.stack === 0 ? { allIn: true } : {}) } });
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

  /** Deal one street. When it's an all-in runout the round is immediately complete; dealer must call nextStreet() for each remaining street. */
  private dealNextStreet() {
    const prev = this.state.street;
    const next = nextStreet(prev);

    if (next === "FLOP") {
      if (!this.state.deck || this.state.deck.length < 3) return;
      this.state.board = [this.state.deck.pop()!, this.state.deck.pop()!, this.state.deck.pop()!];
      this.pushLog(`--- Flop: ${this.state.board.join(" ")} ---`);
      this.state.street = next;
      this.resetForNewStreet();
      this.updateLiveHandRanks();
      this.updatePlayerOuts();
      this.state.dealerMessage = this.state.roundComplete
        ? `Flop dealt — all-in run-out. Dealer: click "Deal ${nextStreetLabel(next)}" to continue.`
        : `Flop dealt. Action on ${this.state.players[this.state.currentTurnIndex].name}.`;
    } else if (next === "TURN" || next === "RIVER") {
      if (!this.state.deck || this.state.deck.length < 1) return;
      const c = this.state.deck.pop()!;
      this.state.board.push(c);
      const label = next === "TURN" ? "Turn" : "River";
      this.pushLog(`--- ${label}: ${c} ---`);
      this.state.street = next;
      this.resetForNewStreet();
      this.updateLiveHandRanks();
      this.updatePlayerOuts();
      this.state.dealerMessage = this.state.roundComplete
        ? `${label} dealt — all-in run-out. Dealer: click "Deal ${nextStreetLabel(next)}" to continue.`
        : `${label} dealt. Action on ${this.state.players[this.state.currentTurnIndex].name}.`;
    } else if (next === "SHOWDOWN") {
      this.state.street = next;
      this.returnUnclaimedChips();
      this.updatePots();
      this.autoEvaluateAndAwardPots();
      if (this.allShowdownChoicesMade()) { this.endHand(); return; }
      this.state.dealerMessage = "Showdown: pots awarded. Choose Show 0/1/2, then dealer ends hand.";
      this.state.roundComplete = true;
    } else {
      return;
    }

    appendEvent({ ts: Date.now(), type: "STREET_ADVANCED", tableId: this.tableId, sessionId: this.state.sessionId, payload: { from: prev, to: next, handNumber: this.state.handNumber, board: this.state.board } });
  }

  /** After betting completes, deal exactly one street. All-in runouts pause here — dealer advances each remaining street manually. */
  private autoAdvance() {
    if (this.state.roundComplete && this.state.street !== "DONE" && this.state.street !== "SHOWDOWN") {
      this.dealNextStreet();
    }
  }

  nextStreet(dealerId: string) {
    this.requireDealer(dealerId);
    if (this.state.street === "DONE") throw new Error("No active hand.");

    if (this.state.street === "SHOWDOWN") {
      this.endHand();
      return;
    }

    // All-in run-out: betting is already complete, advance to the next street
    if (this.state.roundComplete) {
      this.dealNextStreet();
      return;
    }

    // Active betting round: dealer voids the hand and refunds all bets
    for (const p of this.state.players) {
      if (p.inHand) { p.stack += p.totalBet; p.totalBet = 0; p.currentBet = 0; }
    }
    this.state.pot = 0;
    this.state.pots = [];
    this.state.street = "DONE";
    this.state.positions = null;
    this.state.streetBet = 0;
    this.state.roundComplete = true;
    this.state.winningHandName = undefined;
    this.state.clockEndsAt = undefined;
    this.state.clockCalledBy = undefined;
    this.state.dealerMessage = "Hand voided by dealer. All bets returned.";
    this.pushLog("--- Hand voided by dealer ---");
    appendEvent({ ts: Date.now(), type: "HAND_VOIDED", tableId: this.tableId, sessionId: this.state.sessionId, payload: { handNumber: this.state.handNumber } });
  }

  revealHand(playerId: string, choice: ShowChoice = { kind: "SHOW_2" }) {
    const p = this.playerById(playerId);
    if (!p) throw new Error("No such player.");

    if (choice.kind === "SHOW_0") {
      delete this.state.showdownChoices[playerId];
      return;
    }

    if (!p.holeCards) throw new Error("You have no cards to reveal.");

    this.state.showdownChoices[playerId] = choice;
    const hole = p.holeCards;
    let shownCards: string[] = [];
    let handName: string | undefined;

    if (choice.kind === "SHOW_2") {
      shownCards = [...hole];
      handName = evaluateBest([...hole, ...this.state.board])?.name;
      if (this.state.street === "DONE") {
        const handStr = handName ? ` — ${handName}` : "";
        this.pushLog(`${p.name} reveals ${hole[0]} ${hole[1]}${handStr}.`);
      }
    } else if (choice.kind === "SHOW_1") {
      shownCards = [hole[choice.cardIndex]];
      handName = evaluateBest([hole[choice.cardIndex], ...this.state.board])?.name;
      if (this.state.street === "DONE") {
        const handStr = handName ? ` — ${handName}` : "";
        this.pushLog(`${p.name} reveals ${hole[choice.cardIndex]}${handStr}.`);
      }
    }

    appendEvent({ ts: Date.now(), type: "SHOWDOWN_CHOICE", tableId: this.tableId, sessionId: this.state.sessionId, payload: { playerId, choice, voluntary: true, cards: shownCards, handName } });
  }

  private endHand() {
    this.state.street = "DONE";
    this.state.positions = null;
    this.state.pots = [];
    this.state.pot = 0;
    this.state.winningHandName = undefined;
    this.state.dealerMessage = "Hand ended. Dealer may start next hand.";
    this.pushLog("--- Hand ended ---");
    appendEvent({ ts: Date.now(), type: "HAND_ENDED", tableId: this.tableId, sessionId: this.state.sessionId, payload: { handNumber: this.state.handNumber } });
    appendEvent({ ts: Date.now(), type: "STREET_ADVANCED", tableId: this.tableId, sessionId: this.state.sessionId, payload: { from: "SHOWDOWN", to: "DONE", handNumber: this.state.handNumber, board: this.state.board } });
    // Check bust-triggered blind advance after stacks have settled
    if (this.state.settings.blindTrigger === "bust") this.checkAutoAdvanceBlinds();
  }

  private allShowdownChoicesMade(): boolean {
    return this.state.players
      .filter(p => p.inHand && !p.folded)
      .every(p => !!this.state.showdownChoices[p.id]);
  }

  setShowdownChoice(playerId: string, choice: ShowChoice) {
    if (this.state.street !== "SHOWDOWN") throw new Error("Not in showdown.");
    this.state.showdownChoices[playerId] = choice;
    const p = this.playerById(playerId);
    let shownCards: string[] = [];
    let handName: string | undefined;
    if (p) {
      const hole = p.holeCards;
      if (choice.kind === "SHOW_0") {
        this.pushLog(`${p.name} mucks.`);
      } else if (choice.kind === "SHOW_2" && hole) {
        shownCards = [...hole];
        handName = evaluateBest([...hole, ...this.state.board])?.name;
        const handStr = handName ? ` — ${handName}` : "";
        this.pushLog(`${p.name} shows ${hole[0]} ${hole[1]}${handStr}.`);
      } else if (choice.kind === "SHOW_1" && hole) {
        shownCards = [hole[choice.cardIndex]];
        handName = evaluateBest([hole[choice.cardIndex], ...this.state.board])?.name;
        const handStr = handName ? ` — ${handName}` : "";
        this.pushLog(`${p.name} shows ${hole[choice.cardIndex]}${handStr}.`);
      }
    }
    appendEvent({ ts: Date.now(), type: "SHOWDOWN_CHOICE", tableId: this.tableId, sessionId: this.state.sessionId, payload: { playerId, choice, cards: shownCards, handName } });

    // Auto-advance to DONE once all eligible players have chosen
    if (this.allShowdownChoicesMade()) {
      this.pushLog("All players have chosen — hand complete.");
      this.endHand();
    }
  }

  // ── High-card dealer draw ──────────────────────────────────────────────

  private resolveHighCard(playerIds: string[], cards: Record<string, string>): { winnerId?: string; tiedIds: string[] } {
    const maxRank = Math.max(...playerIds.map(id => cardRank(cards[id])));
    const top = playerIds.filter(id => cardRank(cards[id]) === maxRank);
    return top.length === 1 ? { winnerId: top[0], tiedIds: [] } : { tiedIds: top };
  }

  cutForDealer(dealerId: string) {
    this.requireDealer(dealerId);
    if (this.state.street !== "DONE") throw new Error("Can only draw for dealer between hands.");
    const eligible = this.state.players.filter(p => p.connected && !p.sittingOut);
    if (eligible.length < 2) throw new Error("Need at least 2 active players to draw.");

    const deck = shuffle(makeDeck());
    const cards: Record<string, string> = {};
    for (const p of eligible) cards[p.id] = deck.pop()!;

    const result = this.resolveHighCard(eligible.map(p => p.id), cards);
    const round: HighCardRound = { cards, tiedIds: result.tiedIds, round: 1, winnerId: result.winnerId };
    this.state.highCardRound = round;

    if (result.winnerId) {
      this.setDealer(result.winnerId);
      const winner = this.playerById(result.winnerId)!;
      this.pushLog(`High card: ${winner.name} wins with ${cards[result.winnerId]} — dealer!`);
    } else {
      const names = result.tiedIds.map(id => this.playerById(id)?.name).join(", ");
      this.pushLog(`High card: tie between ${names} — redeal!`);
    }
    appendEvent({ ts: Date.now(), type: "HIGH_CARD_DRAW", tableId: this.tableId, sessionId: this.state.sessionId, payload: { cards, round: 1 } });
  }

  highCardNext(dealerId: string) {
    this.requireDealer(dealerId);
    if (!this.state.highCardRound || this.state.highCardRound.tiedIds.length === 0) {
      throw new Error("No active tie to resolve.");
    }

    const deck = shuffle(makeDeck());
    const newCards: Record<string, string> = {};
    for (const id of this.state.highCardRound.tiedIds) newCards[id] = deck.pop()!;

    const result = this.resolveHighCard(this.state.highCardRound.tiedIds, newCards);
    const round = this.state.highCardRound.round + 1;
    this.state.highCardRound = { cards: newCards, tiedIds: result.tiedIds, round, winnerId: result.winnerId };

    if (result.winnerId) {
      this.setDealer(result.winnerId);
      const winner = this.playerById(result.winnerId)!;
      this.pushLog(`Redeal round ${round}: ${winner.name} wins with ${newCards[result.winnerId]} — dealer!`);
    } else {
      const names = result.tiedIds.map(id => this.playerById(id)?.name).join(", ");
      this.pushLog(`Redeal round ${round}: still tied (${names}) — redeal!`);
    }
    appendEvent({ ts: Date.now(), type: "HIGH_CARD_DRAW", tableId: this.tableId, sessionId: this.state.sessionId, payload: { cards: newCards, round } });
  }

  // ── Call clock ─────────────────────────────────────────────────────────

  callClock(callerId: string) {
    if (this.state.street === "DONE" || this.state.street === "SHOWDOWN") throw new Error("No active betting round.");
    if (this.state.roundComplete) throw new Error("No active player to put on the clock.");
    const caller = this.playerById(callerId);
    if (!caller?.inHand || caller.folded) throw new Error("Only non-folded players in the hand can call the clock.");
    const target = this.state.players[this.state.currentTurnIndex];
    if (!target) throw new Error("No active player.");
    if (target.id === callerId) throw new Error("Cannot call the clock on yourself.");
    if (this.state.clockEndsAt) throw new Error("Clock is already running.");
    const seconds = this.state.settings.clockSeconds;
    if (!seconds) throw new Error("Clock is disabled (0 seconds configured).");
    this.state.clockEndsAt = Date.now() + seconds * 1000;
    this.state.clockCalledBy = callerId;
    this.pushLog(`⏱ Clock called on ${target.name} — ${seconds} seconds to act.`);
    appendEvent({ ts: Date.now(), type: "CLOCK_CALLED", tableId: this.tableId, sessionId: this.state.sessionId, payload: { callerId, targetId: target.id, seconds } });
  }

  /** Called by index.ts polling. Returns true if it fired and state changed. */
  expireClock(): boolean {
    if (!this.state.clockEndsAt || Date.now() < this.state.clockEndsAt) return false;
    this.state.clockEndsAt = undefined;
    this.state.clockCalledBy = undefined;
    if (this.state.street === "DONE" || this.state.street === "SHOWDOWN") return false;
    const target = this.state.players[this.state.currentTurnIndex];
    if (!target?.inHand || target.folded) return false;

    this.pushLog(`⏱ ${target.name} ran out of time — auto-folded.`);
    target.folded = true;
    this.pendingActors.delete(target.id);
    appendEvent({ ts: Date.now(), type: "ACTION", tableId: this.tableId, sessionId: this.state.sessionId, payload: { playerId: target.id, street: this.state.street, action: { kind: "FOLD" }, clockExpired: true } });

    this.updatePots();
    if (this.maybeEndHandByFolds()) return true;
    this.updateRoundComplete();
    if (this.state.roundComplete) {
      this.autoAdvance();
    } else {
      const n = this.state.players.length;
      this.state.currentTurnIndex = this.nextToActFrom(mod(this.state.currentTurnIndex + 1, n));
      this.state.dealerMessage = `Action on ${this.state.players[this.state.currentTurnIndex].name}.`;
    }
    return true;
  }

  endSession(dealerId: string) {
    this.requireDealer(dealerId);
    this.ended = true;
    this.pushLog("=== Session ended ===");
    const stacks = this.state.players.map(p => ({ id: p.id, name: p.name, stack: p.stack }));
    appendEvent({ ts: Date.now(), type: "STACKS_SNAPSHOT", tableId: this.tableId, sessionId: this.state.sessionId, payload: { stacks } });
    appendEvent({ ts: Date.now(), type: "SESSION_ENDED", tableId: this.tableId, sessionId: this.state.sessionId, payload: {} });
  }
}
