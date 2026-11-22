// Shared contracts. Don't change without posting in Slack.

export type UserId = string; // e.g. "priya" (see team.json)

export interface Claim {
  user: UserId;
  area: string;      // e.g. "repo:team23-hack/server/export" or "doc:Pricing page draft"
  branch?: string;
  since: string;     // ISO timestamp
  files?: string[];  // top 5 recently saved paths in this area (paths only), for the overlap check
}

export type SessionState = "active" | "idle" | "offline";

export interface Session {
  user: UserId;
  state: SessionState;
  lastHeartbeat: string; // ISO
}

export interface Summary {
  user: UserId;
  text: string;      // <= 300 chars
  refs: string[];    // ["file:server/export/csv.ts", "commit:9f2c1e", "cmd:npm test (exit 1)"]
  at: string;        // ISO, when the laptop wrote it
}

export interface AskRequest {
  asker: UserId;
  target: UserId | "team" | "dept";
  question: string;
}

export interface Source { label: string; ageSec: number; }

export interface AskResponse {
  answer: string;
  sources: Source[];
  asOfSec: number;   // age of the oldest input
  cached: boolean;
}

export interface FailEntry {
  user: UserId;
  area: string;
  text: string;      // <= 200 chars: what was tried, what happened
  at: string;
}

export interface FeedItem {
  at: string;
  kind: "claim" | "alert" | "ask" | "fail" | "done" | "overlap" | "assign" | "brief";
  text: string;
  sim?: boolean;
}

export interface Board {
  team: string;
  members: { user: UserId; name: string; area?: string; since?: string; state: SessionState; lastSeen?: string; sim?: boolean }[];
  feed: FeedItem[];
}

// Overlap check (SPEC §2c)
export type OverlapVerdict = "same" | "related" | "different" | "unsure";

export interface Overlap {
  id: string;
  users: [UserId, UserId];  // [earlier claimer, newer claimer]
  area: string;
  verdict: OverlapVerdict;
  confidence: number;       // 0..1
  reason: string;           // one line, e.g. "both editing CSV headers in export/csv.ts"
  tasks: Record<UserId, string>; // one-line intent per user
  at: string;
}

export interface OverlapAnswer { user: UserId; same: boolean; }

// Nudge a teammate from the web app (POST /ping). Delivered to their laptop + open web tabs.
export interface PingRequest { from: UserId; to: UserId; text?: string }

// Assignments + voice catch-up calls (SPEC §2b)
export interface Assignment {
  id: string;
  from: UserId;   // manager
  to: UserId;
  text: string;   // "get /board deployed on Maritime before 13:30"
  at: string;
  status: "open" | "done";
}

export type BriefKind = "assignment" | "manager_digest" | "catchup";

export interface BriefRequest {
  for: UserId;
  kind: BriefKind;
  sinceMin?: number;      // default 30
  assignmentId?: string;  // for kind "assignment"
}

export interface BriefResponse {
  id: string;
  kind: BriefKind;
  script: string;    // <= ~150 words, what the voice says
  audioUrl: string;  // "/brief/<id>/audio" (ElevenLabs TTS, generated server-side)
  sources: Source[];
  agentId?: string;  // set when an ElevenLabs Agent handles the call (talk-back)
}

// WebSocket messages (scout and web both connect; each ignores types it doesn't use)
export type ServerToScout =
  | { type: "ask"; askId: string; question: string; asker: UserId; purpose?: "answer" | "intent" } // intent: one-line task, no "asked about you"
  | { type: "alert"; kind: "collision" | "fail"; text: string; other: UserId; area: string }
  | { type: "overlap_ping"; overlapId: string; other: UserId; area: string; text: string } // "same task?"
  | { type: "asked_about_you"; asker: UserId; sent: string; at: string }
  | { type: "incoming_call"; briefId: string; kind: BriefKind; from: UserId | "zipline"; title: string }
  | { type: "ping"; from: UserId; text?: string; at: string };

export type ScoutToServer =
  | { type: "summary"; askId: string; summary: Summary };
