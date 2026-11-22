import { useEffect, useState } from "react";
import type { Board } from "../../shared/types.ts";
import { getBoard, type Source } from "./api.ts";

/** Polls /board for every team every 3s (spec §5 P3). */
export function useBoards(teams: string[]) {
  const [boards, setBoards] = useState<Record<string, Board>>({});
  const [source, setSource] = useState<Source>("fixtures");
  const key = teams.join(",");
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const results = await Promise.all(teams.map(getBoard));
      if (!alive) return;
      setBoards(Object.fromEntries(results.map((r, i) => [teams[i], r.board])));
      setSource(results[0]?.source ?? "fixtures");
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => { alive = false; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { boards, source };
}
