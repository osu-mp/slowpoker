import { describe, it, expect } from "vitest";
import { evaluateBest, findWinners } from "./hand.js";

describe("evaluateBest", () => {
  it("returns null for fewer than 2 cards", () => {
    expect(evaluateBest([])).toBeNull();
    expect(evaluateBest(["Ah"])).toBeNull();
  });

  it("simplified evaluation for 2 cards — high card", () => {
    const r = evaluateBest(["Ah", "Ks"]);
    expect(r).not.toBeNull();
    expect(r!.rank).toBe(0);
    expect(r!.name).toContain("High Card");
  });

  it("simplified evaluation for 2 cards — pair", () => {
    const r = evaluateBest(["Ah", "As"]);
    expect(r).not.toBeNull();
    expect(r!.rank).toBe(1);
    expect(r!.name).toContain("Pair");
  });

  it("detects high card from 5 cards", () => {
    const r = evaluateBest(["2h", "5d", "8c", "Ts", "Ah"]);
    expect(r!.rank).toBe(0);
    expect(r!.name).toContain("High Card");
    expect(r!.name).toContain("Ace");
  });

  it("detects a pair", () => {
    const r = evaluateBest(["Ah", "Ad", "3c", "7s", "9h"]);
    expect(r!.rank).toBe(1);
    expect(r!.name).toContain("Pair");
    expect(r!.name).toContain("Aces");
  });

  it("detects two pair", () => {
    const r = evaluateBest(["Ah", "Ad", "Kc", "Ks", "9h"]);
    expect(r!.rank).toBe(2);
    expect(r!.name).toContain("Two Pair");
  });

  it("detects three of a kind", () => {
    const r = evaluateBest(["Ah", "Ad", "Ac", "7s", "9h"]);
    expect(r!.rank).toBe(3);
    expect(r!.name).toContain("Trip");
    expect(r!.name).toContain("Aces");
  });

  it("detects a straight", () => {
    const r = evaluateBest(["5h", "6d", "7c", "8s", "9h"]);
    expect(r!.rank).toBe(4);
    expect(r!.name).toContain("Straight");
    expect(r!.name).toContain("Nine");
  });

  it("detects a wheel straight (A-2-3-4-5)", () => {
    const r = evaluateBest(["Ah", "2d", "3c", "4s", "5h"]);
    expect(r!.rank).toBe(4);
    expect(r!.name).toContain("Straight");
    expect(r!.name).toContain("Five");
  });

  it("detects a flush", () => {
    const r = evaluateBest(["2h", "5h", "8h", "Th", "Ah"]);
    expect(r!.rank).toBe(5);
    expect(r!.name).toContain("Flush");
  });

  it("detects a full house", () => {
    const r = evaluateBest(["Ah", "Ad", "Ac", "Ks", "Kh"]);
    expect(r!.rank).toBe(6);
    expect(r!.name).toContain("Full House");
  });

  it("detects four of a kind", () => {
    const r = evaluateBest(["Ah", "Ad", "Ac", "As", "9h"]);
    expect(r!.rank).toBe(7);
    expect(r!.name).toContain("Quad");
    expect(r!.name).toContain("Aces");
  });

  it("detects a straight flush", () => {
    const r = evaluateBest(["5h", "6h", "7h", "8h", "9h"]);
    expect(r!.rank).toBe(8);
    expect(r!.name).toContain("Straight Flush");
  });

  it("detects a royal flush", () => {
    const r = evaluateBest(["Th", "Jh", "Qh", "Kh", "Ah"]);
    expect(r!.rank).toBe(8);
    expect(r!.name).toContain("Royal Flush");
  });

  it("picks best 5 from 7 cards", () => {
    // Has a flush in hearts among 7 cards
    const r = evaluateBest(["2h", "5h", "8h", "Th", "Ah", "3c", "Kd"]);
    expect(r!.rank).toBe(5);
    expect(r!.name).toContain("Flush");
  });

  it("picks best hand when multiple options exist", () => {
    // Could be two pair or trips — trips should win
    const r = evaluateBest(["Ah", "Ad", "Ac", "Ks", "Qh", "2c", "3d"]);
    expect(r!.rank).toBe(3); // Trip Aces
  });
});

describe("findWinners", () => {
  it("returns empty for no eligible players", () => {
    expect(findWinners([], {}, ["2h", "3d", "4c", "5s", "6h"])).toEqual([]);
  });

  it("returns single player if only one eligible", () => {
    const result = findWinners(["p1"], { p1: ["Ah", "Kh"] }, ["2h", "3d", "4c", "5s", "6h"]);
    expect(result).toEqual(["p1"]);
  });

  it("picks the player with the better hand", () => {
    const board = ["2h", "7d", "8c", "Js", "9h"];
    const holes: Record<string, [string, string]> = {
      p1: ["Ah", "Kh"], // High card Ace
      p2: ["9d", "9c"], // Trip Nines
    };
    const result = findWinners(["p1", "p2"], holes, board);
    expect(result).toEqual(["p2"]);
  });

  it("splits pot on tie", () => {
    const board = ["2h", "3d", "4c", "5s", "Th"];
    const holes: Record<string, [string, string]> = {
      p1: ["Ah", "Kh"], // A-high
      p2: ["Ad", "Kd"], // A-high (same)
    };
    const result = findWinners(["p1", "p2"], holes, board);
    expect(result).toEqual(["p1", "p2"]);
  });

  it("uses kickers to break ties", () => {
    const board = ["2h", "7d", "8c", "Js", "Ah"];
    const holes: Record<string, [string, string]> = {
      p1: ["Ad", "Kh"], // Pair of Aces, K kicker
      p2: ["Ac", "Qh"], // Pair of Aces, Q kicker
    };
    const result = findWinners(["p1", "p2"], holes, board);
    expect(result).toEqual(["p1"]);
  });
});
