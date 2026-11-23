# /web

```bash
cd web && npm install && npm run dev   # http://localhost:5173
```

- API calls go through the Vite proxy to `SERVER_URL` from the repo-root `.env` (default `http://localhost:8787`), so the server needs no CORS setup.
- If the server is unreachable, the board falls back to `shared/fixtures.json` (amber dot, top right) and chat answers are tagged `fixture`.
- `VITE_MURMUR_USER` sets the asker (default `richard`). `VITE_SERVER_URL` overrides the API origin for a split deploy.
- The web joins `/ws?user=<ME>&client=web` (proxied in dev) and exposes server events via `onServerEvent(type, fn)` in `src/serverEvents.ts`. `overlap_ping` renders the "same task?" card → `POST /overlap/:id/answer`. Yuvi's `<IncomingCall/>` can listen for `incoming_call` the same way and mounts at the end of `App.tsx`.
- Dev rehearsal without a server: `__zipline.emit({type:"overlap_ping", overlapId:"o1", other:"maxim", area:"repo:team23-hack/server/export", text:"…Same task?"})` in the browser console.
- `VITE_LOCAL_MODEL` sets the model name shown on the chat panel (default `qwen2.5:3b`, the laptops' Ollama model). Answers come from `/ask`; the web never calls a cloud model.
