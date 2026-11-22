import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Board, FeedItem } from "../../shared/types.ts";
import { ageSec, clock, fmtAge, useNow } from "./time.ts";
import { MemberDetail } from "./MemberDetail.tsx";
import { MIN_SENDING_MS, usePings } from "./pings.ts";
import { useProjects } from "./projects.ts";

// One continuous pendulum swing (0.6s per back-and-forth) lasting the whole ping (MIN_SENDING_MS):
// starts and ends at rest, only slows at the extremes, so it never reads as separate shakes.
const SINE_OUT = "cubic-bezier(.61, 1, .88, 1)";
const SINE_IN_OUT = "cubic-bezier(.37, 0, .63, 1)";
const SINE_IN = "cubic-bezier(.12, 0, .39, 0)";
const SHAKE: Keyframe[] = [
  { transform: "translateX(0)", offset: 0, easing: SINE_OUT },
  { transform: "translateX(-4px)", offset: 1 / 8, easing: SINE_IN_OUT },
  { transform: "translateX(4px)", offset: 3 / 8, easing: SINE_IN_OUT },
  { transform: "translateX(-4px)", offset: 5 / 8, easing: SINE_IN_OUT },
  { transform: "translateX(4px)", offset: 7 / 8, easing: SINE_IN },
  { transform: "translateX(0)", offset: 1 },
];

/** Small one-shot shake whenever `trigger` changes (skips the first render and reduced-motion users). */
function useShake(el: React.RefObject<HTMLElement | null>, trigger: string | number | undefined) {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (trigger === undefined || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    el.current?.animate(SHAKE, { duration: MIN_SENDING_MS, easing: "linear" });
  }, [trigger, el]);
}
import type { AskRequest } from "../../shared/types.ts";

type Member = Board["members"][number];
export type Focus = { users: Set<string>; phase: "asking" | "done" } | null;

export const areaLabel = (area?: string) => (area ? area.replace(/^repo:[^/]+\//, "").replace(/^doc:/, "") : "—");

/** Users whose area is shared with another non-offline member. */
export function clashingUsers(members: Member[]): Set<string> {
  const byArea = new Map<string, string[]>();
  for (const m of members) {
    if (!m.area || m.state === "offline") continue;
    byArea.set(m.area, [...(byArea.get(m.area) ?? []), m.user]);
  }
  return new Set([...byArea.values()].filter((u) => u.length > 1).flat());
}

/** Bumps a counter whenever `value` changes after the first render. */
function useChangeCount(value: string) {
  const prev = useRef(value);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (prev.current !== value) setN((x) => x + 1);
    prev.current = value;
  }, [value]);
  return n;
}

type FocusFn = (target: AskRequest["target"], phase: "asking" | "done") => void;
interface CardProps { m: Member; now: number; i: number; clash: boolean; focus: Focus; selected: boolean; onToggle: () => void }

/** "12s ago" style last-seen label; offline people show whole minutes. */
const seenLabel = (m: Member, seen: number) => (!Number.isFinite(seen) ? "—" : m.state === "offline" ? `${Math.floor(seen / 60)}m` : fmtAge(seen));

function MemberCard({ m, now, i, clash, focus, selected, onToggle }: CardProps) {
  const areaBump = useChangeCount(m.area ?? "");
  const stateBump = useChangeCount(m.state);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (selected) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [selected]);
  const seen = ageSec(m.lastSeen, now);
  const focused = focus?.users.has(m.user);
  const { sent, received } = usePings();
  const projects = useProjects();
  const out = sent[m.user];
  const outAge = out ? (now - out.at) / 1000 : Infinity;
  const pingedOut = out && outAge < 120;
  const pingedMe = received.some((r) => r.from === m.user);
  const lastIncoming = received.find((r) => r.from === m.user)?.id;
  useShake(ref, out?.n);
  useShake(ref, lastIncoming);
  const cls = ["member", m.state, clash && "clash", focused && `focus ${focus!.phase}`, selected && "selected", pingedMe && "pinged-me"].filter(Boolean).join(" ");
  return (
    <li style={{ "--i": i } as CSSProperties}>
      <div className={cls} ref={ref}>
        <button className="member-head" onClick={onToggle} aria-pressed={selected} aria-current={selected || undefined} aria-label={m.name}>
          <span className="avatar" aria-hidden>
            {m.name.slice(0, 1)}
            {focused && focus!.phase === "asking" && <span className="avatar-ring" />}
            {pingedOut && out.status === "confirmed" && <span key={out.n} className="ping-burst" />}
            {pingedOut && <span className={`ping-dot ${out.status}`} title={out.status === "failed" ? "Ping failed" : `Pinged ${fmtAge(outAge)}`} />}
            {pingedMe && <span className="ping-burst incoming" />}
          </span>
          <span className="member-main">
            <span className="member-top">
              <span className="name">{m.name}</span>
              <span key={stateBump} className={`dot ${m.state} ${stateBump ? "ring" : ""}`} title={m.state} />
              {projects[m.user] && <span className="project" title="Project">{projects[m.user]}</span>}
            </span>
            <span key={areaBump} className={`scope ${areaBump ? "flash" : ""}`} title={m.area}>{areaLabel(m.area)}</span>
          </span>
          <span className="age big">{seenLabel(m, seen)}</span>
        </button>
      </div>
    </li>
  );
}

interface StackProps { boards: Board[]; focus: Focus; selected: string | null; onSelect: (user: string | null) => void }

export function MemberStack({ boards, focus, selected, onSelect }: StackProps) {
  const now = useNow();
  const clash = clashingUsers(boards.flatMap((b) => b.members));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onSelect(null); };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onSelect]);
  let i = 0;
  return (
    <div className="stacks">
      {boards.map((b) => (
        <section key={b.team} className="stack-group">
          {boards.length > 1 && <h3 className="group-title">{b.team}{b.members.some((m) => m.sim) && <span className="tag sim">sim</span>}</h3>}
          <ul className={`stack ${b.members.some((m) => clash.has(m.user)) ? "has-clash" : ""}`}>
            {b.members.map((m) => (
              <MemberCard
                key={m.user} m={m} now={now} i={i++} clash={clash.has(m.user)} focus={focus}
                selected={selected === m.user} onToggle={() => onSelect(selected === m.user ? null : m.user)}
              />
            ))}
            {b.members.length === 0 && <li className="empty">—</li>}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Left-column panel: the selected person's head (like their card) plus their live details. */
export function SelectedMember({ m, feed, onFocus, onClose }: { m: Member | undefined; feed: FeedItem[]; onFocus: FocusFn; onClose: () => void }) {
  const now = useNow();
  const projects = useProjects();
  if (!m) return <section className="selected-panel empty-state" aria-label="Selected person">Pick someone <span className="wide-only">on the right</span><span className="narrow-only">below</span> to see what they're doing.</section>;
  return (
    <section className={`selected-panel ${m.state}`} aria-label={`${m.name}'s details`}>
      <header className="selected-head">
        <span className="avatar" aria-hidden>{m.name.slice(0, 1)}</span>
        <span className="member-top">
          <h2 className="name">{m.name}</h2>
          <span className={`dot ${m.state}`} title={m.state} />
          {projects[m.user] && <span className="project" title="Project">{projects[m.user]}</span>}
        </span>
        <span className="age big">{seenLabel(m, ageSec(m.lastSeen, now))}</span>
        <button className="icon-btn" onClick={onClose} aria-label="Close details" title="Close (Esc)">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        </button>
      </header>
      <MemberDetail key={m.user} m={m} feed={feed} onFocus={onFocus} />
    </section>
  );
}

const feedKey = (f: FeedItem) => `${f.at}|${f.kind}|${f.text}`;

export function Feed({ items }: { items: FeedItem[] }) {
  const sorted = [...items].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 12);
  const seen = useRef<Set<string> | null>(null);
  const fresh = seen.current ? new Set(sorted.map(feedKey).filter((k) => !seen.current!.has(k))) : new Set<string>();
  useEffect(() => {
    seen.current = new Set([...(seen.current ?? []), ...sorted.map(feedKey)]);
  });
  return (
    <section className="feed">
      <ul>
        {sorted.map((f) => {
          const k = feedKey(f);
          return (
            <li key={k} className={[f.kind === "alert" && "alert", fresh.has(k) && "new"].filter(Boolean).join(" ")}>
              <span className="t">{clock(f.at)}</span>
              <span className={`tag ${f.kind}`}>{f.kind}</span>
              <span className="feed-text">{f.text}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
