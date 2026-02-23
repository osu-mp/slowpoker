import { describe, it, expect, vi, beforeEach } from "vitest";
import { Table } from "./table.js";

// Mock the logger so tests don't write to disk
vi.mock("./logger.js", () => ({
  appendEvent: vi.fn(),
  ensureDir: vi.fn(),
  logPath: vi.fn(() => ""),
}));

function createTable(n: number, stack = 100) {
  const table = new Table("test");
  const playerIds: string[] = [];
  for (let i = 0; i < n; i++) {
    const p = table.addPlayer(`Player${i + 1}`);
    playerIds.push(p.id);
  }
  const dealerId = playerIds[0]; // first player is auto-dealer
  // Set stacks via bank (first player is also auto-bank)
  for (const id of playerIds) {
    table.setStack(dealerId, id, stack);
  }
  return { table, playerIds, dealerId };
}

function currentPlayer(table: Table): string {
  return table.state.players[table.state.currentTurnIndex].id;
}

describe("Table setup", () => {
  it("first player is dealer and bank", () => {
    const { table, playerIds } = createTable(2);
    const p0 = table.state.players[0];
    expect(p0.isDealer).toBe(true);
    expect(table.state.bankPlayerId).toBe(playerIds[0]);
  });

  it("setStack changes player stack", () => {
    const { table, playerIds, dealerId } = createTable(2);
    table.setStack(dealerId, playerIds[1], 500);
    expect(table.state.players[1].stack).toBe(500);
  });

  it("setStack rejects non-bank", () => {
    const { table, playerIds } = createTable(2);
    expect(() => table.setStack(playerIds[1], playerIds[0], 500)).toThrow("Bank");
  });

  it("setDealer changes dealer", () => {
    const { table, playerIds } = createTable(2);
    table.setDealer(playerIds[1]);
    expect(table.state.players[0].isDealer).toBe(false);
    expect(table.state.players[1].isDealer).toBe(true);
  });

  it("setBlinds updates settings", () => {
    const { table, dealerId } = createTable(2);
    table.setBlinds(dealerId, 5, 10, true);
    expect(table.state.settings.smallBlind).toBe(5);
    expect(table.state.settings.bigBlind).toBe(10);
    expect(table.state.settings.straddleEnabled).toBe(true);
  });

  it("setBlinds rejects sb >= bb", () => {
    const { table, dealerId } = createTable(2);
    expect(() => table.setBlinds(dealerId, 10, 10, false)).toThrow();
  });
});

describe("startHand", () => {
  it("requires dealer to start", () => {
    const { table, playerIds } = createTable(2);
    expect(() => table.startHand(playerIds[1])).toThrow("dealer");
  });

  it("requires min 2 players with chips", () => {
    const table = new Table("test");
    const p1 = table.addPlayer("P1");
    table.addPlayer("P2");
    table.setStack(p1.id, p1.id, 100);
    // P2 has 0 chips
    expect(() => table.startHand(p1.id)).toThrow("chips");
  });

  it("posts blinds and deals cards", () => {
    const { table, dealerId } = createTable(3);
    table.startHand(dealerId);

    expect(table.state.street).toBe("PREFLOP");
    expect(table.state.handNumber).toBe(1);

    // All players should have hole cards
    for (const p of table.state.players) {
      expect(p.holeCards).toBeDefined();
      expect(p.holeCards).toHaveLength(2);
    }

    // Blinds posted (with 3 players: SB is player[1], BB is player[2])
    expect(table.state.pot).toBeGreaterThan(0);
  });

  it("first hand button starts at index 0", () => {
    const { table, dealerId } = createTable(3);
    table.startHand(dealerId);
    expect(table.state.positions!.buttonIndex).toBe(0);
  });
});

describe("act", () => {
  it("fold removes player from hand", () => {
    const { table, dealerId } = createTable(3);
    table.startHand(dealerId);
    const cp = currentPlayer(table);
    table.act(cp, { kind: "FOLD" });
    const p = table.state.players.find(p => p.id === cp)!;
    expect(p.folded).toBe(true);
  });

  it("check works when no bet", () => {
    const { table, dealerId } = createTable(2);
    table.startHand(dealerId);

    // Fold out to end first hand, start second to get past preflop complexity
    // Instead, let's call BB and get to flop
    const cp = currentPlayer(table);
    table.act(cp, { kind: "CALL" });
    // BB checks (if round not complete, BB gets to act)
    if (table.state.street === "PREFLOP" && !table.state.roundComplete) {
      const cp2 = currentPlayer(table);
      table.act(cp2, { kind: "CHECK" });
    }

    // Should be on FLOP now
    if (table.state.street === "FLOP") {
      const cp3 = currentPlayer(table);
      table.act(cp3, { kind: "CHECK" });
      // Should not throw
    }
  });

  it("check fails when there is a bet", () => {
    const { table, dealerId } = createTable(2);
    table.startHand(dealerId);
    // First to act preflop must call/raise/fold, not check (BB is a bet)
    const cp = currentPlayer(table);
    expect(() => table.act(cp, { kind: "CHECK" })).toThrow("check");
  });

  it("call matches the street bet", () => {
    const { table, dealerId } = createTable(2);
    table.startHand(dealerId);
    const cp = currentPlayer(table);
    const before = table.state.players.find(p => p.id === cp)!.stack;
    table.act(cp, { kind: "CALL" });
    const after = table.state.players.find(p => p.id === cp)!.stack;
    expect(after).toBeLessThan(before);
  });

  it("bet creates a new wager", () => {
    const { table, dealerId } = createTable(2);
    table.startHand(dealerId);
    // Call to get past preflop
    table.act(currentPlayer(table), { kind: "CALL" });
    if (table.state.street === "PREFLOP") {
      table.act(currentPlayer(table), { kind: "CHECK" });
    }
    if (table.state.street === "FLOP") {
      const cp = currentPlayer(table);
      table.act(cp, { kind: "BET", to: 10 });
      expect(table.state.streetBet).toBe(10);
    }
  });

  it("raise increases the street bet", () => {
    const { table, dealerId } = createTable(3);
    table.startHand(dealerId);
    // UTG calls
    table.act(currentPlayer(table), { kind: "CALL" });
    // SB calls
    table.act(currentPlayer(table), { kind: "CALL" });
    // BB raises
    const cp = currentPlayer(table);
    const bb = table.state.players.find(p => p.id === cp)!;
    table.act(cp, { kind: "RAISE", to: 8 });
    expect(table.state.streetBet).toBe(8);
  });

  it("rejects action from wrong player", () => {
    const { table, dealerId, playerIds } = createTable(3);
    table.startHand(dealerId);
    const cp = currentPlayer(table);
    const wrongPlayer = playerIds.find(id => id !== cp)!;
    expect(() => table.act(wrongPlayer, { kind: "FOLD" })).toThrow("turn");
  });

  it("all-in caps at player stack", () => {
    const { table, dealerId, playerIds } = createTable(2, 50);
    table.startHand(dealerId);
    const cp = currentPlayer(table);
    const p = table.state.players.find(p => p.id === cp)!;
    // Raise to more than stack — should cap
    table.act(cp, { kind: "RAISE", to: 999 });
    expect(p.stack).toBe(0);
  });
});

describe("turn order", () => {
  it("advances to next player after action", () => {
    const { table, dealerId } = createTable(3);
    table.startHand(dealerId);
    const first = currentPlayer(table);
    table.act(first, { kind: "CALL" });
    const second = currentPlayer(table);
    expect(second).not.toBe(first);
  });

  it("skips folded players", () => {
    const { table, dealerId } = createTable(3);
    table.startHand(dealerId);
    const p1 = currentPlayer(table);
    table.act(p1, { kind: "FOLD" });
    // Next action
    const p2 = currentPlayer(table);
    table.act(p2, { kind: "CALL" });
    // BB should be next (not p1 who folded), or round completes
    if (table.state.street === "PREFLOP" && !table.state.roundComplete) {
      expect(currentPlayer(table)).not.toBe(p1);
    }
  });
});

describe("fold-out (uncontested)", () => {
  it("last player wins when all others fold", () => {
    const { table, dealerId, playerIds } = createTable(3);
    table.startHand(dealerId);

    // Everyone folds except one
    table.act(currentPlayer(table), { kind: "FOLD" });
    // Next player to act
    if (table.state.street !== "DONE") {
      table.act(currentPlayer(table), { kind: "FOLD" });
    }

    expect(table.state.street).toBe("DONE");
    // The remaining player should have won the pot
    const nonFolded = table.state.players.filter(p => p.inHand && !p.folded);
    // Pot should be 0 (awarded)
    expect(table.state.pot).toBe(0);
  });
});

describe("street progression", () => {
  function advanceToStreet(table: Table, targetStreet: string) {
    // Simple: everyone checks/calls until target street
    let safety = 50;
    while (table.state.street !== targetStreet && table.state.street !== "DONE" && safety-- > 0) {
      const cp = currentPlayer(table);
      const p = table.state.players.find(p => p.id === cp)!;
      const toCall = table.state.streetBet - p.currentBet;
      if (toCall > 0) {
        table.act(cp, { kind: "CALL" });
      } else {
        table.act(cp, { kind: "CHECK" });
      }
    }
  }

  it("auto-advances PREFLOP → FLOP", () => {
    const { table, dealerId } = createTable(2);
    table.startHand(dealerId);
    advanceToStreet(table, "FLOP");
    expect(table.state.street).toBe("FLOP");
    expect(table.state.board).toHaveLength(3);
  });

  it("auto-advances FLOP → TURN", () => {
    const { table, dealerId } = createTable(2);
    table.startHand(dealerId);
    advanceToStreet(table, "TURN");
    expect(table.state.street).toBe("TURN");
    expect(table.state.board).toHaveLength(4);
  });

  it("auto-advances TURN → RIVER", () => {
    const { table, dealerId } = createTable(2);
    table.startHand(dealerId);
    advanceToStreet(table, "RIVER");
    expect(table.state.street).toBe("RIVER");
    expect(table.state.board).toHaveLength(5);
  });

  it("auto-advances RIVER → SHOWDOWN", () => {
    const { table, dealerId } = createTable(2);
    table.startHand(dealerId);
    advanceToStreet(table, "SHOWDOWN");
    expect(table.state.street).toBe("SHOWDOWN");
    expect(table.state.board).toHaveLength(5);
  });
});

describe("showdown", () => {
  function playToShowdown(table: Table) {
    let safety = 50;
    while (table.state.street !== "SHOWDOWN" && table.state.street !== "DONE" && safety-- > 0) {
      const cp = currentPlayer(table);
      const p = table.state.players.find(p => p.id === cp)!;
      const toCall = table.state.streetBet - p.currentBet;
      if (toCall > 0) {
        table.act(cp, { kind: "CALL" });
      } else {
        table.act(cp, { kind: "CHECK" });
      }
    }
  }

  it("auto-advances to DONE when all showdown choices made", () => {
    const { table, dealerId, playerIds } = createTable(2);
    table.startHand(dealerId);
    playToShowdown(table);

    if (table.state.street === "SHOWDOWN") {
      // Make choices for remaining players
      for (const p of table.state.players) {
        if (p.inHand && !p.folded && !table.state.showdownChoices[p.id]) {
          table.setShowdownChoice(p.id, { kind: "SHOW_0" });
        }
      }
      expect(table.state.street).toBe("DONE");
    }
  });

  it("dealer can force-end hand from showdown", () => {
    const { table, dealerId } = createTable(2);
    table.startHand(dealerId);
    playToShowdown(table);

    if (table.state.street === "SHOWDOWN") {
      table.nextStreet(dealerId);
      expect(table.state.street).toBe("DONE");
    }
  });
});

describe("void hand", () => {
  it("refunds all bets when dealer voids", () => {
    const { table, dealerId, playerIds } = createTable(2);
    const stacksBefore = table.state.players.map(p => p.stack);
    table.startHand(dealerId);

    // Void the hand
    table.nextStreet(dealerId);

    expect(table.state.street).toBe("DONE");
    expect(table.state.pot).toBe(0);
    // Stacks should be restored
    for (let i = 0; i < table.state.players.length; i++) {
      expect(table.state.players[i].stack).toBe(stacksBefore[i]);
    }
  });
});

describe("reconnection", () => {
  it("reconnectPlayer succeeds with matching name", () => {
    const { table, playerIds } = createTable(2);
    table.markDisconnected(playerIds[0]);
    expect(table.state.players[0].connected).toBe(false);

    const result = table.reconnectPlayer(playerIds[0], "Player1");
    expect(result).not.toBeNull();
    expect(table.state.players[0].connected).toBe(true);
  });

  it("reconnectPlayer fails with wrong name", () => {
    const { table, playerIds } = createTable(2);
    table.markDisconnected(playerIds[0]);
    const result = table.reconnectPlayer(playerIds[0], "WrongName");
    expect(result).toBeNull();
  });

  it("reconnectPlayer fails with unknown id", () => {
    const { table } = createTable(2);
    const result = table.reconnectPlayer("unknown", "Player1");
    expect(result).toBeNull();
  });

  it("markDisconnected sets connected to false", () => {
    const { table, playerIds } = createTable(2);
    table.markDisconnected(playerIds[0]);
    expect(table.state.players[0].connected).toBe(false);
  });
});

describe("multi-way all-ins", () => {
  function createTableWithStacks(stacks: number[]) {
    const table = new Table("test");
    const playerIds: string[] = [];
    for (let i = 0; i < stacks.length; i++) {
      const p = table.addPlayer(`Player${i + 1}`);
      playerIds.push(p.id);
    }
    const dealerId = playerIds[0];
    for (let i = 0; i < stacks.length; i++) {
      table.setStack(dealerId, playerIds[i], stacks[i]);
    }
    return { table, playerIds, dealerId };
  }

  it("2-player all-in: chips are conserved", () => {
    const stacks = [50, 100];
    const total = stacks.reduce((a, b) => a + b, 0);
    const { table, dealerId } = createTableWithStacks(stacks);
    table.startHand(dealerId);

    // First to act shoves all-in
    table.act(currentPlayer(table), { kind: "RAISE", to: 999 });
    // Other player calls
    if (table.state.street !== "DONE") {
      table.act(currentPlayer(table), { kind: "CALL" });
    }

    // Should auto-advance through all streets to showdown (both all-in or one is)
    // Finish the hand
    if (table.state.street === "SHOWDOWN") {
      for (const p of table.state.players) {
        if (p.inHand && !p.folded && !table.state.showdownChoices[p.id]) {
          table.setShowdownChoice(p.id, { kind: "SHOW_2" });
        }
      }
    }

    expect(table.state.street).toBe("DONE");
    const finalTotal = table.state.players.reduce((s, p) => s + p.stack, 0);
    expect(finalTotal).toBe(total);
  });

  it("2-player all-in with unequal stacks: creates main pot and auto-awarded side pot", () => {
    const { table, dealerId, playerIds } = createTableWithStacks([30, 100]);
    table.startHand(dealerId);

    // First to act shoves
    table.act(currentPlayer(table), { kind: "RAISE", to: 999 });
    // Other player calls
    if (table.state.street !== "DONE" && table.state.street !== "SHOWDOWN") {
      table.act(currentPlayer(table), { kind: "CALL" });
    }

    if (table.state.street === "SHOWDOWN") {
      // Main pot: both contributed up to the short stack's total (contested)
      // Side pot: bigger stack's excess (auto-awarded back, single eligible)
      expect(table.state.pots.length).toBe(2);
      // Main pot is contested by both
      expect(table.state.pots[0].eligiblePlayerIds).toHaveLength(2);
      // Side pot has only the bigger stack eligible (auto-awarded)
      expect(table.state.pots[1].eligiblePlayerIds).toHaveLength(1);

      for (const p of table.state.players) {
        if (p.inHand && !p.folded && !table.state.showdownChoices[p.id]) {
          table.setShowdownChoice(p.id, { kind: "SHOW_2" });
        }
      }
    }

    expect(table.state.street).toBe("DONE");
    const finalTotal = table.state.players.reduce((s, p) => s + p.stack, 0);
    expect(finalTotal).toBe(130);
  });

  it("3-player all-in with different stacks creates main pot and side pot", () => {
    // Player1: 50, Player2: 100, Player3: 200
    const { table, dealerId, playerIds } = createTableWithStacks([50, 100, 200]);
    table.startHand(dealerId);

    // Everyone shoves
    table.act(currentPlayer(table), { kind: "RAISE", to: 999 });
    if (table.state.street !== "DONE" && table.state.street !== "SHOWDOWN") {
      table.act(currentPlayer(table), { kind: "RAISE", to: 999 });
    }
    if (table.state.street !== "DONE" && table.state.street !== "SHOWDOWN") {
      table.act(currentPlayer(table), { kind: "CALL" });
    }

    // Should auto-advance to SHOWDOWN
    if (table.state.street === "SHOWDOWN") {
      // Should have main pot (50*3=150) and side pot (50*2=100)
      // Excess from Player3 (100) returned
      expect(table.state.pots.length).toBe(2);

      // Main pot: all 3 eligible
      expect(table.state.pots[0].eligiblePlayerIds).toHaveLength(3);
      expect(table.state.pots[0].amount).toBe(150); // 50 * 3

      // Side pot: only Player2 and Player3 eligible
      expect(table.state.pots[1].eligiblePlayerIds).toHaveLength(2);
      expect(table.state.pots[1].amount).toBe(100); // 50 * 2

      for (const p of table.state.players) {
        if (p.inHand && !p.folded && !table.state.showdownChoices[p.id]) {
          table.setShowdownChoice(p.id, { kind: "SHOW_2" });
        }
      }
    }

    expect(table.state.street).toBe("DONE");
    const finalTotal = table.state.players.reduce((s, p) => s + p.stack, 0);
    expect(finalTotal).toBe(350);
  });

  it("3-player: two all-in, one folds — chips conserved", () => {
    const { table, dealerId } = createTableWithStacks([50, 100, 100]);
    table.startHand(dealerId);

    // First player (UTG) shoves
    table.act(currentPlayer(table), { kind: "RAISE", to: 999 });
    // SB folds
    if (table.state.street !== "DONE") {
      table.act(currentPlayer(table), { kind: "FOLD" });
    }
    // BB calls
    if (table.state.street !== "DONE") {
      table.act(currentPlayer(table), { kind: "CALL" });
    }

    // Finish hand
    if (table.state.street === "SHOWDOWN") {
      for (const p of table.state.players) {
        if (p.inHand && !p.folded && !table.state.showdownChoices[p.id]) {
          table.setShowdownChoice(p.id, { kind: "SHOW_2" });
        }
      }
    }

    expect(table.state.street).toBe("DONE");
    const finalTotal = table.state.players.reduce((s, p) => s + p.stack, 0);
    expect(finalTotal).toBe(250);
  });

  it("all-in auto-runs out all streets without manual advance", () => {
    const { table, dealerId } = createTableWithStacks([50, 50]);
    table.startHand(dealerId);

    // Both players go all-in preflop
    table.act(currentPlayer(table), { kind: "RAISE", to: 999 });
    if (table.state.street !== "DONE" && table.state.street !== "SHOWDOWN") {
      table.act(currentPlayer(table), { kind: "CALL" });
    }

    // Should auto-advance all the way to SHOWDOWN (no manual street advances needed)
    expect(table.state.street).toBe("SHOWDOWN");
    expect(table.state.board).toHaveLength(5); // Full board dealt

    for (const p of table.state.players) {
      if (p.inHand && !p.folded && !table.state.showdownChoices[p.id]) {
        table.setShowdownChoice(p.id, { kind: "SHOW_2" });
      }
    }
    expect(table.state.street).toBe("DONE");
  });

  it("4-player all-in with 3 different stack sizes creates correct pots", () => {
    // P1:25, P2:50, P3:50, P4:100
    const { table, dealerId } = createTableWithStacks([25, 50, 50, 100]);
    table.startHand(dealerId);

    // Everyone shoves in order
    table.act(currentPlayer(table), { kind: "RAISE", to: 999 });
    for (let i = 0; i < 3; i++) {
      if (table.state.street !== "DONE" && table.state.street !== "SHOWDOWN") {
        const cp = currentPlayer(table);
        const p = table.state.players.find(p => p.id === cp)!;
        if (p.stack > 0) {
          const toCall = table.state.streetBet - p.currentBet;
          if (toCall > 0) table.act(cp, { kind: "CALL" });
          else table.act(cp, { kind: "RAISE", to: 999 });
        }
      }
    }

    if (table.state.street === "SHOWDOWN") {
      // 3 distinct contribution levels create 3 pots:
      // Main pot: 25 * 4 = 100 (all 4 eligible)
      // Side pot 1: 25 * 3 = 75 (P2, P3, P4 eligible)
      // Side pot 2: 50 * 1 = 50 (only P4 eligible, auto-awarded)
      expect(table.state.pots.length).toBe(3);
      expect(table.state.pots[0].eligiblePlayerIds).toHaveLength(4);
      expect(table.state.pots[0].amount).toBe(100);
      expect(table.state.pots[1].eligiblePlayerIds).toHaveLength(3);
      expect(table.state.pots[1].amount).toBe(75);
      expect(table.state.pots[2].eligiblePlayerIds).toHaveLength(1);
      expect(table.state.pots[2].amount).toBe(50);

      for (const p of table.state.players) {
        if (p.inHand && !p.folded && !table.state.showdownChoices[p.id]) {
          table.setShowdownChoice(p.id, { kind: "SHOW_2" });
        }
      }
    }

    expect(table.state.street).toBe("DONE");
    const finalTotal = table.state.players.reduce((s, p) => s + p.stack, 0);
    expect(finalTotal).toBe(225);
  });

  it("all-in on later street: preflop play then flop shove", () => {
    const { table, dealerId } = createTableWithStacks([100, 100, 100]);
    table.startHand(dealerId);

    // Preflop: everyone calls
    table.act(currentPlayer(table), { kind: "CALL" }); // UTG
    table.act(currentPlayer(table), { kind: "CALL" }); // SB
    table.act(currentPlayer(table), { kind: "CHECK" }); // BB

    expect(table.state.street).toBe("FLOP");

    // Flop: first player shoves, everyone calls
    table.act(currentPlayer(table), { kind: "BET", to: 999 });
    if (table.state.street !== "DONE" && table.state.street !== "SHOWDOWN") {
      table.act(currentPlayer(table), { kind: "CALL" });
    }
    if (table.state.street !== "DONE" && table.state.street !== "SHOWDOWN") {
      table.act(currentPlayer(table), { kind: "CALL" });
    }

    // All-in runout should auto-advance to showdown
    expect(table.state.street).toBe("SHOWDOWN");
    expect(table.state.board).toHaveLength(5);

    // Single pot: 100 * 3 = 300
    expect(table.state.pots.length).toBe(1);
    expect(table.state.pots[0].amount).toBe(300);
    expect(table.state.pots[0].eligiblePlayerIds).toHaveLength(3);

    for (const p of table.state.players) {
      if (p.inHand && !p.folded && !table.state.showdownChoices[p.id]) {
        table.setShowdownChoice(p.id, { kind: "SHOW_2" });
      }
    }
    expect(table.state.street).toBe("DONE");
    const finalTotal = table.state.players.reduce((s, p) => s + p.stack, 0);
    expect(finalTotal).toBe(300);
  });

  it("short stack all-in, others continue betting — side pot grows", () => {
    const { table, dealerId, playerIds } = createTableWithStacks([20, 200, 200]);
    table.startHand(dealerId);

    // UTG (short stack, 20 chips) shoves
    table.act(currentPlayer(table), { kind: "RAISE", to: 999 });
    // SB calls
    if (table.state.street !== "DONE" && table.state.street !== "SHOWDOWN") {
      table.act(currentPlayer(table), { kind: "CALL" });
    }
    // BB calls
    if (table.state.street !== "DONE" && table.state.street !== "SHOWDOWN") {
      table.act(currentPlayer(table), { kind: "CALL" });
    }

    // Short stack is all-in but other two can still bet on flop
    if (table.state.street === "FLOP") {
      // SB bets
      table.act(currentPlayer(table), { kind: "BET", to: 50 });
      // BB calls
      table.act(currentPlayer(table), { kind: "CALL" });
    }

    if (table.state.street === "TURN") {
      // Both check through
      table.act(currentPlayer(table), { kind: "CHECK" });
      table.act(currentPlayer(table), { kind: "CHECK" });
    }

    if (table.state.street === "RIVER") {
      table.act(currentPlayer(table), { kind: "CHECK" });
      table.act(currentPlayer(table), { kind: "CHECK" });
    }

    expect(table.state.street).toBe("SHOWDOWN");

    // Main pot: 20 * 3 = 60 (all 3 eligible)
    // Side pot: from continued betting between P2 and P3
    expect(table.state.pots.length).toBeGreaterThanOrEqual(2);
    expect(table.state.pots[0].eligiblePlayerIds).toHaveLength(3);
    expect(table.state.pots[0].amount).toBe(60);
    // Side pot has the extra betting (at least 30*2 from the extra flop bets)
    expect(table.state.pots[1].eligiblePlayerIds).toHaveLength(2);

    for (const p of table.state.players) {
      if (p.inHand && !p.folded && !table.state.showdownChoices[p.id]) {
        table.setShowdownChoice(p.id, { kind: "SHOW_2" });
      }
    }
    expect(table.state.street).toBe("DONE");
    const finalTotal = table.state.players.reduce((s, p) => s + p.stack, 0);
    expect(finalTotal).toBe(420);
  });

  it("one player folds in multi-way all-in — not eligible for pot", () => {
    const { table, dealerId, playerIds } = createTableWithStacks([50, 50, 50]);
    table.startHand(dealerId);

    // UTG raises
    table.act(currentPlayer(table), { kind: "RAISE", to: 20 });
    // SB folds
    table.act(currentPlayer(table), { kind: "FOLD" });
    // BB shoves
    if (table.state.street !== "DONE") {
      table.act(currentPlayer(table), { kind: "RAISE", to: 999 });
    }
    // UTG calls all-in
    if (table.state.street !== "DONE" && table.state.street !== "SHOWDOWN") {
      table.act(currentPlayer(table), { kind: "CALL" });
    }

    if (table.state.street === "SHOWDOWN") {
      // Only 2 eligible in the main pot (SB folded)
      for (const pot of table.state.pots) {
        // Folded player should not be eligible
        const sbId = playerIds[1]; // SB
        expect(pot.eligiblePlayerIds).not.toContain(sbId);
      }

      for (const p of table.state.players) {
        if (p.inHand && !p.folded && !table.state.showdownChoices[p.id]) {
          table.setShowdownChoice(p.id, { kind: "SHOW_2" });
        }
      }
    }

    expect(table.state.street).toBe("DONE");
    const finalTotal = table.state.players.reduce((s, p) => s + p.stack, 0);
    expect(finalTotal).toBe(150);
  });

  it("back-to-back all-in hands conserve chips", () => {
    const { table, dealerId, playerIds } = createTableWithStacks([100, 100]);
    const total = 200;

    // Play two consecutive hands with all-ins
    for (let hand = 0; hand < 2; hand++) {
      // Skip if a player has 0 chips
      const withChips = table.state.players.filter(p => p.stack > 0);
      if (withChips.length < 2) break;

      table.startHand(dealerId);
      table.act(currentPlayer(table), { kind: "RAISE", to: 999 });
      if (table.state.street !== "DONE" && table.state.street !== "SHOWDOWN") {
        table.act(currentPlayer(table), { kind: "CALL" });
      }
      if (table.state.street === "SHOWDOWN") {
        for (const p of table.state.players) {
          if (p.inHand && !p.folded && !table.state.showdownChoices[p.id]) {
            table.setShowdownChoice(p.id, { kind: "SHOW_2" });
          }
        }
      }
      expect(table.state.street).toBe("DONE");
    }

    const finalTotal = table.state.players.reduce((s, p) => s + p.stack, 0);
    expect(finalTotal).toBe(total);
  });
});

describe("integration: full hand", () => {
  it("plays a complete hand from preflop through showdown", () => {
    const { table, dealerId, playerIds } = createTable(3, 200);
    table.startHand(dealerId);
    expect(table.state.street).toBe("PREFLOP");
    expect(table.state.handNumber).toBe(1);

    // Preflop: UTG calls, SB calls, BB checks
    table.act(currentPlayer(table), { kind: "CALL" });
    table.act(currentPlayer(table), { kind: "CALL" });
    table.act(currentPlayer(table), { kind: "CHECK" });

    // Flop
    expect(table.state.street).toBe("FLOP");
    expect(table.state.board).toHaveLength(3);
    table.act(currentPlayer(table), { kind: "CHECK" });
    table.act(currentPlayer(table), { kind: "CHECK" });
    table.act(currentPlayer(table), { kind: "CHECK" });

    // Turn
    expect(table.state.street).toBe("TURN");
    expect(table.state.board).toHaveLength(4);
    table.act(currentPlayer(table), { kind: "CHECK" });
    table.act(currentPlayer(table), { kind: "CHECK" });
    table.act(currentPlayer(table), { kind: "CHECK" });

    // River
    expect(table.state.street).toBe("RIVER");
    expect(table.state.board).toHaveLength(5);
    table.act(currentPlayer(table), { kind: "CHECK" });
    table.act(currentPlayer(table), { kind: "CHECK" });
    table.act(currentPlayer(table), { kind: "CHECK" });

    // Showdown
    expect(table.state.street).toBe("SHOWDOWN");

    // Make showdown choices for non-auto-shown players
    for (const p of table.state.players) {
      if (p.inHand && !p.folded && !table.state.showdownChoices[p.id]) {
        table.setShowdownChoice(p.id, { kind: "SHOW_2" });
      }
    }

    expect(table.state.street).toBe("DONE");

    // Total stacks should equal starting total (200 * 3 = 600)
    const totalStacks = table.state.players.reduce((s, p) => s + p.stack, 0);
    expect(totalStacks).toBe(600);
  });
});
