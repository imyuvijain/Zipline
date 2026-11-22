import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useLocalRuntime,
  type ChatModelAdapter,
  type ThreadMessage,
} from "@assistant-ui/react";
import type { AskRequest, Board, Source as AskSource } from "../../shared/types.ts";
import { ask, ME } from "./api.ts";
import { fmtAge, useNow } from "./time.ts";
import { Mark } from "./Mark.tsx";
import { areaLabel, clashingUsers } from "./Board.tsx";

type Member = Board["members"][number];
type FocusFn = (target: AskRequest["target"], phase: "asking" | "done") => void;
interface Ctx { members: Member[]; defaultTarget: AskRequest["target"]; scopeLabel: string; onFocus?: FocusFn }

interface AskMeta {
  phase: "asking" | "done";
  label: string;
  startedAt: number;
  elapsedMs?: number;
  sources?: AskSource[];
  asOfSec?: number;
  cached?: boolean;
  fixture?: boolean;
}

/** Figure out who the question is about: a named person, the team, or the dept. */
function resolveTarget(q: string, ctx: Ctx): { target: AskRequest["target"]; label: string } {
  const text = q.toLowerCase();
  const hit = ctx.members.find((m) => new RegExp(`\\b(${m.user}|${m.name.toLowerCase()})\\b`).test(text));
  if (hit) return { target: hit.user, label: `${hit.name}'s laptop` };
  if (/\b(dept|department|engineering|org|everyone in eng)\b/.test(text)) return { target: "dept", label: "Engineering" };
  if (/\b(team|everyone|we|us)\b/.test(text)) return { target: "team", label: "Team" };
  return { target: ctx.defaultTarget, label: ctx.defaultTarget === "dept" ? "Engineering" : ctx.scopeLabel };
}

const lastUserText = (messages: readonly ThreadMessage[]) => {
  const m = [...messages].reverse().find((x) => x.role === "user");
  return m?.content.map((p) => (p.type === "text" ? p.text : "")).join(" ").trim() ?? "";
};

function makeAdapter(ctxRef: React.RefObject<Ctx>): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal }) {
      const question = lastUserText(messages);
      const { target, label } = resolveTarget(question, ctxRef.current!);
      const startedAt = Date.now();
      yield { metadata: { custom: { phase: "asking", label, startedAt } satisfies AskMeta } };
      ctxRef.current!.onFocus?.(target, "asking");
      let res;
      try {
        res = await ask({ asker: ME, target, question }, abortSignal);
      } finally {
        ctxRef.current!.onFocus?.(target, "done");
      }
      yield {
        content: [{ type: "text", text: res.answer }],
        metadata: {
          custom: {
            phase: "done", label, startedAt, elapsedMs: Date.now() - startedAt,
            sources: res.sources, asOfSec: res.asOfSec, cached: res.cached, fixture: res.fixture,
          } satisfies AskMeta,
        },
      };
    },
  };
}

function AskingStatus({ meta }: { meta: AskMeta }) {
  useNow(100);
  return (
    <div className="status">
      <span className="spinner" />
      {meta.label} · {((Date.now() - meta.startedAt) / 1000).toFixed(1)}s
    </div>
  );
}

function AssistantMessage({ message }: { message: ThreadMessage }) {
  const meta = message.metadata?.custom as unknown as AskMeta | undefined;
  const running = message.status?.type === "running";
  return (
    <MessagePrimitive.Root className="msg assistant">
      <div className="msg-head"><Mark className={`claude-mark ${running ? "pulse" : ""}`} /></div>
      {meta && running && <AskingStatus meta={meta} />}
      {!running && <div className="msg-body"><MessagePrimitive.Parts /></div>}
      {message.status?.type === "incomplete" && <div className="status err">No response</div>}
      {meta?.phase === "done" && (
        <div className="sources">
          {meta.sources?.map((s, i) => <span key={i} className="src" style={{ "--i": i } as CSSProperties}>{s.label} · {fmtAge(s.ageSec)}</span>)}
          {meta.cached && <span className="src">cached</span>}
          {meta.fixture && <span className="src warn" title="Server unreachable; sample answer from shared/fixtures.json">fixture</span>}
          <span className="src muted">{((meta.elapsedMs ?? 0) / 1000).toFixed(1)}s</span>
        </div>
      )}
    </MessagePrimitive.Root>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="msg user">
      <div className="msg-body"><MessagePrimitive.Parts /></div>
    </MessagePrimitive.Root>
  );
}

export function ChatPanel({ members, shown, defaultTarget, scopeLabel, onFocus, pending }: Ctx & { shown: Member[]; pending: { text: string; n: number } | null }) {
  const ctxRef = useRef<Ctx>({ members, defaultTarget, scopeLabel, onFocus });
  ctxRef.current = { members, defaultTarget, scopeLabel, onFocus };
  const adapter = useMemo(() => makeAdapter(ctxRef), []);
  const runtime = useLocalRuntime(adapter);

  // A click on a member card sends "What's X doing?" without typing.
  useEffect(() => {
    if (pending) runtime.thread.append({ role: "user", content: [{ type: "text", text: pending.text }] });
  }, [pending?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  // Max 3, driven by what's on screen. A collision outranks everything (Von Restorff).
  const clash = clashingUsers(shown);
  const clashArea = shown.find((m) => clash.has(m.user))?.area;
  const rank = { active: 0, idle: 1, offline: 2 } as const;
  const people = [...shown].sort((a, b) => rank[a.state] - rank[b.state]).slice(0, clashArea ? 1 : 2);
  const suggestions = [
    ...(clashArea ? [{ text: `Who else is on ${areaLabel(clashArea)}?`, hot: true }] : []),
    ...people.map((m) => ({ text: `What's ${m.name} doing?`, hot: false })),
    { text: defaultTarget === "dept" ? "What's engineering blocked on?" : "What's the team on?", hot: false },
  ].slice(0, 3);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <aside className="panel">
        <header className="panel-head">
          <span className="panel-title"><Mark className="claude-mark" /> Claude</span>
        </header>
        <ThreadPrimitive.Root className="thread">
          <ThreadPrimitive.Viewport className="viewport">
            <ThreadPrimitive.Empty>
              <div className="welcome">
                <div className="suggestions">
                  {suggestions.map((s) => (
                    <ThreadPrimitive.Suggestion key={s.text} prompt={s.text} send className={`suggestion ${s.hot ? "hot" : ""}`}>{s.text}</ThreadPrimitive.Suggestion>
                  ))}
                </div>
              </div>
            </ThreadPrimitive.Empty>
            <ThreadPrimitive.Messages>
              {({ message }) => (message.role === "user" ? <UserMessage /> : <AssistantMessage message={message} />)}
            </ThreadPrimitive.Messages>
          </ThreadPrimitive.Viewport>
          <ComposerPrimitive.Root className="composer">
            <ComposerPrimitive.Input className="composer-input" placeholder="Ask…" rows={2} autoFocus />
            <div className="composer-foot">
              <span className="ctx-chip">@{scopeLabel}</span>
              <ComposerPrimitive.Send className="send" aria-label="Send">↑</ComposerPrimitive.Send>
            </div>
          </ComposerPrimitive.Root>
        </ThreadPrimitive.Root>
      </aside>
    </AssistantRuntimeProvider>
  );
}
