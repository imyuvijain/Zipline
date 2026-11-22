# Zipline: Team 23 build spec

YC × ElevenLabs Hackathon · UWaterloo E7 · Sun 2026-11-22
Challenge: **"an AI coworker they'd actually use."**

> **Read this whole file (5 min), find your role in §5, and start.** Questions go in Slack.
> **Changed at 12:45:** the product is now **Zipline**, voice is back for catch-up calls (§2b), collisions check the task as well as the folder (§2c), and asking about one person is never cached. Code names (`MURMUR_*` env vars, `team-murmur`, `~/.murmur`) **stay as they are** so we don't break code that's already written.
> **Changed at 13:55 (Yuvi):**
> - **Calls cover only what's relevant to the listener.** `catchup` mentions a teammate only when they touch your area or files, collide with you, fail in your area, or have an assignment to or from you. If nothing is relevant, it says so in one line and hangs up. `assignment` gives the ask plus only the context for that task. `manager_digest` covers only what needs the manager: blockers, collisions, open or overdue asks, and people who are idle. It never recites everyone's status. 120 words or less.
> - **Spoken version for TTS.** Each brief has `script` (the exact paths, shown in the transcript) and `spoken` (paths become words: "the summarize file in scout", "the Qwen model", "1:30"), and ElevenLabs uses `apply_text_normalization: "on"`.
> - **Today's tasks page.** `GET /tasks?user=` lists today's assignments to you. `POST /tasks/:id/done` marks one done, and `POST /tasks` `{from,to,text}` assigns one (and rings the call). The web adds a "Board | Today's tasks" toggle, and managers also get an "Assign a task" form.
> - **Web layout.** The right-hand chat panel is gone, replaced by a one-line "Ask about a teammate…" box above the board. A **profile menu at the top right** shows your avatar, name and role, includes **Switch user (demo)** (saved in `localStorage.zipline_user`, then the page reloads), and holds Team review / Catch me up.

## 👋 START HERE: who does what

| Who | Owns | First checkpoint (12:55) |
|---|---|---|
| **Maxim** | `/scout`: the laptop agent. Collectors, SQLite buffer, `/claim` + heartbeat, WebSocket, Ollama summaries, notifications, plus the user-facing sharing page on `localhost:4545` | Real claims from your laptop reaching the server |
| **Anshi** | `/server`: Fastify + SQLite + WebSocket hub, `/claim` `/heartbeat` `/board` `/ask`, the 2-stage overlap check. **Deploy to Maritime early and post the URL in Slack.** | Live URL serving `/board` |
| **Richard** | `/web`: Vite + React + assistant-ui. Team board with live ages, chat → `/ask`, activity feed, dept tab, the "same task?" card | Board rendering `shared/fixtures.json` ✅ (pushed 12:36) |
| **Yuvi** | Lead. **Voice catch-up calls** (ElevenLabs): `/assign`, `/brief`, the incoming-call UI. Seed data, demo script, video, **submits the form at 14:50** | Everyone unblocked |

**Contracts:** `shared/types.ts`. **Don't change them without posting in Slack.** Build against `shared/fixtures.json` until the server is live. The 12:45 changes only *add* fields and message types, so existing code keeps compiling.

**Setup now:** `cp .env.example .env` · `ollama pull qwen2.5:3b` · macOS Privacy & Security → Accessibility + Automation → allow Terminal.

**Timeline:** 12:55 claim shows on the board · 13:30 typed question returns a laptop summary · 13:45 first catch-up call plays · 14:00 all 4 laptops live + collision ("same task?") fires · **14:20 feature freeze** · 14:35 video · **14:50 submit**.

**Rules:** one branch per person, merge to `main` every 30 min, no secrets in git. Partner tool not working within 15 min? Fake it and move on. Blocked for 10 min? Say so in Slack.

---

## 1. What we're building, in one paragraph

Every laptop runs a small **scout** (a Node script). It quietly records what you're doing: the window title, git diffs, shell commands and file saves. It keeps only the **last 30 minutes, on your laptop**. It shares one thing with the server: your *location* ("Priya → server/export"). When a teammate **types** "what's Priya doing?" into the web app, the server forwards the question to Priya's laptop. A **local model (Ollama)** reads her last 30 minutes and writes a 2-sentence answer, and the answer comes back **seconds old**. When two people end up in the same area, Zipline checks whether they're actually on the **same task**. If they are, the second person gets "Priya's already on this". If it can't tell, it **asks them both**. When you come back from a meeting, or when your manager hands you something, **Zipline calls you**: a Teams-style incoming call where an ElevenLabs voice catches you up in 60 seconds, and you can interrupt with questions. Priya sees who asked about her and exactly what was sent.

**Pitch line:** *"Other tools know what your team did yesterday. Zipline knows what they did 5 seconds ago. It stops two people doing the same work twice, and it calls you to catch you up."*

**Typed questions for live answers. Voice calls for catching up.**

---

## 2. Architecture

```
LAPTOP (×4)  /scout  (Node script, runs in a terminal)
  collectors ──► privacy filter ──► SQLite buffer (last 30 min, never leaves laptop)
     │                                  │
     │ location changed?                │ server asks a question (or an intent check)
     ▼                                  ▼
  POST /claim (+ top 5 file paths)  fresh collect → Ollama qwen2.5:3b → Summary JSON → back over WS
  POST /heartbeat (15s)             node-notifier: alerts, "same task?" pings, "Sam asked about you",
  WebSocket ◄────────────────────►    "Zipline is calling"
                                    local page localhost:4545 (sharing log + Pause)

SERVER  /server  (Fastify + SQLite, deployed on Maritime)
  claims · sessions · summaries · asks_log · assignments · overlaps · briefs
  /ask → one person: ALWAYS live (no cache) → forward the laptop's summary as-is (no Claude)
         team/dept:  cache 3 min → one Claude Haiku call over the summaries
  /claim → overlap stage 1 (path + files) → stage 2 (intent check, Claude) → alert / ping / nothing
  /brief → gather summaries + assignments + feed → Claude Haiku script → ElevenLabs TTS (mp3)

WEB  /web  (Vite + React + assistant-ui)
  team board (live ages) · chat → /ask · activity feed · dept tab (sim teams)
  "same task?" card · incoming-call overlay (ring → answer → voice brief → talk back)
```

The diagram and UI mockups are in `docs/murmur-architecture.html`. **Its voice parts are out of date.** §2b is the source of truth for voice.

### 2a. The flows
- **Always on (no AI):** collect every 10s → filter → buffer. If the location changes (main folder + branch) and stays changed for **15s** → `POST /claim` with the top 5 recently saved file paths in that area. Heartbeat every 15s. `DEMO_FAST_CLAIM=1` claims on the first save (use it on stage).
- **Ask (one person):** web chat → `POST /ask` → **no cache** → server sends `{type:"ask"}` to the laptop → the scout **collects fresh first** (so a file opened 3s ago counts) → Ollama summarizes → `{type:"summary"}` → web shows the answer with sources and ages. The target gets a "Sam asked about you" notification.
- **Ask (team/dept):** same fan-out to every laptop in parallel, 10s timeout, then one Claude Haiku call. Cached 3 min.
- **Collision:** see §2c.
- **Catch-up call:** see §2b.
- **Dead end (stretch):** a failed test (non-zero exit code on a test command) → the local model writes a short FAIL → `POST /fail` → a teammate who later claims the same area gets "Sam hit this 20 min ago."

### 2b. Voice catch-up calls (ElevenLabs) · owner: Yuvi
Zipline "calls" you the way a Teams call rings in: a full-width incoming-call overlay in the web app, a ringtone, and a "Zipline is calling: your catch-up" native notification on your laptop. You answer, and an ElevenLabs voice talks you through what you missed in about 60 seconds (~150 words). The transcript shows alongside, with source chips.

**Three kinds of call:**

| Kind | Who gets it | Trigger | What it says |
|---|---|---|---|
| `assignment` | the report | the manager posts `/assign` ("Anshi: get `/board` deployed before 13:30") | "Yuvi needs `/board` live on Maritime before 13:30. Richard is already building against it, and Maxim's claims are failing until it's up." It's the manager's ask *plus the context around it*, built from the live summaries. |
| `manager_digest` | the manager | button, or coming back after being idle ≥10 min | "In the last 30 minutes: Anshi deployed the server, Maxim is stuck on Ollama JSON parsing (3 failed runs), Richard and Maxim both touched `shared/types.ts`, and Zipline flagged it." Built from what each person is doing, plus claims, overlaps and fails. Never raw activity. |
| `catchup` | anyone | coming back after being idle ≥10 min, or the "catch me up" button | Peer version: what your teammates did while you were heads-down, and anything that touches *your* area first. |

**Talk back (Teams-style):** during the call you can interrupt: "wait, which file is Maxim stuck on?" That question goes to `/ask` and the voice answers from the live laptop.

**Build it in this order (15-minute rule applies to each step):**
1. **Must:** `POST /brief` → Claude Haiku writes the script → **ElevenLabs TTS** (`eleven_flash_v2_5`, streaming mp3) → the web plays it inside the call overlay. The TTS call is made on the server, so the key never reaches the browser.
2. **Should:** an **ElevenLabs Agent** (Conversational AI) for the call, so you can interrupt by voice. Give the script as the agent's first message, plus one server tool `ask_zipline(target, question)` → `POST /ask`. Web: `@elevenlabs/react` `useConversation`.
3. **Stretch, "Huddle":** from a collision, "Start huddle" opens a 2-person call card. Zipline speaks first: "Maxim's doing X, Richard's doing Y. Here's the overlap." Then the two of them split the work. No WebRTC between the humans: they're at the same table.

**Org shape:** `shared/team.json` has `manager` (Yuvi for the demo). The sim teams in `demo/seed.ts` get a manager too, so the dept digest works.

### 2c. Collision: smarter, and never cut · owners: Anshi (server), Maxim (intent line), Richard (card)
Being in the same folder doesn't mean doing the same task. Two stages:

**Stage 1: cheap filter (on every `/claim`, no AI).** It's a *candidate* when another active person's area shares a path prefix **at least 2 levels deep** (`server/export` counts; the repo root and `src/` alone don't), **or** the two claims share any of the top 5 file paths. A shared file counts as `strong`. The same branch counts as `strong` too.

**Stage 2: context check (only for candidates).** The server sends both laptops `{type:"ask", purpose:"intent"}` with the question "In one line: what task are you working on?". The scout answers from its buffer like any other ask. (It's a summary, so no raw activity leaves the laptop, and **it doesn't fire "asked about you"**.) One Claude Haiku call compares the two lines and the file lists → `{verdict: "same" | "related" | "different", confidence, reason}`.

| Result | What happens |
|---|---|
| `same`, confidence ≥ 0.7 | **Alert** to the newer claimer: "Heads up: Maxim's already fixing the CSV export in `server/export`." A softer FYI goes to the other person. Feed: `alert`. |
| `related`, or `same` below 0.7, or Claude times out on a `strong` candidate | **Ping both** ("same task?"): "You and Maxim are both in `server/export`: you're on *CSV headers*, Maxim's on *export auth*. Same task?" Buttons: **Yes, let's sync** (→ offers a huddle) / **No, different**. Sent as a laptop notification + a card in the web app; the answer goes to `POST /overlap/:id/answer`. |
| `different` | Nothing pushed. Feed shows "Maxim + Richard nearby in `server/export`, different tasks". |

Muting: after any alert or ping, that pair + area is muted for 1h. A "No, different" answer also mutes it for 1h. The stage 2 check adds ~5–10s, which is fine (claims are already debounced).
**Fallback if Claude is down:** a `strong` candidate gets a ping, a weak one gets nothing. The collision never silently disappears.

---

## 3. Shared contracts (`shared/types.ts`). DO NOT change without telling Slack.

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/claim` | `Claim` (now with optional `files`) | `{ok}` |
| POST | `/heartbeat` | `{user}` | `{ok}` |
| GET | `/board?team=` | – | `Board` |
| POST | `/ask` | `AskRequest` | `AskResponse` (wait up to 12s; one person = never cached) |
| POST | `/overlap/:id/answer` | `OverlapAnswer` | `{ok}` |
| POST | `/assign` | `Assignment` (no `id`/`at`) | `{id}`, then triggers an `assignment` brief to `to` |
| POST | `/brief` | `BriefRequest` | `BriefResponse` |
| GET | `/brief/:id/audio` | – | `audio/mpeg` stream (ElevenLabs TTS, made on the server) |
| POST | `/fail` | `FailEntry` | `{ok}` (stretch) |
| WS | `/ws?user=priya` | scout + web connect | server→client: `ask`, `alert`, `overlap_ping`, `asked_about_you`, `incoming_call` · scout→server: `summary` |

**Users are hardcoded** for the demo: `maxim`, `anshi`, `richard`, `yuvi` (in `shared/team.json`; `manager: "yuvi"`). Team `team-murmur`, dept `engineering`.

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
| Server AI | Claude Haiku (`@anthropic-ai/sdk`): team/dept answers, overlap verdicts, brief scripts |
| Voice | **ElevenLabs**: TTS `eleven_flash_v2_5` (must), Agents / Conversational AI + `@elevenlabs/react` (should) |
| Hosting | Maritime (server + built web) |
| Web | Vite + React + TypeScript + **assistant-ui** |
| Partner tools if time | Alter (scoped tokens + audit log for `asks_log`), TraceRoot (trace `/ask` and `/brief`), Rowboat (company handbook memory), Codevisor (use it while building, so we can claim it honestly). **15-minute rule:** not working → fake it behind the interface and move on. |

### Cost rules (already designed in)
- Questions about one person skip Claude: we forward the laptop summary. They are **never cached**, because staleness is the whole point.
- Team answers are cached for 3 min.
- Overlap stage 2 only runs on stage 1 candidates, and each pair + area is muted for 1h after.
- Brief scripts are capped at ~150 words, which keeps the TTS around 60s and cheap. Generate the audio once per brief and replay it from `/brief/:id/audio`.
- Summaries are capped at 300 chars. Counts (commits, failed runs) come from SQL, not from the model.
- Ollama unloads after 5 min idle.

---

## 5. Roles: who does what

### P1 · MAXIM: Scout / laptop agent, context + user integration (`/scout`)
| By | Do |
|---|---|
| 12:55 | Collectors → SQLite buffer, pruned to 30 min. Secret regex (`sk-`, `ghp_`, `AKIA`, `password=`). |
| 13:20 | Location = most common folder among the last 10 saves + branch. `POST /claim` on change (**15s** debounce, `DEMO_FAST_CLAIM`), with the top 5 saved paths in `files`. Heartbeat, WebSocket connect. |
| 13:50 | On `ask`: **collect fresh first**, then build a prompt from the buffer (recent diff hunks, commands + exit codes, window titles, commits) → Ollama → `Summary` (≤300 chars, `refs`). On `ask` with `purpose:"intent"`, return a one-line task and skip "asked about you". Notifications for `alert`, `overlap_ping`, `asked_about_you`, `incoming_call`. |
| 14:20 | Running on all 4 laptops. Tune the prompt until summaries name real files and tasks. |

### P2 · ANSHI: Server + DB (`/server`)
| By | Do |
|---|---|
| 12:55 | Fastify + SQLite tables (`claims`, `sessions`, `summaries`, `asks_log`, `fails`, `overlaps`, `assignments`, `briefs`). `/claim`, `/heartbeat`, `/board` with seed data. **Deploy to Maritime now** and post the URL in Slack. |
| 13:20 | WebSocket hub (user → socket; the web connects too, for `incoming_call` and `overlap_ping`). `/ask`: fan out to the target(s), collect summaries, 10s timeout, offline fallback ("offline since 13:52, last in server/export"). |
| 13:50 | Answer logic: one person = forward, **no cache**. Team = Claude Haiku, cached 3 min. Write to `asks_log` and send `asked_about_you` (not for `purpose:"intent"`). |
| 14:10 | Overlap stage 1 + stage 2 (§2c) on `/claim` → `alert` / `overlap_ping` / feed-only. `POST /overlap/:id/answer`. 1h mute per pair + area. `/fail` if time. |

Yuvi writes the brief routes in `server/src/brief.ts` and registers them with one line, so Anshi's files don't conflict.

### P3 · RICHARD: Web app UI (`/web`)
| By | Do |
|---|---|
| 12:55 | ✅ Board, dock, chat panel (pushed 12:36). |
| 13:30 | Chat → `POST /ask` against the live server. "Asking Priya's laptop… 4.8s" status, then the answer with source chips (`label · 5s ago`). |
| 14:00 | Activity feed (claims, alerts, overlaps, asks, assigns, briefs). Dept tab with sim teams labeled `sim`. **"Same task?" card** for `overlap_ping` (Yes, let's sync / No, different → `/overlap/:id/answer`). Leave a slot for Yuvi's `<IncomingCall/>` overlay. |
| 14:20 | Demo polish: big font, dark mode, one-screen layout for the demo table. |

### P4 · YUVI: Lead · voice catch-up calls · demo (`/demo`, `server/src/brief.ts`, `web/src/call/`)
| By | Do |
|---|---|
| 12:55 | Own this spec and Slack. Post the 12:45 changes in Slack. Help P1 with the `localhost:4545` page: "you're in X", the "who asked about you" log, the Pause button (it stops claims, answers and calls). |
| 13:20 | `POST /assign` + `POST /brief`: gather summaries, assignments and feed → Claude Haiku script (≤150 words, names real files) → ElevenLabs TTS → `GET /brief/:id/audio`. Test it with `curl` against fixtures. |
| 13:45 | `<IncomingCall/>` in the web app: ring overlay on `incoming_call`, Answer → play the audio + transcript + source chips, "Ask a follow-up" box → `/ask`. Push `incoming_call` to the scout for the laptop notification. **First call plays.** |
| 14:10 | `demo/seed.ts`: 2 sim teams (`team-payments`, `team-infra`), each with a manager, claims and summaries posted to the server. If on track: ElevenLabs Agent for talk-back (§2b step 2). Demo script (§6). Rehearse the collision with P1 and P3. |
| 14:35 | Record the 2-min backup video. **Submit the form by 14:50** with every partner tool used. |

Cut from P4 if behind: `demo/handbook.md` / Rowboat, Alter, TraceRoot (in that order).

---

## 6. The 3-minute demo
1. **0:00** "Teams lose hours to 'what are you on?' pings, still duplicate work, and come back from meetings with no idea what changed."
2. **0:15** Web board: our 4 real laptops, live, ages ticking.
3. **0:30** The judge types "What's [Maxim] doing?" The answer names real files and says "5s ago".
4. **0:50** **The judge touches a laptop** (opens a file, runs a command) and asks again right away. The answer includes what they just did (no cache, fresh collect).
5. **1:10** Richard opens Maxim's folder on a *related* task. Both laptops get the **"same task?" ping** with each task in one line. Richard taps "Yes, let's sync". Then Richard edits the exact file Maxim is in, and gets the hard **alert**: "Heads up: Maxim's already on this."
6. **1:40** Yuvi (manager) assigns Anshi "get the export deployed". **Anshi's Zipline rings.** She answers, and the voice explains the ask *plus* who else is involved. The judge interrupts: "which file is Maxim stuck on?" The voice answers live.
7. **2:15** Yuvi taps "catch me up": a 20-second **manager digest** of the whole team.
8. **2:35** The person asked about shows their log: "here's exactly what was sent. Raw activity never left my laptop. Pause button."
9. **2:50** (if time) Dept tab: "what's engineering blocked on?"

---

## 7. Checkpoints. If one is missed, cut scope; don't push the times back.

| Time | Must be true |
|---|---|
| **12:55** | 1 laptop → live server → web board shows a real claim |
| **13:30** | Typed question → laptop summary appears in the web chat |
| **13:45** | `/brief` returns a script and the audio plays in the call overlay |
| **14:00** | All 4 laptops live. Collision ("same task?" ping + hard alert) fires. |
| **14:20** | **FEATURE FREEZE.** Bug fixes and polish only. |
| **14:35** | Video recorded |
| **14:50** | Form submitted |

**Cut in this order if behind:** dead-end/FAIL → dept tab → huddle → ElevenLabs Agent talk-back (keep the TTS call) → team (Claude) answers → partner extras.
**Never cut:** one-person ask, collision (with the "same task?" ping), and one voice catch-up call (TTS).

---

## 8. Setup (do it now, 5 min)
```bash
git clone https://github.com/imyuvijain/team23-hack && cd team23-hack
cp .env.example .env            # fill in your keys
ollama pull qwen2.5:3b          # P1 + everyone running a scout
```
- macOS: System Settings → Privacy & Security → **Accessibility + Automation** → allow Terminal (needed to read window titles).
- Branch per person: `p1/…`, `p2/…`, `p3/…`, `p4/…`. Merge to `main` at least every 30 min. `main` must always run.
- **No secrets in git.** Only `.env.example` holds key names. `ELEVENLABS_API_KEY` lives on the server only.

## 9. Repo layout
```
/scout    P1  laptop agent (Node)
/server   P2  Fastify + SQLite + WS   (P4: src/brief.ts)
/web      P3  Vite + React + assistant-ui   (P4: src/call/)
/demo     P4  seed script, demo script
/shared   types.ts, team.json, fixtures.json (contracts)
/docs     architecture page (voice parts out of date: see §2b)
```

## 10. Judging reminders
25% works live on real input · 25% partner tools central · 25% useful · 15% clear in 3 min · 10% memorable. Lead with the demo. Partner prizes stack: **ElevenLabs** (host), Maritime (top 3 agents), Codevisor (Mac Mini: build with it), Wasp (not used). **Partner tools to list on the form:** ElevenLabs (TTS + Agents), Maritime, assistant-ui, plus Alter / TraceRoot / Rowboat / Codevisor if we really used them.

**Judge Q&A answers:**
- *Bossware?* Raw activity never leaves the laptop. You see every read about you, and you can pause. Managers get digests of what each person is doing, never raw activity, and the people in a digest can see it was made.
- *Glean / Copilot / Teams recap?* They index finished documents and recorded meetings. We see live work, and we catch you up on work that was never in a meeting.
- *Why a local model?* Privacy, zero cloud cost, and it works offline.
- *Why voice?* Catching up is the moment you're switching context: walking back from a meeting, or just opening your laptop. A 60-second call beats reading a feed. You can also talk back.
- *Won't collisions be noisy?* Being in the same folder only makes two people a candidate. We compare the tasks themselves. When we're not sure, we ask the two people instead of guessing.
