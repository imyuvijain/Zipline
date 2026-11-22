// Load the repo-root .env (and server/.env if present) before anything reads process.env.
// Real environment variables (e.g. set on Maritime) always win.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

for (const rel of ["../.env", "../../.env"]) {
  const p = fileURLToPath(new URL(rel, import.meta.url));
  if (existsSync(p)) process.loadEnvFile(p);
}
