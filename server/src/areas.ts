// Areas look like "repo:team23-hack/server/export" or "doc:Pricing page draft".

function parse(area: string) {
  const i = area.indexOf(":");
  const kind = i > 0 ? area.slice(0, i) : "repo";
  const rest = (i > 0 ? area.slice(i + 1) : area).replace(/\\/g, "/");
  return { kind, segs: rest.split("/").filter(Boolean) };
}

/**
 * Two repo areas overlap when one is a whole-segment prefix of the other and they share
 * at least repo + one folder (so claiming the repo root doesn't collide with everyone).
 * Non-repo areas (docs) overlap only on an exact, case-insensitive match.
 */
export function overlaps(a: string, b: string): boolean {
  const A = parse(a);
  const B = parse(b);
  if (A.kind !== B.kind) return false;
  if (A.kind !== "repo") return A.segs.join("/").toLowerCase() === B.segs.join("/").toLowerCase();
  const n = Math.min(A.segs.length, B.segs.length);
  if (n < 2) return false;
  for (let i = 0; i < n; i++) if (A.segs[i] !== B.segs[i]) return false;
  return true;
}

/** "repo:team23-hack/server/export" -> "server/export"; "doc:Pricing page draft" -> "Pricing page draft". */
export function displayArea(area: string): string {
  const { kind, segs } = parse(area);
  if (kind === "repo" && segs.length > 1) return segs.slice(1).join("/");
  return segs.join("/");
}

const fmt = new Intl.DateTimeFormat("en-CA", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: process.env.DISPLAY_TZ ?? "America/Toronto",
});
export const hhmm = (iso: string) => fmt.format(new Date(iso));

export function ago(sec: number): string {
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)} min ago`;
  return `${Math.round(sec / 3600)}h ago`;
}
