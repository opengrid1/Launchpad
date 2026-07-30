#!/usr/bin/env bash
# Assemble .vercel/output (Build Output API v3) from dist/ plus the RPC relay.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf .vercel/output
mkdir -p .vercel/output/functions/api/rpc.func
cp -r dist .vercel/output/static
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
