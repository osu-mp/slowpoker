import express from "express";
import cors from "cors";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { WebSocketServer } from "ws";
import type WebSocket from "ws";
import { Table } from "./table.js";
import type { ClientToServer, ServerToClient, TableState } from "./types.js";
import { readJsonl, summarize } from "./recap.js";
import { reconstructHands } from "./handHistory.js";

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
  const isShowdown = state.street === "SHOWDOWN";
  return {
    ...state,
    deck: undefined,
    players: state.players.map((p) => {
      if (p.id === youId) return { ...p };

      // Reveal cards if player has chosen to show (any street, including voluntary reveals)
      const choice = state.showdownChoices[p.id];
      if (choice?.kind === "SHOW_2") {
        return { ...p }; // full holeCards + bestHand
      }
      if (isShowdown && choice?.kind === "SHOW_1" && p.holeCards) {
        return { ...p, holeCards: p.holeCards, bestHand: undefined };
      }

      return { ...p, holeCards: undefined, bestHand: undefined };
    })
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

const sessionsDir = path.join(process.cwd(), "data", "sessions");

app.get("/api/sessions/:tableId", (_req, res) => {
  const dir = path.join(sessionsDir, _req.params.tableId);
  if (!fs.existsSync(dir)) return res.json([]);
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".jsonl"));
  const ids = files.map(f => f.replace(".jsonl", ""));
  res.json(ids);
});

app.get("/api/recap/:tableId/:sessionId", (_req, res) => {
  const { tableId, sessionId } = _req.params;
  const logFile = path.join(sessionsDir, tableId, `${sessionId}.jsonl`);
  if (!fs.existsSync(logFile)) return res.status(404).json({ error: "Session not found." });
  const events = readJsonl(logFile);
  const s = summarize(events);
  const date = new Date(s.started ?? Date.now()).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  res.json({ tableId, sessionId, date, players: s.joins, durationMin: s.durationMin, hands: s.hands, actions: s.actions, posts: s.posts });
});

app.get("/api/hands/:tableId/:sessionId", (_req, res) => {
  const { tableId, sessionId } = _req.params;
  const logFile = path.join(sessionsDir, tableId, `${sessionId}.jsonl`);
  if (!fs.existsSync(logFile)) return res.status(404).json({ error: "Session not found." });
  const events = readJsonl(logFile);
  const hands = reconstructHands(events);
  res.json(hands);
});

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

        let player;
        if (msg.playerId) {
          player = table.reconnectPlayer(msg.playerId, msg.name, msg.emoji);
          if (player) {
            // Remove stale connections for this playerId
            for (const c of conns) {
              if (c.playerId === player.id && c.tableId === msg.tableId) {
                conns.delete(c);
              }
            }
          }
        }
        if (!player) {
          player = table.addPlayer(msg.name, msg.emoji);
        }

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
        case "SET_PROFILE": table.setProfile(current.playerId, msg.emoji); break;
        case "SET_DEALER": table.setDealer(msg.playerId); break;
        case "SET_STACK": table.setStack(current.playerId, msg.playerId, msg.stack); break;
        case "SET_BANK": table.setBank(current.playerId, msg.playerId); break;
        case "SET_BLINDS": table.setBlinds(current.playerId, msg.smallBlind, msg.bigBlind, msg.straddleEnabled); break;
        case "START_HAND": table.startHand(current.playerId); break;
        case "ACT": table.act(current.playerId, msg.action); break;
        case "NEXT_STREET": table.nextStreet(current.playerId); break;
        case "SHOWDOWN_CHOICE": table.setShowdownChoice(current.playerId, msg.choice); break;
        case "REVEAL_HAND": table.revealHand(current.playerId, msg.choice); break;
        case "SIT_OUT": table.setSitOut(current.playerId, true); break;
        case "SIT_IN": table.setSitOut(current.playerId, false); break;
        case "REQUEST_STACK": table.requestStack(current.playerId, msg.amount); break;
        case "CLEAR_STACK_REQUEST": table.clearStackRequest(current.playerId, msg.playerId); break;
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
