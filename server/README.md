# /server (Anshi)

Fastify + `node:sqlite` + WebSocket hub. Needs Node 22.5+ (no native modules).

```bash
cd server && npm install
npm run dev          # http://localhost:8787, reads ../.env
npm run smoke        # with the server running: fake scouts + every endpoint
```

## Endpoints (contracts in `shared/types.ts`)
| Method | Path | Notes |
|---|---|---|
| POST | `/claim` | `Claim` (+ `files`) → `{ok, alerts, checking}`. `checking` = overlap candidates sent to stage 2; their results arrive over WS. |
| POST | `/overlap/:id/answer` | `OverlapAnswer` → `{ok, answers}` (the "same task?" buttons). |
| GET | `/overlaps?team=` | Recent `Overlap[]`. |
| POST | `/heartbeat` | `{user}`. State: active ≤45s, idle ≤5 min, else offline. |
| GET | `/board?team=` | `Board`. Default team `team-murmur`. Sim teams: `team-payments`, `team-infra`. |
| GET | `/teams` | `[{team, sim}]` for the dept tab. |
| POST | `/ask` | `AskRequest` (+ optional `team`). Person: forwards laptop summary (10s timeout, offline fallback). `team`/`dept`: Claude Haiku over summaries, 3-min cache, plain digest if no API key. |
| GET | `/asks?user=` | Who asked about `user` and exactly what was sent (for the localhost:4545 page). |
| POST | `/fail` | `FailEntry`. Later claimers of an overlapping area get a `fail` alert. |
| POST | `/seed` | Sim teams: `{team, members:[{user,name,area,state,summary,refs,minutesAgo}], feed?}` or an array of those. |
| GET | `/health` | `{ok, online, teams}` |
| WS | `/ws?user=` | Scout. Gets `ask` (incl. `purpose:"intent"`), `alert`, `overlap_ping`, `asked_about_you`, `incoming_call`; sends `summary`. |
| WS | `/ws?user=&client=web` | Web app. Gets every push except `ask`. A user can have a scout and several web tabs at once. |

## Overlap check (SPEC §2c)
- **Stage 1** (every `/claim`, no AI): another non-offline person's area shares the repo + 2 folders (`server/export`; `src/` alone doesn't), or the two claims share a file. A shared file, or the same branch, makes it `strong`.
- **Stage 2** (background): both laptops get `ask` with `purpose:"intent"` (8s), then one Claude Haiku call → `same | related | different` + confidence.
  - `same` ≥ 0.7 → `alert` to the newer claimer, FYI `alert` to the other. Feed `alert`.
  - `related`, `same` < 0.7, or no verdict (no laptop answer / no API key) → `overlap_ping` to both. Feed `overlap`.
  - `different` → feed only.
- Each pair + area is muted for 1h after a check starts.

## Brief routes (Yuvi)
If `server/src/brief.ts` exists, it's registered automatically: `export default async function (app: FastifyInstance) {...}`. Use `db.ts` (tables `assignments`, `briefs` already exist), `hub.send(user, {type:"incoming_call", ...})` and `handleAsk` from `ask.ts`.

## Rules
- If `web/dist` exists, it's served at `/`.

Env: `PORT` (8787), `DB_PATH` (murmur.db), `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` (claude-haiku-5-5), `SEED_SIM=0` to skip the sample sim teams.
