import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AskRequest, Board } from "../../shared/types.ts";
import { SIM_TEAMS, TEAM } from "./api.ts";
import { Feed, MemberStack, SelectedMember, type Focus } from "./Board.tsx";
import { Profile } from "./Profile.tsx";
import { TasksPage } from "./Tasks.tsx";
import { useBoards } from "./useBoards.ts";
import { SameTaskCards } from "./SameTask.tsx";
import { startServerEvents } from "./serverEvents.ts";
import { startPingListener } from "./pings.ts";
import { IncomingPings } from "./IncomingPings.tsx";
import { IncomingCall } from "./call/IncomingCall.tsx";

const ALL_TEAMS = [TEAM, ...SIM_TEAMS];
const DEPT = "dept:engineering";
type TeamTab = { label: string; glyph: string; hue: number; sim?: boolean };
const META: Record<string, TeamTab> = {
  [TEAM]: { label: "Zipline", glyph: "Z", hue: 168 },
  [DEPT]: { label: "Engineering", glyph: "E", hue: 210 },
  "team-payments": { label: "Payments", glyph: "P", hue: 260, sim: true },
  "team-infra": { label: "Infra", glyph: "I", hue: 28, sim: true },
};
const TAB_ORDER = [TEAM, DEPT, ...SIM_TEAMS];

export default function App() {
  const { boards, source } = useBoards(ALL_TEAMS);
  const [view, setView] = useState<string>(TEAM);
  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState<Focus>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const shown: Board[] = view === DEPT ? ALL_TEAMS.map((t) => boards[t]).filter(Boolean) : boards[view] ? [boards[view]] : [];
  const allMembers = useMemo(() => ALL_TEAMS.flatMap((t) => boards[t]?.members ?? []), [boards]);
  const allFeed = useMemo(() => ALL_TEAMS.flatMap((t) => boards[t]?.feed ?? []), [boards]);
  // Looked up from live board data every render so the details panel updates live.
  const selectedMember = selected ? allMembers.find((m) => m.user === selected) : undefined;
  useEffect(() => { startPingListener(); startServerEvents(); }, []);
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
          <Profile />
        </header>
        <div className="board">
          <div className="col col-left">
            <IncomingPings nameOf={nameOf} onOpen={setSelected} />
            <SameTaskCards nameOf={nameOf} />
            <SelectedMember m={selectedMember} feed={allFeed} onFocus={onFocus} onClose={() => setSelected(null)} />
            <TasksPage board={boards[TEAM]} />
          </div>
          <aside className="col col-right" aria-label="Team">
            <TeamTabs selected={view} onSelect={setView} />
            <div className="team-panel" role="tabpanel" id="team-panel" aria-labelledby={`tab-${view}`} key={view}>
              <MemberStack boards={shown} focus={focus} selected={selected} onSelect={setSelected} />
              <Feed items={shown.flatMap((b) => b.feed)} />
            </div>
          </aside>
        </div>
      </main>
      <IncomingCall />
    </div>
  );
}

/** Team views as tabs at the top of the right column (arrow keys move between them). */
function TeamTabs({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  const onKey = (e: React.KeyboardEvent) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = TAB_ORDER[(TAB_ORDER.indexOf(selected) + d + TAB_ORDER.length) % TAB_ORDER.length];
    onSelect(next);
    document.getElementById(`tab-${next}`)?.focus();
  };
  return (
    <div className="team-tabs" role="tablist" aria-label="Teams" onKeyDown={onKey}>
      {TAB_ORDER.map((id) => {
        const t = META[id];
        const on = id === selected;
        return (
          <button
            key={id} id={`tab-${id}`} role="tab" aria-selected={on} aria-controls="team-panel" tabIndex={on ? 0 : -1}
            className={`team-tab ${on ? "on" : ""} ${t.sim ? "sim" : ""}`} onClick={() => onSelect(id)}
          >
            <span className="team-glyph" style={{ ["--hue" as string]: t.hue }} aria-hidden>{t.glyph}</span>
            <span>{t.label}</span>
            {t.sim && <span className="tag sim">sim</span>}
          </button>
        );
      })}
    </div>
  );
}
