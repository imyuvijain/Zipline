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
| POST | `/claim` | `Claim` → `{ok, alerts}`. `alerts` repeats any collision/fail alert also pushed over WS. |
| POST | `/heartbeat` | `{user}`. State: active ≤45s, idle ≤5 min, else offline. |
| GET | `/board?team=` | `Board`. Default team `team-murmur`. Sim teams: `team-payments`, `team-infra`. |
| GET | `/teams` | `[{team, sim}]` for the dept tab. |
| POST | `/ask` | `AskRequest` (+ optional `team`). Person: forwards laptop summary (10s timeout, offline fallback). `team`/`dept`: Claude Haiku over summaries, 3-min cache, plain digest if no API key. |
| GET | `/asks?user=` | Who asked about `user` and exactly what was sent (for the localhost:4545 page). |
| POST | `/fail` | `FailEntry`. Later claimers of an overlapping area get a `fail` alert. |
| POST | `/seed` | Sim teams: `{team, members:[{user,name,area,state,summary,refs,minutesAgo}], feed?}` or an array of those. |
| GET | `/health` | `{ok, online, teams}` |
| WS | `/ws?user=` | server→scout `ask` / `alert` / `asked_about_you`; scout→server `summary`. |

## Rules
- Overlap = same `repo:` path on whole segments, sharing at least repo + one folder. `doc:` areas need an exact match.
- The collision alert goes only to the **new** claimer, then that pair is muted for 1h. Offline people don't trigger it.
- If `web/dist` exists, it's served at `/`.

Env: `PORT` (8787), `DB_PATH` (murmur.db), `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` (claude-haiku-5-5), `SEED_SIM=0` to skip the sample sim teams.
