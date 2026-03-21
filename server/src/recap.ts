import fs from "node:fs";
import path from "node:path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

export type LogEvent = { ts: number; type: string; tableId: string; sessionId: string; payload?: any };

export function readJsonl(p: string): LogEvent[] {
  const lines = fs.readFileSync(p, "utf-8").split(/\r?\n/).filter(Boolean);
  return lines.map(l => JSON.parse(l));
}

export type PlayerStat = {
  id: string;
  name: string;
  handsPlayed: number;
  potsWon: number;
  chipsWon: number;
  finalStack?: number;
};

export type BiggestPot = {
  amount: number;
  winnerNames: string[];
  handNumber: number;
};

export type AllInMoment = {
  playerName: string;
  street: string;
  amount?: number;
  handNumber: number;
};

export function summarize(events: LogEvent[]) {
  const started = events.find(e => e.type === "SESSION_STARTED")?.ts;
  const ended = events.find(e => e.type === "SESSION_ENDED")?.ts;

  const joins = events.filter(e => e.type === "PLAYER_JOINED").map(e => e.payload?.name).filter(Boolean);
  const hands = events.filter(e => e.type === "HAND_STARTED").length;
  const actions = events.filter(e => e.type === "ACTION").length;
  const posts = events.filter(e => e.type === "POST").length;

  const durationMin = started && ended ? Math.round((ended - started) / 60000) : undefined;

  // Build player name map
  const nameMap = new Map<string, string>();
  for (const e of events) {
    if (e.type === "PLAYER_JOINED" && e.payload?.id && e.payload?.name) {
      nameMap.set(e.payload.id, e.payload.name);
    }
  }

  // Final stacks from STACKS_SNAPSHOT
  const finalStacks = new Map<string, number>();
  const snapshot = events.find(e => e.type === "STACKS_SNAPSHOT");
  if (snapshot?.payload?.stacks) {
    for (const s of snapshot.payload.stacks) {
      finalStacks.set(s.id, s.stack);
      if (!nameMap.has(s.id)) nameMap.set(s.id, s.name);
    }
  }

  // Per-player stats
  const statsMap = new Map<string, PlayerStat>();
  const getOrCreate = (id: string): PlayerStat => {
    if (!statsMap.has(id)) {
      statsMap.set(id, { id, name: nameMap.get(id) ?? id, handsPlayed: 0, potsWon: 0, chipsWon: 0 });
    }
    return statsMap.get(id)!;
  };

  // Track which players appeared in each hand (via POST or ACTION), and detect all-in moments
  const handPlayers = new Map<number, Set<string>>();
  const allIns: AllInMoment[] = [];
  let currentHand = 0;
  for (const e of events) {
    if (e.type === "HAND_STARTED") currentHand = e.payload?.handNumber ?? currentHand;
    if ((e.type === "POST" || e.type === "ACTION") && e.payload?.playerId) {
      if (!handPlayers.has(currentHand)) handPlayers.set(currentHand, new Set());
      handPlayers.get(currentHand)!.add(e.payload.playerId);
    }
    if (e.payload?.allIn && e.payload.playerId) {
      allIns.push({
        playerName: nameMap.get(e.payload.playerId) ?? e.payload.playerId,
        street: e.type === "POST" ? "PREFLOP" : (e.payload.street ?? "PREFLOP"),
        amount: e.payload.to ?? e.payload.amount,
        handNumber: currentHand,
      });
    }
  }
  for (const players of handPlayers.values()) {
    for (const id of players) getOrCreate(id).handsPlayed++;
  }

  // Pot awards
  let biggestPot: BiggestPot | null = null;
  for (const e of events) {
    if (e.type === "POT_AWARDED" && e.payload) {
      const { winnerIds, amount, potIndex } = e.payload;
      if (!winnerIds || !amount) continue;
      const handNum: number = e.payload.handNumber ?? 0;
      // For split pots, credit each winner their share
      const share = Math.floor(amount / winnerIds.length);
      for (const wid of winnerIds) {
        const stat = getOrCreate(wid);
        if (potIndex === 0) stat.potsWon++; // count main pot only to avoid double-counting
        stat.chipsWon += share;
      }
      if (!biggestPot || amount > biggestPot.amount) {
        biggestPot = { amount, winnerNames: winnerIds.map((id: string) => nameMap.get(id) ?? id), handNumber: handNum };
      }
    }
    if (e.type === "HAND_WON_UNCONTESTED" && e.payload) {
      const { winnerId, amount } = e.payload;
      if (!winnerId || !amount) continue;
      const stat = getOrCreate(winnerId);
      stat.potsWon++;
      stat.chipsWon += amount;
      if (!biggestPot || amount > biggestPot.amount) {
        biggestPot = { amount, winnerNames: [nameMap.get(winnerId) ?? winnerId], handNumber: e.payload.handNumber ?? 0 };
      }
    }
  }

  // Apply final stacks and find knockouts
  for (const [id, stack] of finalStacks) {
    getOrCreate(id).finalStack = stack;
  }
  const knockouts = [...statsMap.values()].filter(s => s.finalStack === 0).map(s => s.name);

  const playerStats = [...statsMap.values()].sort((a, b) => b.chipsWon - a.chipsWon);

  return { started, ended, durationMin, joins, hands, actions, posts, playerStats, biggestPot, knockouts, allIns };
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

// Only run CLI when this file is the entry point
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (isMain) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
