// Voice catch-up calls (SPEC §2b). Minimal, self-contained styling: Richard restyles.
// Mount once: <IncomingCall/>. It rings on the `incoming_call` WS push, or when <CatchMeUp/> fires.
import { useEffect, useRef, useState } from "react";
import type { AskResponse, BriefKind, BriefRequest, BriefResponse, UserId } from "../../../shared/types.ts";
import { ME } from "../api.ts";
import { onServerEvent } from "../serverEvents.ts";
import { AgentCall, prepareAgent, type AgentSession } from "./AgentCall.tsx";
import team from "../../../shared/team.json";

const IS_MANAGER = ME === (team as { manager?: string }).manager;

const BASE = (import.meta.env.VITE_SERVER_URL as string | undefined) ?? "";

interface Ringing { briefId?: string; brief?: BriefResponse; title: string; from: UserId | "zipline" }

// Lets <CatchMeUp/> open a call without prop drilling.
const openers = new Set<(r: Ringing) => void>();

export async function startCatchup(kind: BriefKind = "catchup") {
  const body: BriefRequest = { for: ME, kind };
  const res = await fetch(BASE + "/brief", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`/brief HTTP ${res.status}`);
  const brief = (await res.json()) as BriefResponse;
  const title = kind === "manager_digest" ? "Zipline: your team digest" : "Zipline: your catch-up";
  openers.forEach((fn) => fn({ brief, title, from: "zipline" }));
}

function ringtone(): () => void {
  let ctx: AudioContext | null = null;
  try { ctx = new AudioContext(); } catch { return () => {}; }
  const beep = () => {
    if (!ctx) return;
    for (const [freq, at] of [[440, 0], [480, 0], [440, 0.5], [480, 0.5]] as const) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = freq;
      g.gain.value = 0.06;
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + at);
      o.stop(ctx.currentTime + at + 0.4);
    }
  };
  beep();
  const t = setInterval(beep, 2500);
  return () => { clearInterval(t); ctx?.close(); ctx = null; };
}

function speak(text: string, onEnd: () => void) {
  if (!("speechSynthesis" in window)) return onEnd();
  const u = new SpeechSynthesisUtterance(text);
  u.onend = onEnd;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

/** `trigger` also renders a small floating "Catch me up" button (manager gets the team digest). */
export function IncomingCall({ trigger = false }: { trigger?: boolean }) {
  const [ring, setRing] = useState<Ringing | null>(null);
  const [brief, setBrief] = useState<BriefResponse | null>(null);
  const [status, setStatus] = useState<"ringing" | "live" | "ended">("ringing");
  const [mode, setMode] = useState<"agent" | "elevenlabs" | "browser" | null>(null);
  const [agent, setAgent] = useState<AgentSession | null>(null);
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const open = (r: Ringing) => { setRing(r); setBrief(r.brief ?? null); setStatus("ringing"); setAnswer(null); setMode(null); setAgent(null); };
    openers.add(open);
    const off = onServerEvent("incoming_call", (e) => open({ briefId: e.briefId, title: e.title, from: e.from }));
    return () => { openers.delete(open); off(); };
  }, []);

  useEffect(() => (ring && status === "ringing" ? ringtone() : undefined), [ring, status]);

  const hangUp = () => {
    audio.current?.pause();
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    setRing(null);
    setBrief(null);
    setAgent(null);
  };

  const playTts = async (b: BriefResponse) => {
    const a = new Audio();
    audio.current = a;
    a.onended = () => setStatus("ended");
    try {
      // 503 = no ElevenLabs key on the server: fall back to browser speech.
      const probe = await fetch(BASE + b.audioUrl);
      if (!probe.ok) throw new Error(String(probe.status));
      a.src = URL.createObjectURL(await probe.blob());
      await a.play();
      setMode("elevenlabs");
    } catch {
      setMode("browser");
      speak(b.script, () => setStatus("ended"));
    }
  };

  const answerCall = async () => {
    if (!ring) return;
    setStatus("live");
    let b = brief;
    if (!b && ring.briefId) {
      try { b = (await (await fetch(`${BASE}/brief/${ring.briefId}`)).json()) as BriefResponse; setBrief(b); } catch { return; }
    }
    if (!b) return;
    // Manager review: talk-back agent when configured and the mic is allowed; otherwise the TTS mp3.
    const session = b.kind === "manager_digest" ? await prepareAgent(b.id) : null;
    if (session) { setAgent(session); setMode("agent"); return; }
    await playTts(b);
  };

  const agentFailed = (why: string) => {
    console.warn("[call] agent session failed, playing TTS:", why);
    setAgent(null);
    if (brief) void playTts(brief);
  };

  const ask = async () => {
    if (!q.trim()) return;
    setAnswer("…");
    try {
      const res = await fetch(BASE + "/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ asker: ME, target: "team", question: q }) });
      const r = (await res.json()) as AskResponse;
      setAnswer(r.answer);
    } catch {
      setAnswer("Couldn't reach the server.");
    }
  };

  if (!ring)
    return trigger ? (
      <div style={S.trigger}>
        {IS_MANAGER ? <TeamReview /> : <CatchMeUp />}
      </div>
    ) : null;
  return (
    <div style={S.backdrop} role="dialog" aria-label="Incoming call">
      <div style={S.card}>
        <div style={S.title}>{ring.title}</div>
        <div style={S.sub}>{status === "ringing" ? "Incoming call…" : status === "live" ? `On call${mode ? ` (${mode === "agent" ? "live agent" : mode === "elevenlabs" ? "ElevenLabs" : "browser voice"})` : ""}` : "Call ended"}</div>
        {status === "ringing" ? (
          <div style={S.row}>
            <button style={S.btn} onClick={answerCall}>Answer</button>
            <button style={S.btn} onClick={hangUp}>Decline</button>
          </div>
        ) : mode === "agent" && agent ? (
          <AgentCall session={agent} onFail={agentFailed} onHangUp={hangUp} style={S} />
        ) : (
          <>
            <p style={S.script}>{brief?.script ?? "Loading…"}</p>
            <div style={S.chips}>
              {brief?.sources.map((s, i) => <span key={i} style={S.chip}>{s.label} · {Math.round(s.ageSec / 60)}m</span>)}
            </div>
            <div style={S.row}>
              <input style={S.input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()} placeholder="Ask a follow-up" />
              <button style={S.btn} onClick={ask}>Ask</button>
            </div>
            {answer && <p style={S.script}>{answer}</p>}
            <div style={S.row}><button style={S.btn} onClick={hangUp}>Hang up</button></div>
          </>
        )}
      </div>
    </div>
  );
}

export function CatchMeUp({ kind = "catchup", label = "Catch me up" }: { kind?: BriefKind; label?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button disabled={busy} onClick={() => { setBusy(true); startCatchup(kind).catch(console.warn).finally(() => setBusy(false)); }}>
      {busy ? "Calling…" : label}
    </button>
  );
}

/** Manager-only: rings a manager_digest call (AI team review with talk-back). Renders nothing for non-managers. */
export function TeamReview() {
  return IS_MANAGER ? <CatchMeUp kind="manager_digest" label="Team review" /> : null;
}

const S: Record<string, React.CSSProperties> = {
  backdrop: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 48, zIndex: 1000 },
  card: { background: "Canvas", color: "CanvasText", width: "min(560px, calc(100vw - 32px))", borderRadius: 12, padding: 20, boxShadow: "0 10px 40px rgba(0,0,0,0.3)" },
  title: { fontSize: 18, fontWeight: 600 },
  sub: { opacity: 0.7, marginTop: 4 },
  row: { display: "flex", gap: 8, marginTop: 12 },
  btn: { padding: "8px 14px", cursor: "pointer" },
  script: { lineHeight: 1.5, marginTop: 12, whiteSpace: "pre-wrap" },
  chips: { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 },
  chip: { fontSize: 12, padding: "2px 8px", border: "1px solid currentColor", borderRadius: 999, opacity: 0.75 },
  input: { flex: 1, padding: 8 },
  trigger: { position: "fixed", right: 16, bottom: 16, zIndex: 900 },
};
