# Hosting Slow Poker for Friends

This guide covers how to host Slow Poker from your home machine (including behind Starlink/CGNAT)
and share it with friends over the internet.

## The Problem

Starlink (and many other ISPs) use **CGNAT** (Carrier-Grade NAT), which means you don't have a
direct public IP address and port forwarding from your router won't work. You need a **tunnel** —
a service that gives you a stable public URL that forwards traffic to your local machine.

The server serves the built client from the same port, so **one tunnel covers everything**.

---

## ngrok — Recommended

**Free plan works great for monthly games.** No session timeout, 1 GB/month bandwidth (poker traffic is
negligible). The only catch: the URL changes each time you restart ngrok, so share a fresh link
in your group chat before each game.

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
it in their browser and connect directly.

> **Interstitial page:** ngrok shows a one-time warning the first time a browser visits your URL.
> Just click **Visit Site** to proceed — ngrok sets a cookie and won't show it again on that device.

---

## Setting the Admin Token

The admin panel (`/admin?token=...`) requires an `ADMIN_TOKEN` environment variable.
On Windows, environment variables must be set **before** the command — not appended after it.

### Development (npm run dev)

Open PowerShell and run:

```powershell
$env:ADMIN_TOKEN="blah"; npm run dev
```

Or use two commands:

```powershell
$env:ADMIN_TOKEN = "blah"
npm run dev
```

> `npm run dev ADMIN_TOKEN=blah` is **Linux/macOS syntax** and will not work on Windows.

### Production (npm start)

```powershell
$env:ADMIN_TOKEN = "your-secret-token"
npm start
```

### Using the admin panel

Once the server is running with `ADMIN_TOKEN` set, visit:

```
http://localhost:3001/admin?token=your-secret-token
```

Or through the tunnel URL:

```
https://your-tunnel-url/admin?token=your-secret-token
```

**Features:**
- Click any table row to expand player details
- **Set dealer / Set bank** dropdowns let you reassign roles if a player disconnects
- **Kill** removes an idle table from memory
- Page auto-refreshes every 10 seconds
