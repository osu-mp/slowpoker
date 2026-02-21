import { describe, it, expect } from "vitest";
import { makeDeck, shuffle } from "./cards.js";

describe("makeDeck", () => {
  it("produces 52 unique cards", () => {
    const deck = makeDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck).size).toBe(52);
  });

  it("all cards are rank+suit format", () => {
    const deck = makeDeck();
    const ranks = "23456789TJQKA";
    const suits = "shdc";
    for (const card of deck) {
      expect(card).toHaveLength(2);
      expect(ranks).toContain(card[0]);
      expect(suits).toContain(card[1]);
    }
  });
});

describe("shuffle", () => {
  it("preserves all 52 cards", () => {
    const deck = makeDeck();
    const shuffled = shuffle(deck);
    expect(shuffled).toHaveLength(52);
    expect(new Set(shuffled).size).toBe(52);
    expect([...shuffled].sort()).toEqual([...deck].sort());
  });

  it("does not mutate the original array", () => {
    const deck = makeDeck();
    const copy = [...deck];
    shuffle(deck);
    expect(deck).toEqual(copy);
  });

  it("returns a new array reference", () => {
    const deck = makeDeck();
    const shuffled = shuffle(deck);
    expect(shuffled).not.toBe(deck);
  });
});
