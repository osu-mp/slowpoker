# SlowPoker Project Memory

## Architecture
- Monorepo: `server/` (Express + WebSocket + TypeScript) and `client/` (React 18 + Vite)
- Server is single source of truth; cards redacted before sending to each client
- WebSocket discriminated union protocol; `ClientToServer` / `ServerToClient` in both `types.ts` files
- Hand event log: JSONL in `server/data/sessions/{tableId}/{sessionId}.jsonl`

## Key Files
- `server/src/table.ts` — Core game logic (Table class)
- `server/src/index.ts` — WS server, message dispatch, `redactState()`
- `server/src/types.ts` — Server-side shared types
- `server/src/handHistory.ts` — Reconstructs hands from event log
- `client/src/App.tsx` — Single-component React UI (~1180 lines)
- `client/src/types.ts` — Client mirror of server types
- `client/src/ws.ts` — WebSocket connection with auto-reconnect
- `client/src/styles.css` — All CSS

## Follow-up Fixes (2026-02-28, same session)
- **Join prompt**: trigger on `me.stack === 0` after WELCOME (not `isNewPlayer` — localStorage may have stale entry)
- **Button rotation bug**: `lastButtonIndex` private field on Table class; `state.positions` was reset to null between hands, causing button to always be index 0
- **REVEAL_HAND extended**: accepts `choice?: ShowChoice` for show-1-card support at DONE street
- **holeArea show panel**: folded mid-hand → "Show Cards" (both); DONE → show one/both panel; sit-out replaced with persistent disabled-during-hand checkbox

## Recent Changes (2026-02-28)
Implemented 5 UX improvements:
1. **Side pot fix**: `potBreakdown` only renders when `state.pots.length > 1 && hasAllIn`
2. **Settings popover**: Top-right button opens `UserSettingsPopover` with emoji grid, chip request, auto-show pref
3. **Emoji**: `PlayerState.emoji?` field; `SET_PROFILE` message; persisted to `sp-emoji-{tableId}` in localStorage
4. **Bank chip alert**: Banner shows pending requests to the bank user with approve/deny buttons
5. **New player chip prompt**: `chipPromptOpen` state fires on first join (no stored playerId)
6. **Show cards after uncontested**: "Show Cards" button condition extended to `street === "DONE"` (not just folded)
7. **Auto show/muck**: `autoShowPref` state + ref; useEffect fires on street/handNumber change
8. **Hand history cards**: `SHOWDOWN_CHOICE` event enriched with `cards[]` and `handName`; `HandShowdown` type updated

## Patterns
- Emoji fallback: `p.emoji ?? PLAYER_EMOJIS[playerIndex % PLAYER_EMOJIS.length]`
- Auto-show uses ref pattern to avoid stale closure: `autoShowPrefRef.current`
- `UserSettingsPopover` is a standalone function component at bottom of App.tsx
- `ChipRequestPanel` component was removed (functionality moved to settings popover)
