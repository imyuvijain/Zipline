// Server-side AI: team/dept answers and overlap verdicts.
// Backend, in order of preference:
//   1. A hosted local model, when LLM_URL is set (Ollama by default, or any OpenAI-compatible API).
//   2. Claude Haiku, when ANTHROPIC_API_KEY is set.
//   3. Nothing: callers fall back (plain digest for answers, "same task?" ping for overlaps).
// Every function returns null on failure so callers can fall back.
import Anthropic from "@anthropic-ai/sdk";

const LLM_URL = process.env.LLM_URL?.replace(/\/+$/, "");        // e.g. https://friend-box.example.com  or  http://host:11434
const LLM_API = (process.env.LLM_API ?? "ollama").toLowerCase();  // "ollama" | "openai"
const LLM_MODEL = process.env.LLM_MODEL ?? "qwen2.5:3b";
const LLM_KEY = process.env.LLM_API_KEY;                          // optional bearer token
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS ?? 6_000);
const CLAUDE_MODEL = process.env.CLAUDE_MODEL ?? "claude-haiku-5-5";

let claude: Anthropic | null = null;
if (LLM_URL) {
  console.log(`[ai] using hosted model ${LLM_MODEL} at ${LLM_URL} (${LLM_API} API)`);
} else if (process.env.ANTHROPIC_API_KEY) {
  // Tight timeout: /ask has a 12s budget and the laptops already used up to 6s of it.
  claude = new Anthropic({ timeout: 5_000, maxRetries: 0 });
  console.log(`[ai] using ${CLAUDE_MODEL}`);
} else {
  console.warn("[ai] no LLM_URL or ANTHROPIC_API_KEY: team answers use a plain digest, overlaps always ping");
}

export const aiBackend = LLM_URL ? `${LLM_API}:${LLM_MODEL}` : claude ? CLAUDE_MODEL : "none";

/** One system + user turn. `json` asks the model for a JSON object. */
async function complete(system: string, user: string, opts: { maxTokens: number; json?: boolean }): Promise<string | null> {
  if (LLM_URL) return completeLocal(system, user, opts);
  if (!claude) return null;
  try {
    const res = await claude.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: opts.maxTokens,
      output_config: { effort: "low" },
      system,
      messages: [{ role: "user", content: user }],
    });
    if (res.stop_reason === "refusal") return null;
    return res.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim() || null;
  } catch (err) {
    if (err instanceof Anthropic.APIError) console.warn(`[ai] Claude API error ${err.status}: ${err.message}`);
    else console.warn("[ai] Claude request failed:", (err as Error).message);
    return null;
  }
}

async function completeLocal(system: string, user: string, opts: { maxTokens: number; json?: boolean }): Promise<string | null> {
  const messages = [{ role: "system", content: system }, { role: "user", content: user }];
  const openai = LLM_API === "openai";
  const url = openai ? `${LLM_URL}/chat/completions` : `${LLM_URL}/api/chat`;
  const body = openai
    ? { model: LLM_MODEL, messages, max_tokens: opts.maxTokens, temperature: 0.2, ...(opts.json ? { response_format: { type: "json_object" } } : {}) }
    : { model: LLM_MODEL, messages, stream: false, keep_alive: "5m", options: { num_predict: opts.maxTokens, temperature: 0.2 }, ...(opts.json ? { format: "json" } : {}) };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(LLM_KEY ? { authorization: `Bearer ${LLM_KEY}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[ai] hosted model HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    const data = (await res.json()) as any;
    const text: string | undefined = openai ? data?.choices?.[0]?.message?.content : data?.message?.content;
    return text?.trim() || null;
  } catch (err) {
    console.warn("[ai] hosted model request failed:", (err as Error).message);
    return null;
  }
}

const SYSTEM = `You answer questions about what a software team is working on right now.
You only know what is in the status notes you are given. Each note comes from a teammate's laptop and says how old it is.
Answer in 2-3 short sentences of plain text (no markdown, no lists). Name people and the files or areas they are in.
Point out when two people are working in the same area, or when someone looks blocked (failing tests, repeated errors).
If the notes don't answer the question, say so briefly. Never invent work that isn't in the notes.`;

/** Team / dept answer over the laptop summaries. */
export async function synthesize(question: string, notes: string): Promise<string | null> {
  const text = await complete(SYSTEM, `Status notes:\n${notes}\n\nQuestion: ${question}`, { maxTokens: 400 });
  return text ? text.slice(0, 700) : null;
}

export interface Verdict { verdict: "same" | "related" | "different"; confidence: number; reason: string }

const VERDICT_SYSTEM = `Two teammates are working in the same part of a codebase. Decide whether they are doing the same task.
"same" = they would duplicate each other's work. "related" = different tasks that touch the same code and should coordinate. "different" = unrelated tasks that just live nearby.
Reply with only a JSON object: {"verdict": "same" | "related" | "different", "confidence": number between 0 and 1, "reason": "one short line naming the tasks"}`;

/** Overlap stage 2: compare two one-line intents. */
export async function compareIntents(input: {
  area: string; a: { name: string; task: string; files: string[] }; b: { name: string; task: string; files: string[] }; sharedFiles: string[];
}): Promise<Verdict | null> {
  const body = [
    `Area: ${input.area}`,
    `${input.a.name}: ${input.a.task}${input.a.files.length ? ` (files: ${input.a.files.join(", ")})` : ""}`,
    `${input.b.name}: ${input.b.task}${input.b.files.length ? ` (files: ${input.b.files.join(", ")})` : ""}`,
    input.sharedFiles.length ? `Both recently saved: ${input.sharedFiles.join(", ")}` : "",
  ].filter(Boolean).join("\n");
  const text = await complete(VERDICT_SYSTEM, body, { maxTokens: 200, json: true });
  if (!text) return null;
  try {
    const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    const verdict = String(json.verdict ?? "").toLowerCase();
    if (!["same", "related", "different"].includes(verdict)) return null;
    return {
      verdict: verdict as Verdict["verdict"],
      confidence: Math.max(0, Math.min(1, Number(json.confidence) || 0)),
      reason: String(json.reason ?? "").slice(0, 160),
    };
  } catch {
    console.warn("[ai] overlap verdict was not valid JSON:", text.slice(0, 120));
    return null;
  }
}
