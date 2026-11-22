// End-to-end smoke test: fake scouts over WebSocket + HTTP calls.
// Usage: start the server, then `npm run smoke` (SERVER_URL defaults to http://localhost:8787).
const BASE = process.env.SERVER_URL ?? "http://localhost:8787";
const WS = BASE.replace(/^http/, "ws");

const post = (path: string, body: unknown) =>
  fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
const get = (path: string) => fetch(BASE + path).then((r) => r.json());

function scout(user: string, reply?: (q: string) => string) {
  const got: any[] = [];
  const ws = new WebSocket(`${WS}/ws?user=${user}`);
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data));
    got.push(m);
    if (m.type === "ask" && reply) {
      ws.send(JSON.stringify({
        type: "summary", askId: m.askId,
        summary: { user, text: reply(m.question), refs: ["file:server/export/csv.ts"], at: new Date().toISOString() },
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

const maxim = await scout("maxim", () => "Maxim is building the CSV export in server/export/csv.ts and fixing a failing test.");
const richard = await scout("richard"); // never answers asks -> exercises the timeout path

await post("/heartbeat", { user: "maxim" });
await post("/heartbeat", { user: "richard" });
check("claim maxim", (await post("/claim", { user: "maxim", area: "repo:team23-hack/server/export", since: new Date().toISOString() })).ok);

const r2 = await post("/claim", { user: "richard", area: "repo:team23-hack/server/export/csv", since: new Date().toISOString() });
await sleep(200);
check("collision alert returned to new claimer", r2.alerts?.[0]?.kind === "collision", r2);
check("collision alert pushed over WS to richard", richard.got.some((m) => m.type === "alert"), richard.got);
check("no alert to maxim", !maxim.got.some((m) => m.type === "alert"), maxim.got);
const r3 = await post("/claim", { user: "richard", area: "repo:team23-hack/server/export/csv", since: new Date().toISOString() });
check("pair muted on repeat", (r3.alerts ?? []).length === 0, r3);

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
console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
