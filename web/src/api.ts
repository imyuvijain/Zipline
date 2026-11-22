import type { AskRequest, AskResponse, Board, OverlapAnswer, UserId } from "../../shared/types.ts";
import fixtures from "../../shared/fixtures.json";

// Same-origin by default: the Vite proxy in dev, the server itself when deployed.
const BASE = (import.meta.env.VITE_SERVER_URL as string | undefined) ?? "";

export const ME: UserId = (import.meta.env.VITE_MURMUR_USER as string | undefined) || "richard";
export const TEAM = "team-murmur";
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
    return { board: await fetchJson<Board>(`/board?team=${encodeURIComponent(team)}`), source: "live" };
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
