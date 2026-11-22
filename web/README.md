# /web: see SPEC.md §5 (P3, Richard)

```bash
cd web && npm install && npm run dev   # http://localhost:5173
```

- API calls go through the Vite proxy to `SERVER_URL` from the repo-root `.env` (default `http://localhost:8787`), so the server needs no CORS setup.
- If the server is unreachable, the board falls back to `shared/fixtures.json` (amber dot, top right) and chat answers are tagged `fixture`.
- `VITE_MURMUR_USER` sets the asker (default `richard`). `VITE_SERVER_URL` overrides the API origin for a split deploy.
