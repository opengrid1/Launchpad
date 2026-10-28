#!/bin/bash
# Mainnet deploy of Equo v3 on Solana, from the v3 deployer (.keys/deployer-v3.json):
#   1. Equo's LayerZero OFT program (artifacts/oft-v3.so) at RuyLPEWoYG2b6mGb6nvKotoNhW2F9KdhrjRghaRdGkz
#   2. Equo's Solana leg program (target/deploy/equo_omni.so) at 8tQmVEDRd4gBXP2brdgKxtmzXbTD3y8uEbY1erS1UFKq
#   3. its config (scripts/init-omni.mjs): admin and fee recipient J5UT..., the service's launcher and signer
#   4. SOL for the service's Solana launcher (LAUNCHER_SOL, default 1)
# Program data is sized to each program exactly (no room to grow: an upgrade that is larger needs a new program).
# The deployer stays the upgrade authority, so the programs can later be closed and their rent returned.
#
#   ./scripts/deploy-v3.sh            what it would do, with balances
#   ./scripts/deploy-v3.sh --send     deploy
set -e
cd "$(dirname "$0")/.."
export PATH=$HOME/.local/share/solana/install/active_release/bin:$PATH
URL=${RPC:-https://api.mainnet-beta.solana.com}
DEP=.keys/deployer-v3.json
set -a; . ../contracts/.env.launch-service; set +a
OFT=artifacts/oft-v3.so EQUO=target/deploy/equo_omni.so
[ "$(solana-keygen pubkey .keys/oft-v3-program.json)" = RuyLPEWoYG2b6mGb6nvKotoNhW2F9KdhrjRghaRdGkz ] || { echo "wrong OFT program key"; exit 1; }
[ "$(solana-keygen pubkey .keys/equo-v3-program.json)" = 8tQmVEDRd4gBXP2brdgKxtmzXbTD3y8uEbY1erS1UFKq ] || { echo "wrong Equo program key"; exit 1; }
size() { stat -c %s "$1"; }
echo "deployer $(solana-keygen pubkey $DEP): $(solana balance $(solana-keygen pubkey $DEP) --url $URL)"
echo "OFT program $(size $OFT) bytes, Equo program $(size $EQUO) bytes"
echo "rent: OFT $(solana rent $(( $(size $OFT) + 45 )) --url $URL | head -1), Equo $(solana rent $(( $(size $EQUO) + 45 )) --url $URL | head -1)"
[ "$1" = "--send" ] || { echo "dry run: add --send"; exit 0; }
FEE="--with-compute-unit-price 50000"
solana program deploy $OFT --program-id .keys/oft-v3-program.json --keypair $DEP --fee-payer $DEP --max-len $(size $OFT) --url $URL $FEE
solana program deploy $EQUO --program-id .keys/equo-v3-program.json --keypair $DEP --fee-payer $DEP --max-len $(size $EQUO) --url $URL $FEE
RPC=$URL AUTHORITY=$DEP node scripts/init-omni.mjs --send
solana transfer $EQUO_SOL_LAUNCHER_ADDRESS ${LAUNCHER_SOL:-1} --allow-unfunded-recipient --keypair $DEP --fee-payer $DEP --url $URL $FEE
echo "deployer left: $(solana balance $(solana-keygen pubkey $DEP) --url $URL)"
