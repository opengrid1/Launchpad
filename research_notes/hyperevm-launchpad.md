# HyperEVM as the launchpad chain, and how alt.fun works

Checked 2026-10-29 on the live chain (RPC `https://rpc.hyperliquid.xyz/evm`, chain id 999, HYPE about $96).

## 1. The chain

| Item | Value | Effect on the Pons fork |
|---|---|---|
| Blocks | small blocks every second, gas limit 3,000,000; big blocks every minute, 30,000,000 (2 of the last 120 blocks were big) | every contract deploy and anything above 3M gas needs the sender switched to big blocks (`evmUserModify`) |
| Base fee | 18 to 111 gwei across 10 samples one minute apart; the alt.fun launch below paid 146 gwei | not a flat 0.1 gwei like Elysium: a 3.6M-gas launch is 0.1 to 0.5 HYPE ($10 to $50), a 150k-gas buy $1 to $2 |
| Uniswap v4 | official deployment (developers.uniswap.org deployments page): PoolManager `0x12D4Fd9C5DeDd00ab8a0bCe2CF0167bbf94b6B1F` (the one Equo v3 already uses on HyperEVM), PositionManager `0x0d7Ab5B3db668128Aff6F70C4eBC71D7d4DA9bf9`, Universal Router `0x9aFe3C497e19501DB228F28CdBdD29bC98F65DBa`, StateView `0x1656326235cb9E34Cb58CaDe53AE30789AB32A1A`, Quoter `0x108Bfe38532C98f8Cd8D7Ab49c9dDAa3675a1c5e` | used as is; the scripts can still deploy the official builds on a chain without v4 |
| Permit2 | `0x0000…78BA3`, same code as Base except the chain-id immutables | OK |
| CREATE2 proxy | `0x4e59…956C`, identical to Base | OK, the hook address is mined the same way |
| WHYPE | `0x5555…5555` "Wrapped HYPE" | PositionManager's `weth9` |
| Public RPC | `eth_getLogs` max 1,000 blocks, rate limited (burst of 4 calls already refused) | keeper and indexer page at 1,000 with pauses, or use a private RPC |
| Explorers | hyperevmscan.io (Etherscan v2, chain 999: `getsourcecode`, `getcontractcreation` work with our key); hyperscan.com now redirects to hl.eco | verification through Etherscan v2 |

Pons launch gas on the Elysium fork was 3.6M, of which about 2.7M is code deposit (curve runtime 10,229 B,
token 3,248 B, 200 gas per byte). That is above the 3M small-block limit, so a creator cannot send a Pons
launch on HyperEVM at all unless they switch their own address to big blocks (a HyperCore action, one-minute
blocks). The fix is the one alt.fun and Liqio use: deploy the token and the curve as EIP-1167 clones of
implementations with initializers. The curve keeps its logic; its constructor arguments become an
`initialize` call. That is a change to three Pons files (`PonsV2LaunchDeployer`, `PonsV2LauncherToken`,
`PonsV2BondingCurve`) and brings the launch to roughly 1M gas (alt.fun's launch with opening buy is 1.83M
through two extra hops; its token clone alone is about 280k).

## 2. alt.fun (the launchpad behind `0x751A603D00ebE9Dcb46C48225fF3b79147100000`)

The address is the token ELOOONG, launched 2026-10-29 in block 49,847,080. It is an EIP-1167 clone of a
verified `Token.sol` (forked from Virtuals' FERC20: fixed 1B supply minted to the launchpad, owner-only burn,
EIP-2612 permit, initializer so it can be cloned). Vanity: every token address ends in five zeros
(`VANITY_TRAILING_ZEROS = 5`, salt mined off chain against `predictTokenAddress`).

Contracts (all on HyperEVM, all upgradeable proxies except the clones and the AMM):

| Role | Address | Verified |
|---|---|---|
| Bonding (launchpad core, ERC1967 proxy) | `0xb68811BcC0e4FcD825aA49F9453b065ddF752FcB` | proxy yes, implementation `0xa86c…80ec` no |
| Zap (user entry, USDC in) | `0x693F12E9E6B35b34458793546065E8b08e0299d6` | proxy yes, implementation no |
| Router (curve vs AMM) | `0x70c7ec6f85b960379b7ee60af72e0f419d915878` | yes |
| Factory (pair clones) | `0xd5E5Fef4cFeFb67bbA0aA1dc74B2Cd196B4786AC` | yes |
| Pair (curve reserves) | `0xc71A275627E07650FFF102C74F39A7b16BcC1041` | no |
| FeeVault | `0xb4894380282533A86cb241145fac54AaAc995F18` | yes (`FeeVault.sol`) |
| Referrals | `0x6B7E93536bB94F33617A71d3aDC5dE35Ea14ee7B` | yes (`ReferralsV2.sol`, BounceTech) |
| LP lock | `0x8Deb9603d5F31471E993c23f73E4bDdB702a7476` | proxy |
| Token implementation | `0xfbEc3D3c42427Dc2c08A2401e53758F02cecB540` | yes |
| Quote asset of this launch: BounceTech "HYPE 5x Long" (HYPE5L) | `0x18b8539261cF9e760E7fEc4a8a73c50F0AE7baBE` | yes (`LeveragedToken.sol`) |
| Graduation DEX: Uniswap v2 fork | factory `0x724412C00059bf7d6ee7d4a1d0D5cd4de3ea1C48`, router `0xb4a9C4e6Ea8E2191d2FA5B380452a634Fb21240A` (HyperSwap V2) | |

The mechanism, from the on-chain constants and the launch transaction:

1. **Quote asset is a leveraged token, not HYPE.** The creator picks an underlying (HYPE, BTC, ETH, SOL,
   PAXG), a direction and 2x/3x/5x. Buyers pay USDC; the Zap mints the matching BounceTech leveraged token
   (an ERC-20 wrapping a Hyperliquid perp position that rebalances to its target leverage, 0.3% redemption
   fee, no liquidation but volatility decay) and puts it in the curve. So the memecoin's price moves with
   trades and with the leveraged underlying: a $100 creator buy in a HYPE 3x long becomes about $130 if HYPE
   rises 10% with no trades, and the curve can also fall away from graduation.
2. **Curve.** 1B supply; 75% (750M, `CURVE_BPS = 7500`) sold on the curve, 25% (`LP_RESERVE = 250M`) kept
   for the pool. Virtual liquidity `VIRTUAL_LIQUIDITY_USD = 3,000`, graduation `graduationThresholdUsd =
   9,000` measured as the USD value of the leveraged tokens in the curve (so it is reversible). Trading
   starts `LAUNCH_TRADING_DELAY_BLOCKS = 3` blocks after launch. Minimums: $20 creator buy, $20 buy, $12 sell.
3. **Fees.** 0.75% per curve trade, 0.50% protocol + 0.25% creator, paid in USDC into `FeeVault`
   (`accrue(token, creator, creatorAmount, protocolAmount, isBuy)`, `claim()` for creators, `claimProtocol()`
   to `feeTo`), hard cap 2%. The same split continues after graduation on routed trades. The launch
   transaction above shows it: the Zap took the creator's USDC, sent fees to the FeeVault
   (`FeeAccrued`), minted HYPE5L, and bought on the curve (`Trade`, `Buy`).
4. **Graduation.** When all curve tokens sell or the curve's USD value reaches $9,000 (`canGraduate`,
   `triggerGraduation`, `finalizeGraduation`, `pendingGraduation`), the 250M reserve plus the curve's
   leveraged tokens go into a HyperSwap V2 pair (token / leveraged token, not token / USDC) and the LP is
   locked in `lpLock`. ELOOONG graduated the same day: `graduatedPair = 0x8Bbd…6F18`, `isTrading = false`.
5. **Platform.** Owner `0xA911…8a43` can upgrade every proxy, change fees (no floor), the Bonding and
   FeeVault addresses, add routers; `transferCreator` lets the creator address change. Referral parameter on
   buys (BounceTech `ReferralsV2`). Audited by Phage Security 2026-05-14 (0 critical, 0 high, 2 medium).
   No platform token.
6. **Cost of a launch there.** 1,830,337 gas at 146 gwei = 0.27 HYPE (about $26) plus the $20 opening buy.

What it is not: no Uniswap v4, no hook, no snipe tax, no creator tax, no buyback, no locked-forever
position NFT, and the curve is denominated in a leveraged derivative rather than HYPE. It is a Virtuals-style
internal AMM (`Factory`/`Pair`/`Router` clones) with a USD trigger.

## 3. What the Pons fork needs for HyperEVM (plan)

1. Deploy the official PoolManager (owner = protocol owner) and PositionManager: done in `deploy.cjs`
   and the fork test.
2. Switch the deployer to big blocks for the deployment (`liqio-big-blocks.py on`), off afterwards.
3. Fees from the node (EIP-1559), not a fixed 0.1 gwei: done.
4. Keeper and indexer at 1,000-block pages on the public RPC, or a private RPC: keeper done.
5. **Shrink the launch under 3M gas** with clones (section 1). Not done; it changes three Pons files and
   needs its own fork test, and it is the one item that blocks going live.
6. Snipe tax window 3 s (one-second blocks) instead of 12 s.
7. Site: HyperEVM wallet config already exists from Liqio (chain 999, hyperevmscan links).

## 4. Elysium as a third chain without LayerZero (checked 2026-10-30)

LayerZero has no endpoint on Elysium (not in its metadata, 487 chains). Hyperlane is on HyperEVM (Abacus Works,
domain 999) and can be deployed permissionlessly on Elysium (own validators at first). But Elysium already has the
canonical Arbitrum token bridge, found on HyperEVM through the creator event `OrbitTokenBridgeCreated` for the
Elysium inbox `0xce59f8b65ad41c9dae4c07a0571a39824bd92cff` (creator `0x90906b0debd4c6f6ea13edb8adea63fb8b055afe`,
block 48,957,103, tx `0x0b787ec550ad11d5e166f336b23a8d33e75af2633821ac8ae583cd1b5e62c2cc`):

| Side | Router | Standard gateway | Custom gateway | WETH gateway | WETH |
|---|---|---|---|---|---|
| HyperEVM (parent) | `0x5d24f760dd7664b4214bdd4b04a3f62b9edd68c0` | `0xd97b30de0ba0c2eaee942afce77530e06c5f122c` | `0xf735a40938befc34cde27049f7f70780bd460748` | `0x4adeece99edfa453e40e79ffd2f179008f5a91eb` | WHYPE `0x5555…5555` |
| Elysium (child) | `0x61ebbc3a29f1970af2ce862ba9c5364832e14d17` | `0x5dc84e4cb0f9082246e92a5585c5395592b1af1f` | `0x8c0a6e1a8126f880d0dad46f7b7106ee48397432` | `0xb916e67307ad52955d37b6c123cf1a79c10855b6` | WHYPE `0xba876237b0f021a6c6d852d6c26e107997cc5e81` |

Elysium: proxy admin `0xdeae688c60778379f98f3e29c7e94d6e3934a30a`, beacon proxy factory
`0xc1fefd7e93115b280a036484a4988feb3a254160`, upgrade executor `0xce4ceced412aa9359840c7d52bbd99827a5d42b9`,
multicall `0x1526b98c1be5132d5ba24bc4abca0891727976c7`. HyperEVM: proxy admin `0x1394034554889fb60aade45fe38ab05ad6f53f24`,
upgrade executor `0xdd45a7a06cc21cfe442cf13dffeb8252b18c1441`. (Elysium is Kinetiq's chain, docs at
elysium.kinetiq.xyz; the site sits behind a Vercel checkpoint, so these came from the chain.)

How a coin reaches Elysium with it: any ERC-20 on HyperEVM is deposited through the parent router
(`outboundTransfer`), the child standard gateway deploys the coin's Elysium representation on the first deposit
(no registration), deposits land in minutes (retryable ticket), withdrawals back to HyperEVM take the challenge
period (about 5.5 to 6 days). Plan for a third leg: the coin's HyperEVM contract mints the Elysium slice (1B) and the
launch service deposits it through the gateway, opens the Uniswap v4 pool on Elysium with the same hook stack
(proven on the fork, 0.1 gwei gas), locks it, same fees; the site shows a third chain and a bridge tab with the two
timings. Fast two-way later: a Hyperlane warp route on Elysium, or LayerZero when it arrives.
