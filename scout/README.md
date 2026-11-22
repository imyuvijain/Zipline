# Zipline laptop scout

On a Mac with Git, Homebrew and Node 22.13+, run `bash scout/start-mac.sh maxim` from this checkout. Substitute your own username on each of the four laptops. An optional second argument selects a different Git checkout to watch. The launcher installs Ollama if needed, pulls Qwen, verifies a local answer and starts sharing. Leave the terminal open.

For manual setup, start in the checkout you want to watch and open Ollama. Node 20.19+ also works with a working better-sqlite3 native binding.

```sh
export WATCH_REPOS="$PWD"
export MURMUR_USER=maxim  # change to anshi, richard or yuvi on their laptop
export SERVER_URL=https://3ff1b48a-5050-45ea-bb1c-0147135145cc.mtm.sh
ollama pull qwen2.5:3b
cd scout
npm ci
npm run check
npm run check:model
DEMO_FAST_CLAIM=1 npm start
```

The model check asks the installed Qwen model about an example file using the scout’s normal prompt and checks the answer and file citation. It warms the model for the first live ask. The scout calls the loopback Ollama API and keeps the model loaded for five minutes after each ask. Set `OLLAMA_URL` to override `http://127.0.0.1:11434` with another loopback address.

For local server development use `SERVER_URL=http://localhost:8787`. The scout also reads the repo-root `.env`. Exported values take precedence. `WATCH_REPOS` accepts colon-separated Git checkouts. Relative paths in the file resolve from the repo root. A single checkout may override its origin-derived display name with `MURMUR_REPO_NAME`.

## Verify one laptop

1. Open `http://localhost:4545` and check the displayed username. For a real demo, allow the terminal to control System Events under macOS Privacy & Security → Automation and Accessibility. For shell commands and exit codes, source the absolute path to `scout/murmur.zsh` in the interactive zsh session you use for the demo.
2. After the watcher reports ready, save a file in the checkout. Open `$SERVER_URL/board` and find your username, folder and branch. In demo mode the first save can claim immediately. Normal mode waits for a folder and branch to stay dominant for 15 seconds. Heartbeats repeat every 15 seconds.
3. Have a teammate ask what file you just edited. Save a different file and ask again. Each typed question samples local activity afresh. Compare the returned filename with the second edit, then open the local sharing page to see who asked, the exact answer sent and its references.
4. Press **Pause** on the local page. The scout disconnects and stops sharing claims, answers, heartbeats and call notifications. Local collection continues. Pause survives a restart. Press **Resume**, then try another ask. The board may briefly show the previous heartbeat or a labeled last update.
5. For the overlap rehearsal, two teammates save files in the same area and follow the board’s overlap prompt. The scout displays the server’s overlap, collision, ask and incoming-call notifications on macOS. Automated intent questions produce a one-line task description without human-ask notifications.

## What the scout shares

The location is the most common folder across the last ten retained saves, with the newest save breaking a tie. A claim contains the location, branch and up to five distinct repo-relative file paths ranked by save count. On request the scout shares up to 300 characters and grounded file, commit or command references. If a model request fails, typed asks report the failure and intent checks time out.

Raw window titles, commands, diffs and activity history stay in `~/.murmur/buffer.db`. The scout prunes activity and the local sharing log after 30 minutes and masks matching secret markers before writing activity. The local page binds to loopback. If the shell socket is unavailable, other collectors can still run. If the page cannot start, the scout exits before sharing. After an abrupt exit, confirm no scout is running before removing a stale `~/.murmur/scout.sock`.
