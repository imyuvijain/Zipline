# /demo — see SPEC.md §5 for owner and tasks

## Voice catch-up calls (curl)

```sh
B=localhost:8787; J='content-type: application/json'
# Manager assigns -> Richard's web tab + scout get {type:"incoming_call"}
curl -s -XPOST $B/assign -H "$J" -d '{"from":"yuvi","to":"richard","text":"get /board deployed on Maritime before 13:30"}'
# Catch-up / manager digest script (kind: assignment | manager_digest | catchup; add "ring":true to push incoming_call)
curl -s -XPOST $B/brief -H "$J" -d '{"for":"yuvi","kind":"manager_digest"}'
# Audio: mp3 with ELEVENLABS_API_KEY set, else 503 JSON (web falls back to speechSynthesis)
curl -s -o brief.mp3 -w '%{http_code}\n' $B/brief/<id>/audio
```
Env: `ELEVENLABS_API_KEY` (required for real voice), `ELEVENLABS_VOICE_ID` (optional).

### Manager AI review (talk-back)
```sh
ID=$(curl -s -XPOST $B/brief -H "$J" -d '{"for":"yuvi","kind":"manager_digest"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
curl -s $B/brief/$ID/agent-session   # {signedUrl:"wss://...", agentId, script}
```
Needs `ELEVENLABS_AGENT_ID` (agent "Zipline Manager Review", client tool `ask_zipline`). Optional `LLM_URL` (+ `LLM_MODEL`) writes the review with the local model; otherwise the template. Web: run with `VITE_MURMUR_USER=yuvi` to get the manager-only "Team review" button.
