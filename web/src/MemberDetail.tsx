import { useEffect, useState } from "react";
import type { AskRequest, AskResponse, Board, FeedItem } from "../../shared/types.ts";
import { IS_MANAGER, ask, ME } from "./api.ts";
import { projectNames, setProject, useProjects } from "./projects.ts";
import { sendPing, usePings } from "./pings.ts";
import { clock, fmtAge, ageSec, useNow } from "./time.ts";

type Member = Board["members"][number];
type FocusFn = (target: AskRequest["target"], phase: "asking" | "done") => void;
type Answer = AskResponse & { fixture?: boolean; elapsedMs: number };

/** Live summary from the person's laptop (one-person asks are never cached). */
function useLiveSummary(m: Member, onFocus: FocusFn) {
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (m.user === ME) return;
    const ctrl = new AbortController();
    const t0 = Date.now();
    setStartedAt(t0);
    setFailed(false);
    onFocus(m.user, "asking");
    ask({ asker: ME, target: m.user, question: `What's ${m.name} doing right now?` }, ctrl.signal)
      .then((r) => setAnswer({ ...r, elapsedMs: Date.now() - t0 }))
      .catch(() => { if (!ctrl.signal.aborted) setFailed(true); })
      .finally(() => { if (!ctrl.signal.aborted) { setStartedAt(null); onFocus(m.user, "done"); } });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.user, n]);
  return { answer, startedAt, failed, refresh: () => setN((x) => x + 1) };
}

function Pinger({ m }: { m: Member }) {
  const [text, setText] = useState("");
  const sent = usePings().sent[m.user];
  const now = useNow(1000);
  const age = sent ? (now - sent.at) / 1000 : Infinity;
  const status = sent?.status === "sending" ? "sending" : sent?.status === "failed" ? "failed" : sent && age < 60 ? "sent" : "idle";
  const label = { sending: "Pinging", failed: "Retry", sent: `Pinged · ${fmtAge(age).replace(" ago", "")}`, idle: "Ping" }[status];
  return (
    <form
      className={`pinger ${status}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (status === "sending") return;
        sendPing(m.user, text.trim() || undefined);
        setText("");
      }}
    >
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Note" maxLength={140} aria-label={`Note to ${m.name}`} />
      <button className="btn primary" disabled={status === "sending"} aria-live="polite"><span>{label}</span></button>
    </form>
  );
}

/** Manager only: move someone to another project. */
function ProjectEditor({ m }: { m: Member }) {
  const projects = useProjects();
  const saved = projects[m.user] ?? "";
  const [value, setValue] = useState(saved);
  useEffect(() => setValue(saved), [saved]);
  const listId = `projects-${m.user}`;
  return (
    <form
      className="pinger project-editor"
      onSubmit={(e) => { e.preventDefault(); setProject(m.user, value); }}
    >
      <input value={value} onChange={(e) => setValue(e.target.value)} list={listId} placeholder="Project" maxLength={60} aria-label={`${m.name}'s project`} />
      <datalist id={listId}>{projectNames(projects).map((p) => <option key={p} value={p} />)}</datalist>
      <button className="btn" disabled={value.trim() === saved}><span>{value.trim() === saved ? "Assigned" : "Assign"}</span></button>
    </form>
  );
}

export function MemberDetail({ m, feed, onFocus }: { m: Member; feed: FeedItem[]; onFocus: FocusFn }) {
  const now = useNow(100);
  const { answer, startedAt, failed, refresh } = useLiveSummary(m, onFocus);
  const first = m.name.toLowerCase();
  const activity = feed
    .filter((f) => f.text.toLowerCase().includes(first))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, 4);
  const onFor = ageSec(m.since, now);

  return (
    <div className="detail">
      <div className="detail-facts">
        <span className="scope full" title={m.area}>{m.area?.replace(/^(repo|doc):/, "") ?? "—"}</span>
        {m.since && <span className="age">{fmtAge(onFor).replace(" ago", "")}</span>}
      </div>

      {m.user !== ME && (
        <div className="detail-summary">
          {startedAt !== null ? (
            <div className="status"><span className="spinner" />{m.name}'s laptop · {((now - startedAt) / 1000).toFixed(1)}s</div>
          ) : failed ? (
            <div className="status err">No response</div>
          ) : answer ? (
            <>
              <p className="summary-text">{answer.answer}</p>
              <div className="sources">
                {answer.sources.map((s, i) => <span key={i} className="src">{s.label} · {fmtAge(s.ageSec)}</span>)}
                {answer.fixture && <span className="src warn" title="Server unreachable; sample answer from shared/fixtures.json">fixture</span>}
                <span className="src muted">{(answer.elapsedMs / 1000).toFixed(1)}s</span>
              </div>
            </>
          ) : null}
          {startedAt === null && (
            <button className="icon-btn" onClick={refresh} aria-label="Refresh" title="Refresh">
              <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden><path d="M13.5 8A5.5 5.5 0 1 1 11.9 4.1M13.5 2v3h-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          )}
        </div>
      )}

      {activity.length > 0 && (
        <ul className="detail-feed">
          {activity.map((f) => (
            <li key={`${f.at}|${f.text}`}>
              <span className="t">{clock(f.at)}</span>
              <span className={`tag ${f.kind}`}>{f.kind}</span>
              <span className="feed-text">{f.text}</span>
            </li>
          ))}
        </ul>
      )}

      {IS_MANAGER && !m.sim && <ProjectEditor m={m} />}

      {m.user !== ME && <Pinger m={m} />}
    </div>
  );
}
