import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, useMotionValue, useTransform, animate } from "framer-motion";
import { connect, type ConnStatus } from "./ws";
import type { ServerToClient, TableState, ShowChoice, Street, PlayerState, PlayerAction, HandSummary } from "./types";

type Conn = ReturnType<typeof connect> | null;

const SUIT_GLYPHS: Record<string, string> = { h: "\u2665", d: "\u2666", c: "\u2663", s: "\u2660" };

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
  const rank = c.slice(0, -1);
  const suitChar = c.slice(-1);
  const glyph = SUIT_GLYPHS[suitChar] ?? suitChar;
  const isRed = suitChar === "h" || suitChar === "d";
  return (
    <span className={`playingCard ${isRed ? "red" : "white"}`}>
      <span className="rank">{rank}</span>
      <span className="suit">{glyph}</span>
    </span>
  );
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

const cardFlip = {
  initial: { opacity: 0, rotateY: 90, scale: 0.8 },
  animate: { opacity: 1, rotateY: 0, scale: 1 },
  exit: { opacity: 0, scale: 0.8 },
};

const holeFlip = {
  initial: { opacity: 0, rotateY: 180, scale: 0.7 },
  animate: { opacity: 1, rotateY: 0, scale: 1 },
  exit: { opacity: 0, scale: 0.7 },
};

const cardSpring = { type: "spring" as const, stiffness: 300, damping: 20 };

function AnimatedNumber({ value }: { value: number }) {
  const mv = useMotionValue(value);
  const display = useTransform(mv, (v) => String(Math.round(v)));
  const ref = useRef(value);

  useEffect(() => {
    if (ref.current !== value) {
      ref.current = value;
      animate(mv, value, { duration: 0.4 });
    }
  }, [value, mv]);

  return <motion.span>{display}</motion.span>;
}

export default function App() {
  const [conn, setConn] = useState<Conn>(null);
  const [tableId, setTableId] = useState("homegame");
  const [name, setName] = useState(() => `Player${Math.floor(Math.random() * 90 + 10)}`);
  const [youId, setYouId] = useState<string | null>(null);
  const [state, setState] = useState<TableState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [connStatus, setConnStatus] = useState<ConnStatus>("disconnected");
  const sessionIdRef = useRef<string | null>(null);
  const [recap, setRecap] = useState<any>(null);
  const [recapOpen, setRecapOpen] = useState(false);
  const [recapLoading, setRecapLoading] = useState(false);
  const [handHistory, setHandHistory] = useState<HandSummary[]>([]);
  const [handHistoryOpen, setHandHistoryOpen] = useState(false);
  const [handHistoryLoading, setHandHistoryLoading] = useState(false);
  const [expandedHand, setExpandedHand] = useState<number | null>(null);

  const you = useMemo(() => state?.players.find(p => p.id === youId) ?? null, [state, youId]);
  const dealer = useMemo(() => state?.players.find(p => p.isDealer) ?? null, [state]);
  const bank = useMemo(() => state?.players.find(p => p.id === state.bankPlayerId) ?? null, [state]);
  const currentTurnPlayer = useMemo(() => state ? state.players[state.currentTurnIndex] : null, [state]);

  // Tab title: "YOUR TURN" when it's your turn
  useEffect(() => {
    if (!state || !youId) {
      document.title = "Slow Poker";
      return;
    }
    const isYourTurn = state.street !== "DONE" && state.street !== "SHOWDOWN" &&
      state.players[state.currentTurnIndex]?.id === youId &&
      !!you?.inHand && !you?.folded;
    document.title = isYourTurn ? "YOUR TURN — Slow Poker" : "Slow Poker";
  }, [state, youId, you]);

  function join() {
    setError(null);
    const storedPlayerId = localStorage.getItem(`sp-playerId-${tableId}`) ?? undefined;
    const c = connect(
      { tableId, name, playerId: storedPlayerId },
      (m: ServerToClient) => {
        if (m.type === "WELCOME") {
          setYouId(m.youId);
          setState(m.state);
          localStorage.setItem(`sp-playerId-${tableId}`, m.youId);
          sessionIdRef.current = m.state.sessionId;
        }
        else if (m.type === "STATE") { setState(m.state); }
        else if (m.type === "ERROR") { setError(m.message); }
        else if (m.type === "SESSION_ENDED") {
          setError(`Session ended (table ${m.tableId}, session ${m.sessionId}). Refresh to start again.`);
          sessionIdRef.current = m.sessionId;
        }
      },
      setConnStatus
    );
    setConn(c);
  }

  function fetchRecap() {
    const sid = sessionIdRef.current ?? state?.sessionId;
    if (!sid) return;
    setRecapLoading(true);
    fetch(`http://localhost:3001/api/recap/${tableId}/${sid}`)
      .then(r => r.json())
      .then(data => { setRecap(data); setRecapOpen(true); })
      .catch(() => setError("Failed to load session recap."))
      .finally(() => setRecapLoading(false));
  }

  function fetchHandHistory() {
    const sid = sessionIdRef.current ?? state?.sessionId;
    if (!sid) return;
    setHandHistoryLoading(true);
    fetch(`http://localhost:3001/api/hands/${tableId}/${sid}`)
      .then(r => r.json())
      .then(data => { setHandHistory(data); setHandHistoryOpen(true); })
      .catch(() => setError("Failed to load hand history."))
      .finally(() => setHandHistoryLoading(false));
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

  const toCall = you ? Math.max(0, state.streetBet - you.currentBet) : 0;
  const canAct = state.street !== "DONE" && state.street !== "SHOWDOWN" &&
    state.players[state.currentTurnIndex]?.id === youId &&
    !!you?.inHand && !you?.folded;

  const sb = state.settings.smallBlind;
  const bb = state.settings.bigBlind;

  const inActiveHand = state.street !== "DONE" && state.street !== "SHOWDOWN";
  const seatCount = state.players.length;

  return (
    <div className="table">
      {/* ── Top bar ── */}
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
          <button className="secondary" onClick={fetchHandHistory} disabled={handHistoryLoading}>
            {handHistoryLoading ? "Loading..." : "Hand History"}
          </button>
        </div>
      </div>

      {/* ── Reconnect banner ── */}
      {connStatus === "reconnecting" && (
        <div className="reconnectBanner">Reconnecting to server...</div>
      )}
      {connStatus === "disconnected" && conn && (
        <div className="reconnectBanner disconnected">Connection lost. Please refresh the page.</div>
      )}

      {/* ── Centered board area ── */}
      <div className="boardArea">
        <div className="potDisplay">Pot: <AnimatedNumber value={state.pot} /></div>

        {state.pots.length > 0 && (
          <div className="potBreakdown">
            {state.pots.map((pot, i) => {
              const winnerNames = pot.winnerIds?.map(id => state.players.find(p => p.id === id)?.name).filter(Boolean);
              const isSplit = winnerNames && winnerNames.length > 1;
              return (
                <span key={i} className="pill">
                  {state.pots.length === 1 ? "Main" : i === 0 ? "Main" : `Side #${i}`}: <b>{pot.amount}</b>
                  {winnerNames && winnerNames.length > 0 && (
                    <span> → {winnerNames.join(", ")}{isSplit ? " (split)" : ""}{pot.eligiblePlayerIds.length === 1 ? " (uncontested)" : ""}</span>
                  )}
                </span>
              );
            })}
          </div>
        )}

        <div className="boardCards">
          <AnimatePresence>
            {state.board.length ? state.board.map((c, i) => (
              <motion.div
                key={c}
                {...cardFlip}
                transition={{ ...cardSpring, delay: i * 0.15 }}
                style={{ perspective: 600 }}
              >
                <CardPill c={c} />
              </motion.div>
            )) : <span className="small">No board cards yet.</span>}
          </AnimatePresence>
        </div>

        <AnimatePresence>
          {state.winningHandName && (
            <motion.div
              className="winBanner"
              key={state.winningHandName}
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              transition={{ type: "spring", stiffness: 400, damping: 15 }}
            >
              {state.winningHandName}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="boardMeta">
          Button: <b>{state.positions ? state.players[state.positions.buttonIndex]?.name : "—"}</b> • Blinds: <b>{sb}/{bb}</b>
          {state.settings.straddleEnabled ? " • Straddle ON" : ""}
          {" • "}Street bet: <b>{state.streetBet}</b> • Min raise +<b>{state.lastRaiseSize}</b>
        </div>

        <div className="small" style={{ marginTop: 6 }}>
          <b>Turn:</b> {currentTurnPlayer?.name ?? "—"}
          {" — "}
          {state.roundComplete ? "Betting complete — dealer can advance." : "Betting in progress."}
        </div>
      </div>

      {/* ── Your hole cards ── */}
      <div className="holeArea">
        <div style={{ fontWeight: 600 }}>Your Hand</div>
        <div className="holeCards">
          <AnimatePresence mode="wait" key={state.handNumber}>
            {you?.holeCards ? you.holeCards.map((c, i) => (
              <motion.div
                key={c}
                {...holeFlip}
                transition={{ ...cardSpring, delay: i * 0.1 }}
                style={{ perspective: 600 }}
              >
                <CardPill c={c} />
              </motion.div>
            )) : <span className="small">Start a hand to deal cards.</span>}
          </AnimatePresence>
        </div>
        {you?.bestHand && <span className="pill">{you.bestHand}</span>}
        {you?.folded && you?.holeCards && !state.showdownChoices[youId] && (
          <button className="secondary" style={{ marginTop: 6 }} onClick={() => send({ type: "REVEAL_HAND" })}>Show Cards</button>
        )}
        <div className="small">
          Stack: <b>{you?.stack ?? 0}</b> • Bet: <b>{you?.currentBet ?? 0}</b> • To call: <b>{toCall}</b>
        </div>
      </div>

      {state.dealerMessage && <div className="notice">{state.dealerMessage}</div>}
      {error && (
        <div className="notice">
          {error}
          {error.includes("Session ended") && (
            <button className="secondary" style={{ marginLeft: 12 }} onClick={fetchRecap} disabled={recapLoading}>
              {recapLoading ? "Loading..." : "Session Recap"}
            </button>
          )}
        </div>
      )}

      {/* ── Oval seat arrangement ── */}
      <div className={`seats seats-${seatCount}`}>
        {state.players.map((p, i) => {
          const isTurn = i === state.currentTurnIndex && inActiveHand;
          const isFolded = p.inHand && p.folded;
          const isSittingOut = !p.inHand;
          return (
            <div
              key={p.id}
              className={
                "seat" +
                (p.id === youId ? " you" : "") +
                (p.isDealer ? " dealer" : "") +
                (isTurn ? " turn" : "") +
                (isFolded ? " folded" : "") +
                (isSittingOut && state.street !== "DONE" ? " sitting-out" : "")
              }
            >
              <div className="hstack" style={{ justifyContent: "space-between" }}>
                <div>
                  <div>
                    <b>{p.name}</b> {p.connected ? "" : <span className="small">(disconnected)</span>}
                    {/* Position badges */}
                    {state.positions && state.street !== "DONE" && (
                      <>
                        {i === state.positions.buttonIndex && <span className="posBadge btn">BTN</span>}
                        {i === state.positions.sbIndex && <span className="posBadge sb">SB</span>}
                        {i === state.positions.bbIndex && <span className="posBadge bb">BB</span>}
                        {state.positions.straddleIndex !== null && i === state.positions.straddleIndex && <span className="posBadge str">STR</span>}
                      </>
                    )}
                    {p.id === state.bankPlayerId ? <span className="pill" style={{ marginLeft: 8, fontSize: 10 }}>Bank</span> : null}
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

              {/* Show revealed cards on any street, or showdown status */}
              {p.id !== youId && p.holeCards && state.showdownChoices[p.id]?.kind === "SHOW_2" && state.street !== "SHOWDOWN" && (
                <div style={{ marginTop: 8 }}>
                  <div className="holeCards">
                    <AnimatePresence>
                      {p.holeCards.map((c, ci) => (
                        <motion.div
                          key={c}
                          {...cardFlip}
                          transition={{ ...cardSpring, delay: ci * 0.1 }}
                          style={{ perspective: 600 }}
                        >
                          <CardPill c={c} />
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                  {p.bestHand && <span className="pill">{p.bestHand}</span>}
                </div>
              )}
              {state.street === "SHOWDOWN" && p.id !== youId && (
                <div style={{ marginTop: 8 }}>
                  {p.holeCards ? (
                    <div>
                      <div className="holeCards">
                        <AnimatePresence>
                          {p.holeCards.map((c, ci) => (
                            <motion.div
                              key={c}
                              {...cardFlip}
                              transition={{ ...cardSpring, delay: ci * 0.1 }}
                              style={{ perspective: 600 }}
                            >
                              <CardPill c={c} />
                            </motion.div>
                          ))}
                        </AnimatePresence>
                      </div>
                      {p.bestHand && <span className="pill">{p.bestHand}</span>}
                    </div>
                  ) : (
                    <div className="small">
                      {state.showdownChoices[p.id] ? renderChoice(state.showdownChoices[p.id]) : "Waiting..."}
                    </div>
                  )}
                </div>
              )}

              {isBank && (
                <BankRow player={p} onSetStack={(stack) => send({ type: "SET_STACK", playerId: p.id, stack })} />
              )}
            </div>
          );
        })}
      </div>

      {/* ── Sticky action bar ── */}
      <div className="actions">
        {/* Bank controls always visible to bank */}
        {isBank && (
          <div className="actionBar" style={{ marginBottom: 8 }}>
            <BankControls
              settings={state.settings}
              onApply={(sb2, bb2, str) => send({ type: "SET_BLINDS", smallBlind: sb2, bigBlind: bb2, straddleEnabled: str })}
            />
          </div>
        )}

        {state.street === "DONE" && (
          <div className="actionBar">
            <button disabled={!isDealer} onClick={() => send({ type: "START_HAND" })}>
              Dealer: Start hand
            </button>
            <span className="small">Strict turn order betting is live in v4.</span>
          </div>
        )}

        {inActiveHand && (
          canAct ? (
            <div className="actionBar">
              <BettingPanel
                enabled={true}
                streetBet={state.streetBet}
                toCall={toCall}
                sb={sb}
                bb={bb}
                pot={state.pot}
                you={you!}
                onAct={(a) => send({ type: "ACT", action: a })}
              />
            </div>
          ) : (
            <div className="waitingBanner">
              Waiting for <b>{currentTurnPlayer?.name ?? "..."}</b>...
            </div>
          )
        )}

        {inActiveHand && isDealer && (
          <div className="actionBar">
            <button className="secondary danger" onClick={() => {
              if (confirm("Void this hand? All bets will be returned.")) send({ type: "NEXT_STREET" });
            }}>Dealer: Void Hand</button>
          </div>
        )}

        {state.street === "SHOWDOWN" && (
          <div className="actionBar">
            {!state.showdownChoices[youId] && (
              <ShowdownPanel onPick={(choice) => send({ type: "SHOWDOWN_CHOICE", choice })} />
            )}
            {state.showdownChoices[youId] && (
              <span className="pill">You chose: {renderChoice(state.showdownChoices[youId])}</span>
            )}
            <button disabled={!isDealer} onClick={() => send({ type: "NEXT_STREET" })}>
              Dealer: End hand
            </button>
            <button disabled={!isDealer} onClick={() => send({ type: "END_SESSION" })}>
              Dealer: End session
            </button>
          </div>
        )}
      </div>

      {/* ── Collapsible action log ── */}
      <div className="logSection">
        <div className="logToggle" onClick={() => setLogOpen(!logOpen)}>
          <span>Action Log ({state.actionLog.length})</span>
          <span className={`chevron ${logOpen ? "open" : ""}`}>▼</span>
        </div>
        <div className={`logBody ${logOpen ? "open" : ""}`}>
          <div className="logBody-inner">
            {state.actionLog.length ? state.actionLog.map((l, i) => <div key={i} className="logLine">{l}</div>) : <div className="small">No actions yet.</div>}
          </div>
        </div>
      </div>

      {/* ── Recap modal ── */}
      {recapOpen && recap && (
        <div className="recapOverlay" onClick={() => setRecapOpen(false)}>
          <div className="recapModal" onClick={(e) => e.stopPropagation()}>
            <div className="title">Session Recap</div>
            <div style={{ marginTop: 12 }}>
              <div><b>Date:</b> {recap.date}</div>
              <div><b>Table:</b> {recap.tableId}</div>
              <div><b>Session:</b> {recap.sessionId}</div>
              <div><b>Players:</b> {recap.players?.join(", ") ?? "—"}</div>
              <div><b>Duration:</b> {recap.durationMin != null ? `${recap.durationMin} minutes` : "Unknown"}</div>
              <div style={{ marginTop: 10 }}>
                <div>Hands played: <b>{recap.hands}</b></div>
                <div>Blind/straddle posts: <b>{recap.posts}</b></div>
                <div>Player actions: <b>{recap.actions}</b></div>
              </div>
            </div>
            <button style={{ marginTop: 14 }} onClick={() => setRecapOpen(false)}>Close</button>
          </div>
        </div>
      )}

      {/* ── Hand History modal ── */}
      {handHistoryOpen && (
        <div className="recapOverlay" onClick={() => setHandHistoryOpen(false)}>
          <div className="handHistoryModal" onClick={(e) => e.stopPropagation()}>
            <div className="title">Hand History</div>
            {handHistory.length === 0 ? (
              <div className="small" style={{ marginTop: 12 }}>No hands played yet.</div>
            ) : (
              <div className="handList">
                {handHistory.map((h) => (
                  <div key={h.handNumber} className="handEntry">
                    <div
                      className="handHeader"
                      onClick={() => setExpandedHand(expandedHand === h.handNumber ? null : h.handNumber)}
                    >
                      <span>
                        <b>Hand #{h.handNumber}</b>
                        {" — "}
                        <span className={`pill ${h.outcome === "voided" ? "danger" : ""}`}>
                          {h.outcome === "showdown" ? "Showdown" : h.outcome === "uncontested" ? "Uncontested" : "Voided"}
                        </span>
                        {h.potAwards.length > 0 && (
                          <span style={{ marginLeft: 8, opacity: 0.8 }}>
                            {h.potAwards.map(a => a.winnerNames.join(", ")).join("; ")} wins
                          </span>
                        )}
                      </span>
                      <span className={`chevron ${expandedHand === h.handNumber ? "open" : ""}`}>&#x25BC;</span>
                    </div>
                    {expandedHand === h.handNumber && (
                      <div className="handDetail">
                        <div className="small">
                          Blinds: {h.blinds.smallBlind}/{h.blinds.bigBlind}
                          {" — "}Players: {h.players.map(p => p.name).join(", ")}
                        </div>

                        {h.posts.length > 0 && (
                          <div style={{ marginTop: 6 }}>
                            {h.posts.map((p, i) => (
                              <div key={i} className="small">{p.playerName} posts {p.label} {p.amount}</div>
                            ))}
                          </div>
                        )}

                        {renderStreetActions(h, "PREFLOP", "Preflop")}
                        {renderStreetActions(h, "FLOP", "Flop")}
                        {renderStreetActions(h, "TURN", "Turn")}
                        {renderStreetActions(h, "RIVER", "River")}

                        {h.finalBoard.length > 0 && (
                          <div style={{ marginTop: 8 }}>
                            <b className="small">Board:</b>{" "}
                            {h.finalBoard.map((c, i) => <CardPill key={i} c={c} />)}
                          </div>
                        )}

                        {h.potAwards.length > 0 && (
                          <div style={{ marginTop: 8 }}>
                            {h.potAwards.map((a, i) => (
                              <div key={i} className="small">
                                {a.winnerNames.join(", ")} wins {a.amount}
                                {a.split ? " (split)" : ""}
                                {a.auto ? " (uncontested)" : ""}
                              </div>
                            ))}
                          </div>
                        )}

                        {h.showdownChoices.length > 0 && (
                          <div style={{ marginTop: 6 }}>
                            {h.showdownChoices.map((s, i) => (
                              <div key={i} className="small">{s.playerName}: {s.choice.replace("SHOW_", "Show ").replace("_", " ")}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <button style={{ marginTop: 14 }} onClick={() => setHandHistoryOpen(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

function renderStreetActions(h: HandSummary, street: string, label: string) {
  const actions = h.actions.filter(a => a.street === street);
  if (actions.length === 0) return null;

  const streetInfo = h.streets.find(s => s.street === street);
  const board = streetInfo?.board ?? [];

  return (
    <div className="streetSection">
      <div className="streetHeader">
        <b>{label}</b>
        {board.length > 0 && (
          <span style={{ marginLeft: 8 }}>
            {board.map((c, i) => <CardPill key={i} c={c} />)}
          </span>
        )}
      </div>
      {actions.map((a, i) => (
        <div key={i} className="small">
          {a.playerName} {a.action.toLowerCase()}{a.amount != null ? ` ${a.amount}` : ""}
        </div>
      ))}
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

  // Pot-fraction helpers
  const effectivePot = isBet ? pot : pot + toCall;
  const fractionTo = (frac: number) => {
    const amount = Math.floor(effectivePot * frac);
    return isBet ? Math.max(bb, amount) : Math.max(streetBet + bb, streetBet + amount);
  };

  return (
    <>
      {/* Fold / Check|Call */}
      <button className="action-primary danger" disabled={!enabled} onClick={() => onAct({ kind: "FOLD" })}>Fold</button>
      {toCall === 0 ? (
        <button className="action-primary" disabled={!enabled} onClick={() => onAct({ kind: "CHECK" })}>Check</button>
      ) : (
        <button className="action-primary" disabled={!enabled} onClick={() => onAct({ kind: "CALL" })}>Call {toCall}</button>
      )}

      <div style={{ width: 1, height: 32, background: "rgba(255,255,255,0.15)", margin: "0 4px" }} />

      {/* Bet presets */}
      <div className="betPresets">
        <button className="secondary" disabled={!enabled} onClick={() => setToSafe(fractionTo(1/3))}>1/3 Pot</button>
        <button className="secondary" disabled={!enabled} onClick={() => setToSafe(fractionTo(1/2))}>1/2 Pot</button>
        <button className="secondary" disabled={!enabled} onClick={() => setToSafe(fractionTo(2/3))}>2/3 Pot</button>
        <button className="secondary" disabled={!enabled} onClick={() => setToSafe(fractionTo(1))}>Pot</button>
        <button className="secondary" disabled={!enabled} onClick={() => setToSafe(maxTo)}>All-in</button>
      </div>

      {/* Custom sizing */}
      <div className="betSizing">
        <span className="small">{isBet ? "Bet to" : "Raise to"}</span>
        <input
          type="number"
          value={safeTo}
          onChange={(e) => setToSafe(Number(e.target.value))}
          style={{ width: 100 }}
          disabled={!enabled}
        />
        <input
          type="range"
          min={0}
          max={maxTo}
          value={safeTo}
          onChange={(e) => setToSafe(Number(e.target.value))}
          disabled={!enabled}
          style={{ width: 180 }}
        />
        <button
          disabled={!enabled}
          onClick={() => onAct(isBet ? { kind: "BET", to: safeTo } : { kind: "RAISE", to: safeTo })}
        >
          {isBet ? "Bet" : "Raise"}
        </button>
      </div>
    </>
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
