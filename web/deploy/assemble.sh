#!/usr/bin/env bash
# Assemble .vercel/output (Build Output API v3) from dist/ plus the RPC relay.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf .vercel/output
mkdir -p .vercel/output/functions/api/rpc.func
cp -r dist .vercel/output/static
# Stamp the deploy so /debug can prove which build a device is seeing.
BUNDLE=$(ls .vercel/output/static/assets/index-*.js | head -1 | xargs basename)
printf '{"builtAt":"%s","bundle":"%s"}' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$BUNDLE" > .vercel/output/static/version.json
cp deploy/api-rpc/index.mjs deploy/api-rpc/.vc-config.json .vercel/output/functions/api/rpc.func/
cat > .vercel/output/config.json <<'JSON'
{
  "version": 3,
  "routes": [
    { "src": "^/api/rpc$", "dest": "/api/rpc" },
    { "handle": "filesystem" },
    { "src": "/(.*)", "dest": "/index.html" }
  ]
}
JSON
echo "assembled .vercel/output"
