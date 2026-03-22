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

- **Host onboarding**: First-time hosts are confused by the dealer/bank split (two distinct roles that
  real poker doesn't have). The bank assignment is buried in a seat gear menu. Add a short setup guide
  or tooltip explaining: dealer controls hand flow, bank controls stacks/blinds. Surface "Make Bank" more
  prominently on first join when no bank is assigned.

- **NEXT_STREET guard**: The "Deal flop / turn / river" button is visible even while betting is still in
  progress (roundComplete === false). Add a confirmation prompt ("2 players still to act — deal anyway?")
  to prevent accidental premature street advances.

- **"Muck" label**: The ShowdownPanel uses poker jargon "Muck" — casual players may not know this means
  "fold face-down". Consider renaming to "Hide" or "Fold face-down" for clarity.

- **Waiting banner player name**: The "Waiting for [name]..." banner could make the player name larger/bolder
  — it's the most important info when it's not your turn.

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

- **Mobile layout polish**: Larger action buttons and bigger bet-slider thumb on touch screens.
  The ellipse seat layout needs `min-height: 520px`. On small phones the board and seats can overlap.
  CSS: `input[type=range]::-webkit-slider-thumb { width: 28px; height: 28px }`.

- **Reconnect border pulse**: While `connStatus === "reconnecting"`, add a pulsing yellow border
  around the viewport (not just the banner) to make it more obvious something is wrong.

- **Action log default open**: Currently collapsed on first load — new users never see it. Consider
  defaulting to open, or showing the last 1-2 actions inline above the action bar.

- **Emoji expansion**: Only 10 hardcoded emojis. For groups of 5+ regulars who always play together,
  a larger picker (or free-text emoji entry) would let everyone have a unique identity.
