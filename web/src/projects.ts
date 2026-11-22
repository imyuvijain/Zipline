import { useSyncExternalStore } from "react";
import team from "../../shared/team.json";
import type { UserId } from "../../shared/types.ts";

// Who's on which project. Defaults come from shared/team.json; the manager's edits are saved in this browser.
const KEY = "zipline_projects";
const defaults: Record<string, string> = Object.fromEntries(
  team.members.map((m) => [m.user, (m as { project?: string }).project ?? ""]),
);

function read(): Record<string, string> {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return { ...defaults }; }
}

let current = read();
const listeners = new Set<() => void>();

export function setProject(user: UserId, project: string) {
  current = { ...current, [user]: project.trim() };
  try {
    const overrides = Object.fromEntries(Object.entries(current).filter(([u, p]) => p !== defaults[u]));
    localStorage.setItem(KEY, JSON.stringify(overrides));
  } catch { /* storage blocked: keep the edit for this tab */ }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export function useProjects(): Record<string, string> {
  return useSyncExternalStore(subscribe, () => current);
}

/** Distinct project names, for the manager's picker. */
export const projectNames = (p: Record<string, string>) => [...new Set(Object.values(p).filter(Boolean))];
