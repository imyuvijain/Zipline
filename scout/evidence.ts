import { isAbsolute } from 'node:path'
import { secret } from './ollama.js'

export type Activity = { kind: string; at: number; detail: string }

function clean(value: unknown, limit: number) {
  return typeof value === 'string' && value !== '[REDACTED]' && !secret.test(value)
    ? value.slice(0, limit) : undefined
}

export function buildEvidence(rows: Activity[]) {
  const evidence: object[] = []
  const refs = new Map<number, string>()
  let remaining = 14_000
  for (const row of rows) {
    let detail: Record<string, unknown>
    try {
      detail = JSON.parse(row.detail)
      if (!detail || typeof detail !== 'object') continue
    } catch {
      continue
    }
    const id = evidence.length + 1
    const at = new Date(row.at).toISOString()
    let entry: object
    let ref: string | undefined
    switch (row.kind) {
      case 'save': {
        const file = clean(detail.file, 513)
        if (!file || file.length > 512 || isAbsolute(file) ||
            /[\x00-\x1f\x7f]/.test(file) || file.split('/').includes('..')) continue
        entry = { id, at, file }
        ref = `file:${file}`
        break
      }
      case 'git-commit': {
        const head = clean(detail.head, 65)
        if (!head || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(head)) continue
        entry = { id, at, commit: head, commits: clean(detail.commits, 1_000) }
        ref = `commit:${head}`
        break
      }
      case 'command': {
        const command = clean(detail.command, 400)
        if (!command || !Number.isInteger(detail.exitCode)) continue
        const executable = command.match(/^\s*([\w.-]{1,48})(?=\s|$)/)?.[1]
        entry = { id, at, command, exitCode: detail.exitCode }
        if (executable) ref = `command:${executable}`
        break
      }
      case 'git-change':
        entry = { at, branch: clean(detail.branch, 100), status: clean(detail.status, 600), diff: clean(detail.diff, 1_600) }
        break
      case 'window':
        entry = { at, app: clean(detail.app, 100), title: clean(detail.title, 250) }
        break
      default:
        continue
    }
    remaining -= JSON.stringify(entry).length
    if (remaining < 0) break
    evidence.push(entry)
    if (ref) refs.set(id, ref)
  }
  return { evidence, refs }
}
