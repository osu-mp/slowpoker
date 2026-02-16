import fs from "node:fs";
import path from "node:path";

export type LogEvent = {
  ts: number;
  type: string;
  tableId: string;
  sessionId: string;
  payload?: unknown;
};

export function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

export function logPath(tableId: string, sessionId: string) {
  return path.join(process.cwd(), "data", "sessions", tableId, `${sessionId}.jsonl`);
}

export function appendEvent(e: LogEvent) {
  const dir = path.dirname(logPath(e.tableId, e.sessionId));
  ensureDir(dir);
  fs.appendFileSync(logPath(e.tableId, e.sessionId), JSON.stringify(e) + "\n", "utf-8");
}
