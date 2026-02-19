// Poker hand evaluator — pure TypeScript, no dependencies.

export type HandResult = {
  rank: number;   // 0=High Card … 8=Straight Flush
  name: string;   // human-readable
  score: number;  // higher is better (encodes rank + tiebreakers)
};

const RANK_ORDER = "23456789TJQKA";

function cardRank(card: string): number {
  return RANK_ORDER.indexOf(card[0]);
}

function cardSuit(card: string): string {
  return card[1];
}

/** Generate all C(n, k) combinations. */
function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const result: T[][] = [];
  function go(start: number, combo: T[]) {
    if (combo.length === k) { result.push([...combo]); return; }
    for (let i = start; i <= arr.length - (k - combo.length); i++) {
      combo.push(arr[i]);
      go(i + 1, combo);
      combo.pop();
    }
  }
  go(0, []);
  return result;
}

/** Encode tiebreakers into a single score. rank * 15^5 + kickers */
function encode(handRank: number, kickers: number[]): number {
  let score = handRank;
  for (const k of kickers) {
    score = score * 15 + k;
  }
  // Pad to exactly 5 kicker slots for consistent scoring
  for (let i = kickers.length; i < 5; i++) {
    score = score * 15;
  }
  return score;
}

/** Evaluate a single 5-card hand. */
function evaluate5(cards: string[]): HandResult {
  const ranks = cards.map(cardRank).sort((a, b) => b - a);
  const suits = cards.map(cardSuit);

  const isFlush = suits.every(s => s === suits[0]);

  // Check straight (including A-low: A2345)
  let isStraight = false;
  let straightHigh = 0;

  // Normal straight check
  if (ranks[0] - ranks[4] === 4 && new Set(ranks).size === 5) {
    isStraight = true;
    straightHigh = ranks[0];
  }
  // Wheel: A-2-3-4-5 (ranks sorted desc: 12, 3, 2, 1, 0)
  if (!isStraight && ranks[0] === 12 && ranks[1] === 3 && ranks[2] === 2 && ranks[3] === 1 && ranks[4] === 0) {
    isStraight = true;
    straightHigh = 3; // 5-high straight
  }

  // Frequency groups
  const freq = new Map<number, number>();
  for (const r of ranks) freq.set(r, (freq.get(r) ?? 0) + 1);
  const groups = [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);

  // Straight flush
  if (isFlush && isStraight) {
    return { rank: 8, name: straightHigh === 12 ? "Royal Flush" : "Straight Flush", score: encode(8, [straightHigh]) };
  }

  // Four of a kind
  if (groups[0][1] === 4) {
    return { rank: 7, name: "Four of a Kind", score: encode(7, [groups[0][0], groups[1][0]]) };
  }

  // Full house
  if (groups[0][1] === 3 && groups[1][1] === 2) {
    return { rank: 6, name: "Full House", score: encode(6, [groups[0][0], groups[1][0]]) };
  }

  // Flush
  if (isFlush) {
    return { rank: 5, name: "Flush", score: encode(5, ranks) };
  }

  // Straight
  if (isStraight) {
    return { rank: 4, name: "Straight", score: encode(4, [straightHigh]) };
  }

  // Three of a kind
  if (groups[0][1] === 3) {
    const kickers = groups.slice(1).map(g => g[0]).sort((a, b) => b - a);
    return { rank: 3, name: "Three of a Kind", score: encode(3, [groups[0][0], ...kickers]) };
  }

  // Two pair
  if (groups[0][1] === 2 && groups[1][1] === 2) {
    const pairRanks = [groups[0][0], groups[1][0]].sort((a, b) => b - a);
    const kicker = groups[2][0];
    return { rank: 2, name: "Two Pair", score: encode(2, [...pairRanks, kicker]) };
  }

  // One pair
  if (groups[0][1] === 2) {
    const kickers = groups.slice(1).map(g => g[0]).sort((a, b) => b - a);
    return { rank: 1, name: "One Pair", score: encode(1, [groups[0][0], ...kickers]) };
  }

  // High card
  return { rank: 0, name: "High Card", score: encode(0, ranks) };
}

/**
 * Evaluate the best 5-card hand from any number of cards (typically 5-7).
 * For 2 cards (preflop), returns simplified Pair or High Card.
 */
export function evaluateBest(cards: string[]): HandResult | null {
  if (!cards || cards.length < 2) return null;

  if (cards.length < 5) {
    // Preflop or partial board — simplified evaluation
    const ranks = cards.map(cardRank);
    const hasPair = new Set(ranks).size < ranks.length;
    if (hasPair) {
      const pairRank = ranks.find((r, i) => ranks.indexOf(r) !== i)!;
      return { rank: 1, name: "One Pair", score: encode(1, [pairRank]) };
    }
    const high = Math.max(...ranks);
    return { rank: 0, name: "High Card", score: encode(0, [high]) };
  }

  const combos = combinations(cards, 5);
  let best: HandResult | null = null;
  for (const combo of combos) {
    const result = evaluate5(combo);
    if (!best || result.score > best.score) {
      best = result;
    }
  }
  return best;
}

/**
 * Find the winner(s) among eligible players. Returns IDs of players with the highest hand.
 * Supports ties (split pots).
 */
export function findWinners(
  eligibleIds: string[],
  holeCardMap: Record<string, [string, string]>,
  board: string[]
): string[] {
  if (eligibleIds.length === 0) return [];
  if (eligibleIds.length === 1) return [eligibleIds[0]];

  let bestScore = -1;
  let winners: string[] = [];

  for (const id of eligibleIds) {
    const hole = holeCardMap[id];
    if (!hole) continue;
    const allCards = [...hole, ...board];
    const result = evaluateBest(allCards);
    if (!result) continue;

    if (result.score > bestScore) {
      bestScore = result.score;
      winners = [id];
    } else if (result.score === bestScore) {
      winners.push(id);
    }
  }

  return winners;
}
