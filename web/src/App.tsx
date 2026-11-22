import { useMemo, useState } from "react";
import type { Board } from "../../shared/types.ts";
import { SIM_TEAMS, TEAM } from "./api.ts";
import { Feed, MemberStack } from "./Board.tsx";
import { ChatPanel } from "./ChatPanel.tsx";
import { Dock, type DockItem } from "./Dock.tsx";
import { useBoards } from "./useBoards.ts";

const ALL_TEAMS = [TEAM, ...SIM_TEAMS];
const DEPT = "dept:engineering";
const META: Record<string, Omit<DockItem, "id">> = {
  [TEAM]: { label: "Murmur", glyph: "M", hue: 168 },
  "team-payments": { label: "Payments", glyph: "$", hue: 260, sim: true },
  "team-infra": { label: "Infra", glyph: "⚙", hue: 28, sim: true },
  [DEPT]: { label: "Engineering", glyph: "E", hue: 210 },
};

export default function App() {
  const { boards, source } = useBoards(ALL_TEAMS);
  const [view, setView] = useState<string>(TEAM);

  const shown: Board[] = view === DEPT ? ALL_TEAMS.map((t) => boards[t]).filter(Boolean) : boards[view] ? [boards[view]] : [];
  const allMembers = useMemo(() => ALL_TEAMS.flatMap((t) => boards[t]?.members ?? []), [boards]);
  const feed = shown.flatMap((b) => b.feed);
  const dockItems: DockItem[] = [...ALL_TEAMS, DEPT].map((id) => ({ id, ...META[id] }));
  const label = META[view].label;

  return (
    <div className="app">
      <main className="main">
        <header className="topbar">
          <span className="logo" aria-label="Murmur">◉</span>
          <div className="view-title">
            <h1>{label}</h1>
            {META[view].sim && <span className="tag sim">sim</span>}
          </div>
          <span className={`pill ${source}`} title={source === "live" ? "Connected to the Murmur server" : "Server unreachable; showing shared/fixtures.json"}>
            <span className={`dot ${source === "live" ? "active" : "idle"}`} />
          </span>
        </header>
        <div className="main-scroll">
          <MemberStack boards={shown} />
          <Feed items={feed} />
        </div>
        <Dock items={dockItems} selected={view} onSelect={setView} />
      </main>
      <ChatPanel members={allMembers} defaultTarget={view === DEPT ? "dept" : "team"} scopeLabel={view === DEPT ? "engineering" : view} />
    </div>
  );
}
