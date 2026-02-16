export type Card = string;

const SUITS = ["s", "h", "d", "c"] as const;
const RANKS = ["2","3","4","5","6","7","8","9","T","J","Q","K","A"] as const;

export function makeDeck(): Card[] {
  const deck: Card[] = [];
  for (const r of RANKS) for (const s of SUITS) deck.push(`${r}${s}`);
  return deck;
}

export function shuffle(deck: Card[]): Card[] {
  const a = [...deck];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
