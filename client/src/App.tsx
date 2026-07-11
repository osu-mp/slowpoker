import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, useMotionValue, useTransform, animate } from "framer-motion";
import { connect, type ConnStatus } from "./ws";
import type { ServerToClient, TableState, ShowChoice, Street, PlayerState, PlayerAction, HandSummary, PlayerProfile, TableSettings, GameConfigUpdate, BlindLevel } from "./types";
import { playCardDeal, playChipBet, playCheck, playFold, playYourTurn, playWin, playStreetTransition, playClockTick, setSoundVolume } from "./sounds";

type Conn = ReturnType<typeof connect> | null;

const SUIT_GLYPHS: Record<string, string> = { h: "\u2665", d: "\u2666", c: "\u2663", s: "\u2660" };
const PLAYER_EMOJIS = [
  // Animals
  "\uD83D\uDC36", "\uD83E\uDD8A", "\uD83D\uDC31", "\uD83D\uDC38", "\uD83E\uDD81",
  "\uD83D\uDC3C", "\uD83D\uDC28", "\uD83D\uDC2F", "\uD83E\uDD84", "\uD83D\uDC19",
  "\uD83D\uDC3A", "\uD83E\uDD8B", "\uD83D\uDC37", "\uD83D\uDC3B", "\uD83E\uDD94",
  "\uD83D\uDC22", "\uD83E\uDD96", "\uD83E\uDDA7", "\uD83E\uDD9C", "\uD83D\uDC27",
  // Faces / people
  "\uD83E\uDD20", "\uD83D\uDE08", "\uD83E\uDDD9", "\uD83E\uDD13", "\uD83D\uDC80",
  // Objects / misc
  "\uD83C\uDFB2", "\uD83C\uDFA9", "\uD83D\uDC8E", "\uD83D\uDD25", "\uD83D\uDE80",
];
function playerEmoji(index: number) { return PLAYER_EMOJIS[index % PLAYER_EMOJIS.length]; }
function displayRank(r: string) { return r === "T" ? "10" : r; }
function formatCard(c: string) {
  const rank = c.slice(0, -1);
  const suitChar = c.slice(-1);
  const glyph = SUIT_GLYPHS[suitChar] ?? suitChar;
  return displayRank(rank) + glyph;
}

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

function nextStreetLabel(s: Street): string {
  switch (s) {
    case "PREFLOP": return "Flop";
    case "FLOP": return "Turn";
    case "TURN": return "River";
    case "RIVER": return "Showdown";
    default: return "Next";
  }
}

const SUIT_COLOR_CLASS: Record<string, string> = { s: "white", h: "red", d: "blue", c: "green" };

function CardPill({ c, size = "" }: { c: string; size?: "md" | "lg" | "" }) {
  const rank = c.slice(0, -1);
  const suitChar = c.slice(-1);
  const glyph = SUIT_GLYPHS[suitChar] ?? suitChar;
  const colorClass = SUIT_COLOR_CLASS[suitChar] ?? "white";
  return (
    <span className={`playingCard ${colorClass}${size ? " " + size : ""}`}>
      <span className="rank">{displayRank(rank)}</span>
      <span className="suit">{glyph}</span>
    </span>
  );
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function Popover({ trigger, children, open, onToggle }: {
  trigger: React.ReactNode;
  children: React.ReactNode;
  open: boolean;
  onToggle: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onToggle();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open, onToggle]);

  return (
    <div className="popover-anchor" ref={ref}>
      <div onClick={onToggle}>{trigger}</div>
      {open && <div className="popover-card">{children}</div>}
    </div>
  );
}

function SeatMenu({ player, isBank, isDealer, isAdmin, isSelf, pendingRequest, onSetStack, onMakeDealer, onMakeBank, onApproveRequest, onDenyRequest, onBoot }: {
  player: PlayerState;
  isBank: boolean;
  isDealer: boolean;
  isAdmin: boolean;
  isSelf: boolean;
  pendingRequest?: number;
  onSetStack: (stack: number) => void;
  onMakeDealer: () => void;
  onMakeBank: () => void;
  onApproveRequest: () => void;
  onDenyRequest: () => void;
  onBoot: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [stackVal, setStackVal] = useState(player.stack);
  const toggle = useCallback(() => setOpen(o => !o), []);

  const hasActions = isBank || isDealer || isAdmin;
  if (!hasActions) return null;

  return (
    <Popover
      trigger={<button className="seat-gear" title="Seat actions">&#x2699;</button>}
      open={open}
      onToggle={toggle}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {isBank && (
          <>
            <div className="hstack" style={{ gap: 8 }}>
              <span className="small">Set stack:</span>
              <input type="number" value={stackVal} onChange={(e) => setStackVal(Number(e.target.value))} style={{ width: 90 }} />
              <button className="secondary" onClick={() => { onSetStack(stackVal); setOpen(false); }}>Set</button>
            </div>
            {pendingRequest != null && (
              <div className="hstack" style={{ gap: 8 }}>
                <span className="pill">Requests {pendingRequest}</span>
                <button className="secondary" onClick={() => { onSetStack(player.stack + pendingRequest); onApproveRequest(); setOpen(false); }}>Approve</button>
                <button className="secondary danger" onClick={() => { onDenyRequest(); setOpen(false); }}>Deny</button>
              </div>
            )}
          </>
        )}
        {isDealer && !isSelf && (
          <button className="secondary" onClick={() => { onMakeDealer(); setOpen(false); }}>
            Make dealer
          </button>
        )}
        {isBank && !isSelf && (
          <button className="secondary" onClick={() => { onMakeBank(); setOpen(false); }}>
            Make bank
          </button>
        )}
        {isAdmin && !isSelf && (
          <button className="secondary danger" onClick={() => {
            if (confirm(`Remove ${player.name} from the table?`)) { onBoot(); setOpen(false); }
          }}>
            Remove player
          </button>
        )}
      </div>
    </Popover>
  );
}

const cardFlip = {
  initial: { opacity: 0, rotateY: 90, scale: 0.8 },
  animate: { opacity: 1, rotateY: 0, scale: 1 },
  exit: { opacity: 0, scale: 0.8 },
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

function seatStyle(index: number, total: number): React.CSSProperties {
  const angle = (Math.PI / 2) - (index / total) * 2 * Math.PI;
  const rx = 44, ry = 40; // ellipse radii as % of container
  return {
    position: "absolute",
    left: `${50 - rx * Math.cos(angle)}%`,
    top: `${50 + ry * Math.sin(angle)}%`,
  };
}

function SeatCards({ p, choice, isYou, handNumber, showOuts }: {
  p: PlayerState;
  choice: ShowChoice | undefined;
  isYou: boolean;
  handNumber: number;
  showOuts: boolean;
}) {
  if (!p.inHand || p.folded) return null;

  if (choice?.kind === "SHOW_0") {
    return <div className="small" style={{ textAlign: "center", opacity: 0.55, marginTop: 4 }}>Mucked</div>;
  }

  const getCard = (ci: 0 | 1): string | null => {
    if (!p.holeCards) return null;
    if (isYou) return p.holeCards[ci];
    if (choice?.kind === "SHOW_2") return p.holeCards[ci];
    if (choice?.kind === "SHOW_1" && choice.cardIndex === ci) return p.holeCards[ci];
    return null;
  };

  const cardFlipAnim = { initial: { opacity: 0, rotateY: 90 }, animate: { opacity: 1, rotateY: 0 }, exit: { opacity: 0, rotateY: -90 } };
  const spring = { type: "spring" as const, stiffness: 320, damping: 22 };

  return (
    <div>
      <div className="seatCards">
        {([0, 1] as const).map(ci => {
          const card = getCard(ci);
          return (
            <div key={ci} style={{ perspective: 600 }}>
              <AnimatePresence mode="wait">
                {card ? (
                  <motion.div key={`${handNumber}-${card}`} {...cardFlipAnim} transition={{ ...spring, delay: ci * 0.08 }}>
                    <CardPill c={card} size="lg" />
                  </motion.div>
                ) : (
                  <motion.span
                    key="back"
                    className="playingCard card-back lg"
                    initial={{ opacity: 0, scale: 0.85 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, rotateY: 90, scale: 0.8 }}
                    transition={{ duration: 0.22 }}
                  />
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
      {p.bestHand && <div style={{ marginTop: 3 }}><span className="pill">{p.bestHand}</span></div>}
      {isYou && showOuts && p.outs !== undefined && p.outs > 0 && (
        <div style={{ marginTop: 3 }}>
          <span className="pill outs-badge" title="Flush/straight draw outs only">{p.outs} outs</span>
        </div>
      )}
    </div>
  );
}

const DENOMS = [500, 100, 25, 5, 1] as const;
const DENOM_COLOR: Record<number, string> = {
  500: "#9b59b6", 100: "#2c2c2c", 25: "#27ae60", 5: "#e74c3c", 1: "#d5d8dc",
};
const DENOM_BORDER: Record<number, string> = {
  500: "#7d3c98", 100: "#111", 25: "#1e8449", 5: "#c0392b", 1: "#aab7b8",
};
type ChipGroup = { denom: number; count: number };

function chipBreakdown(amount: number): ChipGroup[] {
  let remaining = Math.max(0, Math.floor(amount));
  const result: ChipGroup[] = [];
  for (const d of DENOMS) {
    const count = Math.floor(remaining / d);
    if (count > 0) result.push({ denom: d, count });
    remaining %= d;
  }
  return result;
}

type ChipSize = "sm" | "md" | "lg";
const CHIP_W: Record<ChipSize, number> = { sm: 16, md: 20, lg: 26 };
const CHIP_H: Record<ChipSize, number> = { sm: 5, md: 7, lg: 9 };
const CHIP_OFF: Record<ChipSize, number> = { sm: 4, md: 5, lg: 6 };

function ChipStack({ amount, size = "sm", maxCols = 8 }: {
  amount: number;
  size?: ChipSize;
  maxCols?: number;
}) {
  if (amount <= 0) return null;
  const groups = chipBreakdown(amount);
  if (groups.length === 0) return null;

  const w = CHIP_W[size];
  const h = CHIP_H[size];
  const off = CHIP_OFF[size];

  const columns: { denom: number; count: number }[] = [];
  for (const { denom, count } of groups) {
    for (let c = 0; c < Math.ceil(count / 10); c++) {
      columns.push({ denom, count: Math.min(10, count - c * 10) });
    }
  }
  const cols = columns.slice(0, maxCols);

  return (
    <div style={{ display: "flex", gap: 3, alignItems: "flex-end" }} title={String(amount)}>
      {cols.map((col, ci) => {
        const colH = h + (col.count - 1) * off;
        return (
          <div key={ci} style={{ position: "relative", width: w, height: colH, flexShrink: 0 }}>
            {Array.from({ length: col.count }, (_, i) => (
              <div
                key={i}
                style={{
                  position: "absolute",
                  bottom: i * off,
                  width: w,
                  height: h,
                  borderRadius: "50%",
                  background: DENOM_COLOR[col.denom],
                  border: `1.5px solid ${DENOM_BORDER[col.denom]}`,
                  boxShadow: `0 2px 0 ${DENOM_BORDER[col.denom]}, inset 0 1px 0 rgba(255,255,255,0.25)`,
                }}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function AdminConfigPanel({ settings, onApplyConfig, onSetRebuys, onAdvanceBlinds, onClose, nowMs }: {
  settings: TableSettings;
  onApplyConfig: (c: GameConfigUpdate) => void;
  onSetRebuys: (enabled: boolean, minutes: number) => void;
  onAdvanceBlinds: () => void;
  onClose: () => void;
  nowMs: number;
}) {
  const [tab, setTab] = useState<"schedule" | "rebuys" | "rules" | "json">("schedule");
  const s = settings;
  const [levels, setLevels] = useState<BlindLevel[]>(() => s.blindSchedule ?? []);
  const [trigger, setTrigger] = useState<"manual" | "time" | "bust">(() => s.blindTrigger ?? "manual");
  const [triggerMinutes, setTriggerMinutes] = useState(() => s.blindTriggerMinutes ?? 20);
  const [triggerBusts, setTriggerBusts] = useState(() => s.blindTriggerBusts ?? 1);
  const [rebuysEnabled, setRebuysEnabled] = useState(() => s.rebuysEnabled ?? false);
  const [rebuysMinutes, setRebuysMinutes] = useState(60);
  const [allowReveal, setAllowReveal] = useState(() => s.homeRules?.allowMidHandReveal ?? false);
  const [clockSecs, setClockSecs] = useState(() => s.clockSeconds ?? 30);
  const [allowOuts, setAllowOuts] = useState(() => s.homeRules?.showOuts ?? false);
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState("");

  const addLevel = () => {
    const last = levels[levels.length - 1];
    setLevels([...levels, { smallBlind: last?.bigBlind ?? s.bigBlind, bigBlind: (last?.bigBlind ?? s.bigBlind) * 2 }]);
  };

  const exportConfig = () => {
    const cfg = {
      blindSchedule: s.blindSchedule, blindTrigger: s.blindTrigger,
      blindTriggerMinutes: s.blindTriggerMinutes, blindTriggerBusts: s.blindTriggerBusts,
      straddleEnabled: s.straddleEnabled, rebuysEnabled: s.rebuysEnabled,
      homeRules: s.homeRules,
    };
    setJsonText(JSON.stringify(cfg, null, 2));
  };

  const importConfig = () => {
    try {
      const cfg = JSON.parse(jsonText) as GameConfigUpdate;
      onApplyConfig(cfg);
      setJsonError("");
    } catch { setJsonError("Invalid JSON — check formatting and try again."); }
  };

  const rebuysOpen = s.rebuysOpenUntil > 0 && s.rebuysOpenUntil > nowMs;

  return (
    <div className="recapOverlay" onClick={onClose}>
      <div className="recapModal" style={{ maxWidth: 500 }} onClick={e => e.stopPropagation()}>
        <div className="title">⚙ Game Config <span style={{ fontSize: 12, fontWeight: 400 }}>(Admin only)</span></div>

        <div className="hstack" style={{ gap: 6, margin: "12px 0 16px" }}>
          {(["schedule", "rebuys", "rules", "json"] as const).map(t => (
            <button key={t} className={tab === t ? "" : "secondary"} style={{ fontSize: 12 }} onClick={() => setTab(t)}>
              {t === "schedule" ? "Blind Schedule" : t === "rebuys" ? "Rebuys" : t === "rules" ? "Home Rules" : "Save / Load"}
            </button>
          ))}
        </div>

        {tab === "schedule" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {s.blindLevelIndex >= 0 && (
              <div className="small">Currently on level {s.blindLevelIndex + 1} of {s.blindSchedule.length}: <b>{s.smallBlind}/{s.bigBlind}</b></div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {levels.length === 0 && <div className="small" style={{ opacity: 0.6 }}>No levels — add one below.</div>}
              {levels.map((l, i) => (
                <div key={i} className="hstack" style={{ gap: 8 }}>
                  <span className="small" style={{ width: 56, flexShrink: 0 }}>Level {i + 1}</span>
                  <input type="number" value={l.smallBlind} min={1} style={{ width: 66 }}
                    onChange={e => { const n = [...levels]; n[i] = { ...l, smallBlind: Number(e.target.value) }; setLevels(n); }} />
                  <span className="small">/</span>
                  <input type="number" value={l.bigBlind} min={1} style={{ width: 66 }}
                    onChange={e => { const n = [...levels]; n[i] = { ...l, bigBlind: Number(e.target.value) }; setLevels(n); }} />
                  <button className="secondary danger" onClick={() => setLevels(levels.filter((_, j) => j !== i))}>✕</button>
                </div>
              ))}
              <button className="secondary" onClick={addLevel}>+ Add level</button>
            </div>

            <div>
              <div className="small" style={{ marginBottom: 6 }}>Advance trigger</div>
              <div className="hstack" style={{ gap: 12 }}>
                {(["manual", "time", "bust"] as const).map(t => (
                  <label key={t} className="hstack" style={{ gap: 4, cursor: "pointer" }}>
                    <input type="radio" checked={trigger === t} onChange={() => setTrigger(t)} />
                    <span className="small">{t === "manual" ? "Manual" : t === "time" ? "Time" : "Busts"}</span>
                  </label>
                ))}
              </div>
              {trigger === "time" && (
                <div className="hstack" style={{ gap: 8, marginTop: 8 }}>
                  <span className="small">Minutes per level:</span>
                  <input type="number" value={triggerMinutes} min={1} style={{ width: 70 }} onChange={e => setTriggerMinutes(Number(e.target.value))} />
                </div>
              )}
              {trigger === "bust" && (
                <div className="hstack" style={{ gap: 8, marginTop: 8 }}>
                  <span className="small">Player busts per advance:</span>
                  <input type="number" value={triggerBusts} min={1} style={{ width: 70 }} onChange={e => setTriggerBusts(Number(e.target.value))} />
                </div>
              )}
            </div>

            <div className="hstack" style={{ gap: 8 }}>
              <button onClick={() => onApplyConfig({ blindSchedule: levels, blindTrigger: trigger, blindTriggerMinutes: triggerMinutes, blindTriggerBusts: triggerBusts })}>
                Apply Schedule
              </button>
              {s.blindLevelIndex >= 0 && s.blindLevelIndex + 1 < s.blindSchedule.length && (
                <button className="secondary" onClick={onAdvanceBlinds}>Advance level now</button>
              )}
            </div>
          </div>
        )}

        {tab === "rebuys" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label className="hstack" style={{ gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={rebuysEnabled} onChange={e => setRebuysEnabled(e.target.checked)} />
              <span>Rebuys allowed</span>
            </label>
            {rebuysEnabled && (
              <div className="hstack" style={{ gap: 8 }}>
                <span className="small">Close after (min, 0 = unlimited):</span>
                <input type="number" value={rebuysMinutes} min={0} style={{ width: 70 }} onChange={e => setRebuysMinutes(Number(e.target.value))} />
              </div>
            )}
            <button onClick={() => onSetRebuys(rebuysEnabled, rebuysMinutes)} style={{ alignSelf: "flex-start" }}>
              {rebuysEnabled ? "Open Rebuy Window" : "Close Rebuys"}
            </button>
            {rebuysOpen && (
              <div className="notice" style={{ borderColor: "rgba(100,220,100,0.4)", background: "rgba(100,220,100,0.08)" }}>
                Window open{s.rebuysOpenUntil < Number.MAX_SAFE_INTEGER
                  ? ` — closes in ~${Math.ceil((s.rebuysOpenUntil - nowMs) / 60_000)} min`
                  : " (no time limit)"}.
              </div>
            )}
            {!rebuysOpen && s.rebuysEnabled && <div className="notice">Rebuy window is closed.</div>}
          </div>
        )}

        {tab === "rules" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontWeight: 600 }}>🏠 Home Game Rules</div>
            <label className="hstack" style={{ gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={allowReveal} onChange={e => setAllowReveal(e.target.checked)} />
              <div>
                <div>Allow mid-hand card reveals</div>
                <div className="small" style={{ opacity: 0.7 }}>Players can show their live hole cards to the table (against standard rules).</div>
              </div>
            </label>
            <label className="hstack" style={{ gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={allowOuts} onChange={e => setAllowOuts(e.target.checked)} />
              <div>
                <div>Show draw outs</div>
                <div className="small" style={{ opacity: 0.7 }}>Each player sees their own flush/straight draw outs on their seat (flop &amp; turn only). Opponents see nothing — only you see your own count.</div>
              </div>
            </label>
            <div className="hstack" style={{ gap: 8, alignItems: "center" }}>
              <span className="small">Call clock — seconds to act:</span>
              <input type="number" min={0} max={300} value={clockSecs} style={{ width: 66 }}
                onChange={e => setClockSecs(Math.max(0, Number(e.target.value)))} />
              <span className="small" style={{ opacity: 0.6 }}>(0 = disabled)</span>
            </div>
            <button style={{ alignSelf: "flex-start" }} onClick={() => onApplyConfig({ homeRules: { allowMidHandReveal: allowReveal, showOuts: allowOuts }, clockSeconds: clockSecs })}>
              Apply Rules
            </button>
          </div>
        )}

        {tab === "json" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div className="small">Export the current config to JSON to save it, or paste a saved config to restore it.</div>
            <div className="hstack" style={{ gap: 8 }}>
              <button className="secondary" onClick={exportConfig}>Export config</button>
              <button onClick={importConfig}>Import from JSON</button>
            </div>
            {jsonError && <div className="notice">{jsonError}</div>}
            <textarea rows={12} style={{ fontFamily: "monospace", fontSize: 12, width: "100%", background: "#1a1a2e", color: "#e0e0e0", border: "1px solid #333", borderRadius: 6, padding: 8, boxSizing: "border-box" }}
              value={jsonText} onChange={e => { setJsonText(e.target.value); setJsonError(""); }}
              placeholder='Paste saved config JSON here, then click Import.' />
          </div>
        )}

        <button className="secondary" style={{ marginTop: 16 }} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

type ChipSnapshot = { hand: number; stacks: Record<string, number>; names: Record<string, string> };

const CHART_COLORS = ['#4fc3f7','#81c784','#ffb74d','#e57373','#ba68c8','#4db6ac','#fff176','#f48fb1'];

function ChipChart({ history, youId, onClose }: { history: ChipSnapshot[]; youId: string; onClose: () => void }) {
  return (
    <div className="recapOverlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 560, width: "96vw" }} onClick={e => e.stopPropagation()}>
        <div className="title">📊 Chip History</div>
        {history.length < 2
          ? <div className="small" style={{ padding: "20px 0", textAlign: "center" }}>Play at least 2 hands to see the chart.</div>
          : <ChipChartSVG history={history} youId={youId} />
        }
        <button style={{ marginTop: 16 }} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

function ChipChartSVG({ history, youId }: { history: ChipSnapshot[]; youId: string }) {
  const W = 500, H = 280, ML = 52, MR = 16, MT = 14, MB = 32;
  const PW = W - ML - MR, PH = H - MT - MB;

  const playerIds = [...new Set(history.flatMap(s => Object.keys(s.stacks)))];
  const names: Record<string, string> = {};
  for (const s of history) Object.assign(names, s.names);

  const allVals = history.flatMap(s => Object.values(s.stacks));
  const minY = Math.min(...allVals), maxY = Math.max(...allVals);
  const yRange = maxY - minY || 1;

  const xOf = (i: number) => ML + (i / Math.max(history.length - 1, 1)) * PW;
  const yOf = (v: number) => MT + PH - ((v - minY) / yRange) * PH;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(t => ({
    y: MT + t * PH,
    label: Math.round(maxY - t * yRange),
  }));

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
        {/* Grid + Y labels */}
        {yTicks.map(({ y, label }) => (
          <g key={label}>
            <line x1={ML} y1={y} x2={ML + PW} y2={y} stroke="rgba(255,255,255,0.1)" strokeWidth={1} />
            <text x={ML - 5} y={y + 4} textAnchor="end" fill="rgba(255,255,255,0.45)" fontSize={10}>{label}</text>
          </g>
        ))}
        {/* X labels */}
        {history.map((s, i) => (
          <text key={i} x={xOf(i)} y={H - MB + 14} textAnchor="middle" fill="rgba(255,255,255,0.45)" fontSize={10}>{s.hand}</text>
        ))}
        <text x={ML + PW / 2} y={H} textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize={9}>Hand</text>
        {/* Axes */}
        <line x1={ML} y1={MT} x2={ML} y2={MT + PH} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
        <line x1={ML} y1={MT + PH} x2={ML + PW} y2={MT + PH} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
        {/* Player lines */}
        {playerIds.map((id, ci) => {
          const color = CHART_COLORS[ci % CHART_COLORS.length];
          const isYou = id === youId;
          const pts = history
            .map((s, i) => s.stacks[id] !== undefined ? { x: xOf(i), y: yOf(s.stacks[id]) } : null)
            .filter(Boolean) as { x: number; y: number }[];
          if (pts.length === 0) return null;
          const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
          return (
            <g key={id}>
              <path d={d} fill="none" stroke={color} strokeWidth={isYou ? 2.5 : 1.5} strokeOpacity={isYou ? 1 : 0.65} />
              {pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={isYou ? 4 : 3} fill={color} opacity={isYou ? 1 : 0.75} />)}
            </g>
          );
        })}
      </svg>
      {/* Legend */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", marginTop: 10 }}>
        {playerIds.map((id, ci) => (
          <div key={id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <div style={{ width: 18, height: 3, background: CHART_COLORS[ci % CHART_COLORS.length], borderRadius: 2 }} />
            <span style={{ fontWeight: id === youId ? 700 : 400, opacity: id === youId ? 1 : 0.8 }}>
              {names[id] ?? id}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RulesSummary({ settings, onClose, nowMs }: { settings: TableSettings; onClose: () => void; nowMs: number }) {
  const s = settings;
  const rebuysOpen = s.rebuysOpenUntil > 0 && s.rebuysOpenUntil > nowMs;
  return (
    <div className="recapOverlay" onClick={onClose}>
      <div className="recapModal" onClick={e => e.stopPropagation()}>
        <div className="title">📋 Table Rules</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
          <div><b>Blinds:</b> {s.smallBlind}/{s.bigBlind}{s.straddleEnabled ? " · straddle on" : ""}</div>

          {s.blindSchedule?.length > 0 && (
            <div>
              <b>Blind schedule</b> ({s.blindTrigger === "time" ? `every ${s.blindTriggerMinutes} min` : s.blindTrigger === "bust" ? `every ${s.blindTriggerBusts} bust${s.blindTriggerBusts > 1 ? "s" : ""}` : "manual advance"}):
              <div className="hstack" style={{ flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                {s.blindSchedule.map((l, i) => (
                  <span key={i} className="pill" style={i === s.blindLevelIndex ? { background: "rgba(255,215,0,0.2)", borderColor: "rgba(255,215,0,0.5)" } : {}}>
                    {i === s.blindLevelIndex ? "▶ " : ""}{l.smallBlind}/{l.bigBlind}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div><b>Rebuys:</b> {!s.rebuysEnabled ? "Not allowed" : rebuysOpen ? `Open${s.rebuysOpenUntil < Number.MAX_SAFE_INTEGER ? ` — ~${Math.ceil((s.rebuysOpenUntil - nowMs) / 60_000)} min left` : " (unlimited)"}` : "Closed"}</div>

          <div><b>Home rules:</b> {[
            s.homeRules?.allowMidHandReveal && "Mid-hand reveals",
            s.homeRules?.showOuts && "Draw outs display",
          ].filter(Boolean).join(", ") || "Standard rules"}</div>
        </div>
        <button style={{ marginTop: 16 }} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

type ChipAnim = { id: number; seatIndex: number; amount: number };
type DealAnim = { id: number; seatIndex: number; cardIndex: number };
let animIdCounter = 0;

const TABLE_ID = "default";

export default function App() {
  const [conn, setConn] = useState<Conn>(null);
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
  const [availableSessions, setAvailableSessions] = useState<string[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [soundVolume, setSoundVolumeState] = useState(() => {
    const stored = localStorage.getItem("sp-soundVolume");
    // migrate old on/off setting
    if (stored === null) return localStorage.getItem("sp-soundEnabled") === "false" ? 0 : 80;
    return Number(stored);
  });
  const setSoundVolumePersist = useCallback((v: number) => {
    setSoundVolumeState(v);
    setSoundVolume(v);
    localStorage.setItem("sp-soundVolume", String(v));
  }, []);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const toggleSettings = useCallback(() => setSettingsOpen(o => !o), []);
  const [menuOpen, setMenuOpen] = useState(false);
  const toggleMenu = useCallback(() => setMenuOpen(o => !o), []);
  const [autoShowPref, setAutoShowPref] = useState<"ask" | "muck" | "show">(
    () => (localStorage.getItem("sp-autoShow") as "ask" | "muck" | "show") ?? "ask"
  );
  const autoShowPrefRef = useRef(autoShowPref);
  useEffect(() => { autoShowPrefRef.current = autoShowPref; }, [autoShowPref]);
  const [chipPromptOpen, setChipPromptOpen] = useState(false);
  const [chipPromptAmount, setChipPromptAmount] = useState(200);
  const [welcomeBack, setWelcomeBack] = useState<PlayerProfile | null>(null);
  const [joinChipRequest, setJoinChipRequest] = useState(200);
  const [watchOnly, setWatchOnly] = useState(false);
  const [adminConfigOpen, setAdminConfigOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [chartOpen, setChartOpen] = useState(false);
  const [chipHistory, setChipHistory] = useState<ChipSnapshot[]>([]);
  const [nowMs, setNowMs] = useState(Date.now());
  const [autoStartSecs, setAutoStartSecs] = useState(() => Number(localStorage.getItem("sp-autoStart") ?? 0));
  const [autoStartCountdown, setAutoStartCountdown] = useState<number | null>(null);
  const autoStartRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [confetti, setConfetti] = useState<{ id: number; x: number; color: string; delay: number }[]>([]);
  type ClockThrowAnim = { id: number; fromX: number; fromY: number; toX: number; toY: number };
  const [clockThrow, setClockThrow] = useState<ClockThrowAnim | null>(null);

  // Tick for rebuy countdown & blind schedule progress
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);

  // Sync initial master volume on mount
  useEffect(() => { setSoundVolume(soundVolume); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fast tick for clock countdown — only runs while a clock is active
  const [clockNow, setClockNow] = useState(Date.now());
  useEffect(() => {
    if (!state?.clockEndsAt) return;
    setClockNow(Date.now());
    const id = setInterval(() => setClockNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [state?.clockEndsAt]);

  // Clock tick sound — plays every second when clock is running
  useEffect(() => {
    if (!state?.clockEndsAt || soundVolume === 0) return;
    const id = setInterval(() => {
      const secsLeft = Math.ceil((state.clockEndsAt! - Date.now()) / 1000);
      if (secsLeft > 0) playClockTick(secsLeft <= 10);
    }, 1000);
    return () => clearInterval(id);
  }, [state?.clockEndsAt, soundVolume]);

  // Animation state
  const [chipAnimations, setChipAnimations] = useState<ChipAnim[]>([]);
  const [dealAnimations, setDealAnimations] = useState<DealAnim[]>([]);
  const [streetFlash, setStreetFlash] = useState<string | null>(null);
  const [potPulse, setPotPulse] = useState(0);
  const [winnerPlayerIds, setWinnerPlayerIds] = useState<Set<string>>(new Set());
  const [foldingPlayers, setFoldingPlayers] = useState<Set<string>>(new Set());
  const [stackDeltas, setStackDeltas] = useState<Record<string, number>>({});
  const prevStateRef = useRef<TableState | null>(null);

  // Record chip snapshot after each hand completes
  useEffect(() => {
    if (!state || state.street !== "DONE" || state.handNumber === 0) return;
    setChipHistory(prev => {
      if (prev[prev.length - 1]?.hand === state.handNumber) return prev;
      const stacks: Record<string, number> = {};
      const names: Record<string, string> = {};
      for (const p of state.players) { stacks[p.id] = p.stack; names[p.id] = p.name; }
      return [...prev, { hand: state.handNumber, stacks, names }];
    });
  }, [state?.street, state?.handNumber]);

  const you = useMemo(() => state?.players.find(p => p.id === youId) ?? null, [state, youId]);
  const currentTurnPlayer = useMemo(() => state ? state.players[state.currentTurnIndex] : null, [state]);
  const yourEmoji = you?.emoji ?? playerEmoji(state?.players.findIndex(p => p.id === youId) ?? 0);

  // Animation detection: diff previous state vs current
  useEffect(() => {
    if (!state || !youId) return;
    const prev = prevStateRef.current;
    prevStateRef.current = state;
    if (!prev) return;

    const youIdx = state.players.findIndex(p => p.id === youId);
    const seats = state.players.map((_, i) =>
      state.players[(youIdx + i) % state.players.length]
    );

    // 1. Hand start → card deal animation + sound
    if (state.handNumber !== prev.handNumber && state.street === "PREFLOP") {
      if (soundVolume > 0) playCardDeal();
      const newAnims: DealAnim[] = [];
      seats.forEach((p, seatIdx) => {
        if (p.inHand) {
          newAnims.push({ id: ++animIdCounter, seatIndex: seatIdx, cardIndex: 0 });
          newAnims.push({ id: ++animIdCounter, seatIndex: seatIdx, cardIndex: 1 });
        }
      });
      setDealAnimations(a => [...a, ...newAnims]);
    }

    // 2. Bet increases → chip fly animation + sound (skip on hand start to avoid blind-posting clutter)
    if (state.handNumber === prev.handNumber) {
      let hadBetIncrease = false;
      seats.forEach((p, seatIdx) => {
        const prevP = prev.players.find(pp => pp.id === p.id);
        if (prevP && p.currentBet > prevP.currentBet) {
          hadBetIncrease = true;
          setChipAnimations(a => [...a, {
            id: ++animIdCounter,
            seatIndex: seatIdx,
            amount: p.currentBet - prevP.currentBet,
          }]);
        }
      });
      if (hadBetIncrease) {
        if (soundVolume > 0) playChipBet();
        setPotPulse(n => n + 1);
      }
    }

    // 3. Street change → flash label + sound
    if (state.street !== prev.street && ["FLOP", "TURN", "RIVER"].includes(state.street)) {
      setStreetFlash(streetLabel(state.street));
      setTimeout(() => setStreetFlash(null), 1800);
      if (soundVolume > 0) playStreetTransition();
    }

    // 4. Win banner → sound
    if (state.winningHandName && !prev.winningHandName) {
      if (soundVolume > 0) playWin();
    }

    // 5. Check/fold detection from action log
    if (state.actionLog.length > prev.actionLog.length && state.actionLog[0] !== prev.actionLog[0]) {
      const latest = state.actionLog[0]?.toLowerCase() ?? "";
      if (soundVolume > 0) {
        if (latest.includes("checks")) playCheck();
        else if (latest.includes("folds")) playFold();
      }
    }

    // 6. Your turn → chime
    const prevTurnId = prev.players[prev.currentTurnIndex]?.id;
    const currTurnId = state.players[state.currentTurnIndex]?.id;
    if (currTurnId === youId && prevTurnId !== youId &&
        state.street !== "DONE" && state.street !== "SHOWDOWN") {
      if (soundVolume > 0) playYourTurn();
    }

    // 7. Hand ends → highlight winner seats for 3s
    if (state.street === "DONE" && prev.street !== "DONE") {
      const winners = new Set(state.pots.flatMap(p => p.winnerIds ?? []));
      if (winners.size > 0) {
        setWinnerPlayerIds(winners);
        setTimeout(() => setWinnerPlayerIds(new Set()), 3000);
      }
    }

    // 8. Stack changes → show delta badge for 1.5s
    for (const p of state.players) {
      const prevP = prev.players.find(pp => pp.id === p.id);
      if (prevP && p.stack !== prevP.stack) {
        const delta = p.stack - prevP.stack;
        const pid = p.id;
        setStackDeltas(d => ({ ...d, [pid]: delta }));
        setTimeout(() => setStackDeltas(d => { const { [pid]: _, ...rest } = d; return rest; }), 1500);
      }
    }

    // 9. Player folds → show card-back ghost for 1.2s
    if (state.handNumber === prev.handNumber) {
      for (const p of state.players) {
        const prevP = prev.players.find(pp => pp.id === p.id);
        if (prevP && !prevP.folded && p.folded) {
          setFoldingPlayers(fp => new Set([...fp, p.id]));
          const foldId = p.id;
          setTimeout(() => setFoldingPlayers(fp => {
            const next = new Set(fp);
            next.delete(foldId);
            return next;
          }), 1200);
        }
      }
    }

    // 10. Clock newly called → throw animation from caller seat to target seat
    if (!prev.clockEndsAt && state.clockEndsAt && state.clockCalledBy) {
      const n = seats.length;
      const callerSeatIdx = seats.findIndex(p => p.id === state.clockCalledBy);
      const targetSeatIdx = seats.findIndex(p => p.id === state.players[state.currentTurnIndex]?.id);
      if (callerSeatIdx >= 0 && targetSeatIdx >= 0) {
        const seatCenter = (idx: number) => {
          const angle = (Math.PI / 2) - (idx / n) * 2 * Math.PI;
          return { x: 50 - 44 * Math.cos(angle), y: 50 + 40 * Math.sin(angle) };
        };
        const from = seatCenter(callerSeatIdx);
        const to = seatCenter(targetSeatIdx);
        const throwId = ++animIdCounter;
        setClockThrow({ id: throwId, fromX: from.x, fromY: from.y, toX: to.x, toY: to.y });
        setTimeout(() => setClockThrow(t => t?.id === throwId ? null : t), 900);
      }
    }

    // 11. You win a pot → confetti burst
    if (state.street === "DONE" && prev.street !== "DONE" && youId) {
      const wonPot = state.pots.some(p => p.winnerIds?.includes(youId));
      if (wonPot) {
        const colors = ["#ffd700","#ff4444","#44ff88","#4499ff","#ff88ff","#ff8844"];
        setConfetti(Array.from({ length: 36 }, (_, i) => ({
          id: i,
          x: 30 + Math.random() * 40,
          color: colors[i % colors.length],
          delay: Math.random() * 0.4,
        })));
        setTimeout(() => setConfetti([]), 3000);
      }
    }
  }, [state, youId, soundVolume]);

  // Reconnect border: toggle body class so CSS viewport pulse applies
  useEffect(() => {
    document.body.classList.toggle("reconnecting", connStatus === "reconnecting");
    return () => document.body.classList.remove("reconnecting");
  }, [connStatus]);

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

  // Auto-start hand countdown for dealer
  const youIsDealer = !!you?.isDealer;
  useEffect(() => {
    if (autoStartRef.current) { clearInterval(autoStartRef.current); autoStartRef.current = null; }
    setAutoStartCountdown(null);
    if (!youIsDealer || !state || state.street !== "DONE" || autoStartSecs <= 0) return;
    setAutoStartCountdown(autoStartSecs);
    let remaining = autoStartSecs;
    autoStartRef.current = setInterval(() => {
      remaining -= 1;
      setAutoStartCountdown(remaining);
      if (remaining <= 0) {
        clearInterval(autoStartRef.current!);
        autoStartRef.current = null;
        send({ type: "START_HAND" });
      }
    }, 1000);
    return () => { if (autoStartRef.current) clearInterval(autoStartRef.current); };
  }, [youIsDealer, state?.street, autoStartSecs]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto show/muck preference
  useEffect(() => {
    if (!state || !youId || !you) return;
    const pref = autoShowPrefRef.current;
    if (pref === "ask") return;

    if (state.street === "SHOWDOWN" && you.inHand && !you.folded && !state.showdownChoices[youId]) {
      send({ type: "SHOWDOWN_CHOICE", choice: pref === "show" ? { kind: "SHOW_2" } : { kind: "SHOW_0" } });
    }
    if (state.street === "DONE" && you.holeCards && !state.showdownChoices[youId] && pref === "show") {
      send({ type: "REVEAL_HAND" });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.street, state?.handNumber, youId]);

  function join() {
    setError(null);
    const pendingChips = watchOnly ? 0 : joinChipRequest;
    const storedPlayerId = localStorage.getItem(`sp-playerId-${TABLE_ID}`) ?? undefined;
    const storedEmoji = localStorage.getItem(`sp-emoji-${TABLE_ID}`) ?? undefined;
    let connRef: ReturnType<typeof connect> | null = null;
    const c = connect(
      { tableId: TABLE_ID, name, playerId: storedPlayerId, emoji: storedEmoji, watchOnly: watchOnly || undefined },
      (m: ServerToClient) => {
        if (m.type === "WELCOME") {
          setYouId(m.youId);
          setState(m.state);
          localStorage.setItem(`sp-playerId-${TABLE_ID}`, m.youId);
          sessionIdRef.current = m.state.sessionId;
          if (pendingChips > 0) {
            connRef?.send({ type: "REQUEST_STACK", amount: pendingChips });
          }
          if (m.profile && m.profile.sessions > 0) setWelcomeBack(m.profile);
        }
        else if (m.type === "STATE") { setState(m.state); }
        else if (m.type === "ERROR") { setError(m.message); }
        else if (m.type === "SESSION_ENDED") {
          setError(`Session ended. Refresh to start again.`);
          sessionIdRef.current = m.sessionId;
        }
      },
      setConnStatus
    );
    connRef = c;
    setConn(c);
  }

  function fetchRecap() {
    const sid = sessionIdRef.current ?? state?.sessionId;
    if (!sid) return;
    setRecapLoading(true);
    fetch(`/api/recap/${TABLE_ID}/${sid}`)
      .then(r => r.json())
      .then(data => { setRecap(data); setRecapOpen(true); })
      .catch(() => setError("Failed to load session recap."))
      .finally(() => setRecapLoading(false));
  }

  function fetchHandHistory(sid?: string) {
    const sessionId = sid ?? sessionIdRef.current ?? state?.sessionId;
    if (!sessionId) return;
    setHandHistoryLoading(true);
    if (!sid) {
      fetch(`/api/sessions/${TABLE_ID}`)
        .then(r => r.json())
        .then((ids: string[]) => {
          setAvailableSessions(ids);
          if (sessionId && !ids.includes(sessionId)) {
            setAvailableSessions(prev => [...prev, sessionId]);
          }
        })
        .catch(() => {});
      setSelectedSessionId(sessionId);
    }
    fetch(`/api/hands/${TABLE_ID}/${sessionId}`)
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
          <div className="title">Slow Poker</div>

          <div className="row" style={{ marginTop: 16, gap: 12 }}>
            <div className="card" style={{ flex: 1 }}>
              <div className="small">Your name</div>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && join()}
                autoFocus
              />
            </div>
            {!watchOnly && (
              <div className="card" style={{ flex: 1 }}>
                <div className="small">Chips to request</div>
                <input
                  type="number"
                  value={joinChipRequest}
                  min={1}
                  onChange={(e) => setJoinChipRequest(Math.max(1, Number(e.target.value)))}
                  onKeyDown={(e) => e.key === "Enter" && join()}
                />
              </div>
            )}
          </div>

          <div className="hstack" style={{ marginTop: 12, gap: 12 }}>
            <label className="hstack" style={{ gap: 6, cursor: "pointer", fontSize: 13 }}>
              <input
                type="checkbox"
                checked={watchOnly}
                onChange={(e) => setWatchOnly(e.target.checked)}
              />
              Watch only (no chips)
            </label>
          </div>

          <div style={{ marginTop: 14 }}>
            <button onClick={join}>Join game</button>
          </div>

          {error && <div className="notice">{error}</div>}
        </div>
      </div>
    );
  }

  const isDealer = !!you?.isDealer;
  const isBank = youId === state.bankPlayerId;
  const isAdmin = youId === state.adminPlayerId;

  const myRevealChoice = youId ? state.showdownChoices[youId] : undefined;
  const myCardShowing0 = myRevealChoice?.kind === "SHOW_2" || (myRevealChoice?.kind === "SHOW_1" && myRevealChoice.cardIndex === 0);
  const myCardShowing1 = myRevealChoice?.kind === "SHOW_2" || (myRevealChoice?.kind === "SHOW_1" && myRevealChoice.cardIndex === 1);

  const toCall = you ? Math.max(0, state.streetBet - you.currentBet) : 0;
  const canAct = state.street !== "DONE" && state.street !== "SHOWDOWN" &&
    state.players[state.currentTurnIndex]?.id === youId &&
    !!you?.inHand && !you?.folded;

  const sb = state.settings.smallBlind;
  const bb = state.settings.bigBlind;

  const inActiveHand = state.street !== "DONE" && state.street !== "SHOWDOWN";
  const seatCount = state.players.length;

  // Reorder players so "you" is at bottom (index 0), rest clockwise
  const youIndex = state.players.findIndex(p => p.id === youId);
  const seatPlayers = state.players.map((_, i) =>
    state.players[(youIndex + i) % state.players.length]
  );

  return (
    <div className="table">
      {/* ── Top bar ── */}
      <div className="tableTop">
        <div>
          <div className="title">Slow Poker {isAdmin ? "👑" : ""}</div>
          <div className="small">
            Hand #{state.handNumber} • {streetLabel(state.street)} • Blinds {sb}/{bb}
          </div>
          {(() => {
            const s = state.settings;
            if (!s.blindSchedule?.length || s.blindLevelIndex < 0) return null;
            const nextIdx = s.blindLevelIndex + 1;
            const next = s.blindSchedule[nextIdx];
            let hint = "";
            if (s.blindTrigger === "time" && s.blindLevelStartedAt) {
              const msLeft = (s.blindLevelStartedAt + s.blindTriggerMinutes * 60_000) - nowMs;
              hint = next ? ` → ${next.smallBlind}/${next.bigBlind} in ~${Math.max(1, Math.ceil(msLeft / 60_000))} min` : " (final level)";
            } else if (s.blindTrigger === "bust" && next) {
              hint = ` → ${next.smallBlind}/${next.bigBlind} after ${s.blindTriggerBusts} bust${s.blindTriggerBusts > 1 ? "s" : ""}`;
            } else if (next) {
              hint = ` → ${next.smallBlind}/${next.bigBlind} (manual)`;
            } else {
              hint = " (final level)";
            }
            return <div className="small" style={{ opacity: 0.75 }}>Level {s.blindLevelIndex + 1}/{s.blindSchedule.length}: {s.smallBlind}/{s.bigBlind}{hint}</div>;
          })()}
        </div>
        <div className="hstack">
          <Popover
            trigger={<button className="secondary">{yourEmoji} {you?.name} &#x25BE;</button>}
            open={settingsOpen}
            onToggle={toggleSettings}
          >
            <UserSettingsPopover
              yourEmoji={yourEmoji}
              chipRequest={youId ? state.stackRequests[youId] : undefined}
              onRequest={(amount) => { send({ type: "REQUEST_STACK", amount }); setSettingsOpen(false); }}
              autoShowPref={autoShowPref}
              onAutoShowChange={(v) => { setAutoShowPref(v); localStorage.setItem("sp-autoShow", v); }}
              onEmojiChange={(e) => {
                localStorage.setItem(`sp-emoji-${TABLE_ID}`, e);
                send({ type: "SET_PROFILE", emoji: e });
              }}
              isBank={isBank}
            />
          </Popover>
          <Popover
            trigger={<button className="secondary" title="Menu">···</button>}
            open={menuOpen}
            onToggle={toggleMenu}
          >
            <div className="menuList">
              <button className="secondary" onClick={() => { setRulesOpen(true); setMenuOpen(false); }}>Rules</button>
              <button className="secondary" onClick={() => { fetchHandHistory(); setMenuOpen(false); }} disabled={handHistoryLoading}>
                {handHistoryLoading ? "Loading..." : "Hand History"}
              </button>
              <button className="secondary" onClick={() => { setChartOpen(true); setMenuOpen(false); }}>📊 Chip History</button>
              <div className="menuVolumeRow">
                <span>{soundVolume === 0 ? "🔇" : soundVolume < 50 ? "🔉" : "🔊"}</span>
                <input type="range" min={0} max={100} value={soundVolume}
                  onChange={e => setSoundVolumePersist(Number(e.target.value))}
                  style={{ flex: 1 }} />
                <span className="small" style={{ minWidth: 28, textAlign: "right" }}>{soundVolume}</span>
              </div>
              {isAdmin && <button className="secondary" onClick={() => { setAdminConfigOpen(true); setMenuOpen(false); }}>⚙ Config</button>}
              {isBank && (
                <>
                  <div className="menuDivider" />
                  <BankControls
                    settings={state.settings}
                    onApply={(sb2, bb2, str) => { send({ type: "SET_BLINDS", smallBlind: sb2, bigBlind: bb2, straddleEnabled: str }); setMenuOpen(false); }}
                  />
                </>
              )}
            </div>
          </Popover>
        </div>
      </div>

      {/* ── Reconnect banner ── */}
      {connStatus === "reconnecting" && (
        <div className="reconnectBanner">Reconnecting to server...</div>
      )}
      {connStatus === "disconnected" && conn && (
        <div className="reconnectBanner disconnected">Connection lost. Please refresh the page.</div>
      )}

      {/* ── Host onboarding: no bank assigned ── */}
      {isDealer && !state.bankPlayerId && state.street === "DONE" && (
        <div className="notice" style={{ borderColor: "rgba(255,215,0,0.4)", background: "rgba(255,215,0,0.08)" }}>
          <b>Setup:</b> No bank assigned yet. Open the ⚙ gear on any seat → <b>Make bank</b> to assign someone to control stacks &amp; blinds. The dealer starts hands; the bank sets chips.
        </div>
      )}

      {/* ── Bank chip-request alert banner ── */}
      {isBank && Object.keys(state.stackRequests).length > 0 && (
        <div className="chipAlert">
          <span>💰 Chip requests:</span>
          {Object.entries(state.stackRequests).map(([pid, amount]) => {
            const p = state.players.find(pp => pp.id === pid);
            return (
              <span key={pid} className="chipAlertItem">
                {p?.name}: {amount}
                <button className="secondary" onClick={() => send({ type: "SET_STACK", playerId: pid, stack: (p?.stack ?? 0) + amount })}>
                  +{amount}
                </button>
                <button className="secondary danger" onClick={() => send({ type: "CLEAR_STACK_REQUEST", playerId: pid })}>✕</button>
              </span>
            );
          })}
        </div>
      )}

      {/* ── Rebuy countdown banner ── */}
      {(() => {
        const until = state.settings.rebuysOpenUntil;
        if (!until || until <= nowMs) return null;
        const msLeft = until - nowMs;
        const minLeft = Math.ceil(msLeft / 60_000);
        const isUrgent = msLeft < 5 * 60_000;
        return (
          <div className="chipAlert" style={isUrgent ? { background: "rgba(255,100,50,0.15)", borderColor: "rgba(255,100,50,0.5)" } : { borderColor: "rgba(100,220,100,0.4)", background: "rgba(100,220,100,0.07)" }}>
            💰 Rebuy window {isUrgent ? <b>CLOSING in {minLeft} min!</b> : `open — ${minLeft} min remaining`}
          </div>
        );
      })()}

      {/* ── Table ring: seats around an ellipse with board in center ── */}
      <div className="tableRing">
        {/* Center: board area */}
        <div className="ringCenter">
          <motion.div
            className="potDisplay"
            key={potPulse}
            animate={potPulse > 0 ? { scale: [1, 1.18, 1], color: ["#ffd700", "#fff8a0", "#ffd700"] } : {}}
            transition={{ duration: 0.45, ease: "easeOut" }}
          >
            Pot: <AnimatedNumber value={state.pot} />
          </motion.div>
          {state.pot > 0 && (
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 4 }}>
              <ChipStack amount={state.pot} size="md" />
            </div>
          )}

          {(() => {
            const hasAllIn = state.players.some(p => p.inHand && !p.folded && p.stack === 0);
            return state.pots.length > 1 && hasAllIn && (
              <div className="potBreakdown">
                {state.pots.map((pot, i) => {
                  const winnerNames = pot.winnerIds?.map(id => state.players.find(p => p.id === id)?.name).filter(Boolean);
                  const isSplit = winnerNames && winnerNames.length > 1;
                  return (
                    <span key={i} className="pill">
                      {i === 0 ? "Main" : `Side #${i}`}: <b>{pot.amount}</b>
                      {winnerNames && winnerNames.length > 0 && (
                        <span> → {winnerNames.join(", ")}{isSplit ? " (split)" : ""}{pot.eligiblePlayerIds.length === 1 ? " (uncontested)" : ""}</span>
                      )}
                    </span>
                  );
                })}
              </div>
            );
          })()}

          <AnimatePresence>
            {streetFlash && (
              <motion.div
                className="streetFlash"
                key={streetFlash}
                initial={{ opacity: 0, x: -60, scale: 0.85 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 60, scale: 0.85 }}
                transition={{ type: "spring", stiffness: 320, damping: 24 }}
              >
                {streetFlash}
              </motion.div>
            )}
          </AnimatePresence>

          <div className="boardCards">
            <AnimatePresence>
              {state.board.length ? state.board.map((c, i) => (
                <motion.div
                  key={c}
                  {...cardFlip}
                  transition={{ ...cardSpring, delay: i * 0.15 }}
                  style={{ perspective: 600 }}
                >
                  <CardPill c={c} size="md" />
                </motion.div>
              )) : null}
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

          {state.settings.straddleEnabled && (
            <div className="boardMeta">Straddle ON</div>
          )}

          <div className="small" style={{ marginTop: 6 }}>
            <b>Turn:</b> {currentTurnPlayer?.name ?? "—"}
            {" — "}
            {state.roundComplete ? "Betting complete — dealer can advance." : "Betting in progress."}
          </div>
        </div>

        {/* Animation overlay layer */}
        <div className="chipAnimationLayer">
          <AnimatePresence>
            {chipAnimations.map((chip) => {
              const angle = (Math.PI / 2) - (chip.seatIndex / seatCount) * 2 * Math.PI;
              const rx = 44, ry = 40;
              const startLeft = `${50 - rx * Math.cos(angle)}%`;
              const startTop = `${50 + ry * Math.sin(angle)}%`;
              return (
                <motion.div
                  key={chip.id}
                  className="flyingChipCluster"
                  initial={{ left: startLeft, top: startTop, scale: 1, opacity: 1 }}
                  animate={{ left: "50%", top: "50%", scale: 0.7, opacity: 0 }}
                  transition={{ type: "spring", stiffness: 180, damping: 22 }}
                  onAnimationComplete={() =>
                    setChipAnimations(a => a.filter(c => c.id !== chip.id))
                  }
                >
                  <ChipStack amount={chip.amount} size="sm" />
                </motion.div>
              );
            })}
          </AnimatePresence>
          <AnimatePresence>
            {dealAnimations.map((deal) => {
              const angle = (Math.PI / 2) - (deal.seatIndex / seatCount) * 2 * Math.PI;
              const rx = 44, ry = 40;
              const endLeft = `${50 - rx * Math.cos(angle)}%`;
              const endTop = `${50 + ry * Math.sin(angle)}%`;
              return (
                <motion.div
                  key={deal.id}
                  className="flyingCard playingCard card-back"
                  initial={{ left: "50%", top: "50%", scale: 0.5, opacity: 0 }}
                  animate={{ left: endLeft, top: endTop, scale: 1, opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{
                    type: "spring", stiffness: 250, damping: 20,
                    delay: deal.seatIndex * 0.12 + deal.cardIndex * 0.06,
                  }}
                  onAnimationComplete={() =>
                    setDealAnimations(a => a.filter(d => d.id !== deal.id))
                  }
                />
              );
            })}
          </AnimatePresence>

          {/* Clock throw — ⏱ flies from caller seat to target seat */}
          <AnimatePresence>
            {clockThrow && (
              <motion.div
                key={clockThrow.id}
                style={{ position: "absolute", fontSize: 28, pointerEvents: "none", zIndex: 20,
                  left: `${clockThrow.fromX}%`, top: `${clockThrow.fromY}%`, transform: "translate(-50%,-50%)" }}
                animate={{ left: `${clockThrow.toX}%`, top: `${clockThrow.toY}%`, rotate: 720, scale: [1, 1.4, 1] }}
                exit={{ opacity: 0, scale: 0.5 }}
                transition={{ duration: 0.75, ease: "easeInOut" }}
              >
                ⏱
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Confetti burst when you win */}
        <AnimatePresence>
          {confetti.map(p => (
            <motion.div
              key={p.id}
              style={{
                position: "absolute", left: `${p.x}%`, bottom: "8%",
                width: 8, height: 8, borderRadius: 2,
                background: p.color, pointerEvents: "none", zIndex: 30,
              }}
              initial={{ y: 0, opacity: 1, rotate: 0 }}
              animate={{ y: -(120 + Math.random() * 80), opacity: 0, rotate: 360 * (Math.random() > 0.5 ? 1 : -1) }}
              transition={{ duration: 1.4 + p.delay, delay: p.delay, ease: "easeOut" }}
            />
          ))}
        </AnimatePresence>

        {/* Seats around the ellipse */}
        {(() => {
          return seatPlayers.map((p, i) => {
          const isTurn = p.id === state.players[state.currentTurnIndex]?.id && inActiveHand;
          const isFolded = p.inHand && p.folded;
          const isSittingOut = !p.inHand || p.sittingOut;
          const isOtherSeat = p.id !== youId;
          const isWinner = winnerPlayerIds.has(p.id);
          const isFolding = foldingPlayers.has(p.id);
          const showBankOnSeat = isBank;
          const showDealerOnSeat = isOtherSeat && isDealer && !p.isDealer;
          const showGear = showBankOnSeat || showDealerOnSeat || (isAdmin && isOtherSeat);
          return (
            <div
              key={p.id}
              className={
                "seat" +
                (p.id === youId ? " you" : "") +
                (p.isDealer ? " dealer" : "") +
                (isTurn ? " turn" : "") +
                (isFolded ? " folded" : "") +
                (isSittingOut && state.street !== "DONE" ? " sitting-out" : "") +
                (isWinner ? " winner" : "")
              }
              style={seatStyle(i, seatCount)}
            >
              {showGear && (
                <SeatMenu
                  player={p}
                  isBank={isBank}
                  isDealer={isDealer && !p.isDealer}
                  isAdmin={isAdmin && isOtherSeat}
                  isSelf={!isOtherSeat}
                  pendingRequest={state.stackRequests[p.id]}
                  onSetStack={(stack) => send({ type: "SET_STACK", playerId: p.id, stack })}
                  onMakeDealer={() => send({ type: "SET_DEALER", playerId: p.id })}
                  onMakeBank={() => send({ type: "SET_BANK", playerId: p.id })}
                  onApproveRequest={() => send({ type: "CLEAR_STACK_REQUEST", playerId: p.id })}
                  onDenyRequest={() => send({ type: "CLEAR_STACK_REQUEST", playerId: p.id })}
                  onBoot={() => send({ type: "BOOT_PLAYER", playerId: p.id })}
                />
              )}
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                  <b>{p.emoji ?? playerEmoji(state.players.findIndex(pp => pp.id === p.id))} {p.name}</b>
                  {p.id === state.adminPlayerId && <span title="Admin">👑</span>}
                  {isSittingOut && state.street !== "DONE" && <span style={{ fontSize: 12, opacity: 0.7 }}>💤</span>}
                  {!p.connected && <span className="small">(away)</span>}
                  {state.positions && state.street !== "DONE" && (
                    <>
                      {p.id === state.players[state.positions.buttonIndex]?.id && <span className="posBadge btn">BTN</span>}
                      {p.id === state.players[state.positions.sbIndex]?.id && <span className="posBadge sb">SB</span>}
                      {p.id === state.players[state.positions.bbIndex]?.id && <span className="posBadge bb">BB</span>}
                      {state.positions.straddleIndex !== null && p.id === state.players[state.positions.straddleIndex]?.id && <span className="posBadge str">STR</span>}
                    </>
                  )}
                  {p.id === state.bankPlayerId && <span className="pill" style={{ fontSize: 10 }}>Bank</span>}
                </div>

                {/* Cards + chip stack side by side */}
                <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
                  <SeatCards
                    p={p}
                    choice={state.showdownChoices[p.id]}
                    isYou={p.id === youId}
                    handNumber={state.handNumber}
                    showOuts={!!state.settings.homeRules?.showOuts}
                  />
                  {/* High-card draw result */}
                  {state.highCardRound?.cards[p.id] && (
                    <div className="seatCards" style={{ opacity: state.highCardRound.tiedIds.includes(p.id) || state.highCardRound.winnerId === p.id ? 1 : 0.45 }}>
                      <CardPill c={state.highCardRound.cards[p.id]} size="lg" />
                      {state.highCardRound.winnerId === p.id && <span style={{ fontSize: 11, marginLeft: 3 }}>👑</span>}
                      {state.highCardRound.tiedIds.includes(p.id) && <span style={{ fontSize: 11, marginLeft: 3 }}>🔄</span>}
                    </div>
                  )}
                </div>
                {/* Showdown waiting label */}
                {state.street === "SHOWDOWN" && p.inHand && !p.folded &&
                 !state.showdownChoices[p.id] && p.id !== youId && (
                  <div className="small" style={{ marginTop: 3, opacity: 0.65 }}>Waiting…</div>
                )}

                <div className="small" style={{ marginTop: 4 }}>
                  Stack: <b>{p.stack}</b>
                  <AnimatePresence>
                    {stackDeltas[p.id] != null && (
                      <motion.span
                        key={p.stack}
                        className={`stackDelta ${stackDeltas[p.id] >= 0 ? "positive" : "negative"}`}
                        initial={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.8 }}
                      >
                        {stackDeltas[p.id] >= 0 ? `+${stackDeltas[p.id]}` : stackDeltas[p.id]}
                      </motion.span>
                    )}
                  </AnimatePresence>
                  {inActiveHand && <>{" "}• Bet: <b>{p.currentBet}</b></>}
                  {" "}• {p.inHand ? (p.folded ? "Folded" : "In hand") : "Out"}
                </div>
                {p.stack > 0 && (
                  <div style={{ marginTop: 4 }}>
                    <ChipStack amount={p.stack} size="sm" />
                  </div>
                )}
              </div>

              {/* Fold card-back ghost */}
              <AnimatePresence>
                {isFolding && (
                  <motion.div
                    className="foldGhost"
                    initial={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -22, scale: 0.75 }}
                    transition={{ duration: 0.6, ease: "easeIn" }}
                  >
                    <span className="playingCard card-back foldCard" />
                    <span className="playingCard card-back foldCard" style={{ marginLeft: 4 }} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        });
      })()}
      </div>

      {/* ── Reveal buttons + sit-out ── */}
      <div className="holeArea">
        {you?.folded && you?.holeCards && state.street !== "DONE" && (
          <div className="hstack" style={{ gap: 6 }}>
            <span className="small">Show folded hand?</span>
            <button className="secondary" onClick={() => send({ type: "REVEAL_HAND", choice: myCardShowing0 ? (myCardShowing1 ? { kind: "SHOW_1", cardIndex: 1 } : { kind: "SHOW_0" }) : (myCardShowing1 ? { kind: "SHOW_2" } : { kind: "SHOW_1", cardIndex: 0 }) })}>
              {myCardShowing0 ? "Hide" : formatCard(you.holeCards![0])}
            </button>
            <button className="secondary" onClick={() => send({ type: "REVEAL_HAND", choice: myCardShowing1 ? (myCardShowing0 ? { kind: "SHOW_1", cardIndex: 0 } : { kind: "SHOW_0" }) : (myCardShowing0 ? { kind: "SHOW_2" } : { kind: "SHOW_1", cardIndex: 1 }) })}>
              {myCardShowing1 ? "Hide" : formatCard(you.holeCards![1])}
            </button>
            {myRevealChoice?.kind !== "SHOW_2" && (
              <button className="secondary" onClick={() => send({ type: "REVEAL_HAND" })}>Both</button>
            )}
          </div>
        )}
        {you?.holeCards && state.street === "DONE" && (
          <div className="hstack" style={{ gap: 6 }}>
            <span className="small">Show hand?</span>
            <button className="secondary" onClick={() => send({ type: "REVEAL_HAND", choice: myCardShowing0 ? (myCardShowing1 ? { kind: "SHOW_1", cardIndex: 1 } : { kind: "SHOW_0" }) : (myCardShowing1 ? { kind: "SHOW_2" } : { kind: "SHOW_1", cardIndex: 0 }) })}>
              {myCardShowing0 ? "Hide" : formatCard(you.holeCards![0])}
            </button>
            <button className="secondary" onClick={() => send({ type: "REVEAL_HAND", choice: myCardShowing1 ? (myCardShowing0 ? { kind: "SHOW_1", cardIndex: 0 } : { kind: "SHOW_0" }) : (myCardShowing0 ? { kind: "SHOW_2" } : { kind: "SHOW_1", cardIndex: 1 }) })}>
              {myCardShowing1 ? "Hide" : formatCard(you.holeCards![1])}
            </button>
            {myRevealChoice?.kind !== "SHOW_2" && (
              <button className="secondary" onClick={() => send({ type: "REVEAL_HAND" })}>Both</button>
            )}
          </div>
        )}
        {state.settings.homeRules?.allowMidHandReveal &&
         you?.inHand && !you.folded &&
         state.street !== "DONE" && state.street !== "SHOWDOWN" && you.holeCards && (
          <div className="hstack" style={{ gap: 6 }}>
            <span className="small" style={{ color: "#ffaa44" }}>Show live:</span>
            <button className="secondary" onClick={() => send({ type: "REVEAL_HAND", choice: myCardShowing0 ? (myCardShowing1 ? { kind: "SHOW_1", cardIndex: 1 } : { kind: "SHOW_0" }) : (myCardShowing1 ? { kind: "SHOW_2" } : { kind: "SHOW_1", cardIndex: 0 }) })}>
              {myCardShowing0 ? "Hide" : formatCard(you.holeCards![0])}
            </button>
            <button className="secondary" onClick={() => send({ type: "REVEAL_HAND", choice: myCardShowing1 ? (myCardShowing0 ? { kind: "SHOW_1", cardIndex: 0 } : { kind: "SHOW_0" }) : (myCardShowing0 ? { kind: "SHOW_2" } : { kind: "SHOW_1", cardIndex: 1 }) })}>
              {myCardShowing1 ? "Hide" : formatCard(you.holeCards![1])}
            </button>
            {myRevealChoice?.kind !== "SHOW_2" && (
              <button className="secondary" onClick={() => send({ type: "REVEAL_HAND" })}>Both</button>
            )}
          </div>
        )}
        <label className="hstack" style={{ gap: 6, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={!!you?.sittingOut}
            onChange={(e) => send({ type: e.target.checked ? "SIT_OUT" : "SIT_IN" })}
          />
          <span className="small">Sit out next hand</span>
        </label>
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

      {/* ── Last action inline hint ── */}
      {state.actionLog.length > 0 && (
        <div className="lastAction">{state.actionLog[0]}</div>
      )}

      {/* ── Sticky action bar ── */}
      <div className="actions">
        {state.street === "DONE" && (
          <>
            <div className="actionBar">
              {/* Server auto-start countdown — visible to everyone when admin configures a delay */}
              {state.autoStartAt && state.autoStartAt > clockNow && (
                <span className="pill">{Math.ceil((state.autoStartAt - clockNow) / 1000)}s…</span>
              )}
              <button onClick={() => {
                if (autoStartRef.current) { clearInterval(autoStartRef.current); autoStartRef.current = null; setAutoStartCountdown(null); }
                send({ type: "START_HAND" });
              }}>
                {autoStartCountdown !== null ? `Starting in ${autoStartCountdown}s… (click to start now)` : "Start hand"}
              </button>
            </div>
            {isDealer && (
              <div className="actionBar">
                <button className="secondary" onClick={() => send({ type: "CUT_FOR_DEALER" })}
                  title="Deal one face-up card to each player; highest card gets the button">
                  {state.highCardRound && state.highCardRound.tiedIds.length > 0 ? "Redraw (tied)" : "High Card → Button"}
                </button>
                {isAdmin && state.highCardRound?.winnerId && (
                  <button className="secondary" onClick={() => send({ type: "SET_DEALER", playerId: state.highCardRound!.winnerId! })}
                    title="Also make the high-card winner the dealer (game host)">
                    Make Dealer
                  </button>
                )}
                <div className="autoStartControl">
                  <span className="small">Auto-start:</span>
                  <select value={autoStartSecs} onChange={e => {
                    const v = Number(e.target.value);
                    setAutoStartSecs(v);
                    localStorage.setItem("sp-autoStart", String(v));
                  }} style={{ fontSize: 12, padding: "2px 4px" }}>
                    <option value={0}>Off</option>
                    <option value={5}>5s</option>
                    <option value={10}>10s</option>
                    <option value={15}>15s</option>
                    <option value={30}>30s</option>
                  </select>
                </div>
              </div>
            )}
          </>
        )}

        {/* Clock countdown banner */}
        {state.clockEndsAt && (
          <div className="clockBanner">
            {(() => {
              const secsLeft = Math.max(0, Math.ceil((state.clockEndsAt - clockNow) / 1000));
              return <>⏱ Clock running — <b>{currentTurnPlayer?.name}</b> has <b className={secsLeft <= 10 ? "clockUrgent" : ""}>{secsLeft}s</b> to act</>;
            })()}
          </div>
        )}

        {inActiveHand && (
          canAct ? (
            <div className="actionBar">
              {state.clockEndsAt && (() => {
                const secsLeft = Math.max(0, Math.ceil((state.clockEndsAt - clockNow) / 1000));
                return <span className={`pill ${secsLeft <= 10 ? "clockUrgent" : ""}`}>⏱ {secsLeft}s</span>;
              })()}
              <BettingPanel
                enabled={true}
                streetBet={state.streetBet}
                toCall={toCall}
                bb={bb}
                pot={state.pot}
                you={you!}
                onAct={(a) => send({ type: "ACT", action: a })}
              />
            </div>
          ) : (
            <div className="waitingBanner">
              Waiting for <span className="waitingName">{currentTurnPlayer?.name ?? "..."}</span>
              {you?.inHand && !you.folded && !state.clockEndsAt && !state.roundComplete && (
                <button className="secondary" style={{ marginLeft: 10, fontSize: 12 }}
                  onClick={() => send({ type: "CALL_CLOCK" })}
                  title={`Put ${currentTurnPlayer?.name} on a ${state.settings.clockSeconds}s clock`}>
                  ⏱ Call Clock
                </button>
              )}
            </div>
          )
        )}

        {inActiveHand && isDealer && (
          <div className="actionBar">
            {state.roundComplete ? (
              <button onClick={() => send({ type: "NEXT_STREET" })}>
                Deal {nextStreetLabel(state.street)} ▶
              </button>
            ) : (
              <button className="secondary danger" onClick={() => {
                if (confirm("Void this hand? All bets will be returned.")) send({ type: "NEXT_STREET" });
              }}>Dealer: Void Hand</button>
            )}
          </div>
        )}

        {state.street === "SHOWDOWN" && (
          <>
            <div className="actionBar">
              {!state.showdownChoices[youId] && (
                <ShowdownPanel onPick={(choice) => send({ type: "SHOWDOWN_CHOICE", choice })} holeCards={you?.holeCards} />
              )}
              {state.showdownChoices[youId] && (
                <span className="pill">You chose: {renderChoice(state.showdownChoices[youId])}</span>
              )}
            </div>
            {(() => {
              const pendingChoices = state.players.filter(p => p.inHand && !p.folded && !state.showdownChoices[p.id]).length;
              return (
                <div className="actionBar">
                  <button onClick={() => {
                    if (pendingChoices > 0 && !confirm(`${pendingChoices} player${pendingChoices > 1 ? "s have" : " has"} not chosen yet. End hand anyway?`)) return;
                    send({ type: "NEXT_STREET" });
                  }}>End hand</button>
                  {isDealer && (
                    <button className="secondary" onClick={() => {
                      if (confirm("End the session? All players will see the recap.")) send({ type: "END_SESSION" });
                    }}>End session</button>
                  )}
                </div>
              );
            })()}
          </>
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
            <div style={{ marginTop: 12, fontSize: "0.85rem", color: "var(--muted)" }}>
              <span>{recap.date}</span>
              {recap.durationMin != null && <span> · {recap.durationMin} min</span>}
              <span> · {recap.hands} hands</span>
            </div>

            {/* Player stats table */}
            {recap.playerStats?.length > 0 && (
              <div style={{ marginTop: 14, overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)" }}>
                      <th style={{ textAlign: "left", padding: "4px 8px", color: "var(--muted)" }}>Player</th>
                      <th style={{ textAlign: "right", padding: "4px 8px", color: "var(--muted)" }}>Hands</th>
                      <th style={{ textAlign: "right", padding: "4px 8px", color: "var(--muted)" }}>Pots</th>
                      <th style={{ textAlign: "right", padding: "4px 8px", color: "var(--muted)" }}>Won</th>
                      <th style={{ textAlign: "right", padding: "4px 8px", color: "var(--muted)" }}>Final</th>
                      <th style={{ textAlign: "right", padding: "4px 8px", color: "var(--muted)" }}>Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recap.playerStats.map((p: any) => (
                      <tr key={p.id} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td style={{ padding: "5px 8px" }}>{p.name}</td>
                        <td style={{ textAlign: "right", padding: "5px 8px", color: "var(--muted)" }}>{p.handsPlayed}</td>
                        <td style={{ textAlign: "right", padding: "5px 8px", color: "var(--muted)" }}>{p.potsWon}</td>
                        <td style={{ textAlign: "right", padding: "5px 8px", fontWeight: 600 }}>{p.chipsWon > 0 ? `+${p.chipsWon}` : p.chipsWon}</td>
                        <td style={{ textAlign: "right", padding: "5px 8px", color: p.finalStack === 0 ? "var(--danger, #f44)" : undefined }}>
                          {p.finalStack != null ? p.finalStack : "—"}
                        </td>
                        <td style={{ textAlign: "right", padding: "5px 8px", fontWeight: 600, color: p.chipDelta == null ? "var(--muted)" : p.chipDelta >= 0 ? "#5c9" : "#f66" }}>
                          {p.chipDelta != null ? (p.chipDelta >= 0 ? `+${p.chipDelta}` : p.chipDelta) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Highlights */}
            <div style={{ marginTop: 12, fontSize: "0.85rem", display: "flex", flexDirection: "column", gap: 4 }}>
              {recap.biggestPot && (
                <div>🏆 Biggest pot: <b>{recap.biggestPot.amount}</b> — {recap.biggestPot.winnerNames.join(", ")} (hand #{recap.biggestPot.handNumber})</div>
              )}
              {recap.knockouts?.length > 0 && (
                <div>💀 Busted out: <b>{recap.knockouts.join(", ")}</b></div>
              )}
              {recap.allIns?.length > 0 && (
                <div style={{ marginTop: 4 }}>
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>All-ins ({recap.allIns.length})</div>
                  {recap.allIns.map((ai: any, i: number) => (
                    <div key={i} style={{ color: "var(--muted)", paddingLeft: 8 }}>
                      Hand #{ai.handNumber} · {ai.street} · <b>{ai.playerName}</b>{ai.amount ? ` for ${ai.amount}` : ""}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ marginTop: 10, fontSize: "0.75rem", color: "var(--muted)" }}>
              {recap.posts} posts · {recap.actions} actions · table {recap.tableId}
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
            {availableSessions.length > 1 && (
              <div style={{ marginBottom: 10 }}>
                <select
                  value={selectedSessionId ?? ""}
                  onChange={(e) => {
                    const newSid = e.target.value;
                    setSelectedSessionId(newSid);
                    fetchHandHistory(newSid);
                  }}
                  style={{ width: "100%", padding: "4px 6px", background: "var(--bg-card)", color: "var(--text)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 4 }}
                >
                  {availableSessions.map(sid => (
                    <option key={sid} value={sid}>
                      {sid === (sessionIdRef.current ?? state?.sessionId) ? `${sid} (current)` : sid}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {handHistoryLoading ? (
              <div className="small" style={{ marginTop: 12 }}>Loading...</div>
            ) : handHistory.length === 0 ? (
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
                            {h.showdownChoices.map((s, i) => {
                              if (s.choice === "SHOW_0") return <div key={i} className="small">{s.playerName}: Hides</div>;
                              const cardStr = s.cards?.map(c => formatCard(c)).join(" ") ?? "";
                              const handStr = s.handName ? ` — ${s.handName}` : "";
                              return <div key={i} className="small">{s.playerName}: {cardStr}{handStr}</div>;
                            })}
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
      {/* ── New player chip prompt ── */}
      {chipPromptOpen && youId && (
        <div className="recapOverlay" onClick={() => setChipPromptOpen(false)}>
          <div className="recapModal" onClick={(e) => e.stopPropagation()}>
            <div className="title">Welcome to the table!</div>
            <p className="small">Request starting chips from the bank?</p>
            <div className="hstack" style={{ gap: 8, marginTop: 12 }}>
              <input
                type="number"
                value={chipPromptAmount}
                onChange={(e) => setChipPromptAmount(Number(e.target.value))}
                style={{ width: 100 }}
              />
              <button onClick={() => { sessionStorage.setItem(`sp-chip-prompted-${TABLE_ID}`, "1"); send({ type: "REQUEST_STACK", amount: chipPromptAmount }); setChipPromptOpen(false); }}>
                Request from bank
              </button>
            </div>
            <button className="secondary" style={{ marginTop: 8 }} onClick={() => { sessionStorage.setItem(`sp-chip-prompted-${TABLE_ID}`, "1"); setChipPromptOpen(false); }}>
              Just watch for now
            </button>
          </div>
        </div>
      )}

      {/* ── Admin config modal ── */}
      {adminConfigOpen && (
        <AdminConfigPanel
          settings={state.settings}
          onApplyConfig={(cfg) => { send({ type: "SET_CONFIG", config: cfg }); }}
          onSetRebuys={(enabled, minutes) => { send({ type: "SET_REBUYS", enabled, minutes }); }}
          onAdvanceBlinds={() => { send({ type: "ADVANCE_BLINDS" }); }}
          onClose={() => setAdminConfigOpen(false)}
          nowMs={nowMs}
        />
      )}

      {/* ── Rules summary modal ── */}
      {rulesOpen && (
        <RulesSummary settings={state.settings} onClose={() => setRulesOpen(false)} nowMs={nowMs} />
      )}

      {/* ── Chip history chart modal ── */}
      {chartOpen && (
        <ChipChart history={chipHistory} youId={youId} onClose={() => setChartOpen(false)} />
      )}

      {/* ── Welcome back toast ── */}
      <AnimatePresence>
        {welcomeBack && (
          <motion.div
            className="welcomeBackToast"
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 40 }}
            transition={{ duration: 0.35 }}
          >
            <span>
              Welcome back, <b>{welcomeBack.name}</b>!
              {" "}Session {welcomeBack.sessions + 1} •{" "}
              {welcomeBack.handsPlayed} hands •{" "}
              <span style={{ color: welcomeBack.chipsWon >= 0 ? "#55cc88" : "#ff6666" }}>
                {welcomeBack.chipsWon >= 0 ? "+" : ""}{welcomeBack.chipsWon} chips lifetime
              </span>
            </span>
            <button className="toastClose" onClick={() => setWelcomeBack(null)}>✕</button>
          </motion.div>
        )}
      </AnimatePresence>
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

function BettingPanel(props: {
  enabled: boolean;
  streetBet: number;
  toCall: number;
  bb: number;
  pot: number;
  you: PlayerState;
  onAct: (a: PlayerAction) => void;
}) {
  const { enabled, streetBet, toCall, bb, pot, you, onAct } = props;
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

      {/* Bet presets — clicking immediately submits the bet */}
      <div className="betPresets">
        {([1/3, 1/2, 2/3, 1] as const).map((frac) => {
          const amount = clamp(Math.floor(fractionTo(frac)), 0, maxTo);
          const label = frac === 1/3 ? "1/3 Pot" : frac === 1/2 ? "1/2 Pot" : frac === 2/3 ? "2/3 Pot" : "Pot";
          return (
            <button key={label} className="secondary" disabled={!enabled}
              onClick={() => onAct(isBet ? { kind: "BET", to: amount } : { kind: "RAISE", to: amount })}>
              {label}
            </button>
          );
        })}
        <button className="secondary" disabled={!enabled}
          onClick={() => onAct(isBet ? { kind: "BET", to: maxTo } : { kind: "RAISE", to: maxTo })}>
          All-in
        </button>
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
  if (c.kind === "SHOW_0") return "Hide";
  if (c.kind === "SHOW_2") return "Show 2";
  return `Show 1 (card ${c.cardIndex === 0 ? "left" : "right"})`;
}

function UserSettingsPopover({ yourEmoji, chipRequest, onRequest, autoShowPref, onAutoShowChange, onEmojiChange, isBank }: {
  yourEmoji: string;
  chipRequest?: number;
  onRequest: (amount: number) => void;
  autoShowPref: "ask" | "muck" | "show";
  onAutoShowChange: (v: "ask" | "muck" | "show") => void;
  onEmojiChange: (e: string) => void;
  isBank: boolean;
}) {
  const [chipAmount, setChipAmount] = useState(100);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 240 }}>
      <div>
        <div className="small" style={{ marginBottom: 6 }}>Avatar</div>
        <div className="emojiGrid">
          {PLAYER_EMOJIS.map((e) => (
            <button key={e} className={`emojiBtn${e === yourEmoji ? " selected" : ""}`} onClick={() => onEmojiChange(e)}>{e}</button>
          ))}
        </div>
      </div>
      {!isBank && (
        <div>
          <div className="small" style={{ marginBottom: 4 }}>Request chips</div>
          {chipRequest != null ? (
            <div className="small">⏳ Requested {chipRequest} — waiting for bank.</div>
          ) : (
            <div className="hstack" style={{ gap: 6 }}>
              <input type="number" value={chipAmount} onChange={(e) => setChipAmount(Number(e.target.value))} style={{ width: 80 }} />
              <button className="secondary" onClick={() => onRequest(chipAmount)}>Request</button>
            </div>
          )}
        </div>
      )}
      <div>
        <div className="small" style={{ marginBottom: 4 }}>After hand (showdown)</div>
        <div className="hstack" style={{ gap: 8, flexWrap: "wrap" }}>
          {(["ask", "muck", "show"] as const).map(opt => (
            <label key={opt} className="hstack" style={{ gap: 4, cursor: "pointer" }}>
              <input type="radio" name="autoShow" value={opt} checked={autoShowPref === opt} onChange={() => onAutoShowChange(opt)} />
              <span className="small">{opt === "ask" ? "Ask" : opt === "muck" ? "Auto-hide" : "Auto-show"}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

function ShowdownPanel({ onPick, holeCards }: { onPick: (c: ShowChoice) => void; holeCards?: [string, string] }) {
  const c0 = holeCards ? formatCard(holeCards[0]) : "?";
  const c1 = holeCards ? formatCard(holeCards[1]) : "?";
  return (
    <div className="hstack" style={{ gap: 8 }}>
      <span className="small">Your showdown:</span>
      <button onClick={() => onPick({ kind: "SHOW_0" })}>Hide</button>
      <button onClick={() => onPick({ kind: "SHOW_1", cardIndex: 0 })}>Show {c0}</button>
      <button onClick={() => onPick({ kind: "SHOW_1", cardIndex: 1 })}>Show {c1}</button>
      <button onClick={() => onPick({ kind: "SHOW_2" })}>Show Both</button>
    </div>
  );
}
