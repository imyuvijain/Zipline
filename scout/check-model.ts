import './env.mjs'
import assert from 'node:assert/strict'
import { buildEvidence } from './evidence.js'
import { localAnswer, localOllama } from './ollama.js'

// Exercise the same model, prompt, evidence and reference decoding as a live ask.
// This fixture stays on the laptop, including when SERVER_URL is set.
const file = 'scout/sharing.ts'
const { evidence, refs } = buildEvidence([
  { kind: 'save', at: Date.now(), detail: JSON.stringify({ file }) },
  { kind: 'command', at: Date.now() - 1000, detail: JSON.stringify({ command: 'npm test', exitCode: 0 }) }
])
const endpoint = localOllama(process.env.OLLAMA_URL)
const started = performance.now()
const answer = await localAnswer(endpoint, 'Which file was just saved?', false, evidence, AbortSignal.timeout(120_000))
assert.ok(answer.text.includes('sharing.ts'), 'The model did not name the observed file.')
assert.ok(answer.refs.some(id => refs.get(id) === `file:${file}`), 'The model did not cite the observed save.')
console.log(`qwen2.5:3b · ${((performance.now() - started) / 1000).toFixed(1)}s · ${answer.text}`)
console.log(answer.refs.flatMap(id => refs.get(id) ?? []).join(' · '))
