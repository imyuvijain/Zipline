import type { Board } from "../../shared/types.ts";
import { dismissPing, usePings } from "./pings.ts";
import { fmtAge, useNow } from "./time.ts";

type Member = Board["members"][number];

/** When someone pings you: a card at the top of the stack, plus their card glows. */
export function IncomingPings({ nameOf, onOpen }: { nameOf: (u: string) => string; onOpen: (u: string) => void }) {
  const { received } = usePings();
  const now = useNow();
  if (received.length === 0) return null;
  return (
    <div className="incoming-list" aria-live="assertive">
      {received.map((r) => (
        <section key={r.id} className="incoming">
          <button className="incoming-main" onClick={() => { onOpen(r.from); dismissPing(r.id); }}>
            <span className="avatar sm" aria-hidden>{nameOf(r.from).slice(0, 1)}<span className="ping-burst incoming" /></span>
            <span className="name">{nameOf(r.from)}</span>
            {r.text && <span className="incoming-text">{r.text}</span>}
            <span className="age">{fmtAge((now - r.at) / 1000)}</span>
          </button>
          <button className="icon-btn" onClick={() => dismissPing(r.id)} aria-label="Dismiss">
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          </button>
        </section>
      ))}
    </div>
  );
}
export type { Member };
