import './env.mjs'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, realpathSync } from 'node:fs'
import type { Stats } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { basename, delimiter, dirname, isAbsolute, join, relative, sep } from 'node:path'
import { promisify } from 'node:util'
import type Database from 'better-sqlite3'
import { watch } from 'chokidar'
import { secret, redact, localOllama } from './ollama.js'
import { collectFreshSaves } from './fresh-saves.js'
import type { Activity } from './evidence.js'
import { localSharing, startSharingPage } from './sharing.js'
import { connectScout } from './ws.js'
import { listenShell } from './shell-socket.js'

const exec = promisify(execFile)
const user = process.env.MURMUR_USER ?? 'maxim'
const fastClaim = process.env.DEMO_FAST_CLAIM === '1'
const claimDelay = fastClaim ? 0 : 15_000
const endpoint = new URL(process.env.SERVER_URL ?? 'http://localhost:8787')
const ollama = localOllama(process.env.OLLAMA_URL)
const roots = (process.env.WATCH_REPOS ?? '').split(delimiter).filter(Boolean)
if (!roots.length) throw new Error('Set WATCH_REPOS to the Git checkout path(s).')
if (!/^[\w.-]+$/.test(user) || secret.test(user)) throw new Error('Invalid MURMUR_USER.')
if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
  throw new Error('SERVER_URL must be an HTTP(S) URL without credentials.')
}

async function git(root: string, ...args: string[]) {
  const { stdout } = await exec('git', ['--no-optional-locks', '-C', root, ...args], {
    timeout: 4_000, maxBuffer: 1024 * 1024
  })
  return stdout
}

const repos = [...new Set(await Promise.all(roots.map(async path => {
  try {
    return realpathSync((await git(path, 'rev-parse', '--show-toplevel')).trimEnd())
  } catch {
    throw new Error('Each WATCH_REPOS entry must be inside a readable Git checkout.')
  }
})))].sort((a, b) => b.length - a.length)

const configuredName = process.env.MURMUR_REPO_NAME
if (configuredName && (repos.length !== 1 || !/^[\w.-]+$/.test(configuredName) || secret.test(configuredName))) {
  throw new Error('MURMUR_REPO_NAME requires one watched repository and a safe repository name.')
}
const repoNames = new Map(await Promise.all(repos.map(async repo => {
  const origin = (await git(repo, 'remote', 'get-url', 'origin').catch(() => '')).trim()
  const name = origin.replace(/\/+$/, '').split(/[/:]/).at(-1)?.replace(/\.git$/, '')
  return [repo, configuredName || name || basename(repo)] as const
})))

function repoFor(path: string) {
  return repos.find(repo => {
    const subpath = relative(repo, path)
    return subpath !== '..' && !subpath.startsWith('..' + sep) && !isAbsolute(subpath)
  })
}

const home = join(homedir(), '.murmur')
mkdirSync(home, { recursive: true, mode: 0o700 })
chmodSync(home, 0o700)
const socketPath = join(home, 'scout.sock')
const dbPath = join(home, 'buffer.db')
process.umask(0o077)
const require = createRequire(import.meta.url)
type ActivityDatabase = Pick<Database.Database, 'exec' | 'prepare' | 'close'>
const builtin = process.getBuiltinModule?.('node:sqlite') as
  { DatabaseSync: new (path: string) => ActivityDatabase } | undefined
let db: ActivityDatabase
if (builtin) {
  db = new builtin.DatabaseSync(dbPath)
} else {
  try {
    const NativeDatabase = require('better-sqlite3') as typeof Database
    db = new NativeDatabase(dbPath)
  } catch {
    throw new Error('Node 20 requires a working better-sqlite3 install. Run npm ci or use Node 22.13+.')
  }
}
chmodSync(dbPath, 0o600)
db.exec(`
  PRAGMA secure_delete = ON;
  CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY, at INTEGER NOT NULL, kind TEXT NOT NULL,
    repo TEXT, folder TEXT, detail TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS activity_at ON activity(at);
  CREATE INDEX IF NOT EXISTS activity_kind_id ON activity(kind, id);
`)
const sharing = localSharing(db, user)
const insert = db.prepare('INSERT INTO activity (at, kind, repo, folder, detail) VALUES (?, ?, ?, ?, ?)')
const prune = db.prepare('DELETE FROM activity WHERE at <= ?')
const recent = db.prepare("SELECT repo, folder FROM activity WHERE kind = 'save' AND at >= ? ORDER BY id DESC LIMIT 10")
const areaSaves = db.prepare(`
  SELECT json_extract(detail, '$.file') AS file
  FROM activity
  WHERE kind = 'save' AND repo = ? AND folder = ? AND at >= ?
  ORDER BY id DESC
`)
const answerRows = db.prepare('SELECT kind, at, detail FROM activity WHERE at > ? ORDER BY id DESC LIMIT 48')
const retention = 30 * 60_000
function record(kind: string, detail: Record<string, string | number>, repo?: string, folder?: string) {
  const sanitized = Object.fromEntries(Object.entries(detail).map(([key, value]) =>
    [key, typeof value === 'string' ? redact(value) : value]))
  const at = Date.now()
  insert.run(at, kind, repo ? redact(repo) : null, folder === undefined ? null : redact(folder),
    JSON.stringify(sanitized))
  return at
}

function expire() {
  const cutoff = Date.now() - retention
  prune.run(cutoff)
  sharing.expire(cutoff)
}

const gitPaths = ['.', ':(exclude,glob)**/.worktrees', ':(exclude,glob)**/.worktrees/**']
const branches = new Map<string, string>()
const gitState = new Map<string, { head: string; fingerprint: string }>()

async function collectGit(repo: string, fresh = false, signal?: AbortSignal) {
  try {
    const [headText, branchText] = await Promise.all([
      git(repo, 'rev-parse', '--verify', 'HEAD').catch(() => ''),
      git(repo, 'branch', '--show-current')
    ])
    const head = headText.trim()
    const branch = branchText.trim() || (head ? `detached:${head.slice(0, 12)}` : 'unknown')
    branches.set(repo, redact(branch))

    const [status, diff] = await Promise.all([
      git(repo, 'status', '--porcelain=v1', '--untracked-files=all', '--', ...gitPaths),
      git(repo, 'diff', '--no-ext-diff', '--no-textconv', ...(head ? [head] : ['--cached']), '--', ...gitPaths)
        .catch(() => '[Diff unavailable]')
    ])
    const fingerprint = createHash('sha256').update(status).update('\0').update(diff).digest('hex')
    const previous = gitState.get(repo)
    signal?.throwIfAborted()
    if (fresh || (previous?.fingerprint !== fingerprint && (previous || status || diff))) {
      record('git-change', { branch, status, diff }, repo)
    }
    if (head && previous && head !== previous.head) {
      const commits = await git(repo, 'log', '-20', '--format=%H %s',
        previous.head ? `${previous.head}..${head}` : head, '--', ...gitPaths)
      signal?.throwIfAborted()
      if (commits) record('git-commit', { branch, head, commits }, repo)
    }
    gitState.set(repo, { head, fingerprint })
  } catch {
    console.error('Git activity sample unavailable.')
  }
}

let lastWindow: string | undefined
async function collectWindow(fresh = false, signal?: AbortSignal) {
  if (process.platform !== 'darwin') return
  try {
    const { stdout } = await exec('/usr/bin/osascript', ['-e', `
      tell application "System Events"
        set frontApp to first application process whose frontmost is true
        set appName to name of frontApp
        set windowTitle to ""
        try
          set windowTitle to name of front window of frontApp
        end try
        return appName & linefeed & windowTitle
      end tell`], { timeout: 4_000 })
    const [app, ...titleLines] = stdout.trimEnd().split('\n')
    const title = titleLines.join('\n')
    const sample = JSON.stringify([redact(app), redact(title)])
    signal?.throwIfAborted()
    if (fresh || sample !== lastWindow) record('window', { app, title })
    lastWindow = sample
  } catch {
    if (lastWindow !== '') console.error('Active app sample unavailable. Check macOS permissions.')
    lastWindow = ''
  }
}

async function post(path: '/heartbeat' | '/claim', body: object) {
  const permission = sharing.signal
  if (permission.aborted) return false
  try {
    const response = await fetch(new URL(path, endpoint), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.any([permission, AbortSignal.timeout(5_000)])
    })
    await response.body?.cancel()
    if (permission.aborted) return false
    if (response.ok) return true
    console.error(`${path} returned HTTP ${response.status}.`)
  } catch {
    if (!permission.aborted) console.error(`${path} is unavailable.`)
  }
  return false
}

function claimFiles(repo: string, folder: string, cutoff: number) {
  const counts = new Map<string, number>()
  for (const { file } of areaSaves.all(repo, folder, cutoff) as { file: string | null }[]) {
    if (!file || file === '[REDACTED]' || secret.test(file)) continue
    counts.set(file, (counts.get(file) ?? 0) + 1)
  }
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([file]) => file)
}

let firstDemoSaveAt: number | undefined
let candidate: { repo: string; area: string; branch: string; since: string; started: number } | undefined
let sent: string | undefined
let claimInFlight = false
async function evaluateClaim() {
  if (fastClaim && firstDemoSaveAt === undefined) return
  const cutoff = Date.now() - retention
  const saves = recent.all(Math.max(cutoff, firstDemoSaveAt ?? 0)) as { repo: string; folder: string }[]
  const counts = new Map<string, number>()
  for (const save of saves) {
    const key = JSON.stringify(save)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  // Map iteration preserves newest-first order for equal counts.
  const winner = [...counts].sort((a, b) => b[1] - a[1])[0]
  const save = winner && JSON.parse(winner[0]) as { repo: string; folder: string } | undefined
  const branch = save && branches.get(save.repo)
  const name = save && repoNames.get(save.repo)
  if (!save || !branch || !name || save.folder === '[REDACTED]') {
    candidate = undefined
    sent = undefined
    return
  }
  const area = redact(`repo:${name}${save.folder ? '/' + save.folder : ''}`)
  if (area === '[REDACTED]' || branch === '[REDACTED]') {
    candidate = undefined
    sent = undefined
    return
  }
  if (candidate?.repo !== save.repo || candidate.area !== area || candidate.branch !== branch) {
    candidate = { repo: save.repo, area, branch, since: new Date().toISOString(), started: performance.now() }
  }
  const key = JSON.stringify([area, branch])
  if (sharing.paused || claimInFlight || key === sent || performance.now() - candidate.started < claimDelay) return
  claimInFlight = true
  try {
    const files = claimFiles(save.repo, save.folder, cutoff)
    if (await post('/claim', { user, area, branch, since: candidate.since, files })) sent = key
  } finally {
    claimInFlight = false
  }
}

const commands = createServer(socket => {
  const chunks: Buffer[] = []
  let size = 0
  socket.setTimeout(2_000, () => socket.destroy())
  socket.on('error', () => socket.destroy())
  socket.on('data', chunk => {
    size += chunk.length
    if (size > 65_536) socket.destroy()
    else chunks.push(chunk)
  })
  socket.on('end', () => {
    const [cwd, code, command, ...extra] = Buffer.concat(chunks).toString().split('\0')
    if (!cwd || !isAbsolute(cwd) || !/^\d{1,3}$/.test(code) || Number(code) > 255 ||
        !command || extra.length) return
    const repo = repoFor(cwd)
    if (repo && !ignored(cwd)) record('command', { command, exitCode: Number(code), cwd }, repo)
  })
})
await listenShell(commands, socketPath, db).catch((err: NodeJS.ErrnoException) => {
  if (err.code === 'EPERM' || err.code === 'EACCES') {
    console.error('Shell command capture is unavailable. Socket access was denied.')
    return
  }
  throw err
})

const startedWatching = Date.now()
const seenSaves = new Map<string, { stamp: string; at: number }>()
function ignored(path: string) {
  return path === home || path.startsWith(home + sep) ||
    relative(repoFor(path) ?? path, path).split(sep).some(part => part === '.git' || part === '.worktrees' || part === 'node_modules')
}
function captureSave(path: string, stats?: Stats) {
  const repo = repoFor(path)
  if (!repo) return
  if (stats) {
    const key = createHash('sha256').update(path).digest('hex')
    const stamp = `${stats.mtimeMs}:${stats.ctimeMs}:${stats.size}`
    if (seenSaves.get(key)?.stamp === stamp) return
    seenSaves.set(key, { stamp, at: Date.now() })
  }
  const file = relative(repo, path)
  const folder = dirname(file)
  const at = record('save', { file }, repo, folder === '.' ? '' : folder)
  if (fastClaim) firstDemoSaveAt ??= at
  void evaluateClaim()
}

expire()
await Promise.all(repos.map(repo => collectGit(repo)))

let disconnect: (() => void) | undefined
function updateSharing() {
  disconnect?.()
  disconnect = undefined
  if (sharing.paused) return
  disconnect = connectScout(endpoint, user, ollama, refreshForAsk, sharing.record)
  sent = undefined
  void post('/heartbeat', { user })
  void evaluateClaim()
}
const sharingPage = await startSharingPage(Number(process.env.MURMUR_SHARING_PORT ?? 4545), sharing,
  () => candidate?.area ?? null, updateSharing)
const watcher = watch(repos, {
  ignoreInitial: true,
  followSymlinks: false,
  atomic: true,
  alwaysStat: true,
  awaitWriteFinish: { stabilityThreshold: 75, pollInterval: 15 },
  ignored
})
watcher.on('all', (event, path, stats) => {
  if (event === 'add' || event === 'change') captureSave(path, stats)
})
watcher.on('error', () => console.error('File activity watcher reported an error.'))
watcher.on('ready', () => console.log('Zipline scout is watching for saves.'))

let currentSample: Promise<unknown> | undefined
function sample(fresh = false, signal?: AbortSignal) {
  currentSample = Promise.all([
    ...repos.map(repo => collectGit(repo, fresh, signal)),
    collectWindow(fresh, signal)
  ]).finally(() => { currentSample = undefined })
  return currentSample
}

async function refreshForAsk(signal: AbortSignal) {
  const freshSaves = collectFreshSaves(repos, ignored, Math.max(startedWatching, Date.now() - retention), captureSave, signal)
  await Promise.all([freshSaves, (async () => {
    while (currentSample) await currentSample
    signal.throwIfAborted()
    await sample(true, signal)
  })()])
  signal.throwIfAborted()
  return answerRows.all(Date.now() - retention) as Activity[]
}

updateSharing()
setInterval(() => void post('/heartbeat', { user }), 15_000)
void sample()
setInterval(() => {
  const cutoff = Date.now() - retention
  for (const [key, save] of seenSaves) {
    if (save.at < cutoff) seenSaves.delete(key)
  }
  if (!currentSample) void sample().then(evaluateClaim)
}, 10_000)
setInterval(() => {
  expire()
  void evaluateClaim()
}, 1_000)
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.once(signal, () => {
    disconnect?.()
    sharingPage.close()
    void watcher.close()
    commands.close(() => process.exit(0))
  })
}
