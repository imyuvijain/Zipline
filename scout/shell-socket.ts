import { lstat, unlink } from 'node:fs/promises'
import { createConnection, type Server } from 'node:net'

function bind(server: Server, path: string) {
  return new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(path, () => {
      server.off('error', reject)
      resolve()
    })
  })
}

function hasListener(path: string) {
  return new Promise<boolean>((resolve, reject) => {
    const socket = createConnection(path)
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('error', error => {
      if (['ECONNREFUSED', 'ENOENT'].includes((error as NodeJS.ErrnoException).code ?? '')) resolve(false)
      else reject(error)
    })
    socket.setTimeout(1000, () => socket.destroy(new Error('Scout socket probe timed out.')))
  })
}

export async function listenShell(server: Server, path: string, db: { exec(sql: string): unknown }) {
  try {
    await bind(server, path)
    return
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error
  }
  // Serialize recovery between simultaneous restarts that share this profile.
  db.exec('BEGIN IMMEDIATE')
  try {
    const stat = await lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
    if (stat) {
      if (!stat.isSocket() || stat.uid !== process.getuid?.())
        throw new Error('The scout socket path belongs to another file or user.')
      if (await hasListener(path)) throw new Error('A scout is already running in this profile.')
      const current = await lstat(path)
      if (stat.dev !== current.dev || stat.ino !== current.ino)
        throw new Error('The scout socket changed during startup. Retry.')
      await unlink(path)
    }
    await bind(server, path)
  } finally {
    db.exec('ROLLBACK')
  }
}
