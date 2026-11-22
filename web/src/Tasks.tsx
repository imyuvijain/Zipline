// "Today's tasks": GET /tasks?user=me every 5s. 404 / unreachable → empty state (server branch may not be merged).
import { useCallback, useEffect, useState } from "react";
import type { Board } from "../../shared/types.ts";
import { IS_MANAGER, ME, TEAM_MEMBERS, assignTask, getTasks, markTaskDone, nameOfUser, type Task } from "./api.ts";
import { areaLabel } from "./Board.tsx";
import { clock } from "./time.ts";

export function TasksPage({ board }: { board?: Board }) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const refresh = useCallback(async () => { setTasks(await getTasks(ME)); setLoaded(true); }, []);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const me = board?.members.find((m) => m.user === ME);
  const open = (tasks ?? []).filter((t) => t.status === "open");
  const done = (tasks ?? []).filter((t) => t.status === "done");

  const toggle = async (t: Task) => {
    if (t.status === "done") return;
    setTasks((ts) => ts?.map((x) => (x.id === t.id ? { ...x, status: "done" } : x)) ?? ts);
    try { await markTaskDone(t.id); } catch { /* next poll restores truth */ }
    refresh();
  };

  return (
    <div className="tasks">
      <p className="tasks-area">{me?.area ? <>You're working in <span className="scope">{areaLabel(me.area)}</span></> : "No current area from your laptop yet."}</p>
      {IS_MANAGER && <AssignForm onDone={refresh} />}
      <section>
        <div className="group-title">Today's tasks{tasks && tasks.length > 0 && <span className="tag">{open.length} open</span>}</div>
        {!loaded ? (
          <div className="status"><span className="spinner" />Loading…</div>
        ) : !tasks || tasks.length === 0 ? (
          <div className="tasks-empty">{tasks === null ? "No tasks yet. The tasks service isn't available." : "No tasks for today."}</div>
        ) : (
          <ul className="stack">
            {[...open, ...done].map((t, i) => (
              <li key={t.id} style={{ "--i": i } as React.CSSProperties}>
                <label className={`task ${t.status}`}>
                  <input type="checkbox" checked={t.status === "done"} disabled={t.status === "done"} onChange={() => toggle(t)} />
                  <span className="task-text">{t.text}</span>
                  <span className="task-meta">from {nameOfUser(t.from)} · {t.at ? clock(t.at) : ""}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function AssignForm({ onDone }: { onDone: () => void }) {
  const others = TEAM_MEMBERS.filter((m) => m.user !== ME);
  const [to, setTo] = useState(others[0]?.user ?? "");
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const submit = async () => {
    if (!text.trim() || !to) return;
    setState("sending");
    try { await assignTask(to, text.trim()); setText(""); setState("sent"); onDone(); }
    catch { setState("error"); }
  };
  return (
    <form className="assign" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="group-title">Assign a task</div>
      <div className="assign-row">
        <select className="assign-select" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Assign to">
          {others.map((m) => <option key={m.user} value={m.user}>{m.name}</option>)}
        </select>
        <input className="assign-input" value={text} onChange={(e) => { setText(e.target.value); setState("idle"); }} placeholder="What should they do today?" aria-label="Task" />
        <button className="btn" type="submit" disabled={!text.trim() || state === "sending"}>{state === "sending" ? "Assigning…" : "Assign"}</button>
      </div>
      {state === "sent" && <div className="status">Assigned to {nameOfUser(to)}.</div>}
      {state === "error" && <div className="status err">Couldn't assign. Server didn't accept it.</div>}
    </form>
  );
}
