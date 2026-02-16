import type { ClientToServer, ServerToClient } from "./types";

export function connect(onMessage: (m: ServerToClient) => void, onClose: () => void) {
  const ws = new WebSocket("ws://127.0.0.1:3001/ws");
  const queue: ClientToServer[] = [];

  function flush() {
    while (queue.length && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(queue.shift()!));
    }
  }

  ws.onopen = () => flush();
  ws.onmessage = (ev) => onMessage(JSON.parse(ev.data) as ServerToClient);
  ws.onclose = () => onClose();
  ws.onerror = (e) => console.error("WebSocket error", e);

  function send(msg: ClientToServer) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    else queue.push(msg);
  }

  return { ws, send };
}
