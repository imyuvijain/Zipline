import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type Database from 'better-sqlite3'

export interface SharedAnswer {
  asker: string
  purpose: 'answer' | 'intent'
  at: string
  text: string
  refs: string[]
}

export function localSharing(db: Pick<Database.Database, 'exec' | 'prepare'>, user: string) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sharing_settings (user TEXT PRIMARY KEY, paused INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS shared_answers (
      id INTEGER PRIMARY KEY, user TEXT NOT NULL, at TEXT NOT NULL, asker TEXT NOT NULL,
      purpose TEXT NOT NULL, text TEXT NOT NULL, refs TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS shared_answers_user_id ON shared_answers(user, id DESC);
  `)
  const readSetting = db.prepare('SELECT paused FROM sharing_settings WHERE user = ?')
  const writeSetting = db.prepare('INSERT OR REPLACE INTO sharing_settings (user, paused) VALUES (?, ?)')
  const insert = db.prepare('INSERT INTO shared_answers (user, at, asker, purpose, text, refs) VALUES (?, ?, ?, ?, ?, ?)')
  const entries = db.prepare('SELECT at, asker, purpose, text, refs FROM shared_answers WHERE user = ? ORDER BY id DESC LIMIT 100')
  const prune = db.prepare('DELETE FROM shared_answers WHERE at <= ?')
  let controller = new AbortController()
  if ((readSetting.get(user) as { paused: number } | undefined)?.paused) controller.abort()
  return {
    get paused() { return controller.signal.aborted },
    get signal() { return controller.signal },
    setPaused(paused: boolean) {
      if (paused === controller.signal.aborted) return false
      writeSetting.run(user, Number(paused))
      if (paused) controller.abort()
      else controller = new AbortController()
      return true
    },
    record(answer: SharedAnswer) {
      insert.run(user, answer.at, answer.asker, answer.purpose, answer.text, JSON.stringify(answer.refs))
    },
    expire(cutoff: number) {
      prune.run(new Date(cutoff).toISOString())
    },
    snapshot(area: string | null) {
      const rows = entries.all(user) as (Omit<SharedAnswer, 'refs'> & { refs: string })[]
      return { user, area, paused: controller.signal.aborted, entries: rows.map(row => ({ ...row, refs: JSON.parse(row.refs) })) }
    }
  }
}

export async function startSharingPage(
  port: number, sharing: ReturnType<typeof localSharing>, currentArea: () => string | null,
  onChange: () => void
) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('MURMUR_SHARING_PORT must be a port from 1 to 65535.')
  const html = readFileSync(new URL('./sharing.html', import.meta.url), 'utf8')
  const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(([, script]) =>
    "'sha256-" + createHash('sha256').update(script).digest('base64') + "'")
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`])
  const server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Content-Security-Policy', `default-src 'none'; script-src ${hashes.join(' ')}; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`)
    if (!hosts.has(req.headers.host ?? '') || (req.headers.origin && req.headers.origin !== 'http://' + req.headers.host)) {
      res.writeHead(403).end()
      return
    }
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html)
      return
    }
    if (req.method === 'POST' && (req.url === '/api/pause' || req.url === '/api/resume')) {
      if (req.headers['x-zipline-local'] !== '1') {
        res.writeHead(403).end()
        return
      }
      if (sharing.setPaused(req.url === '/api/pause')) onChange()
    } else if (req.method !== 'GET' || req.url !== '/api/sharing') {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(sharing.snapshot(currentArea())))
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  console.log(`Local sharing controls: http://localhost:${port}`)
  return server
}
