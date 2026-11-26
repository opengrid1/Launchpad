# Evidence on Token-Level Mechanics for Memecoin / Launchpad Tokens (as of Oct 2026)

Scope note for the writer: this file covers trading taxes (flat / dynamic / decaying), creator fee sharing, holder revenue share / reflections, automated buyback-and-burn and bid walls, supply burns, creator vesting/lockups, anti-snipe launch windows, max-wallet limits, "evolving"/milestone tokenomics, bonding-curve vs direct-liquidity launches, and how token-safety scanners treat these controls. The overall pattern of the evidence: there is a lot of rigorous data on *baseline* memecoin outcomes (graduation, rug, survival rates) and almost no rigorous *causal* data isolating any single mechanic. Most mechanic-level claims come from vendor docs, blog posts, or arguments-from-design. I flag the evidence grade on every item. Sources from 2024-2026 are preferred; older items are labelled "historical".

---

## Baseline context: what "normal" outcomes look like for launchpad tokens (needed to judge any mechanic)

### Takeaway
On the dominant launchpads, >98% of tokens die regardless of mechanics; graduation rates on pump.fun fell from <2% (Q4 2024) to 0.63% (Sep-Oct 2025) to a lower-bound ~0.2% (May-Jun 2026). Any mechanic must be judged against this base rate, and no study to date has isolated a token-level mechanic as the cause of a better outcome.

### Cited Findings
- Solidus Labs' 2025 Rug Pull Report (May 2025): of pump.fun tokens created Jan 2024-Mar 2025 with at least five trades (>7 million), 98.6% fell below $1,000 liquidity and only ~97,000 stayed above it; of 388,000 Raydium V4 pools, ~93% (~361,000) showed "soft rug" liquidity sweeps (>=90% of LP withdrawn); median Raydium rug was ~$2,832, largest $1.9M. Tokens that migrated to Raydium were excluded from the pump.fun figure; mint authority and fee settings were not analysed. — [Solidus Labs](https://www.soliduslabs.com/reports/solana-rug-pulls-pump-dumps-crypto-compliance); summary at [Solidus Labs on X](https://x.com/Solidus_Labs/status/1920464096639533264)
- Pump.fun's spokesperson rejected the Solidus framing, telling CoinDesk the firm lacked "a basic understanding of memecoins" because most memecoins are expected to be worth little. — [Yahoo/CoinDesk](https://www.yahoo.com/news/98-tokens-pump-fun-rug-130000045.html)
- Chainalysis 2025 Crypto Crime Report: 3.59% of 2,063,519 tokens launched in 2024 showed suspected pump-and-dump patterns (secondary outlets also cite 4.52% and ~5%; the token count differs across outlets). — [it-online summarising Chainalysis](https://it-online.co.za/?p=298624); [crypto.news](https://crypto.news/chainalysis-over-4-5-of-all-tokens-launched-in-2024-have-pump-and-dump-traits/)
- Graduation rates on pump.fun by period: "peaks at less than 2%" in Q4 2024 (Dune-based academic study) — [arXiv 2512.11850](https://arxiv.org/html/2512.11850v3); 0.63% across 655,770 tokens in Sep-Oct 2025 — [arXiv 2602.14860 (Marino et al.)](https://arxiv.org/abs/2602.14860); pooled 0.198% (Wilson 95% CI 0.189-0.208%) across 832,941 launches, 8 May-10 Jun 2026, explicitly a *lower bound* because the collector only observed graduations completing within ~6 minutes — [arXiv 2607.02823 v3 (Kamat)](https://arxiv.org/html/2607.02823v3); dataset [RED-PUMP-2026-v1 on Zenodo](https://zenodo.org/records/21908375)
- In that 2026 sample, launches advertising a Telegram graduated at 1.485% vs 0.166% without (Cox HR 5.40); all three social links vs none: 1.919% vs 0.110% (17.4x). Top quartile of initial market cap (>31.04 SOL, which the authors hypothesise indicates a creator self-buy) graduated at 0.634%. Authors make no causal claim. — [arXiv 2607.02823 v3](https://arxiv.org/html/2607.02823v3)
- A CoinGecko study (reported secondhand) found only ~5% of pump.fun tokens survive past 90 days. — [Bitget News](https://www.bitget.com/news/detail/12560605478346)
- "Catching the Rug" (arXiv, Aug 2026): 6.4M Solana memecoins, 30 Nov 2024-30 Jun 2025 (6,304,235 PumpFun tokens; 97,965 Raydium tokens). In labelled test sets (after dropping tokens rugged within 5 minutes), ~82% of PumpFun and ~61% of Raydium tokens were rugs. The paper says Solana rugs are "predominantly driven by liquidity manipulation and social dynamics," not contract backdoors, and uses *no* code-level features (no fee, whitelist, or max-wallet variables). — [arXiv 2608.20271](https://arxiv.org/html/2608.20271)
- Galaxy Research (reported by Cointelegraph): median hold time for Solana memecoins collapsed to ~100 seconds from ~300 seconds a year earlier; most traders lose money while launchpads, DEXs and bots capture the revenue. — [Cointelegraph](https://regional-front.cointelegraph.com/news/memecoins-attract-users-platforms-reap-profits-report)
- Pump.fun data cited by Blockonomi: ~12 tokens (~0.00009% of launches) captured >55% of aggregate FDV; >90% of memecoins launched late 2025-early 2026 "have already died." — [Blockonomi](https://blockonomi.com/the-memecoin-retention-crisis-why-over-90-of-new-tokens-collapse-after-launch/)
- Pump.fun revenue context: January 2026 fees were $31.8M, down ~75% from $148M in January 2025. — [Cointelegraph](https://cointelegraph.com/news/pump-fun-creator-fee-cap-update-memecoin-model)

### Inferences
- Because base-rate failure is ~98%+, small absolute improvements in survival would be large relative improvements; but the only variables empirically associated with graduation in the academic literature are *social presence* and *creator self-buy size*, not any contract-level mechanic.
- The academic rug-detection literature on Solana explicitly finds rugs are liquidity/social phenomena, which suggests contract-level anti-rug features (taxes, max-wallet, etc.) are addressing a secondary attack surface on SPL-token platforms.

### Gaps
- No study was found that compares outcome distributions (survival, holder retention, rug rate) across tokens grouped by tokenomic mechanic. The Dune/analyst-thread comparisons the brief hoped for do not appear to exist in a citable form.

---

## Key Question 1: Do trading taxes (1-5%) reduce volume or liquidity depth vs 0-fee launchpad tokens? Aggregator / bot behaviour toward taxed tokens?

### Takeaway
No measured comparison of volume or depth between taxed and untaxed memecoins was found. What is documented is the *plumbing* evidence: taxed tokens are second-class citizens in aggregators, wallets and AMMs (slippage hacks, hard caps on combined tax, blocked swaps when tax is unknown, older Solana AMMs not supporting Token-2022 transfer fees), which is a strong mechanistic reason to expect less volume and worse execution. Time-decaying launch fees implemented as Uniswap v4 hooks are a 2025-26 design trend specifically because they avoid the permanent tax while keeping an anti-snipe effect.

### Cited Findings
- 1inch help centre: fee-on-transfer tokens require users to manually raise slippage ("from low amounts (like 3-5%) up to 49% or even higher"); if combined internal commission exceeds 49% the token cannot be swapped on 1inch; raising slippage "increases the risk of your transaction being front-run (sandwich attacked)." — [1inch Help](https://help.1inch.com/en/articles/5651059-what-is-a-fee-on-transfer-token)
- Uniswap v3 router does not support fee-on-transfer tokens; Uniswap V2 Router02 has dedicated `SupportingFeeOnTransferTokens` functions because the router cannot compute output from nominal input when the token skims a fee. — [STON.fi blog (secondary)](https://blog.ston.fi/?p=1769); [RareSkills Uniswap V2 router walkthrough](https://rareskills.io/post/uniswap-v2-router)
- Matcha (0x) "may need 10 or even 20% tolerances for some taxed tokens." — [STON.fi blog (secondary)](https://blog.ston.fi/?p=1769)
- Trust Wallet pulls buy/sell tax from GoPlus and *blocks* swaps when the tax value is unknown ("Swap is blocked by asset tax value"), citing protection from unexpected deductions. — [Trust Wallet Support](https://support.trustwallet.com/support/solutions/articles/67000740000--swap-is-blocked-by-asset-tax-value-error-what-it-means)
- Solana: Raydium AMM v4 does not support Token-2022 at all; CPMM supports transfer-fee mints; CLMM supports them via SwapV2 accounts; LaunchLab creates classic SPL mints. Transfer-fee mints change swap accounting so the amount received can differ from the quoted curve output; the fee rate is authority-updatable, with two configs possible during an epoch transition. — [Raydium docs](https://docs.raydium.io/algorithms/token-2022-transfer-fees)
- A Solana developer analysis argues most Solana DEX integrations mishandle Token-2022 transfer fees so quotes differ from executed results (vendor blog, no volume data). — [MadeOnSol](https://madeonsol.com/blog/token-2022-transfer-fees-on-solana-how-they-break-amms)
- Jupiter added Token-2022 / transfer-fee routing in 2023 (via FluxBeam, tokens like $BERN) but recommended "sticking to the standard token library unless there was a strong need" and shipped a separate token list so partners were unaffected (historical, 2023); Oct 2025 changelog extended gasless support to Token-2022 with ~$10 minimum. — [Jupiter blog (2023, historical)](https://docs.jup.ag/blog/jup-token2022-support); [Jupiter changelog Oct 2025](https://developers.jup.ag/changelog/2025-10)
- Bags (Solana launchpad) charges a flat 1% platform fee on every swap pair including token-to-token, taken in SOL/stable/LST at the router level rather than as a token-level transfer tax. — [Bags docs](https://docs.bags.fm/llms-full.txt)
- Pump.fun's fee model is likewise router/pool-level: a 0.05% creator fee added on top of PumpSwap fees (total ~0.3% after May 2025) rather than a token-level tax. — [BeInCrypto](https://beincrypto.com/pump-fun-creator-earnings-fall-below-expectations/)
- Decaying launch-fee hooks on Uniswap v4 (2025-26, auto-generated hooklist reviews, not audits): DecayFeeHook on Base starts at a configurable START_FEE, falls linearly to END_FEE over DECAY_SECONDS, then flat — [hooklist PR #8221](https://github.com/Uniswap/hooklist/pull/8221); DynamicFeeHook on Unichain starts at 1% and steps down with pool age and FDV milestones to a 0.1% floor, fees can only decrease — [hooklist PR #3516](https://github.com/Uniswap/hooklist/pull/3516); STRCLaunchHook on Ethereum combines a decaying anti-snipe buy fee and per-wallet cap with a 5% base fee rising to 10% under "MEV surcharge," and the listing notes its dynamic fee is not a true LP fee — [hooklist PR #7724](https://github.com/Uniswap/hooklist/pull/7724); AntiSnipeHookWithFeeSplit splits a time-decaying fee among up to three recipients — [hooklist PR #8473](https://github.com/Uniswap/hooklist/pull/8473)
- Arrakis Pro Hook adjusts v4 LP fees by volatility and inventory to protect issuer-owned liquidity from arbitrage MEV (vendor blog). — [Arrakis](https://arrakis.finance/blog/the-arrakis-pro-hook-dynamic-fees-for-token-issuers-on-uniswap-v4)
- OpenServ launchpad: buy-side tax starts at 99%, decreases 1% per minute, stabilises at 2% after ~98 minutes; LP locked after bonding-curve migration (vendor docs). — [OpenServ docs](https://docs.openserv.ai/docs/launch/token-launch-mechanics)
- Dynamic "tax step" tokens (e.g. Daddy Dogeback: buy tax falls to 4% minimum on continuous buying, sell tax rises to 30% on continuous selling, with a minimum transaction size to prevent trade-splitting). — [CoinMarketCap listing](https://coinmarketcap.com/currencies/daddy-dogeback/)
- Third-party scanner/user guides treat sell tax above ~10-12% as a "pause" signal and 5% as a "safe threshold." — [Coinvado honeypot guide](https://coinvado.com/en/posts/honeypot-token-detection-tools-dextools-2026/); [Bitbond Token Sniffer guide](https://www.bitbond.com/resources/token-sniffer-comprehensive-guide-review/)

### Inferences
- The dominant 2025-26 launchpads (pump.fun, PumpSwap, Bags, Clanker, Flaunch) all collect fees at the pool/router/hook level, not as token-level transfer taxes. This is consistent with the plumbing evidence: a token-level tax breaks aggregator quoting and triggers wallet blocks, while a pool-level fee is invisible to routers and scanners.
- If a launchpad wants a "tax-like" revenue stream, the evidence favours (a) a pool-level fee (standard LP fee share or v4 hook fee) over (b) a fee-on-transfer token, and (c) a time-decaying launch fee over a permanent one.
- The 1inch 49% cap and Trust Wallet "unknown tax" block mean a tax that is *modifiable* or *unreadable by simulation* is more damaging than a modest fixed tax: scanners return "unknown," wallets block, and volume is lost.

### Gaps
- No dataset comparing volume/depth of 1-5% taxed tokens vs 0-fee tokens was found; the volume cost of a tax is inferred from integration behaviour, not measured.
- No published data on aggregator *exclusion* rates for taxed tokens, or on what share of memecoin volume routes through aggregators vs direct bots.
- No primary 0x/Matcha documentation on FOT handling was retrieved.

---

## Key Question 2: Track record of buyback-and-burn (incl. on-chain reflexive designs like Flaunch's bid wall) vs giving fees to holders or creators

### Takeaway
The best available evidence (Keyrock, Oct 2025, on protocol-level buybacks) finds no consistent price effect from buybacks and shows programmatic buybacks overspend at peaks; there is no outcome data specific to memecoin buyback hooks. The one memecoin-native design with a plausible MEV-resistant structure is Flaunch's Progressive Bid Wall (a maker-side limit order one tick below spot rather than a market buy), but Flaunch publishes no fill or performance data, and at least one scheduled buy-and-burn hook has been reported as a standing sandwich target.

### Cited Findings
- Keyrock "Designing Token Buybacks" (Oct 2025): tokenholder payouts (buybacks + distributions) rose >400% since 2024 to nearly $800M in Q3 2025; across 12 revenue-sharing protocols ~64% of revenue was returned to holders; across 550 buyback days, a below-30-day-SMA entry predicted stronger 30-day forward returns only 39% of the time ("no consistent correlation emerged"); a case-study program spent $184.6M at avg $3.22 vs a simulated FDV-band strategy spending $98.3M at avg $2.44; taker-order buybacks consume liquidity and amplify volatility in thin markets (example: a $400K buyback was 4% of total but 20% of organic volume); the report does not address sandwich/MEV. Recommendations: smooth spend over ~30 days, use maker orders, size against organic not reported volume (~5% of organic), valuation-aware triggers. — [Keyrock](https://keyrock.com/designing-token-buybacks/); coverage [CoinDesk](https://www.coindesk.com/markets/2025/10/23/keyrock-crypto-s-buyback-boom-tests-the-industry-s-financial-maturity); [DL News](https://www.dlnews.com/articles/defi/defi-teams-increase-token-buybacks-in-bid-to-win-investor-trust/)
- Keyrock also flags that reduced buybacks at high valuations read as implicit price ceilings and larger buybacks at low valuations as perceived floors (signalling risk). — [Keyrock](https://keyrock.com/designing-token-buybacks/)
- Flaunch whitepaper: every coin opens with a 30-minute fixed-price Fair Launch; the Progressive Bid Wall (PBW) places ETH as a liquidity position one tick below spot and "follows the price as it moves up"; a secondary hook accumulates all fees (both token0 and token1) as ETH so fees create no sell pressure; the whitepaper claims the PBW avoids "risk of loss to MEV or bots via market buys" but gives no mechanism detail, no trigger threshold, no fill data, and no audit. Dev chooses the revenue split (example 80% dev / 20% holder-controlled treasury; some coins route 100% to community). — [Flaunch whitepaper](https://docs.flaunch.gg/community/whitepaper)
- Secondary sources state PBW buybacks are funded each time 0.1 ETH of fees accumulates, and the Uniswap hooklist review of Flaunch's PositionManager describes an internal swap pool that fills swaps from accumulated fee inventory before hitting the AMM. — [Blocmates](https://www.blocmates.com/articles/flaunch-redefining-launchpads-with-fixed-price-fair-launch); [Uniswap hooklist PR #2092](https://github.com/Uniswap/hooklist/pull/2092)
- Bankless (Feb 2025, promotional): Flaunch "returned $628,900+ in revenue to creators and communities after being live for just 2 days." Self-reported, unverified. — [Bankless](https://www.bankless.com/read/how-to-launch-better-memecoins-on-flaunch)
- A security issue filed Oct 2026 against sqrtDAO's `BuyAndBurnHookV3` reports that buy-and-burn swaps execute with `amountOutMinimum = 0` on a fixed epoch schedule, making each release a predictable sandwich target that shrinks the amount burned; suggested fixes are a TWAP reference or capping buyback size relative to pool depth. Reported vulnerability, not a documented exploit with losses. — [GitHub sqrtDAO/contracts #119](https://github.com/sqrtDAO/contracts/issues/119)
- Historical (2021): Decrypt flagged SafeMoon's *manual* burns and large company stake as a manipulation risk. — [Decrypt (2021, historical)](https://decrypt.co/78672/what-happened-safemoon-why-price-sinking)
- Pump.fun's own design burns the LP tokens at graduation (liquidity is permanently locked), but sources note this does not stop creator/early-buyer/sniper dumps into the new pool. — [crypto.news](https://crypto.news/how-meme-coins-are-made-bonding-curves-pump-fun-rug-pulls/); [Arkham](https://info.arkm.com/research/crypto-launchpads-memecoin-platform-pump-fun-2025)
- Supply burns and unlock dynamics: an industry report (secondary) claims ~90% of token unlocks have a negative price impact and that unlocks plus emissions undermine buyback demand. — [ChainCatcher](https://www.chaincatcher.com/en/article/2155623)

### Inferences
- The two documented failure modes of automated buybacks are (1) predictable, slippage-unprotected market buys get sandwiched (sqrtDAO issue), and (2) revenue-proportional buybacks are procyclical, buying most at peaks (Keyrock). Flaunch's PBW design addresses (1) by being a resting bid instead of a market buy, but it does not address (2): the wall is largest exactly when volume (and price) is highest.
- "Buyback-and-burn" vs "fees to holders" vs "fees to creators" is not an empirically resolved question for memecoins. Keyrock's finding that buybacks barely move price, plus the memecoin base rate (~98% death), suggests the destination of fees matters far less than whether the token attracts volume at all.
- A bid wall has one advantage no other fee destination has: it converts fee revenue into *visible liquidity depth below spot*, which is directly legible to traders and scanners (liquidity checks), whereas burns and reflections are not.

### Gaps
- No on-chain analysis of Flaunch PBW fills, buyback volume, sandwich frequency, or token survival vs non-Flaunch Base tokens was found.
- No study comparing memecoins by fee destination (burn vs holder vs creator) on survival or holder retention.
- The "4,400 sandwiches/day" EigenPhi-style figures in general MEV literature could not be tied to buyback transactions specifically.

---

## Key Question 3: Does creator revenue share (pump.fun, Bags, Zora) measurably change creator behaviour (fewer rugs, longer support)? Plus creator vesting/lockups.

### Takeaway
Creator fee sharing has produced very large aggregate payouts ($350M+ on pump.fun; $40M on Bags) but no before/after measurement of rug or abandonment rates exists; the documented behavioural effect is a *new* abuse ("vamping": redirecting fee recipients after traction), which pump.fun had to patch in March 2026 by limiting fee edits to one. Creator vesting is standard at Zora (50% over 5 years) and absent on pump.fun; its anti-rug effect is argued, not measured.

### Cited Findings
**Pump.fun**
- May 2025: PumpSwap introduced creator revenue sharing: creators earn 0.05% of volume in SOL, funded by an *added* 0.05% fee (total ~0.3%), not from existing protocol revenue. Pump.fun's stated rationale was that creators previously only earned by selling, which incentivised dumping. — [The Block](https://www.theblock.co/post/354038/pumpswap-revenue-tokens); [BeInCrypto](https://beincrypto.com/pump-fun-creator-earnings-fall-below-expectations/)
- Criticism at launch (argument, not data): creators who abandon tokens still collect fees, discouraging community takeovers (CTOs). — [SolanaFloor](https://solanafloor.com/news/pump-fun-s-creator-revenue-sharing-reality-vs-hype); [BeInCrypto](https://beincrypto.com/pump-fun-creator-earnings-fall-below-expectations/)
- Distribution: Flipside data showed creator earnings peaking >$200K/day early on; one analysis found 3,566 creators shared $3.07M with ~35% earning <$100. — [Coinpaprika](https://coinpaprika.com/education/actually-earn-launching-token/)
- A September 2025 fee-model change pushed daily creator payouts from ~$198K to ~$2M within 24 hours; cumulative creator payouts exceeded $350M by the time of a 2026 report; only ~1.8% of creators earned $5K-$10K. — [Coinpaprika](https://coinpaprika.com/education/actually-earn-launching-token/); [Yahoo Finance](https://finance.yahoo.com/markets/crypto/articles/pump-fun-paid-creators-over-100215083.html)
- 9 Jan 2026: Creator Fee Sharing system lets teams split fees across up to 10 wallets, transfer ownership, revoke update authority; CTO administrators can be assigned fee percentages post-launch. — [Brave New Coin](https://bravenewcoin.com/insights/pump-fun-introduces-creator-fee-sharing-system-to-rebalance-platform-incentives)
- 24-25 Mar 2026: co-founder Alon Cohen announced creators get *one* post-launch change of fee recipient, after which settings are immutable, to stop "vamping"/"griefing" (redirecting fees after a token gains traction). — [Cointelegraph](https://cointelegraph.com/news/pump-fun-creator-fee-cap-update-memecoin-model); [CoinMarketCap Academy](https://coinmarketcap.com/academy/es/article/pumpdotfun-caps-creator-fee-changes-to-one-per-token); [crypto.jobs](https://crypto.jobs/news/pump-fun-implements-one-time-fee-redirect-limit-to-address-token-creator-concerns)
- An April 2026 industry blog (unsourced) asserts 98.6% of pump.fun's 11.9M tokens were abandoned or rugged, describes LetsBonk's Bonk-Points gating and a pump.fun "Fair Launch Shield" CAPTCHA window, and provides no effectiveness data for any of them. — [Bex.co](https://bex.co/blog/2026/04/20/meme-launchpad-2-pump-fun-letsbonk-anti-sniper-reputation)

**Bags**
- Bags charges 1% on every swap; launch fee-share configs support up to 100 claimers with basis points summing to 10,000 and an explicit creator share; v2 configs register the payer as a separate deployer receiving 25% of the gross claimers pool; partner share comes out of the platform pool; no anti-snipe, vesting or lockup features are documented. — [Bags docs](https://docs.bags.fm/llms-full.txt)
- Bags self-reports >$5B cumulative volume and >$40M paid to creators since 2025 launch (Mar 2026 press release); a third-party review cites >$21M; Bags crossed $1B 30-day volume by mid-2025, second on Jupiter's launchpad leaderboard. — [BusinessWire](https://www.businesswire.com/news/home/20260320414386/en/Bags.fm-Wins-Crowdfunding-Innovation-Award-in-2026-FinTech-Breakthrough-Awards); [TradeTheDay](https://tradetheday.com/launchpads/bags-fm); [SolanaCompass](https://solanacompass.com/projects/BAGS)
- A competing launchpad claims Bags keeps 70% of fees (commercially motivated, unverified). — [RevShare blog](https://app.revshare.ltd/blog/revshare-vs-bagsfm-creator-fees-comparison)

**Zora**
- Every Zora Creator Coin has a fixed 1B supply; 50% open to market, 50% vests linearly to the creator over 5 years, with vested payouts tied to trading activity in the coin; content coins pair with the creator coin, creator coins pair with $ZORA. — [Blockworks Token Transparency filing](https://blockworks.com/token-transparency/filing/zora); [Blockworks](https://blockworks.com/news/zora-latest-content-coin-fad)
- 2025: 1.5M Creator Coins generated ~$425M volume (older guide). By Sep 2026 Zora replaced its CEO and shifted focus from Creator Coins on Base to trading pairs across Base, Solana and Robinhood Chain; fragmented liquidity across many small markets was flagged. — [BingX guide](https://bingx.com/en/learn/article/what-is-zora-content-tokenization-network-and-how-to-create-content-coins); [CoinMarketCap updates](https://coinmarketcap.com/cmc-ai/zora/latest-updates/)

**Creator vesting / lockups**
- Arkham: memecoin launchpads "tend to have no vesting periods"; vesting is described as preventing dumps, with no data. — [Arkham](https://info.arkm.com/research/crypto-launchpads-memecoin-platform-pump-fun-2025)
- SlotZero (open-source tool) bundles pump.fun token creation, creator buy, and deposit into an uncancellable Jupiter Lock escrow in one atomic transaction so the dev bag is never unlocked (project's own claim). — [GitHub slotzero](https://github.com/Aydin667/slotzero)
- Third-party lockers advertise locking dev tokens from Bags and other launchpads with on-chain proof. — [StakePoint](https://stakepoint.app/blog/solana-token-locking-guide)
- Pine Analytics "Exit Liquidity Machines" (2025): over one month, >15,000 SOL realised profit from deployer-funded same-block sniping across 15,000+ launches, 4,600+ sniper wallets, 10,400+ deployers; 87% of these snipes were profitable; the study only counts provable one-hop funding links and notes multi-hop funding and multi-signer transactions are used to evade detection. — [Pine Analytics](https://pineanalytics.substack.com/p/exit-liquidity-machines); secondary [Bitrue](https://www.bitrue.com/blog/careful-pumpfun-traders)
- Unlock cliffs: an industry report claims ~90% of token unlocks are followed by negative price impact (secondary, methodology not reviewed). — [ChainCatcher](https://www.chaincatcher.com/en/article/2155623)

### Inferences
- The only *measured* behavioural response to creator fee sharing found is adversarial: fee-recipient redirection ("vamping") and continued fee collection by absentee creators. Pump.fun's two patches (CTO fee assignment in Jan 2026; one-edit cap in Mar 2026) are the platform conceding both.
- Pine Analytics' finding that deployers fund their own same-block snipers means the main creator extraction channel on pump.fun is *not* the creator's visible allocation; vesting the creator's declared bag (Zora-style, SlotZero-style) therefore addresses only part of the creator-side risk unless combined with bundle/funding-graph detection.
- Zora's 5-year linear vesting plus activity-linked payout is the strictest creator alignment design in production, but Zora's 2026 strategic pivot away from creator coins means it is not evidence that the design produces durable tokens.
- Creator fee share plus *irreversible* fee-recipient settings is the configuration that survived contact with users; mutable fee recipients did not.

### Gaps
- No before/after rug-rate or abandonment-rate measurement around pump.fun's May 2025, Sep 2025, Jan 2026 or Mar 2026 fee changes was found (a Dune query with a stated rug definition would be needed).
- No study measuring whether vested-creator tokens (Zora) survive longer than unvested ones (pump.fun).
- Bags' bonding-curve fee split and graduation thresholds are admin-configured and not public.

---

## Key Question 4: What happened to ETH-reflection / dividend tokens (2021-2024 ETH-rewards tokens, Hex-style) in terms of longevity?

### Takeaway
Reflection/dividend tokens are volume-dependent by construction, and the documented cases (RFI, SafeMoon, EverETH) show payouts collapse with volume and the tokens become illiquid; no 2024-2026 cohort study of ETH-rewards tokens was found. The Hex comparison requested in the brief could not be sourced.

### Cited Findings
- Reflection rewards "generate money for token holders when the native token is bought and sold"; when trading slows "the return for coin holders can dry up substantially"; on Ethereum gas costs eat small reflection rewards. — [Bybit Learn](https://www.bybit.com/en/learn/crypto/what-are-reflection-tokens)
- Reflect Finance (RFI), the original Ethereum reflection token, "crashed to virtually zero after the initial hype wore off." — [bitcoinethereumnews (secondary)](https://bitcoinethereumnews.com/finance/did-reflection-tokens-peak-or-are-they-just-starting-out/)
- Engineering constraints (historical): naive per-holder dividend loops scale with holder count and hit the block gas limit; reflection contracts add bug surface as tokenomics get more complex; a dividend model gives "no direct support for the token price." — [weka on Medium (historical)](https://weka.medium.com/dividend-bearing-tokens-on-ethereum-42d01c710657)
- SafeMoon (historical 2021 design, 2023-25 outcome): 10% per-transaction fee, half to holders as reflections and half to locked liquidity; relied on continuous new buying; the company filed Chapter 7 in Dec 2023; CEO Braden Karony was convicted by a federal jury in May 2025 (per secondary reporting); token value loss estimated >99.9% by low-quality sources. — [KoinX (secondary)](https://www.koinx.com/blog/is-safemoon-dead); [Decrypt (2021, historical)](https://decrypt.co/78672/what-happened-safemoon-why-price-sinking)
- EverETH (BSC, pays dividends in ETH from a transaction tax): a profile snapshot shows ~$647,547 market cap on ~$181 24h volume, i.e. essentially no fee flow to distribute. — [FXEmpire](https://www.fxempire.com/crypto/evereth/profile)
- A recent (2026) dividend-contract bug report illustrates the accounting fragility: `deposit()` only settled ETH dividends, so a new depositor could claim token dividends paid before they joined. — [GitHub issue (Robinhood-chain repo)](https://github.com/aashu91/robinhood-evm-mcp/issues/24)
- Structural volume context for any volume-funded payout: median Solana memecoin hold time ~100 seconds (Galaxy Research via Cointelegraph), and >90% of late-2025/early-2026 launches dead. — [Cointelegraph](https://regional-front.cointelegraph.com/news/memecoins-attract-users-platforms-reap-profits-report); [Blockonomi](https://blockonomi.com/the-memecoin-retention-crisis-why-over-90-of-new-tokens-collapse-after-launch/)

### Inferences
- Reflections convert a token's biggest weakness (volume decays to zero in days) into a visible, continuous signal of death: the "APY" goes to zero, and the mechanism that was supposed to retain holders becomes the reason to leave. This is consistent across RFI, SafeMoon and EverETH.
- Because reflections are implemented as a transfer tax, they also inherit all the aggregator/wallet penalties documented in KQ1 (slippage hacks, swap blocks when tax is unknown, scanner flags for modifiable tax).
- Holder revenue share is only coherent for tokens with an *external* revenue source (protocol fees), which is the population Keyrock studied, not memecoins.

### Gaps
- No cohort study of 2021-2024 ETH-rewards memecoins (survival, time to zero volume) was found; the Hex comparison requested in the brief could not be sourced in this search.
- The SafeMoon conviction and loss figures rest on secondary sources; DOJ/SEC releases were not retrieved.

---

## Key Question 5: Which anti-snipe / fair-launch mechanisms work and which get gamed (Doppler Dutch auctions, pump.fun bonding curves, max-wallet, launch delays), and bonding-curve vs direct-liquidity launches; "evolving"/milestone tokenomics

### Takeaway
Measured evidence: sniping on pump.fun is pervasive and partly deployer-funded (Pine Analytics), and per-wallet caps are trivially defeated by bundlers that advertise 16-17 wallets. Doppler's Dutch auction + multicurve has a coherent model showing ~77.5% reduction in sniper-extractable value, but it is model-only, and the one real-world data point in its own whitepaper (Zora's 60x lower start price) does not reproduce in an independent rebuild. The one empirical paper claiming to measure sniper-cohort effects withdrew all its numbers in Oct 2026.

### Cited Findings
**Sniping prevalence and deployer collusion**
- Pine Analytics (2025): >15,000 SOL profit/month from deployer-funded same-block snipes across 15,000+ launches; 87% of snipes profitable; 4,600+ sniper wallets, 10,400+ deployers; evasion via multi-hop funding and multi-signer transactions; recommended platform countermeasures are early-holder-concentration tracking, deployer-linked wallet labelling and frontend warnings (i.e. detection, not contract mechanics). — [Pine Analytics](https://pineanalytics.substack.com/p/exit-liquidity-machines)
- Solidus Labs cites Pine's same-block sniping as a key pump.fun pattern and notes the bonding curve itself favours creators and earliest buyers. — [Solidus Labs](https://www.soliduslabs.com/reports/solana-rug-pulls-pump-dumps-crypto-compliance)
- Pump.fun's own bundler tooling allows distributing an initial buy across up to 17 wallets (industry blog, unsourced); third-party bundlers advertise "add up to 16 more" wallets for the launch buy. — [Bex.co](https://bex.co/blog/2026/04/20/meme-launchpad-2-pump-fun-letsbonk-anti-sniper-reputation); [Smithii bundler guide](https://smithii.io/en/pump-fun-bundler-bot/)
- Pump.fun's founders have said soft rug pulls are hard to stop with technical controls and instead display holder-concentration data. — [Wikipedia: Pump.fun](https://en.wikipedia.org/wiki/Pump.fun)
- Bot dominance: a Coinbase executive reportedly said a handful of bots account for most launches on pump.fun-style platforms; 13 wallets launched >4,200 tokens on LetsBonk in 24 hours. — [BlockEden](https://blockeden.xyz/blog/2025/09/21/pump-fun-fairer-launch-paradox/)
- Withdrawn result (do not cite numbers): the arXiv paper "Coordinated Sniper Cohorts on Pump.fun" (July 2026) reported 1,012 persistent wallet rings and a +16.1% contamination-adjusted first-30-minute buyer-count lift, but an October 2026 correction notice states ~43% of its "buy" rows were actually sells and it captured only ~23% of real buys; "All numerical results in this version ... are therefore withdrawn." — [arXiv 2607.02795 PDF](https://arxiv.org/pdf/2607.02795)

**Max-wallet / anti-whale**
- Per-address caps are defeated by one trader controlling many addresses; suggested detection is via shared funding sources, new-wallet clusters and synchronised behaviour; overly strict caps also reject legitimate repeat buys. — [Bitget explainer](https://www.bitget.com/news/detail/12560605666478)
- Bundling is the insider version of the same tactic. — [PenguinToolz on Medium](https://medium.com/@PenguinToolz/what-are-bundled-memecoins-and-when-to-avoid-them-5d78a9ea7b97)
- Historical: Save the Kids token's anti-whale mechanism was allegedly altered on insider instruction before launch (single allegation). — [Wikipedia (historical)](https://en.wikipedia.org/wiki/Save_the_Kids_token)
- Academic note: whitelisted addresses exempt from transaction limits "creates unfair trading conditions that favor privileged addresses"; bundle-level entity resolution is listed as future work (i.e. unsolved). — [arXiv 2608.20271](https://arxiv.org/html/2608.20271)
- GoPlus flags `anti_whale_modifiable` because "a very small limit causes all trading to fail" (owner can halt trading via the cap). — [GoPlus docs](https://docs.gopluslabs.io/reference/response-details)

**Doppler (Dutch auction / multicurve on Uniswap v4)**
- Doppler whitepaper claims instantaneous arbitrage cost token deployers ">$100 million" on Ethereum mainnet and MEV/arbitrage on pump.fun cost users ">$400m" (project-reported figures). — [Doppler whitepaper](https://www.doppler.lol/whitepaper.pdf) via [Paragraph rebuild](https://paragraph.com/@holosko/i-rebuilt-dopplers-auction-math-from-the-whitepapers-what-the-curves-actually-do)
- Design: price starts above expected market price and decays step-wise in tick space until buyers appear; hook enforces a trading window, dynamically adjusts LP fees, tracks proceeds against a minimum threshold and migrates after the sale; SDK supports `startFee` up to 80% and an OpeningAuctionBuilder of single-sided LP positions ahead of the dynamic auction "to mitigate sniping." — [Uniswap hooklist PR #7506](https://github.com/Uniswap/hooklist/pull/7506); [Doppler SDK docs](https://docs.doppler.lol/reference/api-reference)
- Independent model rebuild (2026): multicurve reduces sniper-extractable value by 77.5% (80,000 to 18,020 in the model) under the same demand; a decay step smaller than `maxDelta` lets a multi-block censor ratchet the price down; too-steep gamma recreates the static bonding-curve problem; the whitepaper's Zora claim (start price cut 60x with the same sniping cost using one curve) yields ~13x baseline extractable value in the rebuild and only approaches baseline when a thin discovery curve is layered over a concentrated one. All results are model-only, not validated on Base pool fills. — [Paragraph](https://paragraph.com/@holosko/i-rebuilt-dopplers-auction-math-from-the-whitepapers-what-the-curves-actually-do)

**Launch windows / fixed-price periods / CAPTCHA**
- Flaunch: 30-minute fixed-price Fair Launch at a single tick; ETH raised then becomes a bid wall below spot so early buyers can exit at entry minus fees; no per-wallet cap documented. — [Flaunch whitepaper](https://docs.flaunch.gg/community/whitepaper)
- Pump.fun "Fair Launch Shield" CAPTCHA windows and LetsBonk Bonk-Points gating are asserted without effectiveness data. — [Bex.co](https://bex.co/blog/2026/04/20/meme-launchpad-2-pump-fun-letsbonk-anti-sniper-reputation)
- Decaying launch fees (see KQ1) are the v4-native substitute for launch delays: 1% to 0.1% floor by age/FDV ([hooklist #3516](https://github.com/Uniswap/hooklist/pull/3516)); 99% to 2% over 98 minutes ([OpenServ](https://docs.openserv.ai/docs/launch/token-launch-mechanics)); Hookr.fun "Anti-Snipe" block caps early buys and adds an LP fee for the first blocks (marketing page) — [Hookr.fun](https://hookr.fun/)

**Bonding curve vs direct liquidity**
- Pump.fun: ~800M of 1B tokens on the curve; graduation at ~$69K market cap (~85 SOL real reserves on top of 30 SOL virtual) with LP burned; the contract cannot be modified post-deploy. — [Arkham](https://info.arkm.com/research/crypto-launchpads-memecoin-platform-pump-fun-2025); [arXiv 2607.02823](https://arxiv.org/html/2607.02823v3); [DappRadar](https://dappradar.com/blog/ultimate-guide-to-pump-fun-the-leading-memecoin-launchpad)
- Caveat on curve metrics: pump.fun market cap is computed from virtual reserves and can exceed the graduation threshold without real capital entering; the authors' own attempt to count high-market-cap timeouts as missed graduations was withdrawn after a 100-mint check found none had graduated. — [arXiv 2607.02823 v3](https://arxiv.org/html/2607.02823v3)
- Clanker (Base, direct Uniswap liquidity, no curve) takes a 20% protocol cut of pool LP fees; Coin Bureau flags thin liquidity and fast hype cycles as its trade-off. No head-to-head sniping/outcome data vs pump.fun exists. — [Coin Bureau](https://coinbureau.com/analysis/best-memecoin-launchpads)
- A vendor blog claims the bonding curve is harder to snipe than a direct Raydium pool and that snipers take 5-20% of supply in the first second (no data). — [MemeFactory (vendor)](https://memefactory.it.com/blog/what-is-sniping)
- Marino et al. (Feb 2026) report that conditioning graduation models on SOL locked in the curve plus structural/behavioural launch variables "significantly improve[s]" predictive power; the abstract does not name which variables. — [arXiv 2602.14860](https://arxiv.org/abs/2602.14860)

**"Evolving" / milestone tokenomics**
- Examples found are all marketing-grade: Many Worlds ($MANY, 2022, "tokens age from purchase, taxed differently at each milestone") — [CryptoDaily sponsored (historical)](https://cryptodaily.co.uk/2022/01/many-worlds-the-world-s-first-dynamic-tokenomics-dominates-market-with-record-breaking-1260-bnb-presale-followed-by-surging-growth-on-dex); Dynamix ("evolving algorithm based on events," dynamic rewards/sell fees/buyback) — [Coinbase listing](https://www.coinbase.com/de/price/dynamix); Daddy Dogeback dynamic tax step — [CoinMarketCap](https://coinmarketcap.com/currencies/daddy-dogeback/). The only milestone-based mechanism with a clear rationale and immutable direction is the FDV/age-stepped *decreasing* fee hook on Unichain — [hooklist #3516](https://github.com/Uniswap/hooklist/pull/3516).

### Inferences
- The strongest documented anti-snipe lever is making early blocks *expensive* (high decaying fee / Dutch-auction start above market) rather than *restricted* (per-wallet caps, CAPTCHAs), because restrictions are evaded by wallet-splitting and bundlers, while a fee or price premium is paid by every wallet regardless of how many there are.
- Dutch-auction (Doppler) designs have the best theoretical case and zero published outcome data; a launchpad adopting one should expect to generate the first real evidence.
- Fixed-price windows (Flaunch's 30 min) convert the "who gets in first" race into a "how much do you want at the fixed price" allocation, which neutralises same-block sniping but not deployer self-buys unless supply per wallet is capped and sybil-detected.
- Bonding curves lock liquidity by construction (LP burn), which removes the classic Raydium "liquidity sweep" rug (93% of pools per Solidus) but moves the extraction to pre-graduation dumping and same-block sniping; direct-liquidity launches with hook-managed LP (Clanker/Flaunch) depend on the hook owner's integrity instead.
- Milestone/evolving tokenomics have no evidence base and, where the evolution is owner-controlled, trip scanner flags (`slippage_modifiable`, `anti_whale_modifiable`); the only defensible form is a monotonic, pre-committed schedule (fees can only decrease).

### Gaps
- No measured before/after data on any CAPTCHA, points-gating, or launch-delay mechanism.
- No on-chain validation of Doppler's auction outcomes vs. static curves.
- No head-to-head outcome data for bonding-curve vs direct-liquidity launches on the same chain/time window.
- The one quantitative sniper-cohort paper withdrew its results; a corrected version is "in preparation."

---

## Key Question 6: How do token-safety scanners (GoPlus, Token Sniffer, De.Fi, Honeypot.is, CertiK Skynet) treat fee controls, owner functions and hook-based fees, and how much do ratings affect trader behaviour?

### Takeaway
Scanners penalise *modifiability and privilege* more than the fee level itself: GoPlus exposes `slippage_modifiable`, `personal_slippage_modifiable`, `anti_whale_modifiable`, `transfer_pausable`, `is_whitelisted`, `trading_cooldown`, and wallets such as Trust Wallet hard-block swaps when tax cannot be determined. None of the scanner docs retrieved mention Uniswap v4 hooks, so hook-level fees are currently invisible to them (GoPlus only labels v4 pools as `pool_manager` liquidity). Evidence that ratings change trader behaviour is limited to vendor claims and wallet-level blocking; no user-override data exists.

### Cited Findings
**GoPlus (API consumed by wallets and bots)**
- Fee/owner fields and their risk wording: `slippage_modifiable` ("unlimited rates could make the token untradeable"); `personal_slippage_modifiable` (per-address tax "can block specific addresses from trading"); `transfer_pausable`; `buy_tax`/`sell_tax` on a 0-1 scale where empty = unknown and 1 = 100%/untradeable; `is_honeypot` ("definitely scam"); `is_blacklisted`; `is_whitelisted` ("mainly for early tax-free trades"; entries persist even after ownership is renounced); `cannot_sell_all`; `is_anti_whale` and `anti_whale_modifiable` ("a very small limit causes all trading to fail"); `trading_cooldown`; `is_mintable` ("extremely risky"); `owner_change_balance`; `can_take_back_ownership`; `hidden_owner`; `is_proxy` and `is_open_source` (closed source nulls out other checks). No mention of hooks; UniV4 pairs are only identified via `liquidity_type = pool_manager`. — [GoPlus response details](https://docs.gopluslabs.io/reference/response-details)
- GoPlus describes a free tier of 150K CU/month and paid tiers from $199/month; docs and console disagree on free-tier rate limits (30 calls/min vs 150 CU/min). — [GoPlus Security API](https://gopluslabs.io/en/security-api); [CoinDesk Research](https://www.coindesk.com/research/protocol-research-goplus-security)
- GoPlus research: ~66.6% of newly added ERC20s on Base across three quarters were flagged as suspected scams. — [GoPlus deep dive on Substack](https://defihacklabs.substack.com/p/goplus-security-deep-dive-on-how)
- GoPlus documentation says wallets can use its signals to "warn, block, or escalate" risky actions and let users set risk tolerance. — [GoPlus whitepaper core features](https://whitepaper.gopluslabs.io/goplus-network/web3-security/core-features)

**Wallet enforcement (the main behavioural channel)**
- Trust Wallet blocks swaps when GoPlus tax data is missing/unknown and treats 100% sell tax or `is_honeypot: true` as unsellable. — [Trust Wallet Support](https://support.trustwallet.com/support/solutions/articles/67000740000--swap-is-blocked-by-asset-tax-value-error-what-it-means)

**Honeypot.is**
- Simulates buys and sells to detect blacklists and high taxes; API returns `highestTax` and `highTaxWallets` (count of wallets paying >=50% tax) and flags such as `TRANSFER_BLOCKED` and `EXTREMELY_HIGH_TAXES`; the exact threshold for the high-tax flag is not documented. — [Honeypot.is API](https://docs.honeypot.is/ishoneypot)

**Token Sniffer (Solidus Labs product)**
- Checks described: swapability; honeypot; buy/sell fees with 5% cited as a "safe threshold"; contract verified; ownership renounced / no owner-only functions that alter functions or drain liquidity; mutable metadata; holder concentration (example flags creator or any holder >5%); liquidity flagged as rug risk if <95% burned or locked for at least 15 days; perfect 100/100 "doesn't guarantee success." No published weights or formula. — [Bitbond Token Sniffer guide](https://www.bitbond.com/resources/token-sniffer-comprehensive-guide-review/)
- Solidus recommends avoiding tokens scoring below 80/100 and automating LP-lock and ownership-distribution checks (vendor guidance). — [Solidus Labs](https://www.soliduslabs.com/reports/solana-rug-pulls-pump-dumps-crypto-compliance)

**CertiK Skynet Token Scan**
- Shows buy and sell tax percentages as "market" items and ownership renounced/not renounced as a centralisation flag (example page showed 24% buy / 27% sell tax with unrenounced owner). — [CertiK Skynet example](https://skynet.certik.com/tools/token-scan/bsc/0x9733e1038897efb36bb2e526c328c9b6a4b78db2)

**Practitioner thresholds (third-party, not official)**
- Sell tax >10-12% treated as a stop signal; round-trip recovering <92% of buy treated as a trap heuristic by sniper-bot guides. — [Coinvado](https://coinvado.com/en/posts/honeypot-token-detection-tools-dextools-2026/)
- Third-party guides note GoPlus flags owner-adjustable taxes because "a token you enter at a low fee can become unsellable if the fee is pushed high enough" and flags cooldowns that "can be abused to trap liquidity when hype is peaking." — [CryptoUniversity GoPlus review](https://cryptouniversity.network/reviews/goplus-security-explained-multi-chain-token-and-wallet-risk-checks)

### Inferences
- For a launchpad designer: any fee, cap or cooldown that lives *in the token contract* and is *owner-adjustable* will light up GoPlus (`slippage_modifiable`, `anti_whale_modifiable`, `transfer_pausable`) and can cause wallet-level swap blocks. Fees that live in the pool/hook and are either immutable or only-decreasing avoid these flags today, because scanners do not yet analyse hook logic.
- The "unknown tax" block in Trust Wallet is the single most consequential scanner behaviour found: a tax the simulator cannot resolve (e.g. conditional on holding time, wallet, or hook state) is treated worse than a known 5% tax.
- Scanner blindness to v4 hooks is a double-edged sword: it lets honest hook-fee designs avoid false flags, but it also means a malicious hook (e.g. dynamic fee set to 100% for sells) is not caught, and scanners will likely close this gap, at which point owner-controlled hook fees will be flagged like owner-controlled contract taxes.
- Since the rug literature finds Solana rugs are liquidity events, the scanner checks that matter most there are LP lock/burn and holder concentration, not fee flags; on EVM chains the fee/owner flags matter more because contract-level backdoors are common (GoPlus 66.6% scam rate on Base).

### Gaps
- No data on how often users override scanner warnings, abandon swaps after a block, or on volume differences between tokens with different scanner scores.
- Token Sniffer's actual scoring weights and De.Fi Scanner's thresholds were not retrievable from primary docs.
- No scanner documentation on Uniswap v4 hook analysis was found; the absence is itself the finding.

---

## Cross-cutting summary for the launchpad designer (inferences drawn from the above)

Worth building, with evidence-based caveats:
- Pool/hook-level fees rather than token-level transfer taxes (KQ1 plumbing evidence; KQ6 scanner flags).
- Time- or milestone-decaying launch fees that can only decrease, pre-committed and immutable (KQ1 hooklist designs; KQ5 anti-snipe logic; avoids `slippage_modifiable`).
- Fixed-price or Dutch-auction opening windows (Flaunch 30-min window; Doppler) as the structural anti-snipe layer, accepting that outcome data does not yet exist.
- LP lock/burn at launch (the only check both Solidus and the rug-ML literature treat as decisive on Solana).
- Creator fee share only with immutable or one-shot-editable recipients (pump.fun's March 2026 fix) and ideally with CTO reassignment paths (Jan 2026 fix).
- Creator vesting locked atomically at creation (Zora, SlotZero pattern), paired with deployer-funding-graph detection, because the Pine Analytics data shows extraction via funded snipers, not the declared bag.
- If fees are recycled into the token, a resting bid wall (maker-side, below spot) rather than scheduled market buybacks (sqrtDAO sandwich surface; Keyrock procyclicality).

Gimmicks or unsupported by evidence:
- Reflections / holder dividends funded by transaction tax (dies with volume; inherits tax penalties; RFI/SafeMoon/EverETH).
- Per-wallet max limits and CAPTCHA windows as a primary anti-snipe tool (sybil/bundler evasion is openly productised).
- Owner-adjustable "evolving" tokenomics (no evidence; triggers scanner flags; the vamping pattern shows mutability is exploited).
- Scheduled, slippage-unprotected buyback-and-burn (sandwich target; no measured price effect even at protocol scale).
- Manual or discretionary supply burns (historical manipulation-risk flag; no memecoin outcome data).
