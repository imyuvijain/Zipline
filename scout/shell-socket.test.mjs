import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { listenShell } from './shell-socket.ts'

test('recovers a crashed scout socket and preserves a live listener and unrelated files', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'p1-sock-'))
  const path = join(dir, 'sock')
  const db = new DatabaseSync(':memory:')
  t.after(async () => { db.close(); await rm(dir, { recursive: true, force: true }) })
  const child = spawn(process.execPath, ['-e',
    "require('node:net').createServer().listen(process.argv[1], () => process.send('ready'))", path],
    { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] })
  t.after(() => child.kill('SIGKILL'))
  await once(child, 'message')
  const exited = once(child, 'exit')
  child.kill('SIGKILL')
  await exited
  const server = createServer(socket => socket.end())
  await listenShell(server, path, db)
  try {
    await assert.rejects(listenShell(createServer(), path, db), /already running/)
    assert.ok(server.listening)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
  const keep = join(dir, 'keep')
  await writeFile(keep, 'preserve')
  await assert.rejects(listenShell(createServer(), keep, db), /another file or user/)
  await symlink(keep, path)
  await assert.rejects(listenShell(createServer(), path, db), /another file or user/)
  assert.equal(await readFile(keep, 'utf8'), 'preserve')
})
