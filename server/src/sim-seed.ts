// Simulated teams for the dept tab. Yuvi's demo/seed.ts can replace these via POST /seed.
import * as db from "./db.ts";

export interface SeedBody {
  team: string;
  members: { user: string; name: string; area?: string; branch?: string; state?: "active" | "idle" | "offline"; summary?: string; refs?: string[]; minutesAgo?: number }[];
  feed?: { kind?: "claim" | "alert" | "ask" | "fail" | "done"; text: string; minutesAgo?: number }[];
}

const minsAgo = (m = 0) => new Date(Date.now() - m * 60_000).toISOString();

export function applySeed(body: SeedBody) {
  for (const m of body.members) {
    db.upsertUser(m.user, m.name, body.team, true, m.state ?? "active");
    if (m.area) {
      const prev = db.latestClaim(m.user);
      if (prev?.area !== m.area) db.addClaim({ user: m.user, area: m.area, branch: m.branch, since: minsAgo((m.minutesAgo ?? 5) + 10) });
    }
    if (m.summary) db.saveSummary({ user: m.user, text: m.summary, refs: m.refs ?? [], at: minsAgo(m.minutesAgo ?? 2) });
  }
  for (const f of body.feed ?? []) db.addFeed(body.team, f.kind ?? "claim", f.text, true, minsAgo(f.minutesAgo ?? 5));
}

export const SAMPLE: SeedBody[] = [
  {
    team: "team-payments",
    members: [
      { user: "dana", name: "Dana", area: "repo:payments/stripe-webhooks", state: "active", minutesAgo: 3,
        summary: "Dana is retrying failed Stripe webhooks in stripe-webhooks/retry.ts. Integration tests keep timing out against the sandbox; she's blocked waiting on a new test key.",
        refs: ["file:stripe-webhooks/retry.ts", "cmd:npm test (exit 1)"] },
      { user: "omar", name: "Omar", area: "repo:payments/invoices", state: "idle", minutesAgo: 12,
        summary: "Omar finished the invoice PDF layout and opened a PR for review.", refs: ["commit:4be91a"] },
    ],
    feed: [{ kind: "fail", text: "Dana: Stripe sandbox tests timing out", minutesAgo: 8 }],
  },
  {
    team: "team-infra",
    members: [
      { user: "lee", name: "Lee", area: "repo:infra/terraform/rds", state: "active", minutesAgo: 1,
        summary: "Lee is upgrading the Postgres RDS instance in terraform/rds/main.tf. Plan shows a forced replacement, so he's holding the apply until after the demo.",
        refs: ["file:terraform/rds/main.tf", "cmd:terraform plan (exit 0)"] },
      { user: "kim", name: "Kim", area: "repo:infra/ci", state: "active", minutesAgo: 4,
        summary: "Kim is fixing the flaky CI cache step. Bumping Node didn't help; now trying a fresh turbo cache key.",
        refs: ["file:ci/build.yml"] },
    ],
    feed: [{ kind: "done", text: "Kim: CI runners moved to larger instances", minutesAgo: 20 }],
  },
];

export function seedSampleIfEmpty() {
  if (process.env.SEED_SIM === "0") return;
  if (db.allTeams().some((t) => t.sim)) return;
  SAMPLE.forEach(applySeed);
  console.log("[seed] loaded sample sim teams: team-payments, team-infra");
}
