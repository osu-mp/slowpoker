import React, { useMemo, useState } from "react";
import { connect } from "./ws";
import type { ServerToClient, TableState, ShowChoice, Street, PlayerState, PlayerAction } from "./types";

type Conn = ReturnType<typeof connect> | null;

function streetLabel(s: Street) {
  switch (s) {
    case "PREFLOP": return "Preflop";
    case "FLOP": return "Flop";
    case "TURN": return "Turn";
    case "RIVER": return "River";
    case "SHOWDOWN": return "Showdown";
    case "DONE": return "Between hands";
  }
}

function CardPill({ c }: { c: string }) {
  return <span className="cardChip">{c}</span>;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export default function App() {
  const [conn, setConn] = useState<Conn>(null);
  const [tableId, setTableId] = useState("homegame");
  const [name, setName] = useState(() => `Player${Math.floor(Math.random() * 90 + 10)}`);
  const [youId, setYouId] = useState<string | null>(null);
  const [state, setState] = useState<TableState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const you = useMemo(() => state?.players.find(p => p.id === youId) ?? null, [state, youId]);
  const dealer = useMemo(() => state?.players.find(p => p.isDealer) ?? null, [state]);
  const bank = useMemo(() => state?.players.find(p => p.id === state.bankPlayerId) ?? null, [state]);
  const currentTurnPlayer = useMemo(() => state ? state.players[state.currentTurnIndex] : null, [state]);

  function join() {
    setError(null);
    const c = connect((m: ServerToClient) => {
      if (m.type === "WELCOME") { setYouId(m.youId); setState(m.state); }
      else if (m.type === "STATE") { setState(m.state); }
      else if (m.type === "ERROR") { setError(m.message); }
      else if (m.type === "SESSION_ENDED") {
        setError(`Session ended (table ${m.tableId}, session ${m.sessionId}). Refresh to start again.`);
      }
    }, () => setError("Disconnected from server."));
    setConn(c);
    c.send({ type: "HELLO", tableId, name });
  }

  function send(msg: any) { conn?.send(msg); }

  if (!conn || !state || !youId) {
    return (
      <div className="table">
        <div className="card">
          <div className="title">Slow Poker (Prototype v4)</div>
          <p className="small">Open multiple tabs to simulate multiple players on localhost.</p>

          <div className="row" style={{ marginTop: 12 }}>
            <div className="card">
              <div className="small">Table ID</div>
              <input type="text" value={tableId} onChange={(e) => setTableId(e.target.value)} />
            </div>
            <div className="card">
              <div className="small">Your name</div>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <button onClick={join}>Join table</button>
          </div>

          {error && <div className="notice">{error}</div>}
        </div>
      </div>
    );
  }

  const isDealer = !!you?.isDealer;
  const isBank = youId === state.bankPlayerId;

  const buttonName = state.positions ? state.players[state.positions.buttonIndex]?.name : "—";
  const toCall = you ? Math.max(0, state.streetBet - you.currentBet) : 0;
  const canAct = state.street !== "DONE" && state.street !== "SHOWDOWN" &&
    state.players[state.currentTurnIndex]?.id === youId &&
    !!you?.inHand && !you?.folded;

  const sb = state.settings.smallBlind;
  const bb = state.settings.bigBlind;

  return (
    <div className="table">
      <div className="tableTop">
        <div>
          <div className="title">Table: {state.tableId}</div>
          <div className="small">
            Session: {state.sessionId} • Hand #{state.handNumber} • {streetLabel(state.street)}
          </div>
        </div>
        <div className="hstack">
          <span className="pill">You: <b>{you?.name}</b></span>
          <span className="pill">Dealer: <b>{dealer?.name ?? "—"}</b></span>
          <span className="pill">Bank: <b>{bank?.name ?? "—"}</b></span>
        </div>
      </div>

      <div className="row" style={{ marginTop: 12 }}>
        <div className="card" style={{ flex: 1, minWidth: 360 }}>
          <div className="hstack" style={{ justifyContent: "space-between" }}>
            <div><b>Board</b></div>
            <div className="small">Pot: <b>{state.pot}</b></div>
          </div>

          <div className="small" style={{ marginTop: 6 }}>
            Button: <b>{buttonName}</b> • Blinds: <b>{sb}/{bb}</b>{state.settings.straddleEnabled ? " • Straddle ON" : ""}
            {" • "}
            Street bet: <b>{state.streetBet}</b>
            {" • "}
            Min raise +<b>{state.lastRaiseSize}</b>
          </div>

          <div className="cards">
            {state.board.length ? state.board.map((c) => <CardPill key={c} c={c} />) : <span className="small">No board cards yet.</span>}
          </div>

          <div className="hstack" style={{ marginTop: 10, justifyContent: "space-between" }}>
            <div><b>Your hole cards</b></div>
            <div className="small">
              Stack: <b>{you?.stack ?? 0}</b> • Bet (street): <b>{you?.currentBet ?? 0}</b> • To call: <b>{toCall}</b>
            </div>
          </div>
          <div className="cards">
            {you?.holeCards ? you.holeCards.map((c) => <CardPill key={c} c={c} />) : <span className="small">Start a hand to deal cards.</span>}
          </div>

          <div className="notice" style={{ marginTop: 10 }}>
            <div className="small"><b>Turn:</b> {currentTurnPlayer?.name ?? "—"}</div>
            <div className="small">{state.roundComplete ? "Betting complete — dealer can advance." : "Betting in progress."}</div>
          </div>
        </div>

        <div className="card" style={{ flex: 1, minWidth: 360 }}>
          <div className="hstack" style={{ justifyContent: "space-between" }}>
            <b>Action log</b>
            <span className="small">Most recent first</span>
          </div>
          <div className="log" style={{ marginTop: 8 }}>
            {state.actionLog.length ? state.actionLog.map((l, i) => <div key={i} className="logLine">{l}</div>) : <div className="small">No actions yet.</div>}
          </div>
        </div>
      </div>

      {state.dealerMessage && <div className="notice">{state.dealerMessage}</div>}
      {error && <div className="notice">{error}</div>}

      <div className="seats">
        {state.players.map((p, i) => (
          <div
            key={p.id}
            className={
              "seat" +
              (p.id === youId ? " you" : "") +
              (p.isDealer ? " dealer" : "") +
              (i === state.currentTurnIndex && state.street !== "DONE" && state.street !== "SHOWDOWN" ? " turn" : "")
            }
          >
            <div className="hstack" style={{ justifyContent: "space-between" }}>
              <div>
                <div>
                  <b>{p.name}</b> {p.connected ? "" : <span className="small">(disconnected)</span>}
                  {p.id === state.bankPlayerId ? <span className="pill" style={{ marginLeft: 8 }}>Bank</span> : null}
                </div>
                <div className="small">
                  Stack: <b>{p.stack}</b> • Bet: <b>{p.currentBet}</b> • {p.inHand ? (p.folded ? "Folded" : "In hand") : "Sitting out"}
                </div>
              </div>
              {isDealer && !p.isDealer && (
                <button className="secondary" onClick={() => send({ type: "SET_DEALER", playerId: p.id })}>
                  Make dealer
                </button>
              )}
            </div>

            {state.street === "SHOWDOWN" && (
              <div className="small" style={{ marginTop: 8 }}>
                Showdown choice: {renderChoice(state.showdownChoices[p.id])}
              </div>
            )}

            {isBank && (
              <BankRow player={p} onSetStack={(stack) => send({ type: "SET_STACK", playerId: p.id, stack })} />
            )}
          </div>
        ))}
      </div>

      <div className="actions">
        <div className="actionBar">
          {isBank && (
            <BankControls
              settings={state.settings}
              onApply={(sb2, bb2, str) => send({ type: "SET_BLINDS", smallBlind: sb2, bigBlind: bb2, straddleEnabled: str })}
            />
          )}

          {state.street === "DONE" && (
            <>
              <button disabled={!isDealer} onClick={() => send({ type: "START_HAND" })}>
                Dealer: Start hand
              </button>
              <span className="small">Strict turn order betting is live in v4.</span>
            </>
          )}

          {state.street !== "DONE" && state.street !== "SHOWDOWN" && (
            <>
              <BettingPanel
                enabled={canAct}
                streetBet={state.streetBet}
                toCall={toCall}
                sb={sb}
                bb={bb}
                pot={state.pot}
                you={you!}
                onAct={(a) => send({ type: "ACT", action: a })}
              />
              <button disabled={!isDealer || !state.roundComplete} onClick={() => send({ type: "NEXT_STREET" })}>
                Dealer: Next street
              </button>
            </>
          )}

          {state.street === "SHOWDOWN" && (
            <>
              <ShowdownPanel onPick={(choice) => send({ type: "SHOWDOWN_CHOICE", choice })} />
              <button disabled={!isDealer} onClick={() => send({ type: "NEXT_STREET" })}>
                Dealer: End hand
              </button>
              <button disabled={!isDealer} onClick={() => send({ type: "END_SESSION" })}>
                Dealer: End session
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function BankControls({ settings, onApply }: { settings: TableState["settings"]; onApply: (sb: number, bb: number, str: boolean) => void }) {
  const [sb, setSb] = useState(settings.smallBlind);
  const [bb, setBb] = useState(settings.bigBlind);
  const [str, setStr] = useState(settings.straddleEnabled);

  return (
    <div className="hstack" style={{ gap: 10 }}>
      <span className="pill"><b>Bank controls</b></span>
      <span className="small">SB</span>
      <input type="number" value={sb} onChange={(e) => setSb(Number(e.target.value))} style={{ width: 90 }} />
      <span className="small">BB</span>
      <input type="number" value={bb} onChange={(e) => setBb(Number(e.target.value))} style={{ width: 90 }} />
      <label className="small hstack" style={{ gap: 6 }}>
        <input type="checkbox" checked={str} onChange={(e) => setStr(e.target.checked)} />
        Straddle
      </label>
      <button onClick={() => onApply(sb, bb, str)}>Apply blinds</button>
    </div>
  );
}

function BankRow({ player, onSetStack }: { player: PlayerState; onSetStack: (stack: number) => void }) {
  const [val, setVal] = useState(player.stack);
  return (
    <div className="hstack" style={{ marginTop: 10, gap: 8 }}>
      <span className="small">Set stack:</span>
      <input type="number" value={val} onChange={(e) => setVal(Number(e.target.value))} style={{ width: 110 }} />
      <button className="secondary" onClick={() => onSetStack(val)}>Set</button>
    </div>
  );
}

function BettingPanel(props: {
  enabled: boolean;
  streetBet: number;
  toCall: number;
  sb: number;
  bb: number;
  pot: number;
  you: PlayerState;
  onAct: (a: PlayerAction) => void;
}) {
  const { enabled, streetBet, toCall, sb, bb, pot, you, onAct } = props;
  const maxTo = you.currentBet + you.stack;
  const isBet = streetBet === 0;

  const [to, setTo] = useState(() => clamp(isBet ? bb : (streetBet + bb), 0, maxTo));

  const safeTo = clamp(to, 0, maxTo);
  function setToSafe(v: number) {
    setTo(clamp(Math.floor(v), 0, maxTo));
  }

  const potTo = isBet
    ? Math.max(bb, pot)
    : (() => {
        const potAfterCall = pot + toCall;
        return streetBet + potAfterCall;
      })();

  return (
    <div className="hstack" style={{ gap: 10 }}>
      <span className="pill"><b>Your action</b></span>

      <button className="danger" disabled={!enabled} onClick={() => onAct({ kind: "FOLD" })}>Fold</button>

      {toCall === 0 ? (
        <button disabled={!enabled} onClick={() => onAct({ kind: "CHECK" })}>Check</button>
      ) : (
        <button disabled={!enabled} onClick={() => onAct({ kind: "CALL" })}>Call {toCall}</button>
      )}

      <div className="hstack" style={{ gap: 8 }}>
        <button className="secondary" disabled={!enabled} onClick={() => setToSafe(you.currentBet + sb)}>+SB</button>
        <button className="secondary" disabled={!enabled} onClick={() => setToSafe(you.currentBet + bb)}>+BB</button>
        <button className="secondary" disabled={!enabled} onClick={() => setToSafe(potTo)}>Pot</button>
        <button className="secondary" disabled={!enabled} onClick={() => setToSafe(maxTo)}>All-in</button>
      </div>

      <div className="hstack" style={{ gap: 8 }}>
        <span className="small">{isBet ? "Bet to" : "Raise to"}</span>
        <input
          type="number"
          value={safeTo}
          onChange={(e) => setToSafe(Number(e.target.value))}
          style={{ width: 120 }}
          disabled={!enabled}
        />
        <input
          type="range"
          min={0}
          max={maxTo}
          value={safeTo}
          onChange={(e) => setToSafe(Number(e.target.value))}
          disabled={!enabled}
          style={{ width: 220 }}
        />
        <button
          disabled={!enabled}
          onClick={() => onAct(isBet ? { kind: "BET", to: safeTo } : { kind: "RAISE", to: safeTo })}
        >
          {isBet ? "Bet" : "Raise"}
        </button>
      </div>

      {!enabled && <span className="small">Waiting for your turn…</span>}
    </div>
  );
}

function renderChoice(c: ShowChoice | undefined) {
  if (!c) return "—";
  if (c.kind === "SHOW_0") return "Muck (show 0)";
  if (c.kind === "SHOW_2") return "Show 2";
  return `Show 1 (card ${c.cardIndex === 0 ? "left" : "right"})`;
}

function ShowdownPanel({ onPick }: { onPick: (c: ShowChoice) => void }) {
  return (
    <div className="hstack" style={{ gap: 8 }}>
      <span className="small">Your showdown:</span>
      <button onClick={() => onPick({ kind: "SHOW_0" })}>Show 0</button>
      <button onClick={() => onPick({ kind: "SHOW_1", cardIndex: 0 })}>Show 1 (L)</button>
      <button onClick={() => onPick({ kind: "SHOW_1", cardIndex: 1 })}>Show 1 (R)</button>
      <button onClick={() => onPick({ kind: "SHOW_2" })}>Show 2</button>
    </div>
  );
}
