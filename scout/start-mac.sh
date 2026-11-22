#!/bin/bash
set -euo pipefail

# Run from anywhere: bash scout/start-mac.sh maxim /path/to/the/watched/repo
scout_dir="$(cd "$(dirname "$0")" && pwd)"
repo="${2:-$(git -C "$scout_dir" rev-parse --show-toplevel)}"
export MURMUR_USER="${1:-${MURMUR_USER:-}}"
case "$MURMUR_USER" in
  maxim|anshi|richard|yuvi) ;;
  *) echo 'Usage: bash scout/start-mac.sh <maxim|anshi|richard|yuvi> [checkout]' >&2; exit 2 ;;
esac
WATCH_REPOS="$(git -C "$repo" rev-parse --show-toplevel)"
export WATCH_REPOS
export SERVER_URL="${SERVER_URL:-https://3ff1b48a-5050-45ea-bb1c-0147135145cc.mtm.sh}"
export DEMO_FAST_CLAIM="${DEMO_FAST_CLAIM:-1}"
export OLLAMA_HOST=127.0.0.1:11434
export OLLAMA_URL=http://127.0.0.1:11434

cd "$scout_dir"
if ! command -v ollama >/dev/null; then
  if [[ -x /Applications/Ollama.app/Contents/Resources/ollama ]]; then
    export PATH="/Applications/Ollama.app/Contents/Resources:$PATH"
  else
    brew install ollama
  fi
fi
if ! curl -fsS "$OLLAMA_URL/api/version" >/dev/null 2>&1; then
  log="$(mktemp -t zipline-ollama)"
  ollama serve >"$log" 2>&1 &
  ollama_pid=$!
  trap 'kill "$ollama_pid" 2>/dev/null || true' EXIT
  for ((attempt=0; attempt<30; attempt++)); do
    curl -fsS "$OLLAMA_URL/api/version" >/dev/null 2>&1 && break
    sleep 1
  done
  if ! curl -fsS "$OLLAMA_URL/api/version" >/dev/null 2>&1; then
    echo "Ollama did not start. See $log" >&2
    exit 1
  fi
fi
ollama pull qwen2.5:3b
npm ci
npm run check
npm run check:model
npm start
