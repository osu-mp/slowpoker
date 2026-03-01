import type { LogEvent } from "./recap.js";

export type HandAction = {
  playerId: string;
  playerName: string;
  street: string;
  action: string;
  amount?: number;
};

export type HandPotAward = {
  potIndex: number;
  winnerIds: string[];
  winnerNames: string[];
  amount: number;
  split?: boolean;
  auto?: boolean;
};

export type HandShowdown = {
  playerId: string;
  playerName: string;
  choice: string;
  cards?: string[];
  handName?: string;
};

export type StreetBoard = {
  street: string;
  board: string[];
};

export type HandSummary = {
  handNumber: number;
  startTs: number;
  endTs: number;
  outcome: "showdown" | "uncontested" | "voided";
  players: { id: string; name: string }[];
  blinds: { smallBlind: number; bigBlind: number };
  posts: { playerName: string; label: string; amount: number }[];
  actions: HandAction[];
  streets: StreetBoard[];
  finalBoard: string[];
  potAwards: HandPotAward[];
  showdownChoices: HandShowdown[];
  totalPot: number;
};

export function reconstructHands(events: LogEvent[]): HandSummary[] {
  // Build player name map from PLAYER_JOINED events
  const nameMap = new Map<string, string>();
  for (const e of events) {
    if (e.type === "PLAYER_JOINED" && e.payload?.id && e.payload?.name) {
      nameMap.set(e.payload.id, e.payload.name);
    }
  }

  const pname = (id: string) => nameMap.get(id) ?? id;

  const hands: HandSummary[] = [];
  let current: {
    handNumber: number;
    startTs: number;
    players: { id: string; name: string }[];
    blinds: { smallBlind: number; bigBlind: number };
    posts: { playerName: string; label: string; amount: number }[];
    actions: HandAction[];
    streets: StreetBoard[];
    latestBoard: string[];
    potAwards: HandPotAward[];
    showdownChoices: HandShowdown[];
    totalPot: number;
  } | null = null;

  for (const e of events) {
    if (e.type === "HAND_STARTED") {
      const p = e.payload ?? {};
      // Figure out which players are in the hand from context
      // We'll collect players as we see POST and ACTION events
      current = {
        handNumber: p.handNumber ?? 0,
        startTs: e.ts,
        players: [],
        blinds: {
          smallBlind: p.settings?.smallBlind ?? 1,
          bigBlind: p.settings?.bigBlind ?? 2,
        },
        posts: [],
        actions: [],
        streets: [],
        latestBoard: [],
        potAwards: [],
        showdownChoices: [],
        totalPot: 0,
      };
      continue;
    }

    if (!current) continue;

    if (e.type === "POST" && e.payload) {
      const { playerId, label, amount } = e.payload;
      current.posts.push({ playerName: pname(playerId), label, amount });
      current.totalPot += amount ?? 0;
      addPlayer(current.players, playerId, pname(playerId));
    }

    if (e.type === "ACTION" && e.payload) {
      const { playerId, street, action } = e.payload;
      const kind = action?.kind ?? "UNKNOWN";
      const amount = action?.to ?? (kind === "CALL" ? e.payload.amount : undefined);
      current.actions.push({
        playerId,
        playerName: pname(playerId),
        street: street ?? "",
        action: kind,
        amount,
      });
      addPlayer(current.players, playerId, pname(playerId));
    }

    if (e.type === "STREET_ADVANCED" && e.payload) {
      const board = e.payload.board ?? [];
      current.latestBoard = board;
      current.streets.push({ street: e.payload.to, board: [...board] });
    }

    if (e.type === "POT_AWARDED" && e.payload) {
      const { potIndex, winnerIds, amount, split, auto } = e.payload;
      current.potAwards.push({
        potIndex: potIndex ?? 0,
        winnerIds: winnerIds ?? [],
        winnerNames: (winnerIds ?? []).map((id: string) => pname(id)),
        amount: amount ?? 0,
        split: split ?? false,
        auto: auto ?? false,
      });
    }

    if (e.type === "SHOWDOWN_CHOICE" && e.payload) {
      const { playerId, choice } = e.payload;
      current.showdownChoices.push({
        playerId,
        playerName: pname(playerId),
        choice: choice?.kind ?? "UNKNOWN",
        cards: e.payload.cards,
        handName: e.payload.handName,
      });
    }

    if (e.type === "HAND_ENDED" || e.type === "HAND_WON_UNCONTESTED" || e.type === "HAND_VOIDED") {
      let outcome: HandSummary["outcome"] = "showdown";
      if (e.type === "HAND_WON_UNCONTESTED") {
        outcome = "uncontested";
        // Add the uncontested win info
        if (e.payload) {
          const { winnerId, amount } = e.payload;
          current.potAwards.push({
            potIndex: 0,
            winnerIds: [winnerId],
            winnerNames: [pname(winnerId)],
            amount: amount ?? 0,
          });
        }
      } else if (e.type === "HAND_VOIDED") {
        outcome = "voided";
      }

      hands.push({
        handNumber: current.handNumber,
        startTs: current.startTs,
        endTs: e.ts,
        outcome,
        players: current.players,
        blinds: current.blinds,
        posts: current.posts,
        actions: current.actions,
        streets: current.streets,
        finalBoard: current.latestBoard,
        potAwards: current.potAwards,
        showdownChoices: current.showdownChoices,
        totalPot: current.totalPot,
      });
      current = null;
    }
  }

  return hands;
}

function addPlayer(players: { id: string; name: string }[], id: string, name: string) {
  if (!players.some(p => p.id === id)) {
    players.push({ id, name });
  }
}
