import express from "express";
import cors from "cors";
import http from "node:http";
import { WebSocketServer } from "ws";
import type WebSocket from "ws";
import { Table } from "./table.js";
import type { ClientToServer, ServerToClient, TableState } from "./types.js";

const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;

type Conn = { ws: WebSocket; tableId: string; playerId: string; };

const tables = new Map<string, Table>();
const conns = new Set<Conn>();

function getOrCreateTable(tableId: string) {
  let t = tables.get(tableId);
  if (!t) { t = new Table(tableId); tables.set(tableId, t); }
  return t;
}

function redactState(state: TableState, youId: string): TableState {
  return {
    ...state,
    deck: undefined,
    players: state.players.map((p) => ({
      ...p,
      holeCards: p.id === youId ? p.holeCards : undefined
    }))
  };
}

function send(ws: WebSocket, msg: ServerToClient) {
  ws.send(JSON.stringify(msg));
}

function broadcastState(tableId: string, table: Table) {
  for (const c of conns) {
    if (c.tableId === tableId) {
      c.ws.send(JSON.stringify({ type: "STATE", state: redactState(table.state, c.playerId) } as ServerToClient));
    }
  }
}

const app = express();
app.use(cors());
app.get("/health", (_req, res) => res.json({ ok: true }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws) => {
  let current: Conn | null = null;

  ws.on("message", (raw) => {
    let msg: ClientToServer;
    try { msg = JSON.parse(raw.toString()); }
    catch { return send(ws, { type: "ERROR", message: "Bad JSON." }); }

    try {
      if (msg.type === "HELLO") {
        const table = getOrCreateTable(msg.tableId);
        const player = table.addPlayer(msg.name);
        current = { ws, tableId: msg.tableId, playerId: player.id };
        conns.add(current);
        send(ws, { type: "WELCOME", youId: player.id, state: redactState(table.state, player.id) });
        broadcastState(msg.tableId, table);
        return;
      }

      if (!current) return send(ws, { type: "ERROR", message: "Send HELLO first." });

      const table = getOrCreateTable(current.tableId);
      if (table.ended) return send(ws, { type: "ERROR", message: "Session ended. Refresh to start a new session." });

      switch (msg.type) {
        case "SET_DEALER": table.setDealer(msg.playerId); break;
        case "SET_STACK": table.setStack(current.playerId, msg.playerId, msg.stack); break;
        case "SET_BLINDS": table.setBlinds(current.playerId, msg.smallBlind, msg.bigBlind, msg.straddleEnabled); break;
        case "START_HAND": table.startHand(current.playerId); break;
        case "ACT": table.act(current.playerId, msg.action); break;
        case "NEXT_STREET": table.nextStreet(current.playerId); break;
        case "SHOWDOWN_CHOICE": table.setShowdownChoice(current.playerId, msg.choice); break;
        case "END_SESSION":
          table.endSession(current.playerId);
          for (const c of conns) {
            if (c.tableId === current.tableId) {
              c.ws.send(JSON.stringify({ type: "SESSION_ENDED", tableId: current.tableId, sessionId: table.state.sessionId } as ServerToClient));
            }
          }
          break;
      }

      broadcastState(current.tableId, table);
    } catch (e: any) {
      send(ws, { type: "ERROR", message: e?.message ?? "Unknown error" });
    }
  });

  ws.on("close", () => {
    if (!current) return;
    const table = tables.get(current.tableId);
    if (table) {
      table.markDisconnected(current.playerId);
      broadcastState(current.tableId, table);
    }
    conns.delete(current);
  });
});

server.listen(PORT, () => console.log(`Slow Poker server listening on http://localhost:${PORT}`));
