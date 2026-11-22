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
