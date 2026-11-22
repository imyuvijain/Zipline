// Areas look like "repo:team23-hack/server/export" or "doc:Pricing page draft".

function parse(area: string) {
  const i = area.indexOf(":");
  const kind = i > 0 ? area.slice(0, i) : "repo";
  const rest = (i > 0 ? area.slice(i + 1) : area).replace(/\\/g, "/");
  return { kind, segs: rest.split("/").filter(Boolean) };
}

/**
 * Overlap stage 1 path rule (SPEC §2c): same repo and a shared path prefix at least 2 folders
 * deep below the repo ("server/export" counts; the repo root or "src/" alone don't).
 * Non-repo areas (docs) overlap only on an exact, case-insensitive match.
 */
export function overlaps(a: string, b: string): boolean {
  const A = parse(a);
  const B = parse(b);
  if (A.kind !== B.kind) return false;
  if (A.kind !== "repo") return A.segs.join("/").toLowerCase() === B.segs.join("/").toLowerCase();
  let common = 0;
  while (common < A.segs.length && common < B.segs.length && A.segs[common] === B.segs[common]) common++;
  return common >= 3; // repo name + 2 folders
}

const normFile = (f: string) => f.replace(/\\/g, "/").replace(/^file:/, "").replace(/^\.\//, "").toLowerCase();

/** Files both claims list (paths compared by suffix, so absolute vs repo-relative still match). */
export function sharedFiles(a: string[] = [], b: string[] = []): string[] {
  const B = b.map(normFile);
  return a.filter((f) => {
    const x = normFile(f);
    return B.some((y) => x === y || x.endsWith("/" + y) || y.endsWith("/" + x));
  });
}

/** Stage 1 (no AI): is this pair a candidate, and is it a strong one? */
export function stage1(
  older: { area: string; branch?: string; files?: string[] },
  newer: { area: string; branch?: string; files?: string[] },
) {
  const files = sharedFiles(newer.files, older.files);
  const path = overlaps(older.area, newer.area);
  const candidate = path || files.length > 0;
  const strong = candidate && (files.length > 0 || (!!older.branch && older.branch === newer.branch && path));
  return { candidate, strong, files };
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
