# GIWA RPC node

Your own JSON-RPC endpoint for GIWA, Upbit's OP Stack L2. One command on a fresh
Ubuntu server installs Docker, GIWA's official node (op-reth + op-node), a
restart policy, and an HTTPS front door.

GIWA mainnet is not launched. Chain id 9134 is reserved for it; the testnet is
GIWA Sepolia, chain id 91342. The same installer runs mainnet the day GIWA
publishes `.env.mainnet` in `giwa-io/node`.

## Server

| | Testnet minimum | Recommended |
|---|---|---|
| CPU | 4 cores | 8+ |
| RAM | 8 GB | 16+ GB |
| Disk | 500 GB NVMe | 1+ TB NVMe |

Hetzner CCX23 or CPX41 with a 1 TB volume, or a dedicated AX41, is the usual
pick. Open ports 30303 and 9222 (TCP+UDP) for peers, and 80/443 for the RPC.

## Install

On the server, as root:

```
curl -sSL https://raw.githubusercontent.com/opengrid1/launchpad/claude/arc-inspired-crypto-app-if7yel/giwa-rpc/install.sh \
  | bash -s -- sepolia rpc.chipfi.fun
```

Arguments: `network` (`sepolia` or `mainnet`), then an optional domain, an
optional L1 RPC, and an optional L1 beacon URL. Point the domain's A record at
the server first; Caddy gets the certificate on its own.

Without a domain the RPC listens only on the box, at `http://127.0.0.1:8545`.

The default L1 endpoints are PublicNode's free ones. They are fine to sync a
follower; for a busy production node use your own L1 or a paid provider and pass
both URLs as the third and fourth arguments.

## Check

```
giwa-check
```

prints the execution head and op-node's unsafe/safe/finalized L2 heads. The node
is usable once the unsafe head keeps moving; snap sync takes a few hours.

Logs:

```
cd /opt/giwa/node && docker compose logs -f
```

## Mainnet day

```
curl -sSL https://raw.githubusercontent.com/opengrid1/launchpad/claude/arc-inspired-crypto-app-if7yel/giwa-rpc/install.sh \
  | bash -s -- mainnet rpc.chipfi.fun
```

Mainnet data lives in the same `/opt/giwa/data` directory, so stop and wipe the
Sepolia data first if the disk is tight: `cd /opt/giwa/node && docker compose
down -v && rm -rf /opt/giwa/data`.

## Wallet settings

| | Sepolia | Mainnet |
|---|---|---|
| Chain id | 91342 | 9134 |
| RPC | `https://rpc.chipfi.fun` | same, after the switch |
| Currency | ETH | ETH |
| Explorer | https://sepolia-explorer.giwa.io | to be announced |
