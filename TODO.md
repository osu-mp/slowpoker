# SlowPoker — Open Issues & Backlog

## P1 — Deployment (do before next hosted game)

- **Idle table cleanup**: Tables accumulate in memory indefinitely — any random URL path creates
  a new Table that never gets removed. Add a `setInterval` (every 5 min) that deletes tables
  where `connectedPlayerCount === 0` and `lastActivityAt` is older than 30 minutes. Add a
  `lastActivityAt: number` timestamp to Table, updated on every action/connection event.
  This prevents zombie games without needing a UI admin tool.

  Optional extension: a lightweight `/admin` route (guarded by a secret env var `ADMIN_TOKEN`)
  that returns a JSON list of active tables (id, player count, last activity, hand number).
  Lets you see what's running and call `DELETE /admin/table/:id` to nuke one manually.

## P1 — Deployment (continued)

- **Verify admin panel in live session**: Set `ADMIN_TOKEN` env var, visit `/admin?token=...`, confirm
  table list shows, idle badge appears after inactivity, Kill button removes table. Test that idle cleanup
  fires after 30 min with no connections.

## P2 — UX / polish (medium priority)

- **Sound effects live-session verification**: Confirm all seven events play correctly — card deal,
  chip clink, check tap, fold whoosh, your-turn chime, win arpeggio, street sweep. Verify mute
  toggle persists across page refreshes.

- **Chip prompt edge case**: If the bank zeroes a returning player's stack between sessions, the
  chip prompt appears on reconnect. Consider a `sessionStorage` flag to suppress it after first
  dismissal within the same browser session.

- **Show-cards panel consistency**: At mid-hand SHOWDOWN, folded players see the ShowdownPanel
  (Muck / Show c0 / Show c1 / Both) in the action bar. The holeArea "Show Cards" button only
  shows both — extend it to match the DONE panel (individual card buttons) for consistency.

- **End-of-session summary** ✓ DONE: Recap modal now shows per-player table (hands, pots won, chips won,
  final stack), biggest pot of the session, and busted-out players. `STACKS_SNAPSHOT` event logged at
  session end.

  - **Verify in live session**: end a session, click "Session Recap" — confirm player table, biggest pot,
    knockouts, and all-in list appear correctly.
  - **All-in moments** ✓ DONE: `allIn: true` flag added to ACTION (CALL/BET/RAISE) and POST events
    when a player's stack hits 0. Recap modal shows an "All-ins (N)" list with hand#, street, player, amount.
    Verify in live session: all-in actions appear in the recap modal correctly.
  - **Net profit/loss (chip delta)**: requires buy-in tracking — needs a `STACK_SNAPSHOT` on first join
    or tracking STACK_SET deltas. See P3 below.

## P3 — Features / nice-to-have

- **Per-player chip delta (net profit/loss)**: The recap modal already shows "chips won from pots" and
  "final stack". To show true net profit/loss, log a `STACK_SNAPSHOT` on each player's first STACK_SET
  (captures buy-in amount), diff against `STACKS_SNAPSHOT` at session end. Display as `+150` / `-75`.
  Rebuys complicate this — each STACK_SET replaces the whole stack, so need to track the delta per SET.

- **Session history panel**: The hand-history modal shows the current session. Add a session
  selector to browse previous sessions from `server/data/sessions/`.

- **Multiple concurrent tables**: Architecture already supports multiple tableIds. Just needs a
  lobby/table-picker UI (list of active tables, create new, join by code).

- **Mobile layout polish**: The ellipse seat layout needs `min-height: 520px`. On small phones
  the board and seats can overlap. The responsive CSS fallback (stacked column) needs testing.
