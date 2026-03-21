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

- **End-of-session summary**: After `END_SESSION`, show a summary modal (and/or enhance `npm run recap`) with
  biggest chip movements, knockouts (player hit 0), all-in moments (who shoved, who won), biggest pot,
  hands played per player. Data is all derivable from the JSONL event log. Surface in the in-app recap modal
  and CLI output.

## P3 — Features / nice-to-have

- **Per-player chip delta in recap**: Add net win/loss per player to the session recap — both
  the CLI `npm run recap` output and the in-app recap modal. Approach: log a `STACK_SNAPSHOT`
  event on each player's first join (captures starting stack), diff against final stack on
  `END_SESSION`. Display as `+150` / `-75` next to each player name. Also useful: biggest pot
  won, hands played per player.

- **Session history panel**: The hand-history modal shows the current session. Add a session
  selector to browse previous sessions from `server/data/sessions/`.

- **Multiple concurrent tables**: Architecture already supports multiple tableIds. Just needs a
  lobby/table-picker UI (list of active tables, create new, join by code).

- **Mobile layout polish**: The ellipse seat layout needs `min-height: 520px`. On small phones
  the board and seats can overlap. The responsive CSS fallback (stacked column) needs testing.
