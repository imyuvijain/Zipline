import type { Board, FeedItem } from "../../shared/types.ts";
import { ageSec, clock, fmtAge, useNow } from "./time.ts";

type Member = Board["members"][number];

const areaLabel = (area?: string) => (area ? area.replace(/^repo:[^/]+\//, "").replace(/^doc:/, "📄 ") : "—");

function MemberCard({ m, now }: { m: Member; now: number }) {
  const seen = ageSec(m.lastSeen, now);
  return (
    <li className={`member ${m.state}`}>
      <div className="avatar" aria-hidden>{m.name.slice(0, 1)}</div>
      <div className="member-main">
        <div className="member-top">
          <span className="name">{m.name}</span>
          <span className={`dot ${m.state}`} title={m.state} aria-label={m.state} />
        </div>
        <div className="member-where">
          <span className="scope" title={m.area}>{areaLabel(m.area)}</span>
        </div>
      </div>
      <div className="member-seen">
        <span className="age big">{fmtAge(seen)}</span>
      </div>
    </li>
  );
}

export function MemberStack({ boards }: { boards: Board[] }) {
  const now = useNow();
  return (
    <div className="stacks">
      {boards.map((b) => (
        <section key={b.team} className="stack-group">
          {boards.length > 1 && <h3 className="group-title">{b.team}{b.members.some((m) => m.sim) && <span className="tag sim">sim</span>}</h3>}
          <ul className="stack">
            {b.members.map((m) => <MemberCard key={m.user} m={m} now={now} />)}
            {b.members.length === 0 && <li className="empty">—</li>}
          </ul>
        </section>
      ))}
    </div>
  );
}

const KIND_LABEL: Record<FeedItem["kind"], string> = { claim: "claim", alert: "alert", ask: "ask", fail: "fail", done: "done" };

export function Feed({ items }: { items: FeedItem[] }) {
  const sorted = [...items].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 12);
  return (
    <section className="feed">
      <ul>
        {sorted.map((f, i) => (
          <li key={f.at + i}>
            <span className="t">{clock(f.at)}</span>
            <span className={`tag ${f.kind}`}>{KIND_LABEL[f.kind]}</span>
            <span className="feed-text">{f.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
