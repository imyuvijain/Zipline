import { connect } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'

if (process.argv[2] === '--watch-repos') {
  await import('./env.mjs')
  process.stdout.write(process.env.WATCH_REPOS ?? '')
} else {
  send()
}

function send() {
  const socket = connect(join(homedir(), '.murmur', 'scout.sock'))
  function stop() {
    process.stdin.destroy()
    socket.destroy()
  }
  socket.setTimeout(500, stop)
  socket.on('error', stop)
  process.stdin.pipe(socket)
}
