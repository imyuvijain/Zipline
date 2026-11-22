// Voice catch-up calls (SPEC §2b). Registered by index.ts when this file exists.
//   POST /assign            manager assigns work -> assignment brief -> incoming_call to `to`
//   POST /brief             BriefRequest -> BriefResponse (script + spoken + sources)
//   GET  /brief/:id         the stored BriefResponse (the web needs the script after an incoming_call)
//   GET  /brief/:id/audio   ElevenLabs TTS of the spoken text (eleven_flash_v2_5, mp3), generated once then replayed
//   GET  /tasks?user=X      assignments to X, newest first ("Today's tasks")
//   POST /tasks             same as /assign;  POST /tasks/:id/done  marks one done
// Script: deterministic template over the DB, only what is relevant to the listener, <=120 words.
// `script` keeps exact paths for display; `spoken` (toSpoken) is what the voice reads.
// Mock mode: no ELEVENLABS_API_KEY -> /audio is 503 and the web falls back to speechSynthesis.
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { posix } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import type { Assignment, BriefKind, BriefRequest, BriefResponse, ServerToScout, Source, UserId } from "../../shared/types.ts";
import * as db from "./db.ts";
import * as hub from "./hub.ts";
import { displayArea, overlaps } from "./areas.ts";
import { toSpoken } from "./spoken.ts";

const EL_KEY = process.env.ELEVENLABS_API_KEY;
const EL_VOICE = process.env.ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb"; // public premade voice ("George")
const EL_MODEL = "eleven_flash_v2_5";
const EL_AGENT = process.env.ELEVENLABS_AGENT_ID;
const OVERDUE_MIN = Number(process.env.OVERDUE_MIN ?? 20);
const MAX_WORDS = 120;
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

console.log(`[brief] script: relevance-filtered template over DB data (display script + spoken text)`);
console.log(`[brief] talk-back agent: ${EL_AGENT && EL_KEY ? EL_AGENT : "none (calls play TTS only)"}`);
console.log(`[brief] voice: ${EL_KEY ? `ElevenLabs ${EL_MODEL}, voice ${EL_VOICE}` : "MOCK (no ELEVENLABS_API_KEY: /audio returns 503, web uses speechSynthesis)"}`);

const teamJson = JSON.parse(readFileSync(new URL("../../shared/team.json", import.meta.url), "utf8")) as { manager?: string };
const MANAGER: UserId = teamJson.manager ?? "yuvi";
void MANAGER;

const nameOf = (u: string) => db.getUser(u)?.name ?? u.charAt(0).toUpperCase() + u.slice(1);
const cutoffIso = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const firstSentence = (t: string) => (t.match(/^.*?[.!?](\s|$)/)?.[0] ?? t).trim();
const sentence = (t: string) => { const s = t.replace(/\s+/g, " ").trim(); return s.charAt(0).toUpperCase() + s.slice(1).replace(/([^.!?"])$/, "$1."); };
const unprefix = (t: string) => t.replace(/^\w+:\s*/, "").replace(/[.!?]+$/, "");

// ---------- storage ----------
try { db.db.exec(`ALTER TABLE briefs ADD COLUMN spoken TEXT`); } catch { /* already there */ }

type BriefOut = BriefResponse & { spoken: string };
interface BriefRow { id: string; for: string; kind: BriefKind; script: string; spoken: string | null; sources: string; audio: Uint8Array | null; at: string }

function saveBrief(forUser: string, kind: BriefKind, script: string, sources: Source[], assignmentId?: string): BriefOut {
  const id = randomUUID();
  const spoken = toSpoken(script);
  db.db.prepare(`INSERT INTO briefs (id, "for", kind, script, spoken, sources, assignment_id, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, forUser, kind, script, spoken, JSON.stringify(sources), assignmentId ?? null, new Date().toISOString(),
  );
  return { id, kind, script, spoken, sources, audioUrl: `/brief/${id}/audio` };
}

const getBrief = (id: string) => db.db.prepare(`SELECT * FROM briefs WHERE id = ?`).get(id) as BriefRow | undefined;
const spokenOf = (r: BriefRow) => r.spoken ?? toSpoken(r.script);
const toResponse = (r: BriefRow): BriefOut => ({ id: r.id, kind: r.kind, script: r.script, spoken: spokenOf(r), sources: JSON.parse(r.sources), audioUrl: `/brief/${r.id}/audio` });

const ASSIGN_COLS = `a.id, a."from", a."to", a.text, a.status, a.at`;
function getAssignment(id: string): Assignment | undefined {
  return db.db.prepare(`SELECT ${ASSIGN_COLS} FROM assignments a WHERE a.id = ?`).get(id) as Assignment | undefined;
}
function openAssignments(team: string): Assignment[] {
  return db.db.prepare(
    `SELECT ${ASSIGN_COLS} FROM assignments a JOIN users u ON u.user = a."to"
     WHERE u.team = ? AND a.status = 'open' ORDER BY a.at DESC LIMIT 10`,
  ).all(team) as unknown as Assignment[];
}

// ---------- relevance: files, path prefixes, imports ----------
const norm = (f: string) => f.replace(/\\/g, "/").replace(/^file:/, "").replace(/^\.\//, "").trim();
const noExt = (f: string) => f.replace(/\.(tsx?|jsx?|mjs|cjs)$/, "").toLowerCase();
const PATH_RE = /(?<![\w/])(?:[\w.-]+\/)+[\w.-]+\.\w+/g;

/** Files a user is on: claim.files, file: refs, and paths named in their latest summary. Newest info only. */
function filesOf(user: string): string[] {
  const claim = db.latestClaim(user);
  const sum = db.latestSummary(user);
  const out = new Set<string>();
  for (const f of claim?.files ?? []) out.add(norm(f));
  for (const r of sum?.refs ?? []) if (r.startsWith("file:")) out.add(norm(r));
  for (const m of sum?.text.match(PATH_RE) ?? []) out.add(norm(m));
  return [...out].filter(Boolean);
}

/** Shared leading path segments (2+ = same neighbourhood, e.g. server/src/a.ts vs server/src/b.ts). */
function prefixLen(a: string, b: string): number {
  const A = a.toLowerCase().split("/"), B = b.toLowerCase().split("/");
  let i = 0;
  while (i < A.length && i < B.length && A[i] === B[i]) i++;
  return i;
}

const importCache = new Map<string, Set<string>>();
/** Repo-relative, extensionless targets of a file's relative imports (read from this checkout). */
function importsOf(rel: string): Set<string> {
  const hit = importCache.get(rel);
  if (hit) return hit;
  const out = new Set<string>();
  try {
    const src = readFileSync(posix.join(REPO_ROOT, rel), "utf8");
    for (const m of src.matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)) out.add(noExt(posix.normalize(posix.join(posix.dirname(rel), m[1]))));
  } catch { /* not in this checkout */ }
  importCache.set(rel, out);
  return out;
}

const areaFileCache = new Map<string, string[]>();
/** Source files under a repo area's folder in this checkout (bounded walk). */
function areaFiles(area: string | undefined): string[] {
  if (!area || !area.startsWith("repo:")) return [];
  const dir = displayArea(area);
  const cached = areaFileCache.get(dir);
  if (cached) return cached;
  const out: string[] = [];
  const walk = (rel: string, depth: number) => {
    if (out.length >= 300 || depth > 4) return;
    let names: string[] = [];
    try { names = readdirSync(posix.join(REPO_ROOT, rel)); } catch { return; }
    for (const n of names) {
      if (n === "node_modules" || n === "dist" || n.startsWith(".")) continue;
      const p = posix.join(rel, n);
      try {
        if (statSync(posix.join(REPO_ROOT, p)).isDirectory()) walk(p, depth + 1);
        else if (/\.(tsx?|jsx?|mjs)$/.test(n)) out.push(p);
      } catch { /* skip */ }
    }
  };
  if (dir && !dir.includes("..") && existsSync(posix.join(REPO_ROOT, dir))) walk(dir, 0);
  areaFileCache.set(dir, out);
  return out;
}

/** First file in `targets` that something in `importers` imports, with the importer. */
function importLink(importers: string[], targets: string[]): { target: string; importer: string } | undefined {
  for (const t of targets) {
    const key = noExt(t);
    const importer = importers.find((f) => noExt(f) !== key && importsOf(f).has(key));
    if (importer) return { target: t, importer };
  }
  return undefined;
}

// ---------- hits: one line each, scored by how much it matters to the listener ----------
interface Hit { score: number; line: string; source: Source; action?: string; who?: string }

function relevantHits(forUser: string, sinceMin: number, skipAssignment?: string): Hit[] {
  const me = db.ensureUser(forUser);
  const myClaim = db.latestClaim(forUser);
  const myArea = myClaim?.area;
  const myFiles = filesOf(forUser);
  const myAreaFiles = areaFiles(myArea);
  const cutoff = cutoffIso(sinceMin);
  const hits: Hit[] = [];
  const team = db.teamUsers(me.team).filter((u) => u.user !== forUser);
  const inMyArea = (area: string, files: string[] = []) =>
    (!!myArea && (area === myArea || overlaps(area, myArea))) || files.some((f) => myFiles.some((m) => prefixLen(f, m) >= 2));

  // Collisions involving me.
  for (const o of db.recentOverlaps(me.team).filter((o) => o.at >= cutoff && o.verdict !== "different" && o.users.includes(forUser))) {
    const other = nameOf(o.users[0] === forUser ? o.users[1] : o.users[0]);
    hits.push({ score: 100, who: other, line: `You and ${other} are both in ${displayArea(o.area)}, and Zipline flagged it: ${o.reason}.`, source: { label: `overlap ${displayArea(o.area)}`, ageSec: db.ageSec(o.at) } });
  }

  // Assignments to or from me.
  for (const a of openAssignments(me.team)) {
    if (a.id === skipAssignment) continue;
    const min = Math.round(db.ageSec(a.at) / 60);
    if (a.to === forUser) hits.push({ score: 90, who: nameOf(a.from), line: `${nameOf(a.from)} asked you to ${unprefix(a.text)}.`, source: { label: `assignment from ${nameOf(a.from)}`, ageSec: db.ageSec(a.at) } });
    else if (a.from === forUser) hits.push({ score: 85, who: nameOf(a.to), line: `Your ask to ${nameOf(a.to)}, "${unprefix(a.text)}", is still open${min >= OVERDUE_MIN ? ` after ${min} minutes` : ""}.`, source: { label: `assignment ${nameOf(a.to)}`, ageSec: db.ageSec(a.at) } });
  }

  // Fails in my area (or on my files).
  for (const f of db.recentFails(sinceMin)) {
    if (f.user === forUser) continue;
    const u = db.getUser(f.user);
    if (!u || u.team !== me.team) continue;
    const named = f.text.match(PATH_RE)?.map(norm) ?? [];
    if (!inMyArea(f.area, [...named, ...filesOf(f.user)])) continue;
    hits.push({ score: 80, who: u.name, line: `${u.name} is stuck in ${displayArea(f.area)}, your area: ${f.text.replace(/[.!?]$/, "")}.`, source: { label: `fail ${u.name}`, ageSec: db.ageSec(f.at) } });
  }

  // Teammates whose files touch mine. Best single reason per person.
  for (const u of team) {
    const claim = db.latestClaim(u.user);
    const sum = db.latestSummary(u.user);
    const theirs = filesOf(u.user);
    const fresh = sum ? db.ageSec(sum.at) < 15 * 60 : false;
    const src: Source = sum ? { label: `${u.name}'s laptop`, ageSec: db.ageSec(sum.at) } : { label: `claim ${claim ? displayArea(claim.area) : u.name}`, ageSec: claim ? db.ageSec(claim.since) : 0 };
    const verb = fresh ? "just edited" : "has been editing";
    const same = theirs.find((f) => myFiles.some((m) => m.toLowerCase() === f.toLowerCase()));
    const theyFeedMe = importLink([...myFiles, ...myAreaFiles], theirs);
    const iFeedThem = importLink([...theirs, ...areaFiles(claim?.area)], myFiles);
    let hit: Hit | undefined;
    if (same) hit = { score: 70, line: `${u.name} ${verb} ${same}, which you're working on too.` } as Hit;
    else if (theyFeedMe) hit = { score: 65, line: `${u.name} ${verb} ${theyFeedMe.target}, and your ${theyFeedMe.importer} depends on it, so check in with ${u.name} before you build on it.` } as Hit;
    else if (iFeedThem) hit = { score: 55, line: `heads up, ${u.name}'s ${iFeedThem.importer} depends on ${iFeedThem.target}, which you're changing, so give ${u.name} a quick shout before you break it.` } as Hit;
    else if (claim && inMyArea(claim.area, theirs)) hit = { score: 40, line: `${u.name} is in your area too: ${sum ? firstSentence(sum.text) : `working in ${displayArea(claim.area)}.`}` } as Hit;
    if (hit) hits.push({ ...hit, who: u.name, source: src });
  }
  return hits.sort((a, b) => b.score - a.score);
}

/** Join sentences until the word budget runs out. */
function fit(parts: string[], max = MAX_WORDS): string {
  const out: string[] = [];
  let n = 0;
  for (const p of parts.filter(Boolean)) {
    const w = p.split(/\s+/).length;
    if (n + w > max && out.length) break;
    out.push(p);
    n += w;
  }
  return out.join(" ").split(/\s+/).slice(0, max).join(" ");
}

/** Keep one line per person (their highest-scoring), max `n`. */
function topHits(hits: Hit[], n: number): Hit[] {
  const seen = new Set<string>();
  const out: Hit[] = [];
  for (const h of hits) {
    const key = `${h.who}:${h.score >= 80 ? h.score : "rel"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
    if (out.length >= n) break;
  }
  return out;
}

// ---------- catchup ----------
function catchupBrief(forUser: string, sinceMin: number): { script: string; sources: Source[] } {
  const hits = topHits(relevantHits(forUser, sinceMin), 3);
  const name = nameOf(forUser);
  if (!hits.length) return { script: `Hi ${name}. Nothing from the team touches your work right now.`, sources: [] };
  return { script: fit([`Hi ${name}.`, ...hits.map((h) => sentence(h.line))]), sources: hits.map((h) => h.source) };
}

// ---------- assignment ----------
const STOP = new Set(["about", "after", "before", "their", "there", "these", "those", "which", "while", "should", "could", "would", "make", "sure", "today", "please"]);

function assignmentBrief(forUser: string, a: Assignment, sinceMin: number): { script: string; sources: Source[] } {
  const me = db.ensureUser(forUser);
  const intro = `Hi ${nameOf(forUser)}, ${nameOf(a.from)} has a task for you: ${unprefix(a.text)}.`;
  const hits = relevantHits(forUser, sinceMin, a.id).filter((h) => !h.line.startsWith(`${nameOf(a.from)} asked you`));
  // Teammates whose current work mentions what the task is about (endpoint, path, or a distinctive word).
  const keys = new Set(
    (a.text.toLowerCase().match(/[a-z][\w.-]{3,}/g) ?? []).map((k) => k.replace(/^\//, "")).filter((k) => !STOP.has(k)),
  );
  for (const w of a.text.match(/\/([a-z][\w-]*)/gi) ?? []) keys.add(w.slice(1).toLowerCase());
  for (const u of db.teamUsers(me.team)) {
    if (u.user === forUser || u.user === a.from) continue;
    const sum = db.latestSummary(u.user);
    const claim = db.latestClaim(u.user);
    const hay = `${sum?.text ?? ""} ${claim ? displayArea(claim.area) : ""} ${filesOf(u.user).join(" ")}`.toLowerCase();
    const k = [...keys].find((k) => k.length >= 4 && new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(hay));
    if (k && sum) hits.push({ score: 60, who: u.name, line: `${u.name} is working near it: ${firstSentence(sum.text)}`, source: { label: `${u.name}'s laptop`, ageSec: db.ageSec(sum.at) } });
  }
  const ctx = topHits(hits.sort((x, y) => y.score - x.score), 2);
  const sources: Source[] = [{ label: `assignment from ${nameOf(a.from)}`, ageSec: db.ageSec(a.at) }, ...ctx.map((h) => h.source)];
  const body = ctx.length ? ["Here's what matters for it.", ...ctx.map((h) => sentence(h.line))] : ["Nothing else on the team touches it right now."];
  return { script: fit([intro, ...body]), sources };
}

// ---------- manager digest: only what needs the manager ----------
function managerBrief(forUser: string, sinceMin: number): { script: string; sources: Source[] } {
  const me = db.ensureUser(forUser);
  const cutoff = cutoffIso(sinceMin);
  const lines: string[] = [];
  const sources: Source[] = [];
  let action: string | null = null;
  const teamOthers = db.teamUsers(me.team).filter((u) => u.user !== forUser);
  const ids = new Set(teamOthers.map((u) => u.user));

  const fails = db.recentFails(sinceMin).filter((f) => ids.has(f.user));
  const seenFail = new Set<string>();
  for (const f of fails) {
    if (seenFail.has(f.user)) continue;
    seenFail.add(f.user);
    lines.push(`${nameOf(f.user)} is stuck on ${displayArea(f.area)}: ${f.text.replace(/[.!?]$/, "")}.`);
    sources.push({ label: `fail ${nameOf(f.user)}`, ageSec: db.ageSec(f.at) });
    action ??= `unblock ${nameOf(f.user)} on ${displayArea(f.area)}`;
  }
  for (const o of db.recentOverlaps(me.team).filter((o) => o.at >= cutoff && o.verdict !== "different").slice(0, 2)) {
    const [a, b] = o.users.map(nameOf);
    lines.push(`${a} and ${b} are colliding in ${displayArea(o.area)}: ${o.reason.replace(/[.!?]$/, "")}.`);
    sources.push({ label: `overlap ${displayArea(o.area)}`, ageSec: db.ageSec(o.at) });
    action ??= `get ${a} and ${b} to split ${displayArea(o.area)}`;
  }
  for (const a of openAssignments(me.team).slice(0, 3)) {
    const min = Math.round(db.ageSec(a.at) / 60);
    const late = min >= OVERDUE_MIN;
    lines.push(late
      ? `${nameOf(a.to)} still hasn't finished "${unprefix(a.text)}", and it's been ${min} minutes.`
      : `${nameOf(a.to)} still has "${unprefix(a.text)}" open.`);
    sources.push({ label: `assignment ${nameOf(a.to)}`, ageSec: db.ageSec(a.at) });
    if (late) action ??= `check in with ${nameOf(a.to)} on ${unprefix(a.text)}`;
  }
  const idle = teamOthers.filter((u) => db.stateOf(u) === "idle").map((u) => u.name);
  const offline = teamOthers.filter((u) => db.stateOf(u) === "offline").map((u) => u.name);
  const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0]);
  if (idle.length) { lines.push(`${list(idle)} ${idle.length > 1 ? "have" : "has"} gone idle.`); action ??= `ping ${idle[0]}`; }
  if (offline.length) lines.push(`${list(offline)} ${offline.length > 1 ? "are" : "is"} offline.`);

  const close = action ? `My suggestion: ${action}.` : lines.length ? "Nothing is urgent, so let them keep going." : "Nothing needs you right now, so let them keep going.";
  const intro = `Hi ${me.name}, here's what needs you.`;
  const budget = MAX_WORDS - close.split(/\s+/).length;
  const script = lines.length ? `${fit([intro, ...lines], budget)} ${close}` : `Hi ${me.name}. ${close}`;
  return { script, sources };
}

export async function createBrief(req: BriefRequest): Promise<BriefOut> {
  const kind: BriefKind = (["assignment", "manager_digest", "catchup"] as const).includes(req.kind) ? req.kind : "catchup";
  const sinceMin = req.sinceMin ?? 30;
  const assignment = req.assignmentId ? getAssignment(req.assignmentId) : undefined;
  const b = kind === "manager_digest" ? managerBrief(req.for, sinceMin)
    : kind === "assignment" && assignment ? assignmentBrief(req.for, assignment, sinceMin)
    : catchupBrief(req.for, sinceMin);
  return saveBrief(req.for, kind, b.script, b.sources.slice(0, 8), assignment?.id);
}

// ---------- TTS ----------
const inflight = new Map<string, Promise<Buffer | null>>();

function ttsStream(text: string, normalize = true) {
  return fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(EL_VOICE)}/stream?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": EL_KEY!, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: EL_MODEL, ...(normalize ? { apply_text_normalization: "on" } : {}) }),
    signal: AbortSignal.timeout(30_000),
  });
}

// ---------- assignments (shared by /assign and POST /tasks) ----------
type AssignBody = Omit<Assignment, "id" | "at" | "status"> & { status?: Assignment["status"] };

async function assign(b: AssignBody) {
  const target = db.ensureUser(b.to);
  db.ensureUser(b.from);
  const assignment: Assignment = { id: randomUUID(), from: b.from, to: b.to, text: String(b.text).slice(0, 300), at: new Date().toISOString(), status: b.status === "done" ? "done" : "open" };
  db.db.prepare(`INSERT INTO assignments (id, "from", "to", text, status, at) VALUES (?, ?, ?, ?, ?, ?)`).run(
    assignment.id, assignment.from, assignment.to, assignment.text, assignment.status, assignment.at,
  );
  db.addFeed(target.team, "assign", `${nameOf(b.from)} → ${target.name}: ${assignment.text}`);
  const brief = await createBrief({ for: b.to, kind: "assignment", assignmentId: assignment.id });
  const msg: ServerToScout = { type: "incoming_call", briefId: brief.id, kind: "assignment", from: b.from, title: `${nameOf(b.from)} assigned you a task` };
  const delivered = hub.send(b.to, msg);
  db.addFeed(target.team, "brief", `Zipline called ${target.name} about ${nameOf(b.from)}'s ask`);
  return { ok: true, assignment, brief, delivered };
}

// ---------- routes ----------
export default async function briefRoutes(app: FastifyInstance) {
  const bad = (msg: string) => ({ ok: false, error: msg });

  const assignHandler = async (req: { body?: AssignBody }, reply: import("fastify").FastifyReply) => {
    const b = req.body;
    if (!b?.from || !b?.to || !b?.text) return reply.code(400).send(bad("from, to and text are required"));
    return assign(b);
  };
  app.post<{ Body: AssignBody }>("/assign", assignHandler);
  app.post<{ Body: AssignBody }>("/tasks", assignHandler);

  app.get<{ Querystring: { user?: string } }>("/tasks", async (req, reply) => {
    const user = req.query.user;
    if (!user) return reply.code(400).send(bad("user is required"));
    const tasks = db.db.prepare(`SELECT ${ASSIGN_COLS} FROM assignments a WHERE a."to" = ? ORDER BY a.at DESC LIMIT 100`).all(user) as unknown as Assignment[];
    return { tasks: tasks.map((t) => ({ id: t.id, from: t.from, to: t.to, text: t.text, status: t.status === "done" ? "done" : "open", at: t.at })) };
  });

  app.post<{ Params: { id: string } }>("/tasks/:id/done", async (req, reply) => {
    const r = db.db.prepare(`UPDATE assignments SET status = 'done' WHERE id = ?`).run(req.params.id);
    if (!Number(r.changes)) return reply.code(404).send(bad("no such task"));
    return { ok: true };
  });

  app.post<{ Body: BriefRequest & { ring?: boolean } }>("/brief", async (req, reply) => {
    if (!req.body?.for) return reply.code(400).send(bad("for is required"));
    const brief = await createBrief(req.body);
    // Optional: ring the user's web tabs + scout instead of opening the call directly (idle-return triggers).
    if (req.body.ring) {
      const title = brief.kind === "manager_digest" ? "Zipline is calling: your team digest" : "Zipline is calling: your catch-up";
      hub.send(req.body.for, { type: "incoming_call", briefId: brief.id, kind: brief.kind, from: "zipline", title });
    }
    return brief;
  });

  app.get<{ Params: { id: string } }>("/brief/:id", async (req, reply) => {
    const r = getBrief(req.params.id);
    return r ? toResponse(r) : reply.code(404).send(bad("no such brief"));
  });

  // Talk-back: a signed ElevenLabs Agent URL (the key stays here). `script` is the spoken text, because the web
  // passes it as overrides.agent.firstMessage; `displayScript` keeps the exact paths.
  app.get<{ Params: { id: string } }>("/brief/:id/agent-session", async (req, reply) => {
    const r = getBrief(req.params.id);
    if (!r) return reply.code(404).send(bad("no such brief"));
    if (!EL_KEY || !EL_AGENT) return reply.code(503).send(bad("ELEVENLABS_API_KEY / ELEVENLABS_AGENT_ID not set"));
    try {
      const res = await fetch(`https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(EL_AGENT)}`, {
        headers: { "xi-api-key": EL_KEY }, signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) return reply.code(502).send(bad(`ElevenLabs HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`));
      const { signed_url } = (await res.json()) as { signed_url: string };
      const spoken = spokenOf(r);
      return { signedUrl: signed_url, agentId: EL_AGENT, script: spoken, spoken, displayScript: r.script, kind: r.kind, for: r.for };
    } catch (err) {
      return reply.code(502).send(bad(`signed URL failed: ${(err as Error).message}`));
    }
  });

  app.get<{ Params: { id: string } }>("/brief/:id/audio", async (req, reply) => {
    const r = getBrief(req.params.id);
    if (!r) return reply.code(404).send(bad("no such brief"));
    if (r.audio && r.audio.byteLength) return reply.type("audio/mpeg").send(Buffer.from(r.audio));
    if (!EL_KEY) return reply.code(503).send({ ...bad("ELEVENLABS_API_KEY not set: use browser speech"), mock: true, script: r.script, spoken: spokenOf(r) });

    // Someone else is already generating this brief: wait for their bytes.
    const pending = inflight.get(r.id);
    if (pending) {
      const buf = await pending;
      return buf ? reply.type("audio/mpeg").send(buf) : reply.code(502).send(bad("TTS failed"));
    }

    let res: Response;
    try {
      res = await ttsStream(spokenOf(r));
      // Some plans reject apply_text_normalization on flash models: retry once without it.
      if (res.status === 400 || res.status === 422) {
        const detail = (await res.text().catch(() => "")).slice(0, 200);
        app.log.warn({ status: res.status, detail }, "elevenlabs rejected normalization, retrying without");
        res = await ttsStream(spokenOf(r), false);
      }
    } catch (err) {
      return reply.code(502).send(bad(`TTS request failed: ${(err as Error).message}`));
    }
    if (!res.ok || !res.body) {
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      app.log.warn({ status: res.status, detail }, "elevenlabs error");
      return reply.code(502).send(bad(`ElevenLabs HTTP ${res.status}: ${detail}`));
    }
    // Stream to the client while keeping the bytes, then cache them on the brief row.
    const chunks: Buffer[] = [];
    let done!: (b: Buffer | null) => void;
    inflight.set(r.id, new Promise((res) => (done = res)));
    const stream = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream<Uint8Array>);
    stream.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
    stream.on("end", () => {
      const buf = Buffer.concat(chunks);
      db.db.prepare(`UPDATE briefs SET audio = ? WHERE id = ?`).run(buf, r.id);
      inflight.delete(r.id);
      done(buf);
    });
    stream.on("error", () => { inflight.delete(r.id); done(null); });
    return reply.type("audio/mpeg").send(stream);
  });
}
