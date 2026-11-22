import { useSyncExternalStore } from "react";
import { ping } from "./api.ts";
import { onServerEvent } from "./serverEvents.ts";

/** Pings I sent (by recipient) and pings I received. "sending" shows instantly and lasts at least MIN_SENDING_MS so the result never flickers. */
export type Sent = { at: number; status: "sending" | "confirmed" | "failed"; text?: string; n: number };
const MIN_SENDING_MS = 600;
export type Received = { id: string; from: string; text?: string; at: number };

let state: { sent: Record<string, Sent>; received: Received[] } = { sent: {}, received: [] };
const listeners = new Set<() => void>();
const set = (next: typeof state) => {
  state = next;
  document.title = state.received.length ? `(${state.received.length}) Zipline` : "Zipline";
  listeners.forEach((l) => l());
};

export function sendPing(to: string, text?: string) {
  const n = (state.sent[to]?.n ?? 0) + 1;
  set({ ...state, sent: { ...state.sent, [to]: { at: Date.now(), status: "sending", text, n } } });
  const settle = (status: Sent["status"]) => {
    const cur = state.sent[to];
    if (cur?.n === n) set({ ...state, sent: { ...state.sent, [to]: { ...cur, status, at: Date.now() } } });
  };
  const minWait = new Promise((r) => setTimeout(r, MIN_SENDING_MS));
  ping(to, text).then(
    () => minWait.then(() => settle("confirmed")),
    () => minWait.then(() => settle("failed")),
  );
}

export function dismissPing(id: string) {
  set({ ...state, received: state.received.filter((r) => r.id !== id) });
}

let listening = false;
export function startPingListener() {
  if (listening) return;
  listening = true;
  onServerEvent("ping", (e) => {
    const at = Date.parse(e.at) || Date.now();
    set({ ...state, received: [{ id: `${e.from}-${at}`, from: e.from, text: e.text, at }, ...state.received] });
  });
}

export function usePings() {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => state,
  );
}
