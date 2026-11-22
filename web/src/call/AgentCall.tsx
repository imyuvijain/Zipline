// Talk-back manager review: an ElevenLabs Agent session (signed URL from the server, key stays server-side).
// The brief script is the agent's first message; follow-ups go through the ask_zipline client tool -> POST /ask.
import { useEffect, useRef, useState } from "react";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import type { AskResponse } from "../../../shared/types.ts";
import { ME } from "../api.ts";
import { toSpoken } from "../../../server/src/spoken.ts";

const BASE = (import.meta.env.VITE_SERVER_URL as string | undefined) ?? "";

export interface AgentSession { signedUrl: string; agentId: string; script: string; displayScript?: string }

/** Fetch the signed URL and make sure the mic is allowed. Null means: fall back to the TTS mp3. */
export async function prepareAgent(briefId: string): Promise<AgentSession | null> {
  try {
    const res = await fetch(`${BASE}/brief/${briefId}/agent-session`);
    if (!res.ok) return null;
    const s = (await res.json()) as AgentSession;
    const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
    mic.getTracks().forEach((t) => t.stop());
    return s.signedUrl ? s : null;
  } catch {
    return null; // no agent configured, or mic denied
  }
}

async function askZipline(params: Record<string, unknown>): Promise<string> {
  const target = String(params.target ?? "team").toLowerCase();
  const question = String(params.question ?? "What are they working on?");
  try {
    const res = await fetch(BASE + "/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ asker: ME, target, question }) });
    return toSpoken(((await res.json()) as AskResponse).answer || "Zipline has no answer for that.");
  } catch {
    return "Zipline couldn't reach the team right now.";
  }
}

interface Props { session: AgentSession; onFail: (why: string) => void; onHangUp: () => void; style: Record<string, React.CSSProperties> }

export function AgentCall(props: Props) {
  return (
    <ConversationProvider>
      <AgentInner {...props} />
    </ConversationProvider>
  );
}

function AgentInner({ session, onFail, onHangUp, style: S }: Props) {
  const [lines, setLines] = useState<{ who: "Zipline" | "You"; text: string }[]>([]);
  const connected = useRef(false);
  const started = useRef(false);
  const conv = useConversation({
    onConnect: () => { connected.current = true; },
    onMessage: (m) => setLines((l) => [...l, { who: m.source === "user" ? "You" : "Zipline", text: m.message }]),
    onError: (msg) => { if (!connected.current) onFail(msg); },
    onDisconnect: () => { if (!connected.current) onFail("disconnected before connecting"); },
  });

  useEffect(() => {
    if (started.current) return; // StrictMode double-mount
    started.current = true;
    conv.startSession({
      signedUrl: session.signedUrl,
      overrides: { agent: { firstMessage: session.script } },
      clientTools: { ask_zipline: askZipline },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hangUp = () => { conv.endSession(); onHangUp(); };

  return (
    <>
      <div style={S.sub}>
        {conv.status === "connected" ? (conv.isSpeaking ? "Zipline is speaking… (interrupt any time)" : "Listening… ask a follow-up") : `Connecting (${conv.status})…`}
      </div>
      <div style={{ ...S.script, maxHeight: 260, overflowY: "auto" }}>
        {(lines.length ? lines : [{ who: "Zipline" as const, text: session.script }]).map((l, i) => (
          <p key={i} style={{ margin: "6px 0" }}><b>{l.who}:</b> {l.text}</p>
        ))}
      </div>
      <div style={S.row}><button style={S.btn} onClick={hangUp}>Hang up</button></div>
    </>
  );
}
