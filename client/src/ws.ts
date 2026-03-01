import type { ClientToServer, ServerToClient } from "./types";

export type ConnStatus = "connecting" | "connected" | "reconnecting" | "disconnected";

export type ConnConfig = {
  tableId: string;
  name: string;
  playerId?: string;
  emoji?: string;
};

function getWsUrl(): string {
  // Allow an explicit override (e.g. VITE_WS_URL=ws://localhost:3001/ws for dev)
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL as string;
  // In dev the client (5173) and server (3001) run on different ports
  if (import.meta.env.DEV) return "ws://localhost:3001/ws";
  // In production the client is served from the same host/port as the server
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws`;
}

export function connect(
  config: ConnConfig,
  onMessage: (m: ServerToClient) => void,
  onStatus: (s: ConnStatus) => void
) {
  let intentionalClose = false;
  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let ws: WebSocket | null = null;
  const queue: ClientToServer[] = [];

  function openSocket() {
    ws = new WebSocket(getWsUrl());

    ws.onopen = () => {
      attempt = 0;
      onStatus("connected");
      // Send HELLO with playerId for reconnection
      const hello: ClientToServer = { type: "HELLO", tableId: config.tableId, name: config.name };
      if (config.playerId) (hello as any).playerId = config.playerId;
      if (config.emoji) (hello as any).emoji = config.emoji;
      ws!.send(JSON.stringify(hello));
      // Flush queued messages
      while (queue.length && ws!.readyState === WebSocket.OPEN) {
        ws!.send(JSON.stringify(queue.shift()!));
      }
    };

    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data) as ServerToClient;
      onMessage(msg);
    };

    ws.onclose = () => {
      if (intentionalClose) return;
      scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose will fire after onerror
    };
  }

  function scheduleReconnect() {
    if (intentionalClose) return;
    attempt++;
    if (attempt > 20) {
      onStatus("disconnected");
      return;
    }
    onStatus("reconnecting");
    const delay = Math.min(1000 * Math.pow(2, attempt - 1), 15000);
    reconnectTimer = setTimeout(() => {
      openSocket();
    }, delay);
  }

  function send(msg: ClientToServer) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    } else {
      queue.push(msg);
    }
  }

  function close() {
    intentionalClose = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    ws?.close();
  }

  onStatus("connecting");
  openSocket();

  return { send, close };
}
