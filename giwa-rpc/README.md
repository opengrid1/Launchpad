# GIWA mainnet RPC

Two pieces, both mainnet only. GIWA is Upbit's OP Stack L2; its mainnet chain
id is 9134 and it has not launched yet, so the gateway goes up first and the
node follows on launch day.

## 1. Gateway: the URL wallets use

`proxy/` is a dependency-free Node service. It answers `eth_chainId` with 9134,
so MetaMask and OKX Wallet accept the network, and forwards everything else to
`UPSTREAM_HTTP`. With no upstream set it returns a clear "GIWA mainnet has not
launched yet" error and shows the wallet settings on its home page.

Deploy on Railway from this repo: root directory `giwa-rpc/proxy`, no variables
needed at first, then generate a public domain or attach `rpc.chipfi.fun`.

Variables, all optional:

| Name | Default | Meaning |
|---|---|---|
| `UPSTREAM_HTTP` | empty | Your GIWA node or the RPC GIWA publishes at launch |
| `CHAIN_ID` | `9134` | GIWA mainnet |
| `CHAIN_NAME` | `GIWA` | Shown on the page |
| `EXPLORER` | empty | Set when GIWA announces it |

Wallet settings: network name GIWA, RPC URL the gateway's address, chain id
9134, currency ETH.

## 2. Node: the machine behind it

`install.sh` sets up GIWA's official node (op-reth + op-node) on a fresh Ubuntu
server with Docker, a restart policy, localhost-only RPC ports and Caddy HTTPS.

Server: 8+ cores, 16+ GB RAM, 1 TB NVMe. Open 30303 and 9222 TCP+UDP for
peers, 80 and 443 for the RPC.

On the server as root, the day GIWA publishes `.env.mainnet` in `giwa-io/node`:

```
curl -sSL https://raw.githubusercontent.com/opengrid1/launchpad/claude/arc-inspired-crypto-app-if7yel/giwa-rpc/install.sh \
  | bash -s -- mainnet rpc-node.chipfi.fun
```

Arguments: `mainnet`, an optional domain for Caddy, an optional L1 RPC and an
optional L1 beacon URL. The defaults are PublicNode's free L1 endpoints; a busy
production node should use its own L1 or a paid provider.

Then point the gateway at it: set `UPSTREAM_HTTP=https://rpc-node.chipfi.fun`
on the Railway service. Wallets keep the same URL and start seeing blocks.

Health on the server: `giwa-check`. Logs: `cd /opt/giwa/node && docker compose logs -f`.
