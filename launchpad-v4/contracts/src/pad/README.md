# Pad: launchpad, pools and fee flywheel on Uniswap v4

Working name. Every contract is prefixed `Pad` until the brand is chosen; the rename is mechanical.

## What it is

A launchpad whose pools are Uniswap v4 pools under one singleton hook, plus the contracts that turn the protocol's
fees into rewards for the platform token's stakers. Nothing graduates: a launch opens its pool in the same
transaction and trades on it from the first block.

| Contract | Role |
|---|---|
| `PadFactory` | One call launches: clones the token, opens its pool against native HYPE (LP fee 0, the hook takes every fee), places the whole supply in three single-sided positions above the opening price (defaults 20% from 50 to 200 HYPE market cap, 30% to 1,000, 50% to the top of the range), hands the position NFTs to the locker, takes the launch fee, and makes the creator's opening buy (at most 5% of supply, snipe-tax exempt). Owner: launch configs, launch fee, launch switch and whitelist, creator tax ceiling, snipe tax terms, creator fee recipient override with a 3-day timelock. |
| `PadHook` | Singleton hook on every pool. Fee on each swap's unspecified currency: base `hookFeeBps` (1%) split protocol / creator (`protocolFeeShareBps`), the creator's own `creatorTaxBps` (up to 10%), a snipe tax that starts at 99% and halves fourteen times over the first 10 seconds, and a volatility surcharge (+2 points after a 10% move, decaying over 2 minutes). Fees accrue per pool; the keeper sweeps them (converting token fees to HYPE on the pool, optional buyback into the vault) and credits the escrow. Owner: fee terms, protocol recipient, sweep operator, volatility terms, `rescuePoolFees`. |
| `PadLocker` | Holds the three position NFTs of every launch. Owner: `collect(token, bps, recipient)` takes that share of a launch's liquidity (token and HYPE) out of all three positions. This is the recovery path for LP. |
| `PadFeeEscrow` | Claimable balances for every recipient (creators, protocol). Pull model. |
| `PadBuybackVault` | Bought-back tokens of launches that enabled buyback, released linearly over five years to creator and protocol. |
| `PadSplitter` | The protocol fee recipient (launchpad escrow and AMM protocol fees). `distribute()` pulls its escrow balance and splits the native balance: `stakingBps` to `PadStaking`, `farmBps` to `PadFarm`, `burnBps` earmarked for buybacks of the platform token (executed by the keeper with a minimum output, tokens sent to the dead address), the rest to the treasury. `convert()` (keeper) turns ERC-20 fees from the AMM into native through the router. Owner: shares, destinations, platform token and pool, `recover(asset, to, amount)`. |
| `PadStaking` | Stake the platform token, earn native HYPE streamed over 7 days per top-up (reward-per-token accounting). Owner: pause new stakes, distributor, duration, `recover` of any asset except the staking token. Deposits can never be taken. |
| `PadToken` | Minimal ERC-20 with permit, cloned per launch, whole supply minted to the factory at launch. |
| `PadAmmFactory` / `PadAmmPair` | The AMM: one constant-product pool per token pair, open to anyone, with an ERC-20 LP share. Per swap 0.25% stays with the LPs (in the reserves) and 0.05% goes to the splitter in the token paid; the owner tunes both within 1%. No flash swaps. |
| `PadAmmRouter` | Add and remove liquidity (native wrapped and unwrapped on the way), exact-input swaps along a path, quotes. |
| `PadFarm` | Liquidity mining: stake a pair's LP shares, earn the native coin streamed by the splitter, shared across pools by allocation points. Owner: pools and points, distributor, `recover` of anything but staked LP tokens. |

## Fee flow

```
swap -> hook fee (1% base + creator tax + snipe/volatility extras)
        |- creator share  -> escrow -> creator claims
        '- protocol share -> escrow -> PadSplitter.distribute()
                                         |- 20% -> PadStaking (HYPE stream to stakers of the platform token)
                                         |- 15% -> PadFarm (HYPE stream to LP stakers of the AMM pools)
                                         |- 35% -> buyback of the platform token on its own pool, burned
                                         '- 30% -> treasury
launch fee -> escrow -> PadSplitter (same split)
AMM swap -> 0.25% to the pool's LPs, 0.05% to PadSplitter (converted to native by the keeper, same split)
```

The buyback trades on the platform token's own hook pool, so it pays the hook fee like any trade and feeds the next
cycle.

## Admin surface, in one place

- Ownership: `Ownable2Step` everywhere, `renounceOwnership` disabled.
- LP: `PadLocker.collect` (any share, any launch, any recipient).
- Fees: hook `sweepPoolFees` / `rescuePoolFees` (keeper), escrow claims (recipient), vault release.
- Treasury flow: `PadSplitter.recover`, `PadStaking.recover` (not the staking token).
- Launches: pause (`setLaunchEnabled`), whitelist, fee and config changes.

A launchpad whose owner can withdraw a launch's liquidity must say so on its site before trading opens.

## Build and test

```
node build/compile-pad.cjs                       # solc 0.8.35, viaIR, cancun; artifacts/Pad*.json
anvil --fork-url https://rpc.hyperliquid.xyz/evm --port 8547 --disable-block-gas-limit
node build/router-compile.cjs                    # TestSwapRouter for the test
node test/pad.fork.test.cjs                      # 11 sections, prints gas per step
node test/amm.fork.test.cjs                      # the AMM and the farm, 6 sections
```

The fork test covers: deploy and wiring, launch with an opening buy, snipe tax decay, volatility surcharge, sells,
sweep and claims, a buyback launch with a creator fee, owner collect (50% then 100%), creator fee recipient
transfer and the timelocked override, launch guards, and the splitter and staking flywheel (distribute, stake,
earn, getReward, exit, keeper buyback and burn, recovery).

## Open decisions before deploy

Brand and ticker; owner and treasury wallets; keeper wallet; the launch config in HYPE (start, band edges,
launch fee); the split (35/35/30 by default); the platform token's opening buy; which chain first (Elysium's
public mainnet opens 9 Nov 2026; its v4 PoolManager is at 0xE2e105d3F7209A9DA11f83cCf3E7398a753823F1 and it has no
PositionManager, so the official build is deployed with the stack as LiquidFi did).
