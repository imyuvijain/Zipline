import type { AskRequest, AskResponse, Source, Summary } from "../../shared/types.ts";
import * as db from "./db.ts";
import * as hub from "./hub.ts";
import { synthesize } from "./claude.ts";
import { ago, displayArea, hhmm } from "./areas.ts";

const PERSON_TIMEOUT_MS = Number(process.env.PERSON_TIMEOUT_MS ?? 10_000);
const TEAM_TIMEOUT_MS = Number(process.env.TEAM_TIMEOUT_MS ?? 6_000);
const CACHE_MS = 3 * 60_000;
const STALE_SUMMARY_SEC = 30 * 60; // laptops only keep 30 min anyway

const cache = new Map<string, { at: number; res: AskResponse }>();

type Ask = AskRequest & { team?: string };

export async function handleAsk(req: Ask): Promise<AskResponse> {
  const asker = String(req.asker ?? "someone");
  const question = String(req.question ?? "").trim() || "What are they working on?";
  const target = String(req.target ?? "team");

  if (target === "team" || target === "dept") {
    const team = req.team ?? db.getUser(asker)?.team ?? db.DEFAULT_TEAM;
    const key = `${target}:${target === "team" ? team : "*"}:${question.toLowerCase()}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) {
      const bump = Math.round((Date.now() - hit.at) / 1000);
      const res: AskResponse = {
        ...hit.res,
        cached: true,
        asOfSec: hit.res.asOfSec + bump,
        sources: hit.res.sources.map((s) => ({ ...s, ageSec: s.ageSec + bump })),
      };
      db.logAsk({ asker, target, question, answer: res.answer, cached: true });
      return res;
    }
    const res = target === "team" ? await askTeam(asker, team, question) : await askDept(asker, question);
    cache.set(key, { at: Date.now(), res });
    return res;
  }
  return askPerson(asker, target, question);
}

// ---------- one person: forward the laptop summary as-is (no Claude) ----------
async function askPerson(asker: string, user: string, question: string): Promise<AskResponse> {
  const u = db.getUser(user);
  if (!u) return { answer: `I don't know anyone called "${user}".`, sources: [], asOfSec: 0, cached: false };

  const claim = db.latestClaim(user);
  const claimSrc: Source[] = claim ? [{ label: `claim ${displayArea(claim.area)}`, ageSec: db.ageSec(claim.since) }] : [];

  let live: Summary | null = null;
  if (!u.sim && hub.isOnline(user)) live = await hub.requestSummary(user, question, asker, PERSON_TIMEOUT_MS);

  let res: AskResponse;
  if (live && live.text) {
    db.saveSummary(live);
    const age = db.ageSec(live.at);
    res = { answer: live.text, sources: [{ label: `${u.name}'s laptop`, ageSec: age }, ...claimSrc], asOfSec: age, cached: false };
    hub.send(user, { type: "asked_about_you", asker, sent: live.text, at: new Date().toISOString() });
  } else {
    const last = db.latestSummary(user);
    const lastAge = last ? db.ageSec(last.at) : Infinity;
    if (u.sim && last) {
      res = { answer: last.text, sources: [{ label: `${u.name} (sim)`, ageSec: lastAge }, ...claimSrc], asOfSec: lastAge, cached: false };
    } else {
      const state = db.stateOf(u);
      const hb = db.lastHeartbeat(user);
      let answer =
        state === "offline"
          ? `${u.name}'s laptop is offline${hb ? ` (since ${hhmm(hb)})` : ""}.`
          : `${u.name}'s laptop didn't answer in time.`;
      if (claim) answer += ` Last in ${displayArea(claim.area)}.`;
      const sources = [...claimSrc];
      if (last && lastAge <= STALE_SUMMARY_SEC) {
        answer += ` Last update (${ago(lastAge)}): ${last.text}`;
        sources.unshift({ label: `${u.name}'s last update`, ageSec: lastAge });
      }
      res = { answer, sources, asOfSec: sources.length ? Math.max(...sources.map((s) => s.ageSec)) : 0, cached: false };
    }
  }

  db.logAsk({ asker, target: user, about: user, question, sent: live?.text, answer: res.answer, cached: false });
  db.addFeed(u.team, "ask", `${nameOf(asker)} asked about ${u.name}`);
  return res;
}

// ---------- team / dept: gather summaries, one Claude call ----------
interface Gathered { user: string; name: string; team: string; sim: boolean; summary?: Summary; live: boolean; note: string }

async function gather(users: db.UserRow[], asker: string, question: string): Promise<Gathered[]> {
  return Promise.all(
    users.map(async (u): Promise<Gathered> => {
      let summary: Summary | undefined;
      let live = false;
      if (!u.sim && hub.isOnline(u.user)) {
        const s = await hub.requestSummary(u.user, question, asker, TEAM_TIMEOUT_MS);
        if (s?.text) {
          db.saveSummary(s);
          summary = s;
          live = true;
          hub.send(u.user, { type: "asked_about_you", asker, sent: s.text, at: new Date().toISOString() });
        }
      }
      if (!summary) {
        const last = db.latestSummary(u.user);
        if (last && (u.sim || db.ageSec(last.at) <= STALE_SUMMARY_SEC)) summary = last;
      }
      const claim = db.latestClaim(u.user);
      const where = claim ? ` in ${displayArea(claim.area)}` : "";
      const note = summary
        ? `- ${u.name}${where} (${ago(db.ageSec(summary.at))}): ${summary.text}`
        : `- ${u.name}: ${db.stateOf(u)}${claim ? `, last in ${displayArea(claim.area)}` : ""}, no recent update`;
      return { user: u.user, name: u.name, team: u.team, sim: !!u.sim, summary, live, note };
    }),
  );
}

function toResponse(g: Gathered[], answer: string): AskResponse {
  const sources: Source[] = g
    .filter((x) => x.summary)
    .map((x) => ({ label: x.sim ? `${x.name} (sim)` : `${x.name}'s laptop`, ageSec: db.ageSec(x.summary!.at) }));
  return { answer, sources, asOfSec: sources.length ? Math.max(...sources.map((s) => s.ageSec)) : 0, cached: false };
}

function logEach(g: Gathered[], asker: string, target: string, question: string, answer: string) {
  for (const x of g) if (x.live) db.logAsk({ asker, target, about: x.user, question, sent: x.summary?.text, answer, cached: false });
  if (!g.some((x) => x.live)) db.logAsk({ asker, target, question, answer, cached: false });
}

async function askTeam(asker: string, team: string, question: string): Promise<AskResponse> {
  const g = await gather(db.teamUsers(team), asker, question);
  const notes = g.map((x) => x.note).join("\n");
  const answer = (await synthesize(question, `Team ${team}:\n${notes}`)) ?? digest(g);
  logEach(g, asker, "team", question, answer);
  db.addFeed(team, "ask", `${nameOf(asker)} asked the team: "${question.slice(0, 80)}"`);
  return toResponse(g, answer);
}

async function askDept(asker: string, question: string): Promise<AskResponse> {
  const teams = db.allTeams();
  const perTeam = await Promise.all(teams.map(async (t) => ({ ...t, g: await gather(db.teamUsers(t.team), asker, question) })));
  const notes = perTeam.map((t) => `Team ${t.team}${t.sim ? " (simulated)" : ""}:\n${t.g.map((x) => x.note).join("\n")}`).join("\n\n");
  const all = perTeam.flatMap((t) => t.g);
  const answer = (await synthesize(question, notes)) ?? digest(all);
  logEach(all, asker, "dept", question, answer);
  db.addFeed(db.getUser(asker)?.team ?? db.DEFAULT_TEAM, "ask", `${nameOf(asker)} asked engineering: "${question.slice(0, 80)}"`);
  return toResponse(all, answer);
}

/** Fallback when Claude is unavailable: a compact per-person digest. */
function digest(g: Gathered[]): string {
  const withNews = g.filter((x) => x.summary);
  if (!withNews.length) return "Nobody has a recent update right now.";
  return withNews.map((x) => `${x.name}: ${x.summary!.text}`).join(" ").slice(0, 600);
}

const nameOf = (user: string) => db.getUser(user)?.name ?? user;
