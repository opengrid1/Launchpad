#!/usr/bin/env bash
# One-shot GIWA RPC node on a fresh Ubuntu 22.04/24.04 server.
#
#   curl -sSL https://raw.githubusercontent.com/opengrid1/launchpad/claude/arc-inspired-crypto-app-if7yel/giwa-rpc/install.sh \
#     | sudo bash -s -- <network> [domain] [l1_rpc] [l1_beacon]
#
#   network   sepolia | mainnet   (mainnet works the day GIWA publishes .env.mainnet in giwa-io/node)
#   domain    optional, e.g. rpc.chipfi.fun; with a domain the node is served over HTTPS by Caddy
#   l1_rpc    optional Ethereum L1 JSON-RPC (default: PublicNode, free)
#   l1_beacon optional Ethereum L1 beacon API  (default: PublicNode, free)
#
# Re-running is safe: it updates the checkout, rewrites the env, and restarts.
set -euo pipefail

NETWORK="${1:-sepolia}"
DOMAIN="${2:-}"
case "$NETWORK" in
  sepolia) L1_RPC="${3:-https://ethereum-sepolia-rpc.publicnode.com}"; L1_BEACON="${4:-https://ethereum-sepolia-beacon-api.publicnode.com}" ;;
  mainnet) L1_RPC="${3:-https://ethereum-rpc.publicnode.com}";         L1_BEACON="${4:-https://ethereum-beacon-api.publicnode.com}" ;;
  *) echo "network must be sepolia or mainnet"; exit 1 ;;
esac

ROOT=/opt/giwa
DATA_DIR=/opt/giwa/data
log() { printf '\n\033[1;35m[giwa]\033[0m %s\n' "$*"; }

log "installing Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
apt-get install -y -qq git curl jq >/dev/null

log "fetching giwa-io/node"
mkdir -p "$ROOT" "$DATA_DIR"
if [ -d "$ROOT/node/.git" ]; then git -C "$ROOT/node" pull -q; else git clone -q https://github.com/giwa-io/node "$ROOT/node"; fi
cd "$ROOT/node"

ENV_FILE=".env.$NETWORK"
if [ ! -f "$ENV_FILE" ]; then
  echo "GIWA has not published $ENV_FILE yet (mainnet is still under development). Run with 'sepolia' until it lands."; exit 1
fi

log "writing L1 endpoints into $ENV_FILE"
# A public provider does not expose the debug namespace; 'standard' fetches receipts the plain way.
sed -i "s|^OP_NODE_L1_ETH_RPC=.*|OP_NODE_L1_ETH_RPC=$L1_RPC|" "$ENV_FILE"
sed -i "s|^OP_NODE_L1_BEACON=.*|OP_NODE_L1_BEACON=$L1_BEACON|" "$ENV_FILE"
sed -i "s|^OP_NODE_L1_RPC_KIND=.*|OP_NODE_L1_RPC_KIND=standard|" "$ENV_FILE"
PUBLIC_IP=$(curl -fsS https://api.ipify.org || true)
[ -n "$PUBLIC_IP" ] && sed -i "s|^#\?OP_NODE_P2P_ADVERTISE_IP=.*|OP_NODE_P2P_ADVERTISE_IP=$PUBLIC_IP|" "$ENV_FILE"

log "restart policy and local-only RPC ports"
# The node's own compose has no restart policy and binds RPC on every interface.
# Keep 8545/8546 on localhost; Caddy (or your own proxy) is the public face.
cat > docker-compose.override.yaml <<'EOF'
services:
  execution:
    restart: unless-stopped
    ports: !override
      - "127.0.0.1:8545:8545"
      - "127.0.0.1:8546:8546"
      - "127.0.0.1:7301:6060"
      - "30303:30303"
      - "30303:30303/udp"
  consensus:
    restart: unless-stopped
    ports: !override
      - "127.0.0.1:9545:9545"
      - "9222:9222"
      - "9222:9222/udp"
      - "127.0.0.1:7300:7300"
EOF

cat > "$ROOT/env" <<EOF
NETWORK_ENV=$ENV_FILE
DATA_DIR=$DATA_DIR
EOF

log "building and starting the node ($NETWORK)"
set -a; . "$ROOT/env"; set +a
docker compose build --parallel
docker compose up -d

if [ -n "$DOMAIN" ]; then
  log "HTTPS front door on https://$DOMAIN via Caddy"
  if ! command -v caddy >/dev/null 2>&1; then
    apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https >/dev/null
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -qq && apt-get install -y -qq caddy >/dev/null
  fi
  cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
  encode gzip
  @ws {
    header Connection *Upgrade*
    header Upgrade websocket
  }
  handle @ws {
    reverse_proxy 127.0.0.1:8546
  }
  handle {
    reverse_proxy 127.0.0.1:8545
  }
}
EOF
  systemctl enable --now caddy
  systemctl reload caddy
fi

# A tiny health script for later.
install -m 0755 /dev/stdin /usr/local/bin/giwa-check <<'EOF'
#!/usr/bin/env bash
set -e
el=$(curl -s -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' http://127.0.0.1:8545 | jq -r .result)
cl=$(curl -s -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"optimism_syncStatus","params":[]}' http://127.0.0.1:9545 | jq -c '{unsafe:.unsafe_l2.number,safe:.safe_l2.number,finalized:.finalized_l2.number,l1:.head_l1.number}')
echo "execution head: $((el)) ; consensus: $cl"
EOF

log "done. Node data: $DATA_DIR. Logs: cd $ROOT/node && docker compose logs -f"
log "health: giwa-check"
[ -n "$DOMAIN" ] && log "RPC: https://$DOMAIN  (HTTP and WebSocket)" || log "RPC: http://127.0.0.1:8545 on this box only; pass a domain to expose it"
