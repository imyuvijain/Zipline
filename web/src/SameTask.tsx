import { useEffect, useState } from "react";
import type { ServerToScout } from "../../shared/types.ts";
import { answerOverlap } from "./api.ts";
import { areaLabel } from "./Board.tsx";
import { onServerEvent } from "./serverEvents.ts";

type Ping = Extract<ServerToScout, { type: "overlap_ping" }>;

/** "Same task?" cards for overlap_ping. Answers go to POST /overlap/:id/answer. */
export function SameTaskCards({ nameOf }: { nameOf: (user: string) => string }) {
  const [pings, setPings] = useState<Ping[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(
    () => onServerEvent("overlap_ping", (p) => setPings((xs) => [p, ...xs.filter((x) => x.overlapId !== p.overlapId)])),
    [],
  );

  const answer = async (p: Ping, same: boolean) => {
    setBusy(p.overlapId);
    setFailed(null);
    try {
      await answerOverlap(p.overlapId, same);
      setPings((xs) => xs.filter((x) => x.overlapId !== p.overlapId));
    } catch {
      setFailed(p.overlapId);
    } finally {
      setBusy(null);
    }
  };

  if (pings.length === 0) return null;
  return (
    <div className="same-task-list">
      {pings.map((p) => (
        <section key={p.overlapId} className={`same-task ${failed === p.overlapId ? "failed" : ""}`} aria-live="polite">
          <div className="same-task-head">
            <span className="avatar sm" aria-hidden>{nameOf(p.other).slice(0, 1)}</span>
            <span className="name">{nameOf(p.other)}</span>
            <span className="scope">{areaLabel(p.area)}</span>
          </div>
          <p className="same-task-text">{p.text}</p>
          <div className="same-task-actions">
            <button className="btn primary" disabled={busy === p.overlapId} onClick={() => answer(p, true)}>Yes, let's sync</button>
            <button className="btn" disabled={busy === p.overlapId} onClick={() => answer(p, false)}>No, different</button>
          </div>
        </section>
      ))}
    </div>
  );
}
