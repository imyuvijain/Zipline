// Shared contracts. Don't change without posting in Slack.

export type UserId = string; // e.g. "priya" (see team.json)

export interface Claim {
  user: UserId;
  area: string;      // e.g. "repo:team23-hack/server/export" or "doc:Pricing page draft"
  branch?: string;
  since: string;     // ISO timestamp
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
  kind: "claim" | "alert" | "ask" | "fail" | "done";
  text: string;
  sim?: boolean;
}

export interface Board {
  team: string;
  members: { user: UserId; name: string; area?: string; since?: string; state: SessionState; lastSeen?: string; sim?: boolean }[];
  feed: FeedItem[];
}

// WebSocket messages
export type ServerToScout =
  | { type: "ask"; askId: string; question: string; asker: UserId }
  | { type: "alert"; kind: "collision" | "fail"; text: string; other: UserId; area: string }
  | { type: "asked_about_you"; asker: UserId; sent: string; at: string };

export type ScoutToServer =
  | { type: "summary"; askId: string; summary: Summary };
