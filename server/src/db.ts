import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import type { Claim, FeedItem, SessionState, Summary } from "../../shared/types.ts";

export const DEFAULT_TEAM = process.env.MURMUR_TEAM ?? "team-murmur";
const ACTIVE_SEC = Number(process.env.ACTIVE_SEC ?? 45);
const IDLE_SEC = Number(process.env.IDLE_SEC ?? 300);

export const db = new DatabaseSync(process.env.DB_PATH ?? "murmur.db");

db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS users (
  user TEXT PRIMARY KEY, name TEXT NOT NULL, team TEXT NOT NULL,
  sim INTEGER NOT NULL DEFAULT 0, sim_state TEXT
);
CREATE TABLE IF NOT EXISTS sessions (user TEXT PRIMARY KEY, last_heartbeat TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user TEXT NOT NULL, area TEXT NOT NULL,
  branch TEXT, since TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS claims_user ON claims(user, id);
CREATE TABLE IF NOT EXISTS summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user TEXT NOT NULL, text TEXT NOT NULL,
  refs TEXT NOT NULL, at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS summaries_user ON summaries(user, id);
CREATE TABLE IF NOT EXISTS asks_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, asker TEXT NOT NULL, target TEXT NOT NULL,
  about TEXT, question TEXT NOT NULL, sent TEXT, answer TEXT, cached INTEGER NOT NULL DEFAULT 0, at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS asks_about ON asks_log(about, id);
CREATE TABLE IF NOT EXISTS fails (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user TEXT NOT NULL, area TEXT NOT NULL, text TEXT NOT NULL, at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS feed (
  id INTEGER PRIMARY KEY AUTOINCREMENT, team TEXT NOT NULL, at TEXT NOT NULL,
  kind TEXT NOT NULL, text TEXT NOT NULL, sim INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS mutes (pair TEXT PRIMARY KEY, until TEXT NOT NULL);
`);

export interface UserRow { user: string; name: string; team: string; sim: number; sim_state: string | null }

const now = () => new Date().toISOString();
export const ageSec = (iso: string) => Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));

// ---- users ----
export function upsertUser(user: string, name: string, team: string, sim = false, simState: SessionState | null = null) {
  db.prepare(
    `INSERT INTO users (user, name, team, sim, sim_state) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user) DO UPDATE SET name = excluded.name, team = excluded.team, sim = excluded.sim, sim_state = excluded.sim_state`,
  ).run(user, name, team, sim ? 1 : 0, simState);
}

export function getUser(user: string): UserRow | undefined {
  return db.prepare(`SELECT * FROM users WHERE user = ?`).get(user) as UserRow | undefined;
}

/** Unknown users (a scout someone started with a typo'd MURMUR_USER) get auto-registered on the default team. */
export function ensureUser(user: string): UserRow {
  const existing = getUser(user);
  if (existing) return existing;
  upsertUser(user, user.charAt(0).toUpperCase() + user.slice(1), DEFAULT_TEAM);
  return getUser(user)!;
}

export function allUsers(): UserRow[] {
  return db.prepare(`SELECT * FROM users`).all() as unknown as UserRow[];
}

export function teamUsers(team: string): UserRow[] {
  return db.prepare(`SELECT * FROM users WHERE team = ? ORDER BY sim, rowid`).all(team) as unknown as UserRow[];
}

export function allTeams(): { team: string; sim: boolean }[] {
  const rows = db.prepare(`SELECT team, MIN(sim) AS sim FROM users GROUP BY team ORDER BY MIN(sim), team`).all() as unknown as {
    team: string; sim: number;
  }[];
  return rows.map((r) => ({ team: r.team, sim: r.sim === 1 }));
}

export function loadTeamJson(path: URL) {
  const team = JSON.parse(readFileSync(path, "utf8")) as { team: string; members: { user: string; name: string }[] };
  for (const m of team.members) {
    const existing = getUser(m.user);
    if (!existing || existing.sim === 0) upsertUser(m.user, m.name, team.team);
  }
}

// ---- sessions / state ----
export function touch(user: string, at = now()) {
  db.prepare(
    `INSERT INTO sessions (user, last_heartbeat) VALUES (?, ?) ON CONFLICT(user) DO UPDATE SET last_heartbeat = excluded.last_heartbeat`,
  ).run(user, at);
}

export function lastHeartbeat(user: string): string | undefined {
  const r = db.prepare(`SELECT last_heartbeat FROM sessions WHERE user = ?`).get(user) as { last_heartbeat: string } | undefined;
  return r?.last_heartbeat;
}

export function stateOf(u: UserRow): SessionState {
  if (u.sim) return (u.sim_state as SessionState) ?? "active";
  const hb = lastHeartbeat(u.user);
  if (!hb) return "offline";
  const age = ageSec(hb);
  return age <= ACTIVE_SEC ? "active" : age <= IDLE_SEC ? "idle" : "offline";
}

// ---- claims ----
export function addClaim(c: Claim) {
  db.prepare(`INSERT INTO claims (user, area, branch, since, created_at) VALUES (?, ?, ?, ?, ?)`).run(
    c.user, c.area, c.branch ?? null, c.since ?? now(), now(),
  );
}

export function latestClaim(user: string): Claim | undefined {
  const r = db.prepare(`SELECT user, area, branch, since FROM claims WHERE user = ? ORDER BY id DESC LIMIT 1`).get(user) as
    | { user: string; area: string; branch: string | null; since: string }
    | undefined;
  return r ? { user: r.user, area: r.area, branch: r.branch ?? undefined, since: r.since } : undefined;
}

// ---- summaries ----
export function saveSummary(s: Summary) {
  db.prepare(`INSERT INTO summaries (user, text, refs, at) VALUES (?, ?, ?, ?)`).run(
    s.user, s.text.slice(0, 300), JSON.stringify(s.refs ?? []), s.at ?? now(),
  );
}

export function latestSummary(user: string): Summary | undefined {
  const r = db.prepare(`SELECT user, text, refs, at FROM summaries WHERE user = ? ORDER BY id DESC LIMIT 1`).get(user) as
    | { user: string; text: string; refs: string; at: string }
    | undefined;
  return r ? { user: r.user, text: r.text, refs: JSON.parse(r.refs), at: r.at } : undefined;
}

// ---- asks ----
export function logAsk(row: { asker: string; target: string; about?: string; question: string; sent?: string; answer: string; cached: boolean }) {
  db.prepare(
    `INSERT INTO asks_log (asker, target, about, question, sent, answer, cached, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(row.asker, row.target, row.about ?? null, row.question, row.sent ?? null, row.answer, row.cached ? 1 : 0, now());
}

export function asksAbout(user: string, limit = 50) {
  return db
    .prepare(`SELECT asker, target, question, sent, at FROM asks_log WHERE about = ? ORDER BY id DESC LIMIT ?`)
    .all(user, limit);
}

// ---- fails ----
export function addFail(user: string, area: string, text: string, at = now()) {
  db.prepare(`INSERT INTO fails (user, area, text, at) VALUES (?, ?, ?, ?)`).run(user, area, text.slice(0, 200), at);
}

export function recentFails(sinceMin = 120) {
  const cutoff = new Date(Date.now() - sinceMin * 60_000).toISOString();
  return db.prepare(`SELECT user, area, text, at FROM fails WHERE at >= ? ORDER BY id DESC`).all(cutoff) as unknown as {
    user: string; area: string; text: string; at: string;
  }[];
}

// ---- feed ----
export function addFeed(team: string, kind: FeedItem["kind"], text: string, sim = false, at = now()) {
  db.prepare(`INSERT INTO feed (team, at, kind, text, sim) VALUES (?, ?, ?, ?, ?)`).run(team, at, kind, text, sim ? 1 : 0);
}

export function teamFeed(team: string, limit = 30): FeedItem[] {
  const rows = db.prepare(`SELECT at, kind, text, sim FROM feed WHERE team = ? ORDER BY at DESC, id DESC LIMIT ?`).all(team, limit) as unknown as {
    at: string; kind: FeedItem["kind"]; text: string; sim: number;
  }[];
  return rows.map((r) => ({ at: r.at, kind: r.kind, text: r.text, ...(r.sim ? { sim: true } : {}) }));
}

// ---- collision mutes (1h per person pair) ----
export function isMuted(a: string, b: string): boolean {
  const r = db.prepare(`SELECT until FROM mutes WHERE pair = ?`).get([a, b].sort().join("|")) as { until: string } | undefined;
  return !!r && Date.parse(r.until) > Date.now();
}

export function mute(a: string, b: string, minutes = 60) {
  const until = new Date(Date.now() + minutes * 60_000).toISOString();
  db.prepare(`INSERT INTO mutes (pair, until) VALUES (?, ?) ON CONFLICT(pair) DO UPDATE SET until = excluded.until`).run(
    [a, b].sort().join("|"), until,
  );
}
