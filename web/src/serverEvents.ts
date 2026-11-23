import type { ServerToScout } from "../../shared/types.ts";
import { ME } from "./api.ts";

/**
 * The web app's WebSocket to the server.
 * A tiny event bus so any component can listen, e.g. Yuvi's <IncomingCall/>:
 *   useServerEvent("incoming_call", (e) => ...)
 */
/** Proposed in Slack #ai-messages; not in shared/types.ts yet. */
export type PingEvent = { type: "ping"; from: string; text?: string; at: string };
type Ev = ServerToScout | PingEvent;
type Handler<T extends Ev["type"]> = (e: Extract<Ev, { type: T }>) => void;

const handlers = new Map<string, Set<(e: Ev) => void>>();
let started = false;

export function emit(e: Ev) {
  handlers.get(e.type)?.forEach((h) => h(e));
}

export function onServerEvent<T extends Ev["type"]>(type: T, fn: Handler<T>): () => void {
  if (!handlers.has(type)) handlers.set(type, new Set());
  const set = handlers.get(type)!;
  const h = fn as (e: Ev) => void;
  set.add(h);
  return () => set.delete(h);
}

function wsUrl() {
  const base = (import.meta.env.VITE_SERVER_URL as string | undefined) || location.origin;
  const u = new URL(`/ws?user=${encodeURIComponent(ME)}&client=web`, base);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  return u.toString();
}

/** Connects once, reconnects with backoff. Safe to call repeatedly. */
export function startServerEvents() {
  if (started) return;
  started = true;
  let delay = 1000;
  const connect = () => {
    let ws: WebSocket;
    try { ws = new WebSocket(wsUrl()); } catch { return void setTimeout(connect, delay); }
    ws.onopen = () => { delay = 1000; };
    ws.onmessage = (m) => {
      try { emit(JSON.parse(String(m.data)) as Ev); } catch { /* ignore non-JSON */ }
    };
    ws.onclose = () => { setTimeout(connect, delay); delay = Math.min(delay * 2, 15000); };
  };
  connect();
}

// Dev-only hook to rehearse without a server, e.g.
// __zipline.emit({type:"overlap_ping", overlapId:"o1", other:"maxim", area:"repo:zipline/server/export", text:"..."})
if (import.meta.env.DEV) (window as unknown as { __zipline: unknown }).__zipline = { emit };
