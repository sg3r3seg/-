#!/usr/bin/env sh
# LiveX local test server (macOS / Linux)
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null || { echo "Node.js 22.13+ is required: https://nodejs.org"; exit 1; }
[ -f keys/token_ed25519.pem ] || { echo "Missing keys: extract livex-dev-server-keys.zip here (keys/ folder)."; exit 1; }
[ -d node_modules ] || npm ci --omit=dev --no-audit --no-fund || exit 1
echo "LiveX server on http://127.0.0.1:8787"
exec node --disable-warning=ExperimentalWarning src/index.js
