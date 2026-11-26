#!/bin/bash
# Local validator for tests/equo3.test.mjs: the real Raydium CLMM program, three of its fee tiers and SPYx (with its
# CLMM whitelist entry) cloned from mainnet, the accounts from scripts/test-accounts.mjs with Pyth publish times
# set to now, and this program at its mainnet id with the test wallet as upgrade authority.
# Prices go stale after 10 minutes, so restart it before each test run.
set -e
cd "$(dirname "$0")/.."
export PATH=$HOME/.local/share/solana/install/active_release/bin:$PATH
[ -f .test-accounts/meta.json ] || node scripts/test-accounts.mjs
node -e '
const fs = require("fs"), now = Math.floor(Date.now() / 1000);
for (const [f, t] of [["pyth-sol", now], ["pyth-spyx", now], ["pyth-sol-stale", now - 3600]]) {
  const p = `.test-accounts/${f}.json`, j = JSON.parse(fs.readFileSync(p)), d = Buffer.from(j.account.data[0], "base64");
  d.writeBigInt64LE(BigInt(t), 93);
  j.account.data[0] = d.toString("base64");
  fs.writeFileSync(p, JSON.stringify(j));
}'
mkdir -p .test-accounts/load && cp .test-accounts/pyth-*.json .test-accounts/spyx-holder.json .test-accounts/load/
exec solana-test-validator --reset --quiet --ledger .test-ledger --url https://api.mainnet-beta.solana.com \
  --clone-upgradeable-program CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK \
  --clone A1BBtTYJd4i3xU8D6Tc2FzU6ZN4oXZWXKZnCxwbHXr8x --clone E64NGkDLLCdQ2yFNPcavaKptrEgmiQaNykUuLC1Qgwyp \
  --clone 9iFER3bpjf1PTTCQCfTRu17EJgvsxo9pVyA9QWwEuX4x \
  --clone XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W --clone GJjmPfwJunKhNZ2sSx1XRPB6THRDaHAuJ5WhBks6Kwsg \
  --account-dir .test-accounts/load \
  --upgradeable-program 6mdh7toDGpPEk8CYokVLi2aQMLDnB9jVkzhP5n9Dt4wR target/deploy/equo_sol.so "$(solana-keygen pubkey ~/.config/solana/id.json)"
