import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Board, FeedItem } from "../../shared/types.ts";
import { ageSec, clock, fmtAge, useNow } from "./time.ts";

type Member = Board["members"][number];
export type Focus = { users: Set<string>; phase: "asking" | "done" } | null;

const areaLabel = (area?: string) => (area ? area.replace(/^repo:[^/]+\//, "").replace(/^doc:/, "") : "—");

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

interface CardProps { m: Member; now: number; i: number; clash: boolean; focus: Focus; onAsk: (m: Member) => void }

function MemberCard({ m, now, i, clash, focus, onAsk }: CardProps) {
  const areaBump = useChangeCount(m.area ?? "");
  const stateBump = useChangeCount(m.state);
  const seen = ageSec(m.lastSeen, now);
  const focused = focus?.users.has(m.user);
  const cls = ["member", m.state, clash && "clash", focused && `focus ${focus!.phase}`].filter(Boolean).join(" ");
  return (
    <li style={{ "--i": i } as CSSProperties}>
      <button className={cls} onClick={() => onAsk(m)} aria-label={`Ask what ${m.name} is doing`}>
        <span className="avatar" aria-hidden>
          {m.name.slice(0, 1)}
          {focused && focus!.phase === "asking" && <span className="avatar-ring" />}
        </span>
        <span className="member-main">
          <span className="member-top">
            <span className="name">{m.name}</span>
            <span key={stateBump} className={`dot ${m.state} ${stateBump ? "ring" : ""}`} title={m.state} />
          </span>
          <span key={areaBump} className={`scope ${areaBump ? "flash" : ""}`} title={m.area}>{areaLabel(m.area)}</span>
        </span>
        <span className="age big">{m.state === "offline" ? `${Math.floor(seen / 60)}m` : fmtAge(seen)}</span>
      </button>
    </li>
  );
}

export function MemberStack({ boards, focus, onAsk }: { boards: Board[]; focus: Focus; onAsk: (m: Member) => void }) {
  const now = useNow();
  const clash = clashingUsers(boards.flatMap((b) => b.members));
  let i = 0;
  return (
    <div className="stacks">
      {boards.map((b) => (
        <section key={b.team} className="stack-group">
          {boards.length > 1 && <h3 className="group-title">{b.team}{b.members.some((m) => m.sim) && <span className="tag sim">sim</span>}</h3>}
          <ul className={`stack ${b.members.some((m) => clash.has(m.user)) ? "has-clash" : ""}`}>
            {b.members.map((m) => (
              <MemberCard key={m.user} m={m} now={now} i={i++} clash={clash.has(m.user)} focus={focus} onAsk={onAsk} />
            ))}
            {b.members.length === 0 && <li className="empty">—</li>}
          </ul>
        </section>
      ))}
    </div>
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
