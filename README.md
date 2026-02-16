# Slow Poker (Prototype v4) — strict turn order betting + bank + blinds/straddle + real cards

## New in v4
- Strict turn order betting (no dealer confirmation of actions)
- Action buttons: Fold, Check/Call, Bet/Raise
- Bet sizing helpers: SB, BB, Pot, All-in
- Slider from min bet/raise to all-in
- Betting round must be closed before dealer can advance streets

## Still simplified (intentional for prototype)
- No side-pots yet (all-ins are allowed but side-pot splitting is TODO)
- No automatic showdown hand evaluation yet (show/muck choices still recorded)

## Run locally (Windows-friendly)
Terminal A:
```bash
cd server
npm install
npm run dev
```

Terminal B:
```bash
cd client
npm install
npm run dev
```

Open multiple clients:
- http://localhost:5173
