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
  isDealer: boolean;
  connected: boolean;
  sittingOut: boolean;
  stack: number;
  inHand: boolean;
  folded: boolean;
  currentBet: number; // current street contribution
  totalBet: number; // cumulative across all streets in this hand
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

  deck?: string[]; // server-only; redacted
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

export type ClientToServer =
  | { type: "HELLO"; tableId: string; name: string; playerId?: string }
  | { type: "SET_DEALER"; playerId: string }
  | { type: "SET_STACK"; playerId: string; stack: number }
  | { type: "SET_BLINDS"; smallBlind: number; bigBlind: number; straddleEnabled: boolean }
  | { type: "START_HAND" }
  | { type: "ACT"; action: PlayerAction }
  | { type: "NEXT_STREET" }
  | { type: "SHOWDOWN_CHOICE"; choice: ShowChoice }
  | { type: "REVEAL_HAND" }
  | { type: "SIT_OUT" }
  | { type: "SIT_IN" }
  | { type: "REQUEST_STACK"; amount: number }
  | { type: "CLEAR_STACK_REQUEST"; playerId: string }
  | { type: "END_SESSION" };

export type ServerToClient =
  | { type: "WELCOME"; youId: string; state: TableState }
  | { type: "STATE"; state: TableState }
  | { type: "ERROR"; message: string }
  | { type: "SESSION_ENDED"; tableId: string; sessionId: string };
