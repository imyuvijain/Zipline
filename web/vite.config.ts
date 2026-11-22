import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// SERVER_URL comes from the repo-root .env (shared with scout/server).
// In dev, API calls go through this proxy so the server needs no CORS setup.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, "..", "");
  const target = env.SERVER_URL || "http://localhost:8787";
  const proxy = Object.fromEntries(
    ["/board", "/ask", "/claim", "/heartbeat", "/fail", "/overlap", "/assign", "/brief", "/ping"].map((p) => [p, { target, changeOrigin: true }]),
  );
  proxy["/ws"] = { target, changeOrigin: true, ws: true } as (typeof proxy)[string] & { ws: boolean };
  return {
    plugins: [react()],
    // One .env at the repo root for scout, server and web. Only VITE_* keys reach the browser.
    envDir: "..",
    server: { port: 5173, proxy, fs: { allow: [".."] } },
  };
});
