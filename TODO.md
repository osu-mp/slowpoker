# SlowPoker — Open Issues & Backlog

## P1 — Bugs / Broken behaviour

- **Heads-up SB/BB rules**: In heads-up poker the button *is* the small blind. Currently
  `sbIndex = mod(buttonIndex + 1, n)`, so in 2-player games the button is the BB and posts
  last preflop — incorrect. Fix: when `n === 2`, swap so `sbIndex = buttonIndex` and
  `bbIndex = mod(buttonIndex + 1, n)`.

- **Chip prompt shown to Bank**: The stack=0 prompt appears for the first player (who is also
  the Bank). The Bank allocates chips to others but shouldn't request from themselves. Skip the
  prompt (or change the copy) when `me.id === state.bankPlayerId`.

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
  the holeArea "Show Cards" button that was there previously (show-both only, no single-card
  option) could be extended to match the DONE panel for consistency.

- **Sit-out checkbox UX during active hand**: The checkbox is disabled while a hand is in progress.
  Add a tooltip or small label explaining why (e.g. "takes effect after this hand") so it's not
  confusing.

- **Auto show/muck doesn't cover folded players**: The `useEffect` only fires for `you.inHand &&
  !you.folded` at SHOWDOWN. If a player folds and has auto-show enabled, they still have to
  manually click "Show Cards". Extend the effect to cover the folded case.

## P4 — Features / nice-to-have

- **Multiple concurrent tables**: Architecture already routes by `tableId`; each new `tableId` in
  the URL creates its own Table instance. Just needs a lobby / table-picker UI.

- **Session history panel**: The hand-history modal fetches from the current session. Could add a
  session selector to browse previous sessions from `server/data/sessions/`.

- **Recap improvements**: The session recap shows aggregate stats. Could add per-player chip
  delta (net win/loss), biggest pot, and longest session.

- **Mobile layout polish**: The ellipse seat layout requires `min-height: 520px`. On small phones
  the board and seats can overlap. The existing responsive CSS fallback (stacked column) needs
  more testing and tweaking.
