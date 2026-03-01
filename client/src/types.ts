export type Street = "PREFLOP" | "FLOP" | "TURN" | "RIVER" | "SHOWDOWN" | "DONE";

export type SidePot = {
  amount: number;
  eligiblePlayerIds: string[];
  winnerIds?: string[];
};

export type ShowChoice =
  | { kind: "SHOW_0" }
  | { kind: "SHOW_1"; cardIndex: 0 | 1 }
  | { kind: "SHOW_2" };

export type PlayerState = {
  id: string;
  name: string;
  emoji?: string;
  isDealer: boolean;
  connected: boolean;
  sittingOut: boolean;

  stack: number;
  inHand: boolean;
  folded: boolean;
  currentBet: number;
  totalBet: number;

  holeCards?: [string, string];
  bestHand?: string;
};

export type TableSettings = {
  smallBlind: number;
  bigBlind: number;
  straddleEnabled: boolean;
};

export type HandPositions = {
  buttonIndex: number;
  sbIndex: number;
  bbIndex: number;
  straddleIndex: number | null;
};

export type TableState = {
  tableId: string;
  sessionId: string;
  createdAt: number;

  bankPlayerId?: string;

  settings: TableSettings;
  positions: HandPositions | null;

  street: Street;
  handNumber: number;
  players: PlayerState[];

  board: string[];
  pot: number;
  pots: SidePot[];

  streetBet: number;
  lastRaiseSize: number;
  currentTurnIndex: number;
  roundComplete: boolean;

  showdownChoices: Record<string, ShowChoice | undefined>;
  stackRequests: Record<string, number>;

  actionLog: string[];
  dealerMessage?: string;
  winningHandName?: string;
};

export type PlayerAction =
  | { kind: "FOLD" }
  | { kind: "CHECK" }
  | { kind: "CALL" }
  | { kind: "BET"; to: number }
  | { kind: "RAISE"; to: number };

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

export type ClientToServer =
  | { type: "HELLO"; tableId: string; name: string; playerId?: string; emoji?: string }
  | { type: "SET_PROFILE"; emoji: string }
  | { type: "SET_DEALER"; playerId: string }
  | { type: "SET_STACK"; playerId: string; stack: number }
  | { type: "SET_BLINDS"; smallBlind: number; bigBlind: number; straddleEnabled: boolean }
  | { type: "START_HAND" }
  | { type: "ACT"; action: PlayerAction }
  | { type: "NEXT_STREET" }
  | { type: "SHOWDOWN_CHOICE"; choice: ShowChoice }
  | { type: "REVEAL_HAND"; choice?: ShowChoice }
  | { type: "SIT_OUT" }
  | { type: "SIT_IN" }
  | { type: "REQUEST_STACK"; amount: number }
  | { type: "CLEAR_STACK_REQUEST"; playerId: string }
  | { type: "SET_BANK"; playerId: string }
  | { type: "END_SESSION" };

export type ServerToClient =
  | { type: "WELCOME"; youId: string; state: TableState }
  | { type: "STATE"; state: TableState }
  | { type: "ERROR"; message: string }
  | { type: "SESSION_ENDED"; tableId: string; sessionId: string };
