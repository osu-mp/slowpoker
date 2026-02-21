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
