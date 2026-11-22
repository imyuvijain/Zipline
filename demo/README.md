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
