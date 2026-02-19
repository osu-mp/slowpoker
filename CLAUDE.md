# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SlowPoker is a full-stack web-based poker game (Prototype v4) for home games with strict turn order betting, bank/chip management, and real card dealing. WebSocket-based real-time state sync between server and clients.

## Development Commands

```bash
# Install dependencies (from root)
npm install

# Run server (port 3001, hot-reload via tsx)
npm run dev:server

# Run client (port 5173, Vite dev server)
npm run dev:client

# Production build
cd server && npm run build && npm start
cd client && npm run build && npm run preview

# Generate session recap from event logs
cd server && npm run recap -- --table homegame --session <sessionId>
```

No test suite or linter is configured.

## Architecture

**Monorepo** with npm workspaces: `server/` and `client/`.

**Server** (Express + WebSocket + TypeScript):
- `server/src/index.ts` — WebSocket server, connection management, message dispatch
- `server/src/table.ts` — Core game logic: Table class holds all state, processes actions, manages betting rounds and street progression
- `server/src/types.ts` — Shared TypeScript types (messages, game state, enums)
- `server/src/cards.ts` — Deck creation and Fisher-Yates shuffle
- `server/src/logger.ts` — Event sourcing to JSONL files in `server/data/sessions/{tableId}/{sessionId}.jsonl`
- `server/src/recap.ts` — CLI tool that reads JSONL logs and generates markdown session summaries

**Client** (React 18 + Vite + TypeScript):
- `client/src/App.tsx` — Single-component game UI (seats grid, board, action controls, action log)
- `client/src/ws.ts` — WebSocket connection handler
- `client/src/types.ts` — Type definitions (duplicated from server)

**Communication protocol:** Discriminated union messages over WebSocket.
- `ClientToServer`: HELLO, SET_DEALER, SET_STACK, SET_BLINDS, START_HAND, ACT, NEXT_STREET, SHOWDOWN_CHOICE, END_SESSION
- `ServerToClient`: WELCOME, STATE, ERROR, SESSION_ENDED

**Key design decisions:**
- Server is single source of truth; redacts hidden cards before sending state to each client
- Strict turn order enforced server-side; turn advances automatically after each action
- Dealer role controls hand start/end and street advancement; Bank role controls stacks and blinds
- Showdown is manual (muck/show choices) — no automated hand evaluation
- Complete event log (JSONL) enables full game replay

## Conventions

- Strict TypeScript throughout (`strict: true`)
- Card format: two-char strings (rank + suit), e.g. `"Ah"`, `"2s"`, `"Ks"`
- Chip values are integers
- Player IDs: 8-char nanoid; Session IDs: 10-char nanoid
- Action log displays most recent action first
- Side-pot splitting for all-ins is TODO
- Sound effects (low priority) is TODO
