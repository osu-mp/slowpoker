import fs from "node:fs";
import path from "node:path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

export type LogEvent = { ts: number; type: string; tableId: string; sessionId: string; payload?: any };

export function readJsonl(p: string): LogEvent[] {
  const lines = fs.readFileSync(p, "utf-8").split(/\r?\n/).filter(Boolean);
  return lines.map(l => JSON.parse(l));
}

export function summarize(events: LogEvent[]) {
  const started = events.find(e => e.type === "SESSION_STARTED")?.ts;
  const ended = events.find(e => e.type === "SESSION_ENDED")?.ts;

  const joins = events.filter(e => e.type === "PLAYER_JOINED").map(e => e.payload?.name).filter(Boolean);
  const hands = events.filter(e => e.type === "HAND_STARTED").length;
  const actions = events.filter(e => e.type === "ACTION").length;
  const posts = events.filter(e => e.type === "POST").length;

  const durationMin = started && ended ? Math.round((ended - started) / 60000) : undefined;

  return { started, ended, durationMin, joins, hands, actions, posts };
}

function markdown(tableId: string, sessionId: string, s: ReturnType<typeof summarize>) {
  const date = new Date(s.started ?? Date.now()).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  const players = s.joins.length ? s.joins.join(", ") : "Unknown players";
  const dur = s.durationMin ? `${s.durationMin} minutes` : "Unknown duration";

  return [
    `# The ${date} Game`,
    "",
    `**Table:** ${tableId}`,
    `**Session:** ${sessionId}`,
    `**Players:** ${players}`,
    `**Duration:** ${dur}`,
    "",
    `Strict turn order betting kept things fair and slow — just like a home game.`,
    "",
    `- Hands played: **${s.hands}**`,
    `- Blind/straddle posts: **${s.posts}**`,
    `- Player actions logged: **${s.actions}**`,
    "",
    "Pay the dealer. See you next month!",
    ""
  ].join("\n");
}

async function main() {
  const argv = await yargs(hideBin(process.argv))
    .option("table", { type: "string", demandOption: true })
    .option("session", { type: "string", demandOption: true })
    .parse();

  const tableId = argv.table;
  const sessionId = argv.session;

  const logFile = path.join(process.cwd(), "data", "sessions", tableId, `${sessionId}.jsonl`);
  if (!fs.existsSync(logFile)) {
    console.error(`Log not found: ${logFile}`);
    process.exit(1);
  }

  const events = readJsonl(logFile);
  const s = summarize(events);
  const out = markdown(tableId, sessionId, s);

  const outPath = path.join(process.cwd(), "data", "sessions", tableId, `${sessionId}.recap.md`);
  fs.writeFileSync(outPath, out, "utf-8");
  console.log(`Wrote recap: ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
