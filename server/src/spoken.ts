// toSpoken: turn a display script (exact paths, branches, endpoints) into text a TTS voice reads naturally.
//   "scout/src/summarize.ts" -> "the summarize file in scout"   "shared/types.ts" -> "the shared types file"
//   "/board" -> "the board endpoint"   "qwen2.5:3b" -> "the Qwen model"   "p2/server" -> "the server branch"
//   "13:30" -> "1:30"   "JSON" -> "jay-son"   "WS" -> "web socket"   "(exit 1)" -> "failed"

const SKIP_DIRS = new Set(["src", "lib", "app", "dist", "pkg", "internal"]);
const words = (s: string) => s.replace(/[-_]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim();

function pathToWords(path: string): string {
  const segs = path.split("/").filter(Boolean);
  const file = segs.pop() ?? "";
  const dot = file.lastIndexOf(".");
  const hasExt = dot > 0;
  const base = words(hasExt ? file.slice(0, dot) : file);
  const dirs = segs.filter((s) => !SKIP_DIRS.has(s)).map(words);
  if (!hasExt) {
    // A directory-ish path ("server/export") or an extensionless file ("server/Dockerfile").
    if (/^[A-Z]/.test(file) || /^(makefile|dockerfile|readme)$/i.test(file)) return `the ${[...dirs, base].join(" ")}`;
    return `the ${[...dirs, base].join(" ")} folder`;
  }
  if (dirs.length === 0) return `the ${base} code`;
  if (segs.length === 1) return `the ${dirs[0]} ${base}`;
  return `the ${base} code in the ${dirs[0]}`;
}

export function toSpoken(text: string): string {
  let s = text;
  s = s.replace(/`/g, "");
  // "(exit 1)" -> "failed"; a clean exit says nothing.
  s = s.replace(/\s*\(exit\s+0\)/gi, "").replace(/\s*\(exit\s+-?[1-9]\d*\)/gi, " failed");
  // Areas like "repo:team23-hack/server" -> "the server area"
  s = s.replace(/(?:\bthe\s+)?\brepo:[\w.-]+\/([\w./-]*[\w-])/g, (_m, rest: string) => `the ${rest.split("/").map(words).join(" ")} area`);
  s = s.replace(/\b(?:repo|file|cmd|commit|doc):/g, "");
  // Model tags: "Ollama qwen2.5:3b" -> "the Qwen model"
  s = s.replace(/(?:\bthe\s+)?(?:\bOllama(?:'s)?\s+)?\b(qwen|llama|mistral|gemma|phi|deepseek)[\w.-]*(?::[\w.-]+)?(?:\s+model)?/gi,
    (_m, name: string) => `the ${name.charAt(0).toUpperCase()}${name.slice(1).toLowerCase()} model`);
  // Branch names: "p2/server" -> "the server branch"
  s = s.replace(/(?:\bthe\s+)?\bp\d+\/([\w-]+)(?:\s+branch)?\b/gi, (_m, b: string) => `the ${words(b)} branch`);
  // File / folder paths (need at least one slash and no leading slash).
  // A leading "the" is absorbed; "your"/"Anshi's" replace it ("your the ask file" -> "your ask file").
  s = s.replace(/(?:\b(the|your|my|our|his|her|their|[A-Z][\w-]*'s)\s+)?(?<![\w/:.])((?:[\w.-]+\/)+[\w.-]*\w)/g,
    (_m, det: string | undefined, p: string) => (det && det.toLowerCase() !== "the" ? `${det} ${pathToWords(p).replace(/^the /, "")}` : pathToWords(p)));
  // Endpoints: " /board" -> " the board endpoint"
  s = s.replace(/(?:\bthe\s+)?(^|[\s(])\/([a-z][\w-]*)(?=[\s.,;:!?)]|$)/gi, (_m, pre: string, ep: string) => `${pre}the ${words(ep)} page`);
  // Bare file names: "types.ts" -> "the types file"
  s = s.replace(/(?:\bthe\s+)?\b([\w-]+)\.(tsx?|jsx?|mjs|json|md|py|go|rs|ya?ml|css|html|sh)\b/g, (_m, b: string) => `the ${words(b)} code`);
  // 24h times: "13:30" -> "1:30", "00:15" -> "12:15"
  s = s.replace(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g, (_m, h: string, m: string) => {
    const n = Number(h) % 12 || 12;
    return `${n}:${m}`;
  });
  s = s.replace(/\b([a-z]+):([a-z]+)\b/g, "$1 $2"); // "format:json" -> "format json"
  // Drop debugging tails a person wouldn't say out loud: "; tried format:json, 3 failed runs"
  s = s.replace(/;\s*tried[^.]*?(,\s*(\d+) failed runs?)?(?=\.|$)/gi, (_m, _r, n) => (n ? `, and it's failed ${n} times` : ""));
  s = s.replace(/\b(returns?|returning|outputs?)\s+invalid\s+json\b/gi, "keeps giving back broken output");
  s = s.replace(/\bjson\b/gi, "jay-son").replace(/\bWS\b/g, "web socket");
  s = s.replace(/\bthe the\b/gi, "the").replace(/\s+([.,;:!?])/g, "$1").replace(/\s{2,}/g, " ").trim();
  return s;
}
