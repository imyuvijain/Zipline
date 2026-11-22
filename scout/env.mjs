import { homedir } from 'node:os'
import { delimiter, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'

const root = fileURLToPath(new URL('../', import.meta.url))
const hasWatchRepos = process.env.WATCH_REPOS !== undefined
const { error } = config({ path: resolve(root, '.env'), quiet: true })
if (error && error.code !== 'ENOENT') throw new Error('Cannot read the repo-root .env.')

if (!hasWatchRepos && process.env.WATCH_REPOS) {
  process.env.WATCH_REPOS = process.env.WATCH_REPOS.split(delimiter).filter(Boolean)
    .map(path => path === '~' || path.startsWith('~/')
      ? resolve(homedir(), path.slice(2))
      : resolve(root, path))
    .join(delimiter)
}
