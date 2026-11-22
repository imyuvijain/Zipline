// Voice catch-up calls (SPEC §2b). Registered by index.ts when this file exists.
//   POST /assign            manager assigns work -> assignment brief -> incoming_call to `to`
//   POST /brief             BriefRequest -> BriefResponse (script + sources)
//   GET  /brief/:id         the stored BriefResponse (the web needs the script after an incoming_call)
//   GET  /brief/:id/audio   ElevenLabs TTS (eleven_flash_v2_5, mp3), generated once then replayed from the DB
// Script: deterministic template over the DB (summaries, claims, assignments, overlaps, fails), <=150 words.
// Mock mode: no ELEVENLABS_API_KEY -> /audio is 503 and the web falls back to speechSynthesis.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import type { Assignment, BriefKind, BriefRequest, BriefResponse, ServerToScout, Source, UserId } from "../../shared/types.ts";
import * as db from "./db.ts";
import * as hub from "./hub.ts";
import { displayArea } from "./areas.ts";
import { complete } from "./claude.ts";

const EL_KEY = process.env.ELEVENLABS_API_KEY;
const EL_VOICE = process.env.ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb"; // public premade voice ("George")
const EL_MODEL = "eleven_flash_v2_5";
const EL_AGENT = process.env.ELEVENLABS_AGENT_ID;
const OVERDUE_MIN = Number(process.env.OVERDUE_MIN ?? 20);

console.log(`[brief] script: ${process.env.LLM_URL ? "manager review via LLM_URL (template fallback)" : "template over DB data"}`);
console.log(`[brief] talk-back agent: ${EL_AGENT && EL_KEY ? EL_AGENT : "none (manager review plays TTS only)"}`);
console.log(`[brief] voice: ${EL_KEY ? `ElevenLabs ${EL_MODEL}, voice ${EL_VOICE}` : "MOCK (no ELEVENLABS_API_KEY: /audio returns 503, web uses speechSynthesis)"}`);

const teamJson = JSON.parse(readFileSync(new URL("../../shared/team.json", import.meta.url), "utf8")) as { manager?: string };
const MANAGER: UserId = teamJson.manager ?? "yuvi";

const nameOf = (u: string) => db.getUser(u)?.name ?? u.charAt(0).toUpperCase() + u.slice(1);
const cutoffIso = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const firstSentence = (t: string) => (t.match(/^.*?[.!?](\s|$)/)?.[0] ?? t).trim();

// ---------- storage (tables already exist in db.ts) ----------
interface BriefRow { id: string; for: string; kind: BriefKind; script: string; sources: string; audio: Uint8Array | null; at: string }

function saveBrief(forUser: string, kind: BriefKind, script: string, sources: Source[], assignmentId?: string): BriefResponse {
  const id = randomUUID();
  db.db.prepare(`INSERT INTO briefs (id, "for", kind, script, sources, assignment_id, at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    id, forUser, kind, script, JSON.stringify(sources), assignmentId ?? null, new Date().toISOString(),
  );
  return { id, kind, script, sources, audioUrl: `/brief/${id}/audio` };
}

const getBrief = (id: string) => db.db.prepare(`SELECT * FROM briefs WHERE id = ?`).get(id) as BriefRow | undefined;
const toResponse = (r: BriefRow): BriefResponse => ({ id: r.id, kind: r.kind, script: r.script, sources: JSON.parse(r.sources), audioUrl: `/brief/${r.id}/audio` });

function getAssignment(id: string): Assignment | undefined {
  return db.db.prepare(`SELECT id, "from", "to", text, status, at FROM assignments WHERE id = ?`).get(id) as Assignment | undefined;
}
function openAssignments(team: string): Assignment[] {
  return db.db.prepare(
    `SELECT a.id, a."from", a."to", a.text, a.status, a.at FROM assignments a JOIN users u ON u.user = a."to"
     WHERE u.team = ? AND a.status = 'open' ORDER BY a.at DESC LIMIT 10`,
  ).all(team) as unknown as Assignment[];
}

// ---------- context gathering ----------
interface Ctx { notes: string[]; sources: Source[]; facts: { who: string; line: string; mine?: boolean }[] }

function gather(forUser: string, kind: BriefKind, sinceMin: number): Ctx {
  const me = db.ensureUser(forUser);
  const myArea = db.latestClaim(forUser)?.area;
  const cutoff = cutoffIso(sinceMin);
  const ctx: Ctx = { notes: [], sources: [], facts: [] };
  const others = db.teamUsers(me.team).filter((u) => u.user !== forUser);

  for (const u of others) {
    const claim = db.latestClaim(u.user);
    const sum = db.latestSummary(u.user);
    const area = claim ? displayArea(claim.area) : undefined;
    const mine = !!(myArea && claim && claim.area === myArea);
    if (sum) {
      const age = db.ageSec(sum.at);
      ctx.notes.push(`${u.name} (${Math.round(age / 60)} min ago${area ? `, in ${area}` : ""}): ${sum.text}${sum.refs.length ? ` [refs: ${sum.refs.join(", ")}]` : ""}`);
      ctx.sources.push({ label: `${u.name}'s laptop`, ageSec: age });
      ctx.facts.push({ who: u.name, line: firstSentence(sum.text), mine });
    } else if (claim) {
      ctx.notes.push(`${u.name} is working in ${area}${claim.files?.length ? ` (files: ${claim.files.join(", ")})` : ""}`);
      ctx.sources.push({ label: `claim ${area}`, ageSec: db.ageSec(claim.since) });
      ctx.facts.push({ who: u.name, line: `${u.name} is in ${area}${claim.files?.[0] ? `, touching ${claim.files[0]}` : ""}.`, mine });
    }
  }

  for (const f of db.recentFails(sinceMin)) {
    const u = db.getUser(f.user);
    if (!u || u.team !== me.team) continue;
    ctx.notes.push(`FAILED (${nameOf(f.user)}, ${displayArea(f.area)}): ${f.text}`);
    ctx.sources.push({ label: `fail ${nameOf(f.user)}`, ageSec: db.ageSec(f.at) });
    ctx.facts.push({ who: nameOf(f.user), line: `${nameOf(f.user)} hit a wall in ${displayArea(f.area)}: ${f.text}`, mine: myArea === f.area });
  }

  for (const o of db.recentOverlaps(me.team).filter((o) => o.at >= cutoff && o.verdict !== "different")) {
    const [a, b] = o.users.map(nameOf);
    ctx.notes.push(`OVERLAP (${o.verdict}): ${a} and ${b} in ${displayArea(o.area)}: ${o.reason}`);
    ctx.sources.push({ label: `overlap ${displayArea(o.area)}`, ageSec: db.ageSec(o.at) });
    ctx.facts.push({ who: a, line: `${a} and ${b} are both in ${displayArea(o.area)}, and Zipline flagged it.`, mine: o.users.includes(forUser) });
  }

  if (kind !== "assignment") {
    for (const a of openAssignments(me.team)) {
      if (kind === "catchup" && a.to !== forUser) continue;
      ctx.notes.push(`OPEN ASSIGNMENT from ${nameOf(a.from)} to ${nameOf(a.to)}: ${a.text}`);
      ctx.sources.push({ label: `assignment ${nameOf(a.to)}`, ageSec: db.ageSec(a.at) });
      ctx.facts.push({ who: nameOf(a.to), line: `${nameOf(a.from)} asked ${a.to === forUser ? "you" : nameOf(a.to)} to ${a.text.replace(/^\w+:\s*/, "")}.`, mine: a.to === forUser });
    }
  }
  // Mine first, so the catch-up leads with what touches your area.
  ctx.facts.sort((x, y) => Number(!!y.mine) - Number(!!x.mine));
  return ctx;
}

// ---------- script ----------
function templateScript(kind: BriefKind, listener: string, ctx: Ctx, assignment?: Assignment): string {
  const lines = ctx.facts.slice(0, 5).map((f) => f.line.replace(/\s+/g, " ").trim().replace(/([^.!?])$/, "$1."));
  let open: string;
  if (kind === "assignment" && assignment) open = `Hi ${listener}, ${nameOf(assignment.from)} has a task for you: ${assignment.text.replace(/[.!?]?$/, ".")}`;
  else if (kind === "manager_digest") open = `Hi ${listener}, here's your team in the last half hour.`;
  else open = `Hi ${listener}, here's what you missed.`;
  const ctxIntro = kind === "assignment" && lines.length ? "Here's the context around it." : "";
  const body = lines.length ? lines.join(" ") : "It's been quiet: no new updates from the team.";
  const words = [open, ctxIntro, body, "That's it."].filter(Boolean).join(" ").split(/\s+/);
  return words.slice(0, 150).join(" ");
}


// ---------- manager review (manager_digest) ----------
// Per teammate: what they're on, blockers/fails, collisions, overdue assignments; then one suggested action.
interface Review { script: string; notes: string; sources: Source[] }

function managerReview(forUser: string, sinceMin: number): Review {
  const me = db.ensureUser(forUser);
  const cutoff = cutoffIso(sinceMin);
  const sources: Source[] = [];
  const notes: string[] = [];
  const said: string[] = [];
  const fails = db.recentFails(sinceMin);
  const overlapsNow = db.recentOverlaps(me.team).filter((o) => o.at >= cutoff && o.verdict !== "different");
  const open = openAssignments(me.team);
  let action: string | null = null;

  for (const u of db.teamUsers(me.team).filter((x) => x.user !== forUser)) {
    const claim = db.latestClaim(u.user);
    const sum = db.latestSummary(u.user);
    const area = claim ? displayArea(claim.area) : undefined;
    const parts: string[] = [];
    if (sum) {
      parts.push(firstSentence(sum.text).replace(/[.!?]$/, ""));
      sources.push({ label: `${u.name}'s laptop`, ageSec: db.ageSec(sum.at) });
    } else if (claim && area) {
      parts.push(`${u.name} is on ${area}${claim.files?.[0] ? `, in ${claim.files[0]}` : ""}`);
      sources.push({ label: `claim ${area}`, ageSec: db.ageSec(claim.since) });
    } else continue;
    const f = fails.find((x) => x.user === u.user);
    if (f) {
      parts.push(`blocked: ${f.text.replace(/[.!?]$/, "")}`);
      sources.push({ label: `fail ${u.name}`, ageSec: db.ageSec(f.at) });
      action ??= `unblock ${u.name} on ${displayArea(f.area)}`;
    }
    const o = overlapsNow.find((x) => x.users[1] === u.user);
    if (o) {
      const other = nameOf(o.users[0]);
      parts.push(`colliding with ${other} in ${displayArea(o.area)}`);
      sources.push({ label: `overlap ${displayArea(o.area)}`, ageSec: db.ageSec(o.at) });
      action ??= `get ${u.name} and ${other} to split ${displayArea(o.area)}`;
    }
    const late = open.find((a) => a.to === u.user && db.ageSec(a.at) > OVERDUE_MIN * 60);
    if (late) {
      parts.push(`your ask "${late.text}" is still open after ${Math.round(db.ageSec(late.at) / 60)} minutes`);
      sources.push({ label: `assignment ${u.name}`, ageSec: db.ageSec(late.at) });
      action ??= `check in with ${u.name} on ${late.text}`;
    }
    const line = parts.join("; ") + ".";
    said.push(line.charAt(0).toUpperCase() + line.slice(1));
    notes.push(`${u.name}${area ? ` (${area})` : ""}: ${sum ? sum.text : parts[0]}${f ? ` | FAIL: ${f.text}` : ""}${o ? ` | OVERLAP with ${nameOf(o.users[0])}: ${o.reason}` : ""}${late ? ` | OVERDUE ASSIGNMENT (${Math.round(db.ageSec(late.at) / 60)} min): ${late.text}` : ""}`);
  }
  for (const a of open.filter((a) => db.ageSec(a.at) <= OVERDUE_MIN * 60)) notes.push(`Open assignment for ${nameOf(a.to)}: ${a.text}`);

  const words = [
    `Hi ${me.name}, here's your team review.`,
    ...(said.length ? said : ["No updates from the team yet."]),
    action ? `My suggestion: ${action}.` : "Nothing needs you right now.",
  ].join(" ").split(/\s+/);
  return { script: words.slice(0, 150).join(" "), notes: notes.join("\n"), sources };
}

const REVIEW_SYSTEM = `You write the spoken script for a short voice call in which Zipline reviews a software team for their manager.
At most 150 words, plain spoken English, no markdown, no lists, no emojis. Address the manager as "you".
Go teammate by teammate: what they are on (name real files or areas), any blocker or failure, any collision with a teammate, any overdue assignment.
Finish with exactly one suggested action for the manager. Never invent anything that is not in the notes.`;

/** Local LLM (LLM_URL, via claude.ts's hosted-model path) first; template on unset/failure. Never Anthropic. */
async function managerScript(forUser: string, sinceMin: number): Promise<{ script: string; sources: Source[] }> {
  const r = managerReview(forUser, sinceMin);
  if (process.env.LLM_URL && r.notes) {
    const text = await complete(REVIEW_SYSTEM, `Manager: ${nameOf(forUser)}\nTeam notes:\n${r.notes}`, { maxTokens: 350 });
    if (text) return { script: text.replace(/[*#_`]/g, "").split(/\s+/).slice(0, 160).join(" "), sources: r.sources };
  }
  return { script: r.script, sources: r.sources };
}

export async function createBrief(req: BriefRequest): Promise<BriefResponse> {
  const kind: BriefKind = (["assignment", "manager_digest", "catchup"] as const).includes(req.kind) ? req.kind : "catchup";
  const assignment = req.assignmentId ? getAssignment(req.assignmentId) : undefined;
  if (kind === "manager_digest") {
    const m = await managerScript(req.for, req.sinceMin ?? 30);
    return saveBrief(req.for, kind, m.script, m.sources.slice(0, 8));
  }
  const ctx = gather(req.for, kind, req.sinceMin ?? 30);
  if (assignment) ctx.sources.unshift({ label: `assignment from ${nameOf(assignment.from)}`, ageSec: db.ageSec(assignment.at) });
  const script = templateScript(kind, nameOf(req.for), ctx, assignment);
  return saveBrief(req.for, kind, script, ctx.sources.slice(0, 8), assignment?.id);
}

// ---------- TTS ----------
const inflight = new Map<string, Promise<Buffer | null>>();

function ttsStream(text: string) {
  return fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(EL_VOICE)}/stream?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": EL_KEY!, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: EL_MODEL }),
    signal: AbortSignal.timeout(30_000),
  });
}

// ---------- routes ----------
export default async function briefRoutes(app: FastifyInstance) {
  const bad = (msg: string) => ({ ok: false, error: msg });

  app.post<{ Body: Omit<Assignment, "id" | "at" | "status"> & { status?: Assignment["status"] } }>("/assign", async (req, reply) => {
    const b = req.body;
    if (!b?.from || !b?.to || !b?.text) return reply.code(400).send(bad("from, to and text are required"));
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

  // Talk-back: a signed ElevenLabs Agent URL (the key stays here) plus the script for overrides.agent.firstMessage.
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
      return { signedUrl: signed_url, agentId: EL_AGENT, script: r.script, kind: r.kind, for: r.for };
    } catch (err) {
      return reply.code(502).send(bad(`signed URL failed: ${(err as Error).message}`));
    }
  });

  app.get<{ Params: { id: string } }>("/brief/:id/audio", async (req, reply) => {
    const r = getBrief(req.params.id);
    if (!r) return reply.code(404).send(bad("no such brief"));
    if (r.audio && r.audio.byteLength) return reply.type("audio/mpeg").send(Buffer.from(r.audio));
    if (!EL_KEY) return reply.code(503).send({ ...bad("ELEVENLABS_API_KEY not set: use browser speech"), mock: true, script: r.script });

    // Someone else is already generating this brief: wait for their bytes.
    const pending = inflight.get(r.id);
    if (pending) {
      const buf = await pending;
      return buf ? reply.type("audio/mpeg").send(buf) : reply.code(502).send(bad("TTS failed"));
    }

    let res: Response;
    try {
      res = await ttsStream(r.script);
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
