import { execFile } from 'node:child_process'
import { oneLine, secret } from './ollama.js'

export function notification(title: string, body: string) {
  if (process.platform !== 'darwin') return
  const safeBody = secret.test(body) ? '[REDACTED]' : oneLine(body, 300)
  execFile('/usr/bin/osascript', ['-e', `
    on run argv
      display notification (item 2 of argv) with title (item 1 of argv)
    end run`, title, safeBody], { timeout: 4_000 }, error => {
    if (error) console.error('Zipline desktop notification unavailable.')
  })
}
