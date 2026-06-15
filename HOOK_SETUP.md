# OFAFeeHook — Uniswap v4 setup & test runbook

`src/OFAFeeHook.sol` charges a fee on **every swap** (buy and sell) on the OFA/ETH v4 pool
and forwards the ETH portion to the `OFAToken` distributor, so holders keep earning on every
trade — no transfer tax on the token needed.

> **STATUS: DRAFT — unaudited, not yet tested on-chain.** It compiles against the real v4
> interfaces, but the `afterSwap` fee/delta accounting and native-ETH forwarding **must be
> validated on a v4 testnet (Sepolia) before any mainnet use.** A bug affects every swap.

## Why a proper Foundry setup (not this chat)
v4 hooks need: the `v4-template` (Foundry), hook **address mining** (the deployed address must
encode the permission flag bits), a local `PoolManager` for tests, and real swap tests. None of
that can run from the chat sandbox. Do it locally.

## 1. Scaffold
```bash
# use the official template
git clone https://github.com/uniswapfoundation/v4-template ofa-hook && cd ofa-hook
forge install
cp /path/to/Launchpad/src/OFAFeeHook.sol src/
```
Remappings (`@uniswap/v4-core/`, `@uniswap/v4-periphery/`) come with the template.

## 2. Mine the hook address + deploy
The hook needs `BEFORE_SWAP | BEFORE_SWAP_RETURNS_DELTA | AFTER_SWAP | AFTER_SWAP_RETURNS_DELTA`
flag bits in its address (it fees the ETH input on buys via beforeSwap, and the ETH output on
sells via afterSwap). Use `HookMiner` (ships with the template):
```solidity
uint160 flags = uint160(
    Hooks.BEFORE_SWAP_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG
        | Hooks.AFTER_SWAP_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
);
bytes memory args = abi.encode(POOL_MANAGER, OFA_TOKEN, 200); // 2%
(address hookAddr, bytes32 salt) = HookMiner.find(CREATE2_DEPLOYER, flags, type(OFAFeeHook).creationCode, args);
OFAFeeHook hook = new OFAFeeHook{salt: salt}(IPoolManager(POOL_MANAGER), IOFADistributor(OFA_TOKEN), 200);
require(address(hook) == hookAddr);
```
- `OFA_TOKEN` = `0xAA57c1Aebd29cb767e8C4f80F50bD38b61df073E` (already live).
- `POOL_MANAGER` = the v4 PoolManager for your network — **get it from the official Uniswap v4
  deployments page**. (Mainnet is the canonical `0x0000…` vanity address; confirm before use.)
- `CREATE2_DEPLOYER` = `0x4e59b44847b379578588920cA78FbF26c0B4956C`.

## 3. Create the pool (OFA / native ETH)
- Currencies: native ETH (`address(0)`) and OFA. Pick a fee tier + tickSpacing.
- `hooks` = the mined hook address.
- Initialize at your starting price.

## 4. Exclusions (critical — same trap as the curve)
The v4 **PoolManager custodies the pool's OFA liquidity**, so it would otherwise soak up holder
rewards. From the OFA owner wallet (`0x5DdD…`):
```
OFAToken.setExcludedFromRewards(POOL_MANAGER, true);
OFAToken.setExcludedFromRewards(hookAddr, true);
```

## 5. Add single-sided liquidity (no upfront ETH)
Via the v4 `PositionManager`, mint a position with **OFA only** in a range above the start price.
Buyers' ETH fills it; you (the position-NFT holder) collect LP fees and can manage the position.
(Selling becomes possible once buys have accumulated ETH in range — normal AMM behaviour.)

## 6. TEST ON SEPOLIA FIRST — non-negotiable
- Deploy a test OFAToken + the hook + pool on Sepolia.
- Do an **exact-in buy** and an **exact-in sell**, plus exact-out both ways.
- After each, assert `OFAToken.withdrawableRewardOf(holder)` went **up** (i.e. the ETH fee was
  taken and forwarded on *both* directions).
- Check the hook holds no stuck ETH (or that `flushEth()` clears it), and `sweep()` handles any
  token-side fees.
- Only after this passes — and ideally an audit — consider mainnet.

## Open items to validate in testing
- **Delta sign conventions** (the big one): confirm `beforeSwap` taking the ETH fee from the
  input (BeforeSwapDelta) and `afterSwap` taking it from the ETH output both balance the
  PoolManager books and don't revert. `test/OFAFeeHook.t.sol` asserts a holder's claimable ETH
  rises after **both** a buy and a sell — that's the core check.
- Exact-output swaps are intentionally **not** fee-charged (kept simple); confirm they still
  execute fine.
- Native-ETH `take` + forwarding inside the hook (re-entrancy safety, gas).
- Rounding / minimum fee amounts, and behaviour when `eligibleSupply == 0` (fee held, `flushEth`).
