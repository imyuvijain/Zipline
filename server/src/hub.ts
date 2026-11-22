// WebSocket hub: one socket per scout user, plus the pending-ask table.
import { randomUUID } from "node:crypto";
import type { ScoutToServer, ServerToScout, Summary, UserId } from "../../shared/types.ts";
import { touch } from "./db.ts";

interface Sock { send(data: string): void; close(): void; readyState: number }

const sockets = new Map<UserId, Sock>();
const pending = new Map<string, { user: UserId; resolve: (s: Summary | null) => void }>();

export function register(user: UserId, sock: Sock) {
  const old = sockets.get(user);
  if (old && old !== sock) old.close();
  sockets.set(user, sock);
  touch(user);
}

export function unregister(user: UserId, sock: Sock) {
  if (sockets.get(user) === sock) sockets.delete(user);
}

export const isOnline = (user: UserId) => sockets.get(user)?.readyState === 1;
export const onlineUsers = () => [...sockets.keys()].filter(isOnline);

export function send(user: UserId, msg: ServerToScout): boolean {
  const s = sockets.get(user);
  if (!s || s.readyState !== 1) return false;
  s.send(JSON.stringify(msg));
  return true;
}

/** Ask one laptop for a summary. Resolves null on timeout or if the laptop isn't connected. */
export function requestSummary(user: UserId, question: string, asker: UserId, timeoutMs: number): Promise<Summary | null> {
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
    if (!send(user, { type: "ask", askId, question, asker })) pending.get(askId)?.resolve(null);
  });
}

export function handleMessage(user: UserId, raw: string) {
  touch(user);
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
