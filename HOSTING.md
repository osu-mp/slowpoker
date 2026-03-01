# Hosting Slow Poker for Friends

This guide covers how to host Slow Poker from your home machine (including behind Starlink/CGNAT)
and share it with friends over the internet.

## The Problem

Starlink (and many other ISPs) use **CGNAT** (Carrier-Grade NAT), which means you don't have a
direct public IP address and port forwarding from your router won't work. You need a **tunnel** —
a service that gives you a stable public URL that forwards traffic to your local machine.

The server now serves the built client from the same port, so **one tunnel covers everything**.

---

## Option 1: ngrok — Recommended for One-Off Game Nights

**Free plan works for monthly games.** No session timeout, 1 GB/month bandwidth (poker traffic is
negligible), up to 3 simultaneous tunnels. The only catch: the URL changes each time you restart
ngrok, so share a fresh link in your group chat before each game.

### One-time setup

```bash
# Install (Windows)
winget install ngrok.ngrok

# Authenticate with your free account token from https://ngrok.com
ngrok config add-authtoken YOUR_TOKEN_HERE
```

### Hosting a game

```bash
# 1. Build everything
cd client && npm run build && cd ..
cd server && npm run build

# 2. Start the server (serves both the UI and WebSocket on port 3001)
npm start

# 3. In a second terminal, open the tunnel
ngrok http 3001
```

ngrok displays a URL like `https://abc123.ngrok-free.app`. Share that link — your friends open
it in their browser and connect directly. No client build step with custom env vars needed.

> **Interstitial page:** ngrok shows a one-time browser warning on first visit. The server already
> sends the `ngrok-skip-browser-warning` header to suppress it automatically.

---

## Option 2: Cloudflare Tunnel — Best for a Recurring Group

**Free + ~$10/yr domain.** Stable URL that never changes, no connection limits, no interstitial.
Best if you host the same group monthly and want a permanent link to bookmark.

### One-time setup

```bash
# Install cloudflared (Windows)
winget install Cloudflare.cloudflared

# Login and create a named tunnel
cloudflared tunnel login
cloudflared tunnel create slowpoker

# Create ~/.cloudflared/config.yml:
# tunnel: slowpoker
# credentials-file: C:\Users\YOU\.cloudflared\TUNNEL_ID.json
# ingress:
#   - hostname: poker.yourdomain.com
#     service: http://localhost:3001
#   - service: http_status:404

# Point your DNS at the tunnel
cloudflared tunnel route dns slowpoker poker.yourdomain.com
```

### Hosting a game

```bash
cd client && npm run build && cd ..
cd server && npm run build && npm start   # terminal 1
cloudflared tunnel run slowpoker          # terminal 2
```

Share `https://poker.yourdomain.com`. The URL is permanent — no re-sharing needed.

---

## Option 3: Tailscale — Best for a Trusted Regular Group

**Fully free, no public exposure.** Everyone installs the Tailscale app once and joins your
private network. Most secure — the server is never reachable from the public internet.

```bash
# Friends install Tailscale from https://tailscale.com and accept your invite
# You start the server normally:
cd server && npm run build && npm start

# Find your stable Tailscale IP (or use MagicDNS name):
tailscale ip   # e.g. 100.64.1.23
```

Share `http://your-pc.tailnet-name.ts.net:3001`. Friends bookmark it once; it never changes.

---

## Option 4: Cloud Deploy — Always On, No Local Machine Required

Deploy to a cloud service so the game is available even when your PC is off.

| Service | Free tier | Notes |
|---------|-----------|-------|
| [Railway](https://railway.app) | $5 credit/mo | Easiest deploy, auto-detects Node |
| [Render](https://render.com) | Free (sleeps after 15 min idle) | Spins up slowly on first connect |
| [Fly.io](https://fly.io) | 3 free VMs | More config needed |

```bash
# Build command:  cd server && npm install && npm run build
# Start command:  cd server && npm start
```

The server auto-serves the client build, so no separate static host is needed.

> **State warning:** The in-memory game state is lost on redeploy or instance restart. Acceptable
> for a single-night session; not suitable for multi-day games.

---

## Quick Reference

| Method | Cost | Stable URL | Setup | Public |
|--------|------|-----------|-------|--------|
| ngrok free | Free | No (share each time) | 2 min | Yes |
| Cloudflare Tunnel | Free + ~$10/yr domain | Yes (permanent) | 15 min | Yes |
| Tailscale | Free | Yes (private) | 5 min/person | No |
| Cloud (Railway etc.) | Free tier | Yes | 10 min | Yes |

**Recommendation by use case:**
- Monthly game, casual → **ngrok free**
- Regular group, same friends → **Cloudflare Tunnel** (or Tailscale if they'll install an app)
- Want it always on → **Railway** or **Render**
