# SlowPoker — Open Issues & Backlog

## P1 — Deployment (do before next hosted game)

- **Verify admin panel in live session** ✓ built: Set `ADMIN_TOKEN` env var, visit `/admin?token=...`, confirm
  table list shows, idle badge appears after inactivity, Kill button removes table. Test that idle cleanup
  fires after 30 min with no connections.

- **Upgrade tunnel to Cloudflare Tunnel**: ngrok free changes URL on every restart and has a ~2hr session
  limit. `cloudflared tunnel` is free, gives a stable permanent URL, and is more reliable for a full game
  night. See HOSTING.md for setup instructions.

## P2 — UX / polish (medium priority)

- **Sound effects live-session verification**: Confirm all seven events play correctly — card deal,
  chip clink, check tap, fold whoosh, your-turn chime, win arpeggio, street sweep. Verify mute
  toggle persists across page refreshes.

- **Host onboarding** ✓ DONE: When the dealer joins and no bank is assigned, a gold notice appears
  explaining the dealer/bank split and directing them to the gear menu to assign a bank.

- **NEXT_STREET guard** ✓ DONE: "End hand" confirms if players haven't chosen; "End session" always confirms.

- **"Muck" label** ✓ DONE: Renamed to "Hide" in ShowdownPanel, hand history, and auto-show preference.

- **Waiting banner player name** ✓ DONE: Player name is now 17px bold gold in the waiting banner.

- **End-of-session summary** ✓ DONE: Recap modal now shows per-player table (hands, pots won, chips won,
  final stack), biggest pot of the session, and busted-out players. `STACKS_SNAPSHOT` event logged at
  session end.

  - **Verify in live session**: end a session, click "Session Recap" — confirm player table, biggest pot,
    knockouts, and all-in list appear correctly.
  - **All-in moments** ✓ DONE: `allIn: true` flag added to ACTION (CALL/BET/RAISE) and POST events
    when a player's stack hits 0. Recap modal shows an "All-ins (N)" list with hand#, street, player, amount.
    Verify in live session: all-in actions appear in the recap modal correctly.
  - **Net profit/loss (chip delta)** ✓ DONE: `STACK_SET` now logs `before` field; `summarize()` computes
    `chipDelta = finalStack - netBankGiven`. Recap modal shows a Net column (green/red).

## P2 — Visual improvements (high impact — implement first)

- **Pot pulse** ✓ DONE: Gold scale+glow flash on pot number whenever a bet lands.

- **Win seat highlight** ✓ DONE: Winning player's seat gets a gold pulsing border for ~3 seconds at hand end.

- **Fold card-backs** ✓ DONE: When a player folds, two grey card backs briefly animate off their seat before
  disappearing, reinforcing the physical action.

## P2 — Visual improvements (medium impact — on deck)

- **Street transition overlay** ✓ DONE: Full-screen 80px gold text sweeps in from left at FLOP/TURN/RIVER,
  holds 1.8s, sweeps out to right. Replaced the small in-board label.

- **Stack delta flash** ✓ DONE: When any player's stack changes, a green (+N) or red (−N) badge floats up
  and fades beside their stack number for 1.5 seconds.

- **Sitting out indicator** ✓ DONE: 💤 badge appears next to the player name on sitting-out seats during
  an active hand, beyond the existing 40% opacity dim.

## P3 — Features / nice-to-have

- **Long-term player profiles**: `playerId` (nanoid) already persists in localStorage. On the server,
  store a flat `data/players/{playerId}.json` with lifetime stats (hands, chips won/lost, sessions).
  Update on SESSION_ENDED. Show "Welcome back, Alice — lifetime: +450 chips" in the WELCOME flow.
  No database needed — ~2-3 hours of work. Note: only works if players always use the same browser/device.

- **Session history panel**: The hand-history modal shows the current session. Add a session
  selector to browse previous sessions from `server/data/sessions/`.

- **Multiple concurrent tables**: Architecture already supports multiple tableIds. Just needs a
  lobby/table-picker UI (list of active tables, create new, join by code).

- **Mobile layout polish** ✓ DONE: Action buttons `min-height: 44px`, primary buttons 52px/18px,
  range slider height 36px with 28px thumb on touch screens.

- **Reconnect border pulse** ✓ DONE: `body.reconnecting` class triggers a pulsing gold viewport border
  via CSS `::after` pseudo-element while WebSocket is reconnecting.

- **Action log inline** ✓ DONE: Most recent action log entry shown as a small dim line above the
  action bar — visible without expanding the collapsible log.

- **Emoji expansion**: Only 10 hardcoded emojis. For groups of 5+ regulars who always play together,
  a larger picker (or free-text emoji entry) would let everyone have a unique identity.
