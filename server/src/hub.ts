// WebSocket hub. A user can have several sockets: their scout (/ws?user=x) and any open
// web tabs (/ws?user=x&client=web). Pushes (alert, overlap_ping, asked_about_you,
// incoming_call) go to all of them; asks go to scouts only.
import { randomUUID } from "node:crypto";
import type { ScoutToServer, ServerToScout, Summary, UserId } from "../../shared/types.ts";
import { touch } from "./db.ts";

export type ClientKind = "scout" | "web";
interface Sock { send(data: string): void; close(): void; readyState: number }
interface Conn { sock: Sock; kind: ClientKind }

const conns = new Map<UserId, Set<Conn>>();
const pending = new Map<string, { user: UserId; resolve: (s: Summary | null) => void }>();

export function register(user: UserId, sock: Sock, kind: ClientKind): Conn {
  const set = conns.get(user) ?? new Set<Conn>();
  // One scout per user: a reconnecting scout replaces the old socket.
  if (kind === "scout") for (const c of set) if (c.kind === "scout") { set.delete(c); c.sock.close(); }
  const conn = { sock, kind };
  set.add(conn);
  conns.set(user, set);
  if (kind === "scout") touch(user);
  return conn;
}

export function unregister(user: UserId, conn: Conn) {
  conns.get(user)?.delete(conn);
}

const open = (user: UserId, kind?: ClientKind) =>
  [...(conns.get(user) ?? [])].filter((c) => c.sock.readyState === 1 && (!kind || c.kind === kind));

/** True when the user's scout (laptop) is connected. Web tabs don't count. */
export const isOnline = (user: UserId) => open(user, "scout").length > 0;
export const onlineUsers = () => [...conns.keys()].filter(isOnline);

/** Push to every socket the user has open (scout + web). */
export function send(user: UserId, msg: ServerToScout): boolean {
  const targets = open(user);
  for (const c of targets) c.sock.send(JSON.stringify(msg));
  return targets.length > 0;
}

/** Ask one laptop for a summary (or, with purpose "intent", a one-line task). Null on timeout/offline. */
export function requestSummary(
  user: UserId, question: string, asker: UserId, timeoutMs: number, purpose: "answer" | "intent" = "answer",
): Promise<Summary | null> {
  const askId = randomUUID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(askId);
      resolve(null);
    }, timeoutMs);
    pending.set(askId, {
      user,
      resolve: (s) => {
        clearTimeout(timer);
        pending.delete(askId);
        resolve(s);
      },
    });
    const scouts = open(user, "scout");
    if (!scouts.length) return pending.get(askId)?.resolve(null);
    const msg: ServerToScout = { type: "ask", askId, question, asker, purpose };
    for (const c of scouts) c.sock.send(JSON.stringify(msg));
  });
}

export function handleMessage(user: UserId, kind: ClientKind, raw: string) {
  if (kind === "scout") touch(user);
  let msg: ScoutToServer;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  if (msg?.type === "summary" && msg.askId) {
    const p = pending.get(msg.askId);
    if (!p) return; // late answer after timeout
    const s = msg.summary ?? ({} as Summary);
    p.resolve({
      user: p.user,
      text: String(s.text ?? "").slice(0, 300),
      refs: Array.isArray(s.refs) ? s.refs.map(String) : [],
      at: s.at ?? new Date().toISOString(),
    });
  }
}
