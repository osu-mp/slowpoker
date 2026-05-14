// Ranks indexed 0–12 (2=0, 3=1, ..., T=8, J=9, Q=10, K=11, A=12)
const RANK_ORDER = '23456789TJQKA';

export function calculateOuts(holeCards: [string, string], boardCards: string[]): number {
  if (boardCards.length !== 3 && boardCards.length !== 4) return 0;

  const allCards = [...holeCards, ...boardCards];

  const seenRankCounts: number[] = new Array(13).fill(0);
  const seenSuitCounts: Record<string, number> = {};
  const rankSet = new Set<number>();

  for (const c of allCards) {
    const r = RANK_ORDER.indexOf(c[0]);
    seenRankCounts[r]++;
    rankSet.add(r);
    seenSuitCounts[c[1]] = (seenSuitCounts[c[1]] || 0) + 1;
  }

  // Ace can serve as rank -1 for A-2-3-4-5 wheel
  if (rankSet.has(12)) rankSet.add(-1);

  // ── Flush draw ──
  let flushOuts = 0;
  const suitCounts = Object.values(seenSuitCounts);
  if (!suitCounts.some(c => c >= 5)) {
    if (suitCounts.some(c => c === 4)) flushOuts = 9;
  }

  // ── Already have a straight? ──
  let hasStraight = false;
  for (let start = -1; start <= 8; start++) {
    if ([0, 1, 2, 3, 4].every(i => rankSet.has(start + i))) { hasStraight = true; break; }
  }

  // ── Straight draw ──
  // Each rank not in hand that would complete a 5-card straight = 4 outs (one per suit)
  let straightOuts = 0;
  if (!hasStraight) {
    const outRanks = new Set<number>();
    for (let r = -1; r <= 12; r++) {
      if (rankSet.has(r)) continue;
      const testSet = new Set([...rankSet, r]);
      for (let start = -1; start <= 8; start++) {
        if ([0, 1, 2, 3, 4].every(i => testSet.has(start + i))) { outRanks.add(r); break; }
      }
    }
    for (const r of outRanks) {
      // Ace-low (-1) maps to the actual Ace rank (12); we already hold it so count stays 0 additional
      const actualRank = r === -1 ? 12 : r;
      straightOuts += 4 - seenRankCounts[actualRank];
    }
  }

  return flushOuts + straightOuts;
}
