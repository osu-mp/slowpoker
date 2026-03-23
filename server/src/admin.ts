import type { Router } from "express";
import express from "express";
import type { Table } from "./table.js";

type BroadcastFn = (tableId: string, table: Table) => void;

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!ADMIN_TOKEN) {
    return res.status(503).send("Admin disabled: set ADMIN_TOKEN env var to enable.");
  }
  const token = req.query.token ?? req.headers["x-admin-token"];
  if (token !== ADMIN_TOKEN) {
    return res.status(401).send("Unauthorized.");
  }
  next();
}

export function registerAdminRoutes(router: Router, tables: Map<string, Table>, conns: Set<{ tableId: string }>, broadcast: BroadcastFn) {
  router.use(authMiddleware);
  router.use(express.json());

  // JSON API
  router.get("/api/tables", (_req, res) => {
    const data = [...tables.entries()].map(([id, table]) => {
      const connected = [...conns].filter(c => c.tableId === id).length;
      return {
        id,
        handNumber: table.state.handNumber,
        playerCount: table.state.players.length,
        connectedCount: connected,
        street: table.state.street,
        ended: table.ended,
        lastActivityAt: table.lastActivityAt,
        idleMin: Math.floor((Date.now() - table.lastActivityAt) / 60000),
        players: table.state.players.map(p => ({
          id: p.id,
          name: p.name,
          isDealer: p.isDealer,
          isBank: p.id === table.state.bankPlayerId,
          connected: p.connected,
        })),
      };
    });
    res.json(data);
  });

  router.delete("/api/table/:id", (req, res) => {
    const { id } = req.params;
    if (!tables.has(id)) return res.status(404).json({ error: "Table not found." });
    tables.delete(id);
    console.log(`[admin] Deleted table ${id}`);
    res.json({ ok: true });
  });

  router.post("/api/table/:id/set-dealer", (req, res) => {
    const table = tables.get(req.params.id);
    if (!table) return res.status(404).json({ error: "Table not found." });
    const { playerId } = req.body ?? {};
    if (!playerId) return res.status(400).json({ error: "playerId required." });
    try {
      table.adminSetDealer(playerId);
      broadcast(req.params.id, table);
      res.json({ ok: true });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  router.post("/api/table/:id/set-bank", (req, res) => {
    const table = tables.get(req.params.id);
    if (!table) return res.status(404).json({ error: "Table not found." });
    const { playerId } = req.body ?? {};
    if (!playerId) return res.status(400).json({ error: "playerId required." });
    try {
      table.adminSetBank(playerId);
      broadcast(req.params.id, table);
      res.json({ ok: true });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  // Admin HTML page
  router.get("/", (_req, res) => {
    const token = ADMIN_TOKEN ?? "";
    res.setHeader("Content-Type", "text/html");
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SlowPoker Admin</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: monospace; background: #111; color: #eee; padding: 24px; margin: 0; }
  h1 { margin: 0 0 4px; font-size: 1.4rem; }
  .sub { color: #888; margin-bottom: 24px; font-size: 0.85rem; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; border-bottom: 1px solid #444; padding: 6px 10px; color: #aaa; font-size: 0.8rem; text-transform: uppercase; }
  td { padding: 8px 10px; border-bottom: 1px solid #222; font-size: 0.9rem; }
  tr:hover td { background: #1a1a1a; }
  .ended { color: #666; }
  .badge { display: inline-block; padding: 2px 7px; border-radius: 4px; font-size: 0.75rem; }
  .badge-active { background: #1a4a1a; color: #4caf50; }
  .badge-ended { background: #2a2a2a; color: #888; }
  .badge-idle { background: #3a2a00; color: #f0a000; }
  button { background: #5a0000; color: #f88; border: 1px solid #a00; padding: 4px 10px; cursor: pointer; border-radius: 4px; font-family: monospace; font-size: 0.85rem; }
  button:hover { background: #7a0000; }
  button.btn-assign { background: #1a3a5a; color: #88ccff; border-color: #2266aa; }
  button.btn-assign:hover { background: #1a4a7a; }
  .empty { color: #555; padding: 20px 0; }
  #status { margin-bottom: 16px; color: #4caf50; min-height: 1.2em; }
  .detail-row td { background: #161616; padding: 12px 10px; }
  .player-list { display: flex; flex-direction: column; gap: 6px; }
  .player-row { display: flex; align-items: center; gap: 8px; font-size: 0.85rem; }
  .player-name { min-width: 120px; }
  .tag { font-size: 0.7rem; padding: 1px 5px; border-radius: 3px; background: #2a2a2a; color: #aaa; }
  .tag-dealer { background: #2a1a00; color: #f0a000; }
  .tag-bank { background: #1a2a3a; color: #88ccff; }
  .tag-dc { background: #3a1a1a; color: #f88; }
  .reassign-section { margin-top: 10px; display: flex; gap: 16px; flex-wrap: wrap; }
  .reassign-group { display: flex; align-items: center; gap: 6px; }
  select { background: #222; color: #eee; border: 1px solid #444; padding: 3px 6px; border-radius: 4px; font-family: monospace; font-size: 0.85rem; }
</style>
</head>
<body>
<h1>SlowPoker Admin</h1>
<div class="sub">Live table management</div>
<div id="status"></div>
<table id="tbl">
  <thead><tr>
    <th>Table ID</th><th>Status</th><th>Street</th><th>Hand #</th><th>Players</th><th>Connected</th><th>Idle</th><th>Action</th>
  </tr></thead>
  <tbody id="body"><tr><td colspan="8" class="empty">Loading…</td></tr></tbody>
</table>
<script>
const TOKEN = ${JSON.stringify(token)};
function api(path, opts) {
  return fetch(path + '?token=' + TOKEN, opts || {}).then(r => r.json());
}
function apiPost(path, body) {
  return fetch(path + '?token=' + TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(r => r.json());
}
function setStatus(msg, ok) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.style.color = ok === false ? '#f88' : '#4caf50';
}
function load() {
  api('/admin/api/tables').then(rows => {
    const tbody = document.getElementById('body');
    if (!rows.length) { tbody.innerHTML = '<tr><td colspan="8" class="empty">No active tables.</td></tr>'; return; }
    tbody.innerHTML = rows.map(r => {
      const statusBadge = r.ended
        ? '<span class="badge badge-ended">ended</span>'
        : r.idleMin >= 10 ? '<span class="badge badge-idle">idle ' + r.idleMin + 'm</span>'
        : '<span class="badge badge-active">active</span>';
      const playerList = r.players.map(p =>
        \`<div class="player-row">
          <span class="player-name">\${p.name}</span>
          \${p.isDealer ? '<span class="tag tag-dealer">dealer</span>' : ''}
          \${p.isBank ? '<span class="tag tag-bank">bank</span>' : ''}
          \${!p.connected ? '<span class="tag tag-dc">disconnected</span>' : ''}
        </div>\`
      ).join('');
      const playerOptions = r.players.map(p =>
        \`<option value="\${p.id}">\${p.name}\${!p.connected ? ' (dc)' : ''}</option>\`
      ).join('');
      return \`<tr class="\${r.ended ? 'ended' : ''}" style="cursor:pointer" onclick="toggleDetail('\${r.id}')">
          <td>\${r.id}</td>
          <td>\${statusBadge}</td>
          <td>\${r.street}</td>
          <td>\${r.handNumber}</td>
          <td>\${r.playerCount}</td>
          <td>\${r.connectedCount}</td>
          <td>\${r.idleMin}m</td>
          <td><button onclick="event.stopPropagation();kill('\${r.id}')">Kill</button></td>
        </tr>
        <tr id="detail-\${r.id}" style="display:none">
          <td colspan="8">
            <div class="player-list">\${playerList}</div>
            \${r.ended ? '' : \`<div class="reassign-section">
              <div class="reassign-group">
                <label>Dealer:</label>
                <select id="dealer-sel-\${r.id}">\${playerOptions}</select>
                <button class="btn-assign" onclick="reassign('\${r.id}','dealer')">Set dealer</button>
              </div>
              <div class="reassign-group">
                <label>Bank:</label>
                <select id="bank-sel-\${r.id}">\${playerOptions}</select>
                <button class="btn-assign" onclick="reassign('\${r.id}','bank')">Set bank</button>
              </div>
            </div>\`}
          </td>
        </tr>\`;
    }).join('');
  });
}
function toggleDetail(id) {
  const row = document.getElementById('detail-' + id);
  if (row) row.style.display = row.style.display === 'none' ? '' : 'none';
}
function reassign(tableId, role) {
  const selId = role + '-sel-' + tableId;
  const playerId = document.getElementById(selId).value;
  const endpoint = role === 'dealer' ? 'set-dealer' : 'set-bank';
  apiPost('/admin/api/table/' + tableId + '/' + endpoint, { playerId })
    .then(r => { setStatus(r.ok ? role + ' reassigned' : (r.error || 'Error'), r.ok ? true : false); load(); })
    .catch(() => setStatus('Request failed', false));
}
function kill(id) {
  if (!confirm('Delete table ' + id + '?')) return;
  api('/admin/api/table/' + id, { method: 'DELETE' }).then(r => {
    setStatus(r.ok ? 'Deleted ' + id : r.error, r.ok);
    load();
  });
}
load();
setInterval(load, 10000);
</script>
</body>
</html>`);
  });
}
