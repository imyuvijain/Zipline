import { useEffect, useState } from "react";

/** Re-renders every second so ages tick live. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function fmtAge(sec: number): string {
  if (!Number.isFinite(sec)) return "–";
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s ago`;
  return `${Math.floor(m / 60)}h ${m % 60}m ago`;
}

export const ageSec = (iso: string | undefined, now: number) => (iso ? (now - Date.parse(iso)) / 1000 : NaN);

export const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
