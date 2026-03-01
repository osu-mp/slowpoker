# Hosting Slow Poker for Friends

This guide covers how to host Slow Poker from your home machine (including behind Starlink/CGNAT) and share it with friends.

## The Problem

Starlink (and many other ISPs) use **CGNAT** (Carrier-Grade NAT), which means:
- You don't have a dedicated public IP address
- Port forwarding from your router won't work
- Your IP address can change at any time

You need a **tunnel** — a service that gives you a stable public URL that forwards traffic to your local machine.

---

## Option 1: ngrok (Easiest, Free)

Best for: one-off game nights. Takes 2 minutes to set up.

### Setup

1. **Create a free account** at https://ngrok.com and copy your auth token from the dashboard.

2. **Install ngrok:**
   ```bash
   # Windows (winget)
   winget install ngrok.ngrok

   # Or download from https://ngrok.com/download
   ```

3. **Authenticate (one time):**
   ```bash
   ngrok config add-authtoken YOUR_TOKEN_HERE
   ```

### Hosting a Game

1. **Build and start the server:**
   ```bash
   cd server
   npm run build
   npm start
   ```

2. **In a second terminal, start the tunnel:**
   ```bash
   ngrok http 3001
   ```

3. ngrok will display a public URL like:
   ```
   Forwarding  https://abc123.ngrok-free.app -> http://localhost:3001
   ```

4. **Build the client pointing to the tunnel URL:**
   ```bash
   cd client

   # Set the server URL for the production build
   # Create/edit .env.production:
   echo VITE_WS_URL=wss://abc123.ngrok-free.app/ws > .env.production
   echo VITE_API_URL=https://abc123.ngrok-free.app >> .env.production

   npm run build
   npm run preview
   ```

5. **Share with friends:** You'll need a second ngrok tunnel for the client (free plan allows one; paid allows multiple), OR serve the client build from the same Express server.

### Simpler: Serve Everything from One Port

To avoid needing two tunnels, serve the client build from the Express server:

```bash
# Build the client
cd client && npm run build

# Copy build output into server's static folder
cp -r dist ../server/public
```

Then add static file serving to the Express server (already serves on port 3001). With this approach, one ngrok tunnel covers both the UI and WebSocket.

> **Free tier limits:** ngrok free gives you a random URL that changes each restart, 1 tunnel at a time, and a session limit. For a poker night this is fine.

---

## Option 2: Cloudflare Tunnel (Free, Stable URL)

Best for: recurring game nights. URL stays the same across restarts.

### Setup

1. **Create a free Cloudflare account** at https://dash.cloudflare.com and add a domain (you can buy a cheap one for ~$10/year, or use a domain you already own).

2. **Install cloudflared:**
   ```bash
   # Windows
   winget install Cloudflare.cloudflared
   ```

3. **Login and create a tunnel:**
   ```bash
   cloudflared tunnel login
   cloudflared tunnel create slowpoker
   ```

4. **Configure the tunnel** — create `~/.cloudflared/config.yml`:
   ```yaml
   tunnel: slowpoker
   credentials-file: C:\Users\YOUR_USER\.cloudflared\TUNNEL_ID.json

   ingress:
     - hostname: poker.yourdomain.com
       service: http://localhost:3001
     - service: http_status:404
   ```

5. **Add a DNS record:**
   ```bash
   cloudflared tunnel route dns slowpoker poker.yourdomain.com
   ```

### Hosting a Game

```bash
# Terminal 1: Start the server
cd server && npm run build && npm start

# Terminal 2: Start the tunnel
cloudflared tunnel run slowpoker
```

Share `https://poker.yourdomain.com` with friends. The URL never changes.

---

## Option 3: Tailscale (No Public URL Needed)

Best for: a regular group of friends willing to install an app. Most secure option — no public exposure at all.

### Setup

1. Everyone installs **Tailscale** from https://tailscale.com (free for personal use, up to 100 devices).
2. You create a Tailscale account and share an invite link with your friends.
3. Everyone joins your Tailscale network (takes 30 seconds).

### Hosting a Game

1. Start the server:
   ```bash
   cd server && npm run build && npm start
   ```

2. Find your Tailscale IP:
   ```bash
   tailscale ip
   # e.g., 100.64.1.23
   ```

3. Friends open `http://100.64.1.23:3001` in their browser.

No tunnels, no port forwarding, no dynamic IP problems. Tailscale IPs are stable.

> **Bonus:** Tailscale also gives you a MagicDNS name like `your-pc.tailnet-name.ts.net`, so friends can bookmark `http://your-pc.tailnet-name.ts.net:3001`.

---

## Option 4: Deploy to the Cloud (Always On)

If you don't want to keep your PC running, deploy to a free cloud service.

### Railway (easiest)

1. Push your repo to GitHub.
2. Go to https://railway.app, connect your GitHub repo.
3. Railway auto-detects the Node.js app. Set the start command:
   ```
   cd server && npm run build && npm start
   ```
4. Railway gives you a public URL. Share it.

### Render

1. Push to GitHub.
2. Go to https://render.com, create a new Web Service from your repo.
3. Build command: `cd server && npm install && npm run build`
4. Start command: `cd server && npm start`

### Fly.io

```bash
# Install flyctl, then:
cd server
fly launch
fly deploy
```

> **Note:** Free tiers on these services may sleep after inactivity. Railway and Render free tiers are generous enough for occasional game nights.

---

## Serving the Client Build from Express (Recommended for All Options)

To keep things simple, serve the client from the same server process so you only need one URL/port:

1. **Build the client:**
   ```bash
   cd client && npm run build
   ```

2. **Update `client/src/ws.ts`** to connect to the same host (use relative URLs or `window.location`). The WebSocket URL should be derived from the page URL rather than hardcoded to `localhost:3001`.

3. **Serve static files from Express** — add this to `server/src/index.ts` before the `server.listen()` call:
   ```typescript
   // Serve client build
   const clientDist = path.join(__dirname, "../../client/dist");
   if (fs.existsSync(clientDist)) {
     app.use(express.static(clientDist));
     app.get("*", (_req, res) => {
       res.sendFile(path.join(clientDist, "index.html"));
     });
   }
   ```

4. Now everything runs on one port (3001), and you only need one tunnel/URL.

---

## Quick Reference

| Method | Cost | Stable URL | Setup Time | Public Exposure |
|--------|------|-----------|------------|-----------------|
| ngrok | Free (limited) | No (changes on restart) | 2 min | Yes |
| Cloudflare Tunnel | Free + domain (~$10/yr) | Yes | 15 min | Yes |
| Tailscale | Free | Yes (private) | 5 min per person | No (private mesh) |
| Cloud deploy | Free tier | Yes | 10 min | Yes |

## Recommendation

- **For a one-off game night:** ngrok
- **For a regular group:** Tailscale (easiest for everyone, most secure)
- **For a permanent setup:** Cloudflare Tunnel or cloud deploy
