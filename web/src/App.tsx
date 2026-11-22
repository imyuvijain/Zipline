import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AskRequest, Board } from "../../shared/types.ts";
import { SIM_TEAMS, TEAM } from "./api.ts";
import { Feed, MemberStack, type Focus } from "./Board.tsx";
import { ChatPanel } from "./ChatPanel.tsx";
import { Dock, type DockItem } from "./Dock.tsx";
import { useBoards } from "./useBoards.ts";
import { SameTaskCards } from "./SameTask.tsx";
import { startServerEvents } from "./serverEvents.ts";

const ALL_TEAMS = [TEAM, ...SIM_TEAMS];
const DEPT = "dept:engineering";
const META: Record<string, Omit<DockItem, "id">> = {
  [TEAM]: { label: "Zipline", glyph: "Z", hue: 168 },
  [DEPT]: { label: "Engineering", glyph: "E", hue: 210 },
  "team-payments": { label: "Payments", glyph: "P", hue: 260, sim: true, divider: true },
  "team-infra": { label: "Infra", glyph: "I", hue: 28, sim: true },
};
const DOCK_ORDER = [TEAM, DEPT, ...SIM_TEAMS];

export default function App() {
  const { boards, source } = useBoards(ALL_TEAMS);
  const [view, setView] = useState<string>(TEAM);
  const [pending, setPending] = useState<{ text: string; n: number } | null>(null);
  const [focus, setFocus] = useState<Focus>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const shown: Board[] = view === DEPT ? ALL_TEAMS.map((t) => boards[t]).filter(Boolean) : boards[view] ? [boards[view]] : [];
  const allMembers = useMemo(() => ALL_TEAMS.flatMap((t) => boards[t]?.members ?? []), [boards]);
  useEffect(startServerEvents, []);
  const nameOf = (user: string) => allMembers.find((m) => m.user === user)?.name ?? user.charAt(0).toUpperCase() + user.slice(1);
  const shownUsers = shown.flatMap((b) => b.members.map((m) => m.user));
  const shownRef = useRef(shownUsers);
  shownRef.current = shownUsers;

  const onFocus = useCallback((target: AskRequest["target"], phase: "asking" | "done") => {
    clearTimeout(clearTimer.current);
    const users = new Set(target === "team" || target === "dept" ? shownRef.current : [target]);
    setFocus({ users, phase });
    if (phase === "done") clearTimer.current = setTimeout(() => setFocus(null), 3000);
  }, []);

  return (
    <div className="app">
      <main className="main">
        <header className="topbar">
          <h1>{META[view].label}</h1>
          {META[view].sim && <span className="tag sim">sim</span>}
          <span className={`dot ${source === "live" ? "active" : "idle"} source`} title={source === "live" ? "Live" : "Server unreachable: fixtures"} />
        </header>
        <div className="main-scroll" key={view}>
          <SameTaskCards nameOf={nameOf} />
          <MemberStack boards={shown} focus={focus} onAsk={(m) => setPending((p) => ({ text: `What's ${m.name} doing?`, n: (p?.n ?? 0) + 1 }))} />
          <Feed items={shown.flatMap((b) => b.feed)} />
        </div>
        <Dock items={DOCK_ORDER.map((id) => ({ id, ...META[id] }))} selected={view} onSelect={setView} />
      </main>
      <ChatPanel
        members={allMembers}
        shown={shown.flatMap((b) => b.members)}
        defaultTarget={view === DEPT ? "dept" : "team"}
        scopeLabel={view === DEPT ? "engineering" : view}
        pending={pending}
        onFocus={onFocus}
      />
      {/* Yuvi's <IncomingCall/> (web/src/call/) mounts here. It can listen with
          onServerEvent("incoming_call", ...) from ./serverEvents.ts. */}
    </div>
  );
}
