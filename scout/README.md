# Zipline scout · first claim

From the checkout root, with Node 20 or Node 22.13+ and Git installed:

```sh
export WATCH_REPOS="$PWD"
export MURMUR_USER=maxim
export SERVER_URL=http://localhost:8787
cd scout
npm ci
npm run check
npm start
```

The scout loads settings from the repo-root `.env` when present. Explicitly
exported variables take precedence. Set `SERVER_URL` to Anshi's deployment
when available. `WATCH_REPOS` accepts colon-separated checkout paths. Relative
paths in `.env` are resolved from the repo root. On macOS, grant your terminal Accessibility and
allow it to control System Events under Privacy & Security → Automation.

To collect commands, open an interactive zsh and source `scout/murmur.zsh` by
its absolute path. The hook captures commands started inside watched repos and their exit codes. If the scout was killed abruptly and its
socket remains, confirm it has stopped before removing `~/.murmur/scout.sock`.

After the watcher reports ready, create or save a file under `scout/`. Keep that
folder and branch dominant for 15 seconds, then open `$SERVER_URL/board` and
look for Maxim and `repo:team23-hack/scout`. The repo name comes from Git
origin, with the checkout directory as a fallback. Set `MURMUR_REPO_NAME` to
override it for a single checkout. Heartbeats begin at startup and repeat
every 15 seconds. For a demo, run `DEMO_FAST_CLAIM=1 npm start`. This skips
the debounce and uses saves observed in that run to pick the area, so the first
real save can claim immediately.

Modern Node uses its built-in SQLite. On Node 24, `npm ci --omit=optional`
would also omit platform packages used by tsx, so use plain `npm ci` and
let npm skip the optional better-sqlite3 binding if its build fails.
On Node 20, better-sqlite3 must install successfully.

Inspect the local buffer with:

```sh
sqlite3 ~/.murmur/buffer.db \
  'SELECT datetime(at/1000, "unixepoch"), kind, folder, detail FROM activity ORDER BY id DESC LIMIT 10;'
```

The scout removes expired rows while it runs, including when idle. Secret
markers cause the entire matching field to be replaced with `[REDACTED]`
before insertion. The zsh hook also redacts matching commands at capture.
Only claim and heartbeat JSON leave the laptop. For equal folder counts, the most recently saved folder wins.

Each claim sends up to five distinct repo-relative file paths from saves in
the claimed folder during the last 30 minutes. Paths rank by save frequency,
with the most recent save breaking ties. Paths containing secret markers are
omitted from `Claim.files`.

## One-person asks

Install Ollama on the scout laptop, run `ollama serve` if it is not already
running, and download the model once with `ollama pull qwen2.5:3b`. For the
demo, warm the model with `ollama run qwen2.5:3b "Reply with OK"` before the
first ask. The scout calls the local Ollama API and keeps the model loaded for
five minutes. `OLLAMA_URL` defaults to `http://127.0.0.1:11434` and accepts
only loopback HTTP(S) URLs. The API request rejects redirects.

Start the scout as above, save a file, then ask about Maxim from the board’s
one-person ask flow. The scout connects to the server's `/ws?user=maxim`,
reconnects after a drop, and refreshes saves, Git and the active window before
each ask. Only the summary and its grounded references are sent to the server.
The scout displays macOS notifications for server messages about asks, alerts,
overlap checks and incoming calls. Intent asks return a one-line task and
leave ask notifications to the server.

If Ollama fails or misses the local deadline, a typed ask returns an
unavailable summary without references. A failed intent is left unanswered
so the server can handle it as unavailable.
