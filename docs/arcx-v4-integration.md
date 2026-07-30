# arcx.fun launchpad - indexer and bot integration (Arc mainnet)

arcx.fun launches tokens directly into official Uniswap V4 pools on Arc.
Everything needed to index launches, price pools, and route swaps is below.

## Chain

- Chain: Arc mainnet, chainId 5042
- Native gas token: USDC (18 decimals at the RPC level)
- Explorer: https://arc-mainnet.cloud.blockscout.com

## Contracts

| Contract | Address |
| --- | --- |
| Launchpad factory (QuiverFactory) | `0x3004664a07bDA6CbD416C9486Dc1212eE81fA1fC` |
| Fee hook (QuiverHook) | `0xfE1e80495C412cF3f4C0dE305C9Ca1570bbA8044` |
| Public swap router (QuiverRouter) | `0x6dE8C12324Cd13E40E813B390F8Eea38DBA299b0` |
| Uniswap V4 PoolManager (official) | `0x8366a39CC670B4001A1121B8F6A443A643e40951` |
| Uniswap V4 StateView (official) | `0xf3334192d15450cdd385c8b70e03f9a6bd9e673b` |
| WUSDC (wrapped native, quote asset) | `0xD79aB912c0c5cdDa7FAC89C75deB6ae84028e82e` |

All launchpad contracts are verified on Blockscout.

## Discovering launches

Event on the factory (one per launch):

```
Launched(address indexed token, address indexed creator, address indexed stock, uint16 taxBps, bytes32 poolId)
topic0 = 0x1b0471bbd39edf08824ce7f85b9edf35b61881b52207a7aa472888f55ad4ebad
```

Log-free enumeration (useful while Arc public RPCs have eth_getLogs
restricted):

- `totalTokens() -> uint256`
- `allTokens(uint256 index) -> address`
- `listings(address token) -> (address creator, address stock, uint16 taxBps, uint64 createdAt, bytes32 poolId)`

Token metadata lives on the token itself: `name()`, `symbol()`,
`totalSupply()` (always 1,000,000,000e18), and `metadataURI()` (JSON string
with description, image data URI, and social links).

Launched token addresses end in `0x...4663` (CREATE2 vanity marker).

## Pools

Every token trades in one Uniswap V4 pool on the official PoolManager:

- PoolKey: `currency0`/`currency1` = token and WUSDC sorted ascending,
  `fee = 0`, `tickSpacing = 60`, `hooks = 0xfE1e80495C412cF3f4C0dE305C9Ca1570bbA8044`
- `poolId = keccak256(abi.encode(poolKey))`, also returned by `listings()`
- Price: `StateView.getSlot0(poolId)` for sqrtPriceX96
- Trades: standard PoolManager `Swap` events filtered by poolId

## Fees

- LP fee is 0. The hook skims a 1% fee on each swap (taxBps = 100).
- On harvest the hook pays 80% of accrued fees to the token creator and 20%
  to the protocol treasury, in native USDC.

## Swapping

Standard V4 swaps against the PoolManager work with any router that supports
V4 (the hook only takes its fee in afterSwap; no restrictions, no blocklists,
no transfer taxes on the ERC20 itself). The public QuiverRouter also exposes:

- `buy(address token, uint256 minOut)` payable in native USDC
- `sell(address token, uint256 amountIn, uint256 minOut)` returning native USDC

## Contact

- Site: https://arcx.fun
- X: https://x.com/steadypads
