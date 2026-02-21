import type { ClientToServer, ServerToClient } from "./types";

export type ConnStatus = "connecting" | "connected" | "reconnecting" | "disconnected";

export type ConnConfig = {
  tableId: string;
  name: string;
  playerId?: string;
};

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
    ws = new WebSocket("ws://127.0.0.1:3001/ws");

    ws.onopen = () => {
      attempt = 0;
      onStatus("connected");
      // Send HELLO with playerId for reconnection
      const hello: ClientToServer = { type: "HELLO", tableId: config.tableId, name: config.name };
      if (config.playerId) (hello as any).playerId = config.playerId;
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
