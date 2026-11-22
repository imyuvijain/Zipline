#!/bin/sh
# Backup demo data for team-murmur (use only if live scouts aren't reporting).
# Usage: SERVER_URL=http://localhost:8787 sh demo/seed-team.sh
S=${SERVER_URL:-http://localhost:8787}
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
curl -s -X POST "$S/seed" -H 'content-type: application/json' -d '{
 "team":"team-murmur",
 "members":[
  {"user":"maxim","name":"Maxim","area":"repo:team23-hack/scout","branch":"p1/scout","state":"active","minutesAgo":1,
   "summary":"Maxim is wiring Ollama summaries in scout/src/summarize.ts. The JSON output keeps failing to parse; 3 failed runs in the last 10 minutes.",
   "refs":["file:scout/src/summarize.ts","cmd:npm run dev (exit 1)"]},
  {"user":"anshi","name":"Anshi","area":"repo:team23-hack/server","branch":"p2/server","state":"active","minutesAgo":2,
   "summary":"Anshi is deploying the server to Maritime and adding the two-stage overlap check in server/src/areas.ts.",
   "refs":["file:server/src/areas.ts","file:server/Dockerfile"]},
  {"user":"richard","name":"Richard","area":"repo:team23-hack/shared","branch":"p3/web","state":"active","minutesAgo":1,
   "summary":"Richard is building the same-task card and just edited shared/types.ts to add overlap fields.",
   "refs":["file:shared/types.ts","file:web/src/Board.tsx"]},
  {"user":"yuvi","name":"Yuvi","area":"repo:team23-hack/demo","branch":"main","state":"active","minutesAgo":3,
   "summary":"Yuvi is writing the demo script and testing the ElevenLabs manager review call.",
   "refs":["file:demo/README.md"]}
 ],
 "feed":[
  {"kind":"fail","text":"Maxim: Ollama JSON parse failing (3 runs)","minutesAgo":4},
  {"kind":"alert","text":"Richard + Maxim both touched shared/types.ts","minutesAgo":6},
  {"kind":"claim","text":"Anshi deployed the server to Maritime","minutesAgo":9}
 ]}'; echo
curl -s -X POST "$S/fail" -H 'content-type: application/json' -d "{\"user\":\"maxim\",\"area\":\"repo:team23-hack/scout\",\"text\":\"Ollama qwen2.5:3b returns invalid JSON for the summary; tried format:json, 3 failed runs\",\"at\":\"$NOW\"}"; echo
curl -s -X POST "$S/assign" -H 'content-type: application/json' -d '{"from":"yuvi","to":"anshi","text":"get /board live on Maritime before 13:30"}'; echo
