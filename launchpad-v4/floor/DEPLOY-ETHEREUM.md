# Zappy floor stack on Ethereum mainnet

The FOBO fork (MIT) with one addition: the hook has an owner whose one power is `collectFloor`. Pairs are ETH only
($ZAPPY pairs stay off until the owner allows them).

## What the deploy needs

| Item | Value |
| --- | --- |
| Chain | Ethereum mainnet (1) |
| PoolManager | `0x000000000004444c5dc75cB358380D2e3dE08A90` (default in the script) |
| ETH/USD feed | Chainlink `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419`, max age 2 h (default) |
| `OWNER` and `TEAM` | the admin wallet `0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b` |
| `START_SIGNER` | the address of the key the site uses to sign launch starts |
| `KEEPER` | the address of the key that runs buybacks and fills limit orders |
| `ETH_USD` | the ETH price in whole dollars at deploy time, within 5% of the feed |
| Deployer | a fresh wallet with ETH for gas. The dry run used 21.7M gas: about 0.002 ETH at 0.1 gwei, 0.11 ETH at 5 gwei |

## Dry run (no broadcast)

```sh
cd floor
ETH_USD=2235 TEAM=0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b OWNER=0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b \
START_SIGNER=<signer address> KEEPER=<keeper address> \
forge script script/Deploy.s.sol --rpc-url <ethereum rpc>
```

## Deploy

Same command with `--broadcast --private-key <deployer key>` (or a keystore). It writes `deployments/ethereum.json`.

Then, from the deployer (still the owner until the admin accepts): launch $ZAPPY through the factory (its first launch,
the only pool whose creator is the team), and have the admin wallet call `acceptOwnership()` on the factory, hook,
ZappyRevenue, ZappyLimitOrders and ZappyBurner.

## Tests

```sh
forge test --no-match-contract MainnetFork                      # the local suite
ETH_RPC_URL=<ethereum rpc> forge test --match-contract MainnetFork   # the stack on a fork of mainnet, against the real PoolManager
```

The fork test salts its addresses: `makeAddr("bob")` and friends are real mainnet accounts, some with EIP-7702 code that
sweeps whatever they receive.

## collectFloor

`collectFloor(key, bps, to)` takes `bps` of a pool's pot and band quote to `to`. The rest of the band goes back in at the
lowest tick where it still buys back every circulating token, so the floor drops to what the money left can hold and
every holder can still exit into it. A full collect leaves no band until the pot can carry every holder again.
