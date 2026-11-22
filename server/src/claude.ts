// Team / dept answers: one Claude Haiku call over the laptop summaries.
// Returns null on any failure so the caller can fall back to a plain digest.
import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.CLAUDE_MODEL ?? "claude-haiku-5-5";

let client: Anthropic | null = null;
if (process.env.ANTHROPIC_API_KEY) {
  // Tight timeout: /ask has a 12s budget and the laptops already used up to 6s of it.
  client = new Anthropic({ timeout: 5_000, maxRetries: 0 });
} else {
  console.warn("[claude] ANTHROPIC_API_KEY not set: team/dept answers will use the plain digest fallback");
}

const SYSTEM = `You answer questions about what a software team is working on right now.
You only know what is in the status notes you are given. Each note comes from a teammate's laptop and says how old it is.
Answer in 2-3 short sentences of plain text (no markdown, no lists). Name people and the files or areas they are in.
Point out when two people are working in the same area, or when someone looks blocked (failing tests, repeated errors).
If the notes don't answer the question, say so briefly. Never invent work that isn't in the notes.`;

export interface Verdict { verdict: "same" | "related" | "different"; confidence: number; reason: string }

const VERDICT_SYSTEM = `Two teammates are working in the same part of a codebase. Decide whether they are doing the same task.
"same" = they would duplicate each other's work. "related" = different tasks that touch the same code and should coordinate. "different" = unrelated tasks that just live nearby.
Reply with only a JSON object: {"verdict": "same" | "related" | "different", "confidence": number between 0 and 1, "reason": "one short line naming the tasks"}`;

/** Overlap stage 2: compare two one-line intents. Null on any failure. */
export async function compareIntents(input: {
  area: string; a: { name: string; task: string; files: string[] }; b: { name: string; task: string; files: string[] }; sharedFiles: string[];
}): Promise<Verdict | null> {
  if (!client) return null;
  const body = [
    `Area: ${input.area}`,
    `${input.a.name}: ${input.a.task}${input.a.files.length ? ` (files: ${input.a.files.join(", ")})` : ""}`,
    `${input.b.name}: ${input.b.task}${input.b.files.length ? ` (files: ${input.b.files.join(", ")})` : ""}`,
    input.sharedFiles.length ? `Both recently saved: ${input.sharedFiles.join(", ")}` : "",
  ].filter(Boolean).join("\n");
  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      output_config: { effort: "low" },
      system: VERDICT_SYSTEM,
      messages: [{ role: "user", content: body }],
    });
    if (res.stop_reason === "refusal") return null;
    const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    if (!["same", "related", "different"].includes(json.verdict)) return null;
    return {
      verdict: json.verdict,
      confidence: Math.max(0, Math.min(1, Number(json.confidence) || 0)),
      reason: String(json.reason ?? "").slice(0, 160),
    };
  } catch (err) {
    console.warn("[claude] overlap verdict failed:", (err as Error).message);
    return null;
  }
}

export async function synthesize(question: string, notes: string): Promise<string | null> {
  if (!client) return null;
  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      output_config: { effort: "low" },
      system: SYSTEM,
      messages: [{ role: "user", content: `Status notes:\n${notes}\n\nQuestion: ${question}` }],
    });
    if (res.stop_reason === "refusal") return null;
    const text = res.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    return text || null;
  } catch (err) {
    if (err instanceof Anthropic.APIError) console.warn(`[claude] API error ${err.status}: ${err.message}`);
    else console.warn("[claude] request failed:", (err as Error).message);
    return null;
  }
}
