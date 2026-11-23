import type { AskRequest, AskResponse, Board, OverlapAnswer, UserId } from "../../shared/types.ts";
import fixtures from "../../shared/fixtures.json";
import team from "../../shared/team.json";

// Same-origin by default: the Vite proxy in dev, the server itself when deployed.
const BASE = (import.meta.env.VITE_SERVER_URL as string | undefined) ?? "";

const USER_KEY = "zipline_user";
function readStoredUser(): string | null {
  try {
    const u = localStorage.getItem(USER_KEY);
    return u && team.members.some((m) => m.user === u) ? u : null; // ignore removed members
  } catch { return null; }
}
/** Current user: localStorage (demo switcher) → VITE_MURMUR_USER → "richard". Switching reloads, so this is read once. */
export const ME: UserId = readStoredUser() || (import.meta.env.VITE_MURMUR_USER as string | undefined) || "richard";
export const MANAGER: UserId | undefined = (team as { manager?: string }).manager;
export const IS_MANAGER = ME === MANAGER;
export const TEAM_MEMBERS: { user: UserId; name: string }[] = team.members.map((m) => ({ user: m.user, name: m.name }));
export const nameOfUser = (u: UserId) => TEAM_MEMBERS.find((m) => m.user === u)?.name ?? u.charAt(0).toUpperCase() + u.slice(1);
export const roleOf = (u: UserId) => (u === MANAGER ? "Manager" : "Engineer");
/** Simplest way to reconnect the WS as someone else: persist and reload. */
export function switchUser(u: UserId) {
  try { localStorage.setItem(USER_KEY, u); } catch { /* private mode: reload still uses env default */ }
  location.reload();
}
export const TEAM = "team-murmur";
/** The laptops' local Ollama model that writes every answer. */
export const LOCAL_MODEL = (import.meta.env.VITE_LOCAL_MODEL as string | undefined) || "qwen2.5:3b";
export const SIM_TEAMS = ["team-payments", "team-infra"];

export type Source = "live" | "fixtures";

async function fetchJson<T>(path: string, init: RequestInit = {}, timeoutMs = 3000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(BASE + path, {
      ...init,
      signal: init.signal ?? ctrl.signal,
      headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    });
    if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- fixtures fallback (used until the server is reachable) ----------

// Fixture timestamps are fixed; shift them so the freshest one is "4s ago".
function rebase<T>(value: T, offsetMs: number): T {
  return JSON.parse(JSON.stringify(value), (key, v) =>
    (key === "at" || key === "since" || key === "lastSeen") && typeof v === "string"
      ? new Date(Date.parse(v) + offsetMs).toISOString()
      : v,
  );
}

// Built once so timestamps (and feed keys) stay stable across polls.
let fixtureCache: Record<string, Board> | null = null;
function fixtureBoards(): Record<string, Board> {
  return (fixtureCache ??= buildFixtureBoards());
}

function buildFixtureBoards(): Record<string, Board> {
  const base: Board = { team: fixtures.team, members: fixtures.members as Board["members"], feed: fixtures.feed as Board["feed"] };
  const latest = Math.max(...base.members.map((m) => Date.parse(m.lastSeen ?? m.since ?? "")).filter(Number.isFinite));
  const offset = Date.now() - 4000 - latest;
  const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
  const sim = (team: string, members: [string, string, string, Board["members"][number]["state"]][], feed: string[]): Board => ({
    team,
    members: members.map(([user, name, area, state], i) => ({ user, name, area, state, since: ago(8 + i * 11), lastSeen: ago(state === "offline" ? 30 : 0.2 + i * 0.1), sim: true })),
    feed: feed.map((text, i) => ({ at: ago(3 + i * 7), kind: i === 1 ? "fail" : "claim", text, sim: true })),
  });
  return {
    [TEAM]: rebase(base, offset),
    "team-payments": sim(
      "team-payments",
      [["dana", "Dana", "repo:payments/refunds", "active"], ["lee", "Lee", "repo:payments/refunds", "active"], ["omar", "Omar", "doc:PCI audit checklist", "idle"]],
      ["Dana is in payments/refunds", "Lee: Stripe webhook retries still double-charging in staging", "Omar is in PCI audit checklist"],
    ),
    "team-infra": sim(
      "team-infra",
      [["kim", "Kim", "repo:infra/terraform/rds", "active"], ["ravi", "Ravi", "repo:infra/ci", "active"], ["tess", "Tess", "repo:infra/k8s/ingress", "offline"]],
      ["Ravi is in infra/ci", "Kim: RDS upgrade blocked on maintenance window approval", "Kim is in infra/terraform/rds"],
    ),
  };
}

// ---------- API ----------

export async function getBoard(team: string): Promise<{ board: Board; source: Source }> {
  try {
    const board = await fetchJson<Board>(`/board?team=${encodeURIComponent(team)}`);
    // Our team shows only the people in shared/team.json (the server may still list removed members).
    if (team === TEAM) board.members = board.members.filter((m) => TEAM_MEMBERS.some((t) => t.user === m.user));
    return { board, source: "live" };
  } catch {
    return { board: fixtureBoards()[team] ?? { team, members: [], feed: [] }, source: "fixtures" };
  }
}

export async function ask(req: AskRequest, signal: AbortSignal): Promise<AskResponse & { fixture?: boolean }> {
  try {
    // Server waits up to 12s for laptops; give it a little headroom.
    return await fetchJson<AskResponse>("/ask", { method: "POST", body: JSON.stringify(req), signal: AbortSignal.any([signal, AbortSignal.timeout(14_000)]) }, 14_000);
  } catch (err) {
    if (signal.aborted) throw err;
    // Server unreachable: answer from fixtures so the UI can still be demoed, clearly flagged.
    await new Promise((r) => setTimeout(r, 1500));
    return { ...(fixtures.sampleAsk as AskResponse), fixture: true };
  }
}

export async function answerOverlap(id: string, same: boolean): Promise<void> {
  const body: OverlapAnswer = { user: ME, same };
  await fetchJson(`/overlap/${encodeURIComponent(id)}/answer`, { method: "POST", body: JSON.stringify(body) }, 5000);
}

/** Proposed in Slack #ai-messages (not yet in shared/types.ts): POST /ping → server forwards to the person's laptop + web. */
export interface PingRequest { from: UserId; to: UserId; text?: string }
export async function ping(to: UserId, text?: string): Promise<void> {
  const body: PingRequest = { from: ME, to, ...(text ? { text } : {}) };
  await fetchJson("/ping", { method: "POST", body: JSON.stringify(body) }, 5000);
}

// ---------- Today's tasks (server branch may not be merged: 404 → null) ----------

export interface Task { id: string; from: UserId; to: UserId; text: string; status: "open" | "done"; at: string }

async function rawFetch(path: string, init: RequestInit = {}, timeoutMs = 5000): Promise<Response> {
  return fetch(BASE + path, { ...init, signal: AbortSignal.timeout(timeoutMs), headers: { "content-type": "application/json", ...(init.headers ?? {}) } });
}

/** null = endpoint missing (404) or server unreachable. */
export async function getTasks(user: UserId): Promise<Task[] | null> {
  try {
    const res = await rawFetch(`/tasks?user=${encodeURIComponent(user)}`);
    if (!res.ok) return null;
    const body = (await res.json()) as { tasks?: Task[] };
    return Array.isArray(body.tasks) ? body.tasks : [];
  } catch {
    return null;
  }
}

export async function markTaskDone(id: string): Promise<void> {
  const res = await rawFetch(`/tasks/${encodeURIComponent(id)}/done`, { method: "POST" });
  if (!res.ok) throw new Error(`/tasks/${id}/done → HTTP ${res.status}`);
}

export async function assignTask(to: UserId, text: string): Promise<void> {
  const body = JSON.stringify({ from: ME, to, text });
  let res = await rawFetch("/tasks", { method: "POST", body });
  if (res.status === 404) res = await rawFetch("/assign", { method: "POST", body });
  if (!res.ok) throw new Error(`assign → HTTP ${res.status}`);
}
