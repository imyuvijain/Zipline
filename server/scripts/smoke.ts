// End-to-end smoke test: fake scouts over WebSocket + HTTP calls.
// Usage: start the server, then `npm run smoke` (SERVER_URL defaults to http://localhost:8787).
const BASE = process.env.SERVER_URL ?? "http://localhost:8787";
const WS = BASE.replace(/^http/, "ws");

const post = (path: string, body: unknown) =>
  fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
const get = (path: string) => fetch(BASE + path).then((r) => r.json());

// reply(question, purpose) -> text, or null to stay silent (exercises the timeout path)
function scout(user: string, reply?: (q: string, purpose: string) => string | null, client = "scout") {
  const got: any[] = [];
  const ws = new WebSocket(`${WS}/ws?user=${user}${client === "web" ? "&client=web" : ""}`);
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data));
    got.push(m);
    const text = m.type === "ask" && reply ? reply(m.question, m.purpose ?? "answer") : null;
    if (text) {
      ws.send(JSON.stringify({
        type: "summary", askId: m.askId,
        summary: { user, text, refs: ["file:server/export/csv.ts"], at: new Date().toISOString() },
      }));
    }
  };
  return new Promise<{ ws: WebSocket; got: any[] }>((res) => (ws.onopen = () => res({ ws, got })));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name: string, ok: boolean, extra?: unknown) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`, ok ? "" : JSON.stringify(extra));
  if (!ok) fails++;
};

const maxim = await scout("maxim", (_q, purpose) =>
  purpose === "intent" ? "Adding CSV export headers" : "Maxim is building the CSV export in server/export/csv.ts and fixing a failing test.");
// Richard answers intent checks but never normal asks (exercises the timeout path).
const richard = await scout("richard", (_q, purpose) => (purpose === "intent" ? "Fixing auth on the export endpoint" : null));
const richardWeb = await scout("richard", undefined, "web");

await post("/heartbeat", { user: "maxim" });
await post("/heartbeat", { user: "richard" });
const now = () => new Date().toISOString();
check("claim maxim", (await post("/claim", { user: "maxim", area: "repo:zipline/server/export", since: now(), files: ["server/export/csv.ts"] })).ok);

// Stage 1: shared folder 2 deep + shared file -> strong candidate. Stage 2 runs in the background.
const r2 = await post("/claim", { user: "richard", area: "repo:zipline/server/export/csv", since: now(), files: ["zipline/server/export/csv.ts"] });
check("stage 1 flags a candidate", r2.checking === 1, r2);
await sleep(1500);
const ping = richard.got.find((m) => m.type === "overlap_ping");
check("overlap_ping to new claimer (no Claude key -> unsure -> ping)", !!ping, richard.got);
check("overlap_ping to earlier claimer too", maxim.got.some((m) => m.type === "overlap_ping"), maxim.got);
check("ping text names both tasks", /CSV export headers/i.test(ping?.text ?? "") && /auth/.test(ping?.text ?? ""), ping);
check("web socket gets the ping", richardWeb.got.some((m) => m.type === "overlap_ping"), richardWeb.got);
check("web socket never gets asks", !richardWeb.got.some((m) => m.type === "ask"), richardWeb.got);
check("intent asks don't fire asked_about_you", !maxim.got.some((m) => m.type === "asked_about_you"), maxim.got);
check("answer endpoint", (await post(`/overlap/${ping?.overlapId}/answer`, { user: "richard", same: false })).ok === true);
check("answer rejects outsiders", (await post(`/overlap/${ping?.overlapId}/answer`, { user: "yuvi", same: true })).ok === false);
const r3 = await post("/claim", { user: "richard", area: "repo:zipline/server/export/csv", since: now() });
check("pair + area muted on repeat", r3.checking === 0, r3);
const r4 = await post("/claim", { user: "anshi", area: "repo:zipline/server/routes", since: now() });
check("1-folder-deep share is not a candidate", r4.checking === 0, r4);
check("overlaps list", (await get("/overlaps")).length === 1);

// /ping: web nudge -> target laptop + web tabs
const pr = await post("/ping", { from: "maxim", to: "richard", text: "got a sec?" });
await sleep(200);
check("ping delivered", pr.ok === true && pr.delivered === true, pr);
check("ping reaches web tab", richardWeb.got.some((m) => m.type === "ping" && m.from === "maxim" && m.text === "got a sec?"), richardWeb.got);
check("ping unknown user 404s", (await post("/ping", { from: "maxim", to: "nobody" })).ok === false);

const board = await get("/board");
const bm = board.members.find((m: any) => m.user === "maxim");
check("board shows maxim active in area", bm?.state === "active" && bm?.area?.includes("server/export"), bm);
check("board feed has claim", board.feed.some((f: any) => f.kind === "claim"), board.feed);

let t = Date.now();
const a1 = await post("/ask", { asker: "richard", target: "maxim", question: "what's Maxim doing?" });
console.log(`      ${Date.now() - t}ms ->`, a1.answer);
check("one-person ask forwards laptop summary", a1.answer?.includes("CSV export") && a1.sources?.[0]?.label === "Maxim's laptop", a1);
await sleep(200);
check("asked_about_you sent to maxim", maxim.got.some((m) => m.type === "asked_about_you" && m.asker === "richard"), maxim.got);
const log = await get("/asks?user=maxim");
check("asks_log records what was sent", log[0]?.sent?.includes("CSV export"), log);

const a2 = await post("/ask", { asker: "maxim", target: "yuvi", question: "what's Yuvi doing?" });
check("offline fallback", /offline/.test(a2.answer), a2);

t = Date.now();
const a3 = await post("/ask", { asker: "maxim", target: "team", question: "what is the team doing?" });
console.log(`      ${Date.now() - t}ms ->`, a3.answer);
check("team ask answers", typeof a3.answer === "string" && a3.answer.length > 0 && !a3.cached, a3);
const a4 = await post("/ask", { asker: "maxim", target: "team", question: "what is the team doing?" });
check("team ask cached second time", a4.cached === true, a4);

const a5 = await post("/ask", { asker: "maxim", target: "dept", question: "what's engineering blocked on?" });
console.log(`      dept ->`, a5.answer);
check("dept ask includes sim sources", a5.sources?.some((s: any) => s.label.includes("(sim)")), a5);

check("sim board", (await get("/board?team=team-payments")).members.every((m: any) => m.sim), null);

maxim.ws.close();
richard.ws.close();
richardWeb.ws.close();
console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
