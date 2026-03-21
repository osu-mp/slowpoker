import { describe, it, expect } from "vitest";
import { summarize } from "./recap.js";
import type { LogEvent } from "./recap.js";

function ev(type: string, payload?: any): LogEvent {
  return { ts: 1000, type, tableId: "t1", sessionId: "s1", payload };
}

const SESSION_START = ev("SESSION_STARTED");
const SESSION_END = ev("SESSION_ENDED");

function handStart(handNumber: number) {
  return ev("HAND_STARTED", { handNumber, settings: { smallBlind: 1, bigBlind: 2 } });
}

describe("summarize() — basics", () => {
  it("empty events returns zeroes", () => {
    const s = summarize([]);
    expect(s.hands).toBe(0);
    expect(s.actions).toBe(0);
    expect(s.posts).toBe(0);
    expect(s.playerStats).toEqual([]);
    expect(s.biggestPot).toBeNull();
    expect(s.knockouts).toEqual([]);
    expect(s.allIns).toEqual([]);
  });

  it("counts hands, actions, posts", () => {
    const events: LogEvent[] = [
      SESSION_START,
      handStart(1),
      ev("POST", { playerId: "p1", label: "SB", amount: 1 }),
      ev("POST", { playerId: "p2", label: "BB", amount: 2 }),
      ev("ACTION", { playerId: "p1", street: "PREFLOP", action: { kind: "CALL" } }),
      ev("ACTION", { playerId: "p2", street: "PREFLOP", action: { kind: "CHECK" } }),
      SESSION_END,
    ];
    const s = summarize(events);
    expect(s.hands).toBe(1);
    expect(s.actions).toBe(2);
    expect(s.posts).toBe(2);
  });

  it("computes durationMin from timestamps", () => {
    const start = { ...SESSION_START, ts: 1000 };
    const end = { ...SESSION_END, ts: 1000 + 90 * 60 * 1000 };
    const s = summarize([start, end]);
    expect(s.durationMin).toBe(90);
  });
});

describe("summarize() — player stats", () => {
  it("registers player from PLAYER_JOINED name map", () => {
    const events: LogEvent[] = [
      ev("PLAYER_JOINED", { id: "p1", name: "Alice" }),
      handStart(1),
      ev("ACTION", { playerId: "p1", street: "PREFLOP", action: { kind: "CHECK" } }),
      ev("HAND_WON_UNCONTESTED", { handNumber: 1, winnerId: "p1", amount: 50 }),
    ];
    const s = summarize(events);
    expect(s.playerStats[0].name).toBe("Alice");
  });

  it("counts handsPlayed via POST and ACTION participation", () => {
    const events: LogEvent[] = [
      ev("PLAYER_JOINED", { id: "p1", name: "Alice" }),
      ev("PLAYER_JOINED", { id: "p2", name: "Bob" }),
      handStart(1),
      ev("POST", { playerId: "p1", label: "SB", amount: 1 }),
      ev("ACTION", { playerId: "p2", street: "PREFLOP", action: { kind: "FOLD" } }),
      ev("HAND_WON_UNCONTESTED", { handNumber: 1, winnerId: "p1", amount: 1 }),
      handStart(2),
      ev("POST", { playerId: "p2", label: "SB", amount: 1 }),
      ev("ACTION", { playerId: "p1", street: "PREFLOP", action: { kind: "FOLD" } }),
      ev("HAND_WON_UNCONTESTED", { handNumber: 2, winnerId: "p2", amount: 1 }),
    ];
    const s = summarize(events);
    const alice = s.playerStats.find(p => p.name === "Alice")!;
    const bob = s.playerStats.find(p => p.name === "Bob")!;
    expect(alice.handsPlayed).toBe(2);
    expect(bob.handsPlayed).toBe(2);
  });

  it("does not double-count handsPlayed for multiple actions in same hand", () => {
    const events: LogEvent[] = [
      ev("PLAYER_JOINED", { id: "p1", name: "Alice" }),
      handStart(1),
      ev("ACTION", { playerId: "p1", street: "PREFLOP", action: { kind: "CALL" } }),
      ev("ACTION", { playerId: "p1", street: "FLOP", action: { kind: "CHECK" } }),
      ev("ACTION", { playerId: "p1", street: "RIVER", action: { kind: "CHECK" } }),
      ev("HAND_WON_UNCONTESTED", { handNumber: 1, winnerId: "p1", amount: 10 }),
    ];
    const s = summarize(events);
    expect(s.playerStats[0].handsPlayed).toBe(1);
  });

  it("playerStats sorted by chipsWon descending", () => {
    const events: LogEvent[] = [
      ev("PLAYER_JOINED", { id: "p1", name: "Alice" }),
      ev("PLAYER_JOINED", { id: "p2", name: "Bob" }),
      handStart(1),
      ev("POT_AWARDED", { handNumber: 1, potIndex: 0, winnerIds: ["p1"], amount: 100 }),
      handStart(2),
      ev("POT_AWARDED", { handNumber: 2, potIndex: 0, winnerIds: ["p2"], amount: 200 }),
    ];
    const s = summarize(events);
    expect(s.playerStats[0].name).toBe("Bob");
    expect(s.playerStats[1].name).toBe("Alice");
  });
});

describe("summarize() — pot awards", () => {
  it("HAND_WON_UNCONTESTED credits winner and sets biggestPot", () => {
    const events: LogEvent[] = [
      ev("PLAYER_JOINED", { id: "p1", name: "Alice" }),
      handStart(1),
      ev("ACTION", { playerId: "p1", street: "PREFLOP", action: { kind: "FOLD" } }),
      ev("HAND_WON_UNCONTESTED", { handNumber: 1, winnerId: "p1", amount: 75 }),
    ];
    const s = summarize(events);
    expect(s.playerStats[0].potsWon).toBe(1);
    expect(s.playerStats[0].chipsWon).toBe(75);
    expect(s.biggestPot).toMatchObject({ amount: 75, handNumber: 1 });
  });

  it("POT_AWARDED credits winner", () => {
    const events: LogEvent[] = [
      ev("PLAYER_JOINED", { id: "p1", name: "Alice" }),
      handStart(1),
      ev("POT_AWARDED", { handNumber: 1, potIndex: 0, winnerIds: ["p1"], amount: 120 }),
    ];
    const s = summarize(events);
    expect(s.playerStats[0].chipsWon).toBe(120);
    expect(s.playerStats[0].potsWon).toBe(1);
  });

  it("only counts main pot (potIndex=0) towards potsWon to avoid double-counting side pots", () => {
    const events: LogEvent[] = [
      ev("PLAYER_JOINED", { id: "p1", name: "Alice" }),
      handStart(1),
      ev("POT_AWARDED", { handNumber: 1, potIndex: 0, winnerIds: ["p1"], amount: 60 }),
      ev("POT_AWARDED", { handNumber: 1, potIndex: 1, winnerIds: ["p1"], amount: 40 }),
    ];
    const s = summarize(events);
    expect(s.playerStats[0].potsWon).toBe(1);
    expect(s.playerStats[0].chipsWon).toBe(100);
  });

  it("split pot credits each winner their floor share", () => {
    const events: LogEvent[] = [
      ev("PLAYER_JOINED", { id: "p1", name: "Alice" }),
      ev("PLAYER_JOINED", { id: "p2", name: "Bob" }),
      handStart(1),
      ev("POT_AWARDED", { handNumber: 1, potIndex: 0, winnerIds: ["p1", "p2"], amount: 100, split: true }),
    ];
    const s = summarize(events);
    const alice = s.playerStats.find(p => p.name === "Alice")!;
    const bob = s.playerStats.find(p => p.name === "Bob")!;
    expect(alice.chipsWon).toBe(50);
    expect(bob.chipsWon).toBe(50);
  });

  it("biggestPot tracks the largest award across multiple hands", () => {
    const events: LogEvent[] = [
      ev("PLAYER_JOINED", { id: "p1", name: "Alice" }),
      handStart(1),
      ev("POT_AWARDED", { handNumber: 1, potIndex: 0, winnerIds: ["p1"], amount: 50 }),
      handStart(2),
      ev("POT_AWARDED", { handNumber: 2, potIndex: 0, winnerIds: ["p1"], amount: 200 }),
      handStart(3),
      ev("POT_AWARDED", { handNumber: 3, potIndex: 0, winnerIds: ["p1"], amount: 80 }),
    ];
    const s = summarize(events);
    expect(s.biggestPot!.amount).toBe(200);
    expect(s.biggestPot!.handNumber).toBe(2);
  });
});

describe("summarize() — STACKS_SNAPSHOT / knockouts", () => {
  it("sets finalStack from STACKS_SNAPSHOT", () => {
    const events: LogEvent[] = [
      ev("PLAYER_JOINED", { id: "p1", name: "Alice" }),
      ev("STACKS_SNAPSHOT", { stacks: [{ id: "p1", name: "Alice", stack: 250 }] }),
    ];
    const s = summarize(events);
    expect(s.playerStats[0].finalStack).toBe(250);
  });

  it("player with finalStack=0 appears in knockouts", () => {
    const events: LogEvent[] = [
      ev("PLAYER_JOINED", { id: "p1", name: "Alice" }),
      ev("PLAYER_JOINED", { id: "p2", name: "Bob" }),
      ev("STACKS_SNAPSHOT", {
        stacks: [
          { id: "p1", name: "Alice", stack: 0 },
          { id: "p2", name: "Bob", stack: 300 },
        ],
      }),
    ];
    const s = summarize(events);
    expect(s.knockouts).toContain("Alice");
    expect(s.knockouts).not.toContain("Bob");
  });

  it("player in STACKS_SNAPSHOT but not PLAYER_JOINED still appears in stats", () => {
    const events: LogEvent[] = [
      ev("STACKS_SNAPSHOT", { stacks: [{ id: "p1", name: "Alice", stack: 50 }] }),
    ];
    const s = summarize(events);
    expect(s.playerStats[0].name).toBe("Alice");
    expect(s.playerStats[0].finalStack).toBe(50);
  });
});

describe("summarize() — all-in detection", () => {
  it("ACTION with allIn:true is captured in allIns", () => {
    // Note: table.ts logs BET/RAISE with top-level `to` in extra: logAct("...", { to: p.currentBet })
    const events: LogEvent[] = [
      ev("PLAYER_JOINED", { id: "p1", name: "Alice" }),
      handStart(3),
      ev("ACTION", { playerId: "p1", street: "FLOP", action: { kind: "RAISE" }, to: 100, allIn: true }),
    ];
    const s = summarize(events);
    expect(s.allIns).toHaveLength(1);
    expect(s.allIns[0]).toMatchObject({ playerName: "Alice", street: "FLOP", amount: 100, handNumber: 3 });
  });

  it("ACTION without allIn flag is not captured", () => {
    const events: LogEvent[] = [
      ev("PLAYER_JOINED", { id: "p1", name: "Alice" }),
      handStart(1),
      ev("ACTION", { playerId: "p1", street: "PREFLOP", action: { kind: "CALL" } }),
    ];
    const s = summarize(events);
    expect(s.allIns).toHaveLength(0);
  });

  it("POST with allIn:true (blind all-in) is captured as PREFLOP street", () => {
    const events: LogEvent[] = [
      ev("PLAYER_JOINED", { id: "p1", name: "Alice" }),
      handStart(5),
      ev("POST", { playerId: "p1", label: "BB", amount: 10, allIn: true }),
    ];
    const s = summarize(events);
    expect(s.allIns).toHaveLength(1);
    expect(s.allIns[0]).toMatchObject({ playerName: "Alice", street: "PREFLOP", amount: 10, handNumber: 5 });
  });

  it("CALL all-in (no 'to' field) has undefined amount", () => {
    const events: LogEvent[] = [
      ev("PLAYER_JOINED", { id: "p2", name: "Bob" }),
      handStart(2),
      ev("ACTION", { playerId: "p2", street: "PREFLOP", action: { kind: "CALL" }, allIn: true }),
    ];
    const s = summarize(events);
    expect(s.allIns[0].amount).toBeUndefined();
    expect(s.allIns[0].playerName).toBe("Bob");
  });

  it("multiple all-ins across multiple hands all captured", () => {
    const events: LogEvent[] = [
      ev("PLAYER_JOINED", { id: "p1", name: "Alice" }),
      ev("PLAYER_JOINED", { id: "p2", name: "Bob" }),
      handStart(1),
      ev("ACTION", { playerId: "p1", street: "PREFLOP", action: { kind: "RAISE", to: 50 }, allIn: true }),
      ev("ACTION", { playerId: "p2", street: "PREFLOP", action: { kind: "CALL" }, allIn: true }),
      handStart(2),
      ev("POST", { playerId: "p1", label: "BB", amount: 5, allIn: true }),
    ];
    const s = summarize(events);
    expect(s.allIns).toHaveLength(3);
    expect(s.allIns[0].handNumber).toBe(1);
    expect(s.allIns[1].handNumber).toBe(1);
    expect(s.allIns[2].handNumber).toBe(2);
  });

  it("allIn playerName falls back to playerId when not in nameMap", () => {
    const events: LogEvent[] = [
      handStart(1),
      ev("ACTION", { playerId: "unknown-id", street: "RIVER", action: { kind: "BET", to: 80 }, allIn: true }),
    ];
    const s = summarize(events);
    expect(s.allIns[0].playerName).toBe("unknown-id");
  });
});
