# Murmur: Team 23 build spec (LOCKED)

YC × ElevenLabs Hackathon · UWaterloo E7 · Sun 2026-11-22
Challenge: **"an AI coworker they'd actually use."**

> **Read this whole file (5 min), find your role in §5, and start.** Questions go in Slack.

---

## 1. What we're building, in one paragraph

Every laptop runs a small **scout** (a Node script). It quietly records what you're doing: the window title, git diffs, shell commands and file saves. It keeps only the **last 30 minutes, on your laptop**. It shares one thing with the server, your *location* ("Priya → server/export"). When a teammate **types** "what's Priya doing?" into the web app, the server forwards the question to Priya's laptop. A **local model (Ollama)** reads her last 30 minutes and writes a 2-sentence answer, and the answer comes back **seconds old**. When two people end up in the same area, the second person gets a notification: "Priya's already on this." Priya sees who asked about her and exactly what was sent.

**Pitch line:** *"Other tools know what your team did yesterday. Murmur knows what they did 5 seconds ago, and stops two people doing the same work twice."*

**Text only. No voice.**

---

## 2. Architecture

```
LAPTOP (×4)  /scout  (Node script, runs in a terminal)
  collectors ──► privacy filter ──► SQLite buffer (last 30 min, never leaves laptop)
     │                                  │
     │ location changed?                │ server asks a question
     ▼                                  ▼
  POST /claim                     Ollama qwen2.5:3b → Summary JSON → back over WebSocket
  POST /heartbeat (15s)           node-notifier: alerts, "Sam asked about you"
  WebSocket ◄──────────────────────────► local page localhost:4545 (sharing log + Pause)

SERVER  /server  (Fastify + SQLite, deployed on Maritime)
  claims · sessions · summaries · asks_log
  /ask → cache (3 min)? → send to laptops (parallel, 10s timeout) → answer
         one person: forward the laptop's summary as-is (no Claude)
         team/dept:  one Claude Haiku call over the summaries
  overlap check on every claim → alert pushed to the 2nd person's laptop

WEB  /web  (Vite + React + assistant-ui)
  team board (live ages) · chat → /ask · activity feed · dept tab (sim teams)
```

The full diagram and UI mockups are in `docs/murmur-architecture.html`. **Note:** it still shows ElevenLabs voice. Ignore that: we're text only.

### The flows
- **Always on (no AI):** collect every 10s → filter → buffer. If the location changes (main folder + branch) and stays changed for 60s → `POST /claim`. Heartbeat every 15s.
- **Ask:** web chat → `POST /ask` → check the cache → server sends `{type:"ask"}` to the target laptops over the WebSocket → each laptop has Ollama summarize its buffer → `{type:"summary"}` comes back → server answers → web shows the answer with sources and ages. The target's laptop gets a "Sam asked about you" notification.
- **Collision:** a new claim's area overlaps another active person's area (same folder prefix) → push `{type:"alert"}` to the **new** claimer only → native notification. Same person pair muted for 1 hour after.
- **Dead end (stretch):** a failed test (non-zero exit code on a test command) → local model writes a short FAIL → `POST /fail` → a teammate who later claims the same area gets "Sam hit this 20 min ago."

---

## 3. Shared contracts (`shared/types.ts`). DO NOT change without telling Slack.

See `shared/types.ts`. Summary:

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/claim` | `Claim` | `{ok}` |
| POST | `/heartbeat` | `{user}` | `{ok}` |
| GET | `/board?team=` | – | `Board` |
| POST | `/ask` | `AskRequest` | `AskResponse` (wait up to 12s) |
| POST | `/fail` | `FailEntry` | `{ok}` (stretch) |
| WS | `/ws?user=priya` | scout connects | server→scout: `ask`, `alert`, `asked_about_you` · scout→server: `summary` |

**Users are hardcoded** for the demo: `priya`, `sam`, `jordan`, `alex` → replace these with our real first names in `shared/team.json`. Team `team-murmur`, dept `engineering`.

Server URL: `SERVER_URL` in `.env` (`http://localhost:8787` locally, the Maritime URL once deployed).

---

## 4. Tech stack

| Layer | Tech |
|---|---|
| Scout collectors | Node 20 + TypeScript (`tsx`), `osascript` for the frontmost app and window title, `simple-git`, `chokidar`, a zsh `preexec`/`precmd` hook appending to `~/.murmur/shell.log` |
| Scout storage | `better-sqlite3` at `~/.murmur/buffer.db` |
| Local model | Ollama `qwen2.5:3b`, `format: "json"`, `keep_alive: "5m"` |
| Scout notifications + log | `node-notifier`, plus a tiny Express page on `localhost:4545` |
| Server | Fastify + `@fastify/websocket` + `better-sqlite3` |
| Server AI | Claude Haiku (`@anthropic-ai/sdk`), only for team/dept answers |
| Hosting | Maritime (server + built web) |
| Web | Vite + React + TypeScript + assistant-ui |
| Partner tools if time | Alter (scoped tokens + audit log for `asks_log`), TraceRoot (trace `/ask`), Rowboat (company handbook memory). **15-minute rule:** not working → fake it behind the interface and move on. |

### Cost rules (already designed in)
- Questions about one person skip Claude: we forward the laptop summary.
- Team answers are cached for 3 min.
- Summaries are capped at 300 chars, and counts come from SQL.
- Ollama unloads after 5 min idle.

---

## 5. Roles: who does what

### P1: Scout / laptop agent (`/scout`)
| By | Do |
|---|---|
| 12:55 | Collectors → SQLite buffer, pruned to 30 min. Secret regex (`sk-`, `ghp_`, `AKIA`, `password=`). |
| 13:20 | Location = most common folder among the last 10 saves + branch. `POST /claim` on change (60s debounce), heartbeat, WebSocket connect. |
| 13:50 | On `ask`, build a prompt from the buffer (recent diff hunks, commands + exit codes, window titles, commits) → Ollama → `Summary` (≤300 chars, `refs`). Notifications for `alert` and `asked_about_you`. |
| 14:20 | Running on all 4 laptops. Tune the prompt until summaries name real files and tasks. |

### P2: Server + DB (`/server`)
| By | Do |
|---|---|
| 12:55 | Fastify + SQLite tables (`claims`, `sessions`, `summaries`, `asks_log`, `fails`). `/claim`, `/heartbeat`, `/board` with seed data. **Deploy to Maritime now** and post the URL in Slack. |
| 13:20 | WebSocket hub (user → socket). `/ask`: fan out to the target(s), collect summaries, 10s timeout, offline fallback ("offline since 13:52, last in server/export"). |
| 13:50 | Answer logic: one person = forward; team = Claude Haiku. 3-min cache. Write to `asks_log` and send `asked_about_you`. |
| 14:20 | Overlap check on `/claim` → `alert` to the new claimer, 1h mute per person pair. `/fail` if time. |

### P3: Web app (`/web`)
| By | Do |
|---|---|
| 12:55 | Vite app, team board from `GET /board` (use `shared/fixtures.json` until P2 is live): avatar, name, state dot, location chip, ages that tick every second. |
| 13:30 | assistant-ui chat → `POST /ask`. "Asking Priya's laptop… 4.8s" status, then the answer with source chips (`label · 5s ago`). |
| 14:00 | Activity feed (claims, alerts, asks) polling `/board` every 3s. Dept tab with sim teams labeled `sim`. |
| 14:20 | Demo polish: big font, dark mode, one-screen layout for the demo table. |

### P4: Lead · local sharing page · demo (`/demo`)
| By | Do |
|---|---|
| 12:55 | Own this spec and Slack. Create `shared/team.json` with real names. Help P1 with the `localhost:4545` page: "you're in X", the "who asked about you" log, the Pause button (it stops claims and answers). |
| 13:30 | `demo/seed.ts`: 2 sim teams (`team-payments`, `team-infra`) with claims and summaries posted to the server. `demo/handbook.md`, a one-page fake company handbook. |
| 14:00 | Demo script (§6). Rehearse the collision with P1 and P3. Try Alter, TraceRoot and Rowboat if everything else is on track. |
| 14:35 | Record the 2-min backup video. **Submit the form by 14:50** with every partner tool used. |

---

## 6. The 3-minute demo
1. **0:00** "Teams lose hours to 'what are you on?' pings and still duplicate work."
2. **0:20** Web board: our 4 real laptops, live, ages ticking.
3. **0:40** The judge types "What's [P1] doing?" The answer names real files and says "5s ago".
4. **1:10** **The judge touches a laptop** (opens a file, runs a command) and asks again right away. The answer includes what they just did.
5. **1:40** A teammate starts editing the folder someone else claimed. A **notification** pops up: "Heads up: [name]'s already on this."
6. **2:10** The person asked about shows their log: "here's exactly what was sent. Raw activity never left my laptop. Pause button."
7. **2:35** Dept tab: "what's engineering blocked on?" Answer built from the team answers (sim teams labeled).

---

## 7. Checkpoints. If one is missed, cut scope; don't push the times back.

| Time | Must be true |
|---|---|
| **12:55** | 1 laptop → live server → web board shows a real claim |
| **13:30** | Typed question → laptop summary appears in the web chat |
| **14:00** | All 4 laptops live. Collision notification fires. |
| **14:20** | **FEATURE FREEZE.** Bug fixes and polish only. |
| **14:35** | Video recorded |
| **14:50** | Form submitted |

**Cut in this order if behind:** dead-end/FAIL → dept tab → team (Claude) answers → partner extras. **Never cut:** one-person ask + collision notification.

---

## 8. Setup (do it now, 5 min)
```bash
git clone https://github.com/imyuvijain/team23-hack && cd team23-hack
cp .env.example .env            # fill in your keys
ollama pull qwen2.5:3b          # P1 + everyone running a scout
```
- macOS: System Settings → Privacy & Security → **Accessibility + Automation** → allow Terminal (needed to read window titles).
- Branch per person: `p1/…`, `p2/…`, `p3/…`, `p4/…`. Merge to `main` at least every 30 min. `main` must always run.
- **No secrets in git.** Only `.env.example` holds key names.

## 9. Repo layout
```
/scout    P1  laptop agent (Node)
/server   P2  Fastify + SQLite + WS
/web      P3  Vite + React + assistant-ui
/demo     P4  seed script, handbook, demo script
/shared   types.ts, team.json, fixtures.json (contracts)
/docs     architecture page (ignore the voice parts)
```

## 10. Judging reminders
25% works live on real input · 25% partner tools central · 25% useful · 15% clear in 3 min · 10% memorable. Lead with the demo. Partner prizes stack: Maritime (top 3 agents), Codevisor (Mac Mini: build with it), Wasp. List **every** partner tool on the form.

**Judge Q&A answers:**
- *Bossware?* Raw activity never leaves the laptop. You see every read about you, and you can pause. Managers get team digests only.
- *Glean / Copilot?* They index finished documents. We see live work.
- *Why a local model?* Privacy, zero cloud cost, and it works offline.
