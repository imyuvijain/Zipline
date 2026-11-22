import { lstat, readdir } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { join } from 'node:path'

// Chokidar waits for the write to settle. An ask may arrive during that
// window, so inspect file metadata directly before reading the activity buffer.
export async function collectFreshSaves(
  roots: string[],
  ignored: (path: string) => boolean,
  cutoff: number,
  save: (path: string, stats: Stats) => void,
  signal: AbortSignal
) {
  const stack = [...roots]
  while (stack.length) {
    signal.throwIfAborted()
    const dir = stack.pop()!
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    const files: string[] = []
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (ignored(path)) continue
      if (entry.isDirectory()) stack.push(path)
      if (entry.isFile()) files.push(path)
    }
    for (let start = 0; start < files.length; start += 32) {
      signal.throwIfAborted()
      await Promise.all(files.slice(start, start + 32).map(async path => {
        const stats = await lstat(path).catch(() => undefined)
        signal.throwIfAborted()
        if (stats?.isFile() && Math.max(stats.mtimeMs, stats.ctimeMs) >= cutoff) save(path, stats)
      }))
    }
  }
}
