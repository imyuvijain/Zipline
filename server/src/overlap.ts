// Two-stage overlap check (SPEC §2c).
// Stage 1 runs on every /claim (paths + files, no AI). Candidates go to stage 2 in the
// background: ask both laptops for a one-line intent, then one Claude call compares them.
import { randomUUID } from "node:crypto";
import type { Claim, Overlap, OverlapAnswer } from "../../shared/types.ts";
import * as db from "./db.ts";
import * as hub from "./hub.ts";
import { compareIntents } from "./claude.ts";
import { displayArea, stage1 } from "./areas.ts";

const INTENT_TIMEOUT_MS = Number(process.env.INTENT_TIMEOUT_MS ?? 8_000);
const INTENT_Q = "In one line: what task are you working on?";
const SAME_CONFIDENCE = 0.7;

/** Called from /claim. Returns how many stage-2 checks were started (they finish asynchronously). */
export function checkOverlaps(me: db.UserRow, claim: Claim): number {
  let started = 0;
  for (const other of db.allUsers()) {
    if (other.user === me.user || db.stateOf(other) === "offline") continue;
    const theirs = db.latestClaim(other.user);
    if (!theirs) continue;
    const s1 = stage1(theirs, claim);
    if (!s1.candidate) continue;
    const area = claim.area;
    if (db.isMuted(me.user, other.user, area)) continue;
    db.mute(me.user, other.user, 60, area); // also stops duplicate stage-2 runs while this one is in flight
    started++;
    stage2(other, theirs, me, claim, s1.strong, s1.files).catch((err) => console.warn("[overlap] stage 2 failed:", err));
  }
  return started;
}

async function intentOf(u: db.UserRow): Promise<string | null> {
  if (u.sim) return db.latestSummary(u.user)?.text ?? null;
  const s = await hub.requestSummary(u.user, INTENT_Q, "zipline", INTENT_TIMEOUT_MS, "intent");
  return s?.text?.trim() || null;
}

async function stage2(older: db.UserRow, olderClaim: Claim, newer: db.UserRow, newerClaim: Claim, strong: boolean, files: string[]) {
  const [olderTask, newerTask] = await Promise.all([intentOf(older), intentOf(newer)]);
  const verdict =
    olderTask && newerTask
      ? await compareIntents({
          area: displayArea(newerClaim.area),
          a: { name: older.name, task: olderTask, files: olderClaim.files ?? [] },
          b: { name: newer.name, task: newerTask, files: newerClaim.files ?? [] },
          sharedFiles: files,
        })
      : null;

  const where = displayArea(newerClaim.area);
  const overlap: Overlap = {
    id: randomUUID(),
    users: [older.user, newer.user],
    area: newerClaim.area,
    verdict: verdict?.verdict ?? "unsure",
    confidence: verdict?.confidence ?? 0,
    reason: verdict?.reason ?? (files.length ? `both saved ${files.join(", ")}` : `both in ${where}`),
    tasks: { [older.user]: olderTask ?? "unknown", [newer.user]: newerTask ?? "unknown" },
    at: new Date().toISOString(),
  };
  db.saveOverlap(overlap, newer.team);

  if (overlap.verdict === "same" && overlap.confidence >= SAME_CONFIDENCE) {
    const doing = olderTask ? ` (${lower(olderTask)})` : "";
    hub.send(newer.user, {
      type: "alert", kind: "collision", other: older.user, area: olderClaim.area,
      text: `Heads up: ${older.name}'s already on this in ${where}${doing}.`,
    });
    hub.send(older.user, {
      type: "alert", kind: "collision", other: newer.user, area: newerClaim.area,
      text: `FYI: ${newer.name} just started on the same thing in ${where}.`,
    });
    db.addFeed(newer.team, "alert", `${newer.name} and ${older.name} are on the same task in ${where}: ${overlap.reason}`);
    return;
  }

  if (overlap.verdict === "different") {
    db.addFeed(newer.team, "overlap", `${older.name} + ${newer.name} nearby in ${where}, different tasks`);
    return;
  }

  // related, low-confidence same, or no verdict (Claude/laptop didn't answer): ask both people.
  const pingText = (me: string, myTask: string | null, them: string, theirTask: string | null) =>
    myTask && theirTask
      ? `You and ${them} are both in ${where}: you're on "${clip(myTask)}", ${them}'s on "${clip(theirTask)}". Same task?`
      : `You and ${them} are both in ${where}. Same task?`;
  hub.send(newer.user, { type: "overlap_ping", overlapId: overlap.id, other: older.user, area: newerClaim.area, text: pingText(newer.name, newerTask, older.name, olderTask) });
  hub.send(older.user, { type: "overlap_ping", overlapId: overlap.id, other: newer.user, area: newerClaim.area, text: pingText(older.name, olderTask, newer.name, newerTask) });
  db.addFeed(newer.team, "overlap", `${older.name} + ${newer.name} both in ${where}: same task?`);
}

/** POST /overlap/:id/answer */
export function answerOverlap(id: string, ans: OverlapAnswer): { ok: boolean; error?: string; answers?: Record<string, boolean> } {
  const found = db.getOverlap(id);
  if (!found) return { ok: false, error: "unknown overlap" };
  const { overlap, team, answers } = found;
  if (!overlap.users.includes(ans.user)) return { ok: false, error: "user is not part of this overlap" };
  answers[ans.user] = !!ans.same;
  db.setOverlapAnswers(id, answers);

  const me = db.getUser(ans.user)?.name ?? ans.user;
  const otherId = overlap.users.find((u) => u !== ans.user)!;
  const other = db.getUser(otherId)?.name ?? otherId;
  const where = displayArea(overlap.area);
  if (!ans.same) db.addFeed(team, "overlap", `${me}: different task from ${other} in ${where}`);
  else if (answers[otherId] === true) db.addFeed(team, "overlap", `${me} + ${other} syncing on ${where}`);
  else db.addFeed(team, "overlap", `${me} thinks they're on the same task as ${other} in ${where}`);
  return { ok: true, answers };
}

const clip = (s: string) => (s.length > 80 ? s.slice(0, 77) + "…" : s);
const lower = (s: string) => clip(s.charAt(0).toLowerCase() + s.slice(1)).replace(/\.$/, "");
