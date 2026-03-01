# SlowPoker — Open Issues & Backlog

## P1 — Bugs / Broken behaviour

- **ws.ts hardcodes `127.0.0.1:3001`**: Breaks hosted/LAN play. Should derive the WebSocket URL
  from `window.location` so the same build works everywhere. See `HOSTING.md §Serving the Client
  Build from Express` for approach.

## P2 — Deployment readiness

- **Single-port serving not implemented**: `HOSTING.md` describes serving the client build from
  the same Express process (one URL, one tunnel), but `server/src/index.ts` doesn't serve
  `client/dist` yet. Low effort: add `app.use(express.static(clientDist))` + catch-all before
  `server.listen()`. Requires ws.ts URL fix above.

- **Session data not persistent across server restarts**: In-memory `tables` Map resets when the
  server process restarts. JSONL logs survive, but live game state is lost. For hosted play,
  consider persisting `TableState` to disk or reconnect players gracefully by replaying the log.

## P3 — UX / polish

- **Sound effects live-session verification** (carried from CLAUDE.md): Confirm all seven events
  play correctly — card deal, chip clink, check tap, fold whoosh, your-turn chime, win arpeggio,
  street sweep. Verify mute toggle persists across page refreshes.

- **Chip prompt for returning players with chips**: If a returning player has chips (stack > 0)
  the prompt correctly doesn't show. Edge case: if the bank manually zeroed their stack between
  sessions, prompt shows on reconnect which might be surprising. Consider a one-per-session flag
  (e.g. `sessionStorage`) to suppress it after first dismissal.

- **Show-cards button at mid-hand SHOWDOWN for folded players**: Folded players see the full
  ShowdownPanel in the action bar (Muck / Show c0 / Show c1 / Both). The redundancy is fine but
  the holeArea "Show Cards" button (show-both only, no single-card option) could be extended to
  match the DONE panel for consistency.

## P4 — Features / nice-to-have

- **Multiple concurrent tables**: Architecture already routes by `tableId`; each new `tableId` in
  the URL creates its own Table instance. Just needs a lobby / table-picker UI.

- **Session history panel**: The hand-history modal fetches from the current session. Could add a
  session selector to browse previous sessions from `server/data/sessions/`.

- **Per-player chip delta in recap**: The session recap shows aggregate stats. Add per-player
  net win/loss (chip delta) to the recap output — both the CLI `npm run recap` summary and the
  in-app session recap modal. Approach: track each player's starting stack at session start
  (log a STACK_SNAPSHOT event on first join), compare against final stack at session end.
  Display as `+150` / `-75` next to each player name. Could also surface biggest pot won and
  number of hands played per player.

- **Mobile layout polish**: The ellipse seat layout requires `min-height: 520px`. On small phones
  the board and seats can overlap. The existing responsive CSS fallback (stacked column) needs
  more testing and tweaking.
