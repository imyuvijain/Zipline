import "./env.ts";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import type { Board, Claim, FailEntry, ServerToScout } from "../../shared/types.ts";
import * as db from "./db.ts";
import * as hub from "./hub.ts";
import { handleAsk } from "./ask.ts";
import { displayArea, overlaps, ago } from "./areas.ts";
import { applySeed, seedSampleIfEmpty, type SeedBody } from "./sim-seed.ts";

const PORT = Number(process.env.PORT ?? 8787);

db.loadTeamJson(new URL("../../shared/team.json", import.meta.url));
seedSampleIfEmpty();

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
await app.register(cors, { origin: true });
await app.register(websocket);

const bad = (msg: string) => ({ ok: false, error: msg });

// ---------- health ----------
app.get("/health", async () => ({ ok: true, online: hub.onlineUsers(), teams: db.allTeams() }));

// ---------- claims + collision check ----------
app.post<{ Body: Claim }>("/claim", async (req, reply) => {
  const c = req.body;
  if (!c?.user || !c?.area) return reply.code(400).send(bad("user and area are required"));
  const me = db.ensureUser(c.user);
  const prev = db.latestClaim(c.user);
  db.touch(c.user);
  const claim: Claim = { user: c.user, area: c.area, branch: c.branch, since: c.since ?? new Date().toISOString() };
  db.addClaim(claim);
  if (prev?.area !== c.area) db.addFeed(me.team, "claim", `${me.name} is in ${displayArea(c.area)}`);

  const alerts: ServerToScout[] = [];

  // Collision: someone else (not offline) already has an overlapping area. Alert the NEW claimer only.
  for (const other of db.allUsers()) {
    if (other.user === c.user) continue;
    const theirs = db.latestClaim(other.user);
    if (!theirs || !overlaps(theirs.area, c.area)) continue;
    if (db.stateOf(other) === "offline" || db.isMuted(c.user, other.user)) continue;
    const text = `Heads up: ${other.name}'s already on ${displayArea(theirs.area)} (since ${ago(db.ageSec(theirs.since))}).`;
    const alert: ServerToScout = { type: "alert", kind: "collision", text, other: other.user, area: theirs.area };
    hub.send(c.user, alert);
    alerts.push(alert);
    db.mute(c.user, other.user);
    db.addFeed(me.team, "alert", `${me.name} and ${other.name} are both in ${displayArea(c.area)}`);
  }

  // Dead end: a teammate failed in this area recently.
  for (const f of db.recentFails()) {
    if (f.user === c.user || !overlaps(f.area, c.area) || db.isMuted(c.user, `fail:${f.user}`)) continue;
    const who = db.getUser(f.user)?.name ?? f.user;
    const alert: ServerToScout = {
      type: "alert", kind: "fail", text: `${who} hit this ${ago(db.ageSec(f.at))}: ${f.text}`, other: f.user, area: f.area,
    };
    hub.send(c.user, alert);
    alerts.push(alert);
    db.mute(c.user, `fail:${f.user}`);
  }

  return { ok: true, alerts };
});

app.post<{ Body: { user: string } }>("/heartbeat", async (req, reply) => {
  if (!req.body?.user) return reply.code(400).send(bad("user is required"));
  db.ensureUser(req.body.user);
  db.touch(req.body.user);
  return { ok: true };
});

// ---------- board ----------
app.get<{ Querystring: { team?: string } }>("/board", async (req): Promise<Board> => {
  const team = req.query.team || db.DEFAULT_TEAM;
  const members = db.teamUsers(team).map((u) => {
    const claim = db.latestClaim(u.user);
    const hb = db.lastHeartbeat(u.user);
    return {
      user: u.user,
      name: u.name,
      area: claim?.area,
      since: claim?.since,
      state: db.stateOf(u),
      lastSeen: u.sim ? new Date().toISOString() : hb,
      ...(u.sim ? { sim: true } : {}),
    };
  });
  return { team, members, feed: db.teamFeed(team) };
});

app.get("/teams", async () => db.allTeams());

// ---------- ask ----------
app.post<{ Body: { asker: string; target: string; question: string; team?: string } }>("/ask", async (req, reply) => {
  if (!req.body?.target) return reply.code(400).send(bad("target is required"));
  return handleAsk(req.body);
});

/** For the localhost:4545 sharing page: who asked about this user and exactly what was sent. */
app.get<{ Querystring: { user?: string } }>("/asks", async (req, reply) => {
  if (!req.query.user) return reply.code(400).send(bad("user is required"));
  return db.asksAbout(req.query.user);
});

// ---------- fail (stretch) ----------
app.post<{ Body: FailEntry }>("/fail", async (req, reply) => {
  const f = req.body;
  if (!f?.user || !f?.area || !f?.text) return reply.code(400).send(bad("user, area and text are required"));
  const u = db.ensureUser(f.user);
  db.addFail(f.user, f.area, f.text, f.at);
  db.addFeed(u.team, "fail", `${u.name}: ${f.text.slice(0, 120)}`);
  return { ok: true };
});

// ---------- seed (sim teams, demo only) ----------
app.post<{ Body: SeedBody | SeedBody[] }>("/seed", async (req, reply) => {
  const bodies = Array.isArray(req.body) ? req.body : [req.body];
  if (!bodies.every((b) => b?.team && Array.isArray(b.members))) return reply.code(400).send(bad("each seed needs team + members[]"));
  bodies.forEach(applySeed);
  return { ok: true, teams: bodies.map((b) => b.team) };
});

// ---------- WebSocket: scouts ----------
app.register(async (scope) => {
  scope.get<{ Querystring: { user?: string } }>("/ws", { websocket: true }, (socket, req) => {
    const user = req.query.user;
    if (!user) return socket.close(1008, "user query param required");
    db.ensureUser(user);
    hub.register(user, socket);
    app.log.info({ user }, "scout connected");
    socket.on("message", (data: Buffer) => hub.handleMessage(user, data.toString()));
    socket.on("close", () => {
      hub.unregister(user, socket);
      app.log.info({ user }, "scout disconnected");
    });
  });
});

// ---------- built web app (Maritime serves server + web together) ----------
const webDist = fileURLToPath(new URL("../../web/dist", import.meta.url));
if (existsSync(webDist)) await app.register(fastifyStatic, { root: webDist });

await app.listen({ port: PORT, host: "0.0.0.0" });
