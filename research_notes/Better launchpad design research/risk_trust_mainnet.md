# Trust, Security, Regulatory and Ethereum-Mainnet Feasibility Factors for a Uniswap v4 Hook Launchpad (as of 19 Oct 2026)

Scope note: these notes cover the risk/constraints side only (exploits, security practice, scanners, regulation, mainnet economics, disclosure UX). Research was done 19 Oct 2026. Where a fact comes from a secondary outlet rather than a primary source (post-mortem, court order, regulator page), that is flagged. Tool-call budget was exceeded because the brief spans six distinct domains; several follow-ups are listed under Gaps rather than pursued.

---

## KQ1. Major launchpad exploits, insider scandals and rug waves 2024–2026, and what changed afterward

### Takeaway
Almost every headline launchpad failure in 2024–2026 came from one of three sources: (a) privileged/insider access (pump.fun ex-employee, LIBRA team sniping, DONT pre-announcement buys), (b) liquidity-migration logic that could be front-run or pre-created (Four.meme twice, Odin.fun), or (c) application-layer hook/accounting bugs rather than Uniswap v4 core (Cork $11–12M, Bunni $8.4M). The structural lessons are: no withdraw authority, no pre-creatable migration path, hook callbacks gated to the PoolManager, and anti-sniper fee schedules at launch.

### Cited Findings

**pump.fun (Solana), 16 May 2024 – insider exploit**
- A former employee used privileged access to the withdraw authority and took ~12,300 SOL (~$1.9M); the attacker used flash loans to buy memecoins up their bonding curves to 100% completion, which unlocked the liquidity used to repay the loans. About $1.9M of ~$45M in bonding-curve liquidity was affected — [The Block](https://www.theblock.co/post/295029/pump-fun-post-mortem); [The Defiant](https://thedefiant.io/news/hacks/pump-fun-identifies-ex-employee-in-usd1-9m-breach)
- Response: trading halted by 17:00 UTC, contracts upgraded, pump.fun seeded LPs of affected coins with equal-or-greater SOL liquidity and set trading fees to 0% for seven days — [Benzinga](https://benzinga.com/markets/cryptocurrency/24/05/38897152/solana-meme-coin-platform-pump-fun-exploited-for-1-9m-vows-to-repay-users)
- Secondary sources disagree on which lending protocol was used (Cointelegraph says Raydium; Coin360 says MarginFi) and Coin360 frames it as a compromised key rather than an insider — [Cointelegraph](https://cointelegraph.com/news/solana-memecoin-tool-pumpfun-claims-ex-employee-exploiter); contradicted by [Coin360](https://coin360.com/news/solana-launchpad-pump-fun-multimillion-heist)

**Four.meme (BNB Chain), Feb and Mar 2025 – liquidity-migration front-running, twice**
- February 2025: ~$183K lost when attackers created a fake PancakeSwap V3 pool before the legitimate pool opened — [Decrypt](https://decrypt.co/310388/meme-coin-launchpad-four-meme-falls-victim-to-another-exploit?amp=1)
- March 2025 (second exploit in two months): a flaw let the attacker buy tokens pre-launch and send them to a PancakeSwap pair address that did not yet exist, then create the pair themselves; QuillAudits said this let the attacker "bypass transfer restrictions and manipulate liquidity pool pricing"; SlowMist flagged it first; Four.meme suspended the affected pool — [Decrypt](https://decrypt.co/310388/meme-coin-launchpad-four-meme-falls-victim-to-another-exploit?amp=1); [Yellow.com (Mar 18 2025)](https://yellow.com/it/news/bnb-chain-meme-launchpad-fourmeme-sospende-le-operazioni-dopo-un-exploit-critico)
- No official Four.meme post-mortem was found; a third-party write-up covers one small ($15K) token case — [Lunaray (Medium)](https://lunaray.medium.com/four-meme-hack-analysis-a9cfe2c433ed)

**LIBRA / Meteora (Solana), Feb 2025 – insider sniping scandal**
- Hayden Davis (Kelsier Ventures) told Coffeezilla the LIBRA team sniped its own token at launch and that pre-launch insider knowledge is standard for major memecoin launches — [The Block](https://www.theblock.co/amp/post/341412/meteora-co-founder-ben-chow-resigns-amid-libra-scandal)
- Meteora co-founder Ben Chow resigned; he said Meteora had "no involvement in the project at all beyond providing IT support" though he had been told about it weeks in advance — [The Block](https://www.theblock.co/amp/post/341412/meteora-co-founder-ben-chow-resigns-amid-libra-scandal)
- Burwick Law filed a class action naming KIP, Meteora and Kelsier (not Milei) — [BeInCrypto](https://beincrypto.com/burwick-libra-lawsuit-meteora-kelsier/)
- DappRadar cites LIBRA (down >94% after a high-profile post was deleted) as the archetype of 2025's "fewer but more devastating" rugs — [Cointelegraph/DappRadar](https://cointelegraph.com/news/2025-shaping-up-fewer-but-more-impactful-rugpulls-dapp-radar)
- Design change that followed: Meteora shipped an "Anti-Sniper Suite" (A.S.S.) — a Fee Scheduler (fee starts high and decays linearly or exponentially; DAMM v2 frontend default is exponential from 50% decaying over 120 minutes to 0.25%), a Rate Limiter specific to its Dynamic Bonding Curve (fee rises with buy size, e.g. first SOL of a 100 SOL swap at 1% and later SOL at higher rates), Dynamic Fees and Alpha Vault — [Meteora docs](https://docs.meteora.ag/meteoras-anti-sniper-suite-a.s.s./meteoras-anti-sniper-suite); [Fee Scheduler](https://docs.meteora.ag/meteoras-anti-sniper-suite-a.s.s./meteoras-anti-sniper-suite/fee-scheduler); [A.S.S. for DBC](https://docs.meteora.ag/meteoras-anti-sniper-suite-a.s.s./meteoras-anti-sniper-suite/a.s.s.-for-dbc)

**Base launchpad incidents (Zora, Clanker, Virtuals), 2025**
- Zora (Base), 24 Apr 2025: ~$128K lost because the TokenCommunityClaim contract's `claim()` lacked access control, letting an attacker redirect unclaimed airdrop allocations to a contract they controlled — [Olympix](https://olympix.substack.com/p/419k-could-have-been-saved-if-only)
- Zora's own ZORA token launched without announcement or claim link, drawing criticism (process failure, not a hack) — [The Block](https://www.theblock.co/post/351671/zora-airdrop-triggers-confusion-as-token-launches-without-announcement-requires-users-claim-manually)
- No Clanker smart-contract exploit was found in search; Farcaster acquired Clanker and a May 2025 controversy led it to sever ties with "proxystudio" (details not captured) — [CoinEx report](https://www.coinex.com/en/insight/report/2025-launchpad-wars-base-vs-solana-68a29bdc9609f21454c0e673)
- Virtuals: sniping was a recognised problem — a July 2025 governance vote proposed allocating 1% of VIRTUAL supply to a "Sniper Defense & Yield Fund" to reimburse past defense operations and cover 150+ agent launches — [TradingView/CoinMarketCal](https://tr.tradingview.com/news/coinmarketcal%3A41b635a08094b%3A0-virtuals-protocol-virtual-sniper-defense-vote-04-jul-to-07-jul-2025); in Nov 2025 an agent (BasisOS) running on Virtuals stole ~$500K of user funds — [CoinStats](https://coinstats.app/news/e2590c206dae098f7aa9ba44660ccce1d2ef0feba4eb1157bf71fd3b35e9d52c_AI-Agent-On-Virtuals-Protocol-Stole-500000-A-Blessing-In-Disguise-For-Verified-Bots-And-VIRTUAL-Crypto); Virtuals activity fell >80% by Feb 2025 (daily active wallets <8,000) — [Pine Analytics](https://pineanalytics.substack.com/p/the-virtual-bear-case)

**Uniswap v4 hook exploits (most relevant to this design)**
- Cork Protocol, 28 May 2025, ~$11–12M: two independent flaws — the attacker called the hook's `beforeSwap()` directly (should only be callable by PoolManager) because of missing access control, plus manipulation of an expiry-time volume-weighted price (HIYA). Cork's post-mortem notes a later upstream Uniswap periphery change added an explicit authorization check that was absent in the version Cork used. Four audits preceded the attack and three of the four did not cover the hook code — [Cork post-mortem (4 Jun 2025)](https://www.cork.tech/blog/post-mortem); [BlockSec](https://blocksec.com/blog/cork-protocol-incident-two-independent-flaws-combine-into-one-devastating-exploit-chain); [Verichains](https://blog.verichains.io/p/cork-protocol-exploit-analysis); [Dedaub](https://dedaub.com/blog/the-11m-cork-protocol-hack-a-critical-lesson-in-uniswap-v4-hook-security/); audit-coverage claim via [KuCoin summary](https://www.kucoin.com/news/flash/uniswap-v4-hook-security-analysis-architecture-vulnerabilities-and-best-practices)
- Bunni v2, 1–2 Sep 2025, ~$8.4M across Ethereum (~$2.4M) and Unichain (~$6M): a rounding/precision bug in Bunni's custom Liquidity Distribution Function hook; attacker used exact-input swaps of specific sizes so rounding errors compounded and v4 flash accounting netted the error as a positive balance; no flash loans or oracle manipulation needed; Bunni suspended all contracts — [Rekt](https://alpha.rekt.news/bunni-rekt); [Verichains](https://blog.verichains.io/p/bunnixyz-vulnerability-exposed-how); [QuillAudits](https://www.quillaudits.com/blog/hack-analysis/bunni-v2-exploit); [Cointelegraph](https://cointelegraph.com/news/bunni-hack-2-4m-stablecoin-exploit-uniswap-v4)
- Trail of Bits: Cork and Bunni "did not come from the Uniswap v4 core or PoolManager, but from application-specific authorization and accounting logic around hooks" — [Trail of Bits (30 Jul 2026)](https://blog.trailofbits.com/2026/07/30/building-secure-uniswap-v4-hooks/)

**Insider/sniping cases and rug statistics, late 2025–2026**
- DONT (Bonk.fun, Jan 2026): a wallet bought ~29B DONT for just over $4,000 before the Nasdaq-listed issuer's official announcement; the company called it an "early sniper"; Decrypt verified the funding link and Bubblemaps confirmed — [Decrypt](https://decrypt.co/355552/solana-treasury-firm-blames-sniper-suspicious-meme-coin-trades)
- ATLAS (Dec 2025): Bubblemaps found 68 wallets acquired 47% of supply before official launch — [MEXC news aggregation](https://www.mexc.com/news/541795)
- Odin.fun: ~$7M liquidity exploit by depositing a worthless token alongside BTC and setting an inflated price ratio in a thin market (date not captured) — [MEXC news aggregation](https://www.mexc.com/news/62159)
- Solidus Labs 2025 Rug Pull Report: ~98.7% of pump.fun tokens (Jan 2024–Mar 2025) and ~93% of Raydium pools showed pump-and-dump or rug-pull traits; only ~97,000 of >7M tokens kept liquidity above $1,000; median loss per incident $2,832 — [Solidus Labs](https://www.soliduslabs.com/reports/solana-rug-pulls-pump-dumps-crypto-compliance); [The Defiant](https://thedefiant.io/news/defi/alarming-99-of-memecoin-launches-on-pumpfun-are-pump-and-dumps-or-rug-pulls-report)
- Chainalysis (2023 data): more than half of ERC-20 tokens listed on DEXs in 2023 met criteria for possible pump-and-dump — [Blockworks](https://blockworks.com/news/chainalysis-rug-pull-report)
- DappRadar: Q1 2025 rugs were mostly memecoins, "less frequent but more damaging" — [Cointelegraph](https://cointelegraph.com/news/2025-shaping-up-fewer-but-more-impactful-rugpulls-dapp-radar)

### Inferences
- For a hook-based launchpad the single most dangerous pattern is any privileged key that can touch pooled funds (pump.fun) or any migration step whose target can be pre-created or front-run (Four.meme). A v4 design that launches directly into a hook-gated pool with no "graduation" migration removes the Four.meme class entirely.
- The insider-sniping class (LIBRA, DONT, ATLAS) is not a smart-contract bug; it is a process/distribution problem. The industry response (Meteora's fee scheduler and rate limiter, Virtuals' sniper fund) converged on time-decaying launch fees and per-trade size limits — both natively expressible in a v4 `beforeSwap` dynamic-fee hook.
- Both big v4 hook losses were in hooks that *did more* than fee logic (custom AMM accounting, return deltas). A launchpad hook that only sets dynamic fees and gates swaps/initialization has a far smaller attack surface than one that uses `BeforeSwapDelta` to act as its own AMM.

### Gaps
- No official Four.meme post-mortem exists in public search; only SlowMist/QuillAudits commentary via Decrypt.
- Current status (2026) of the LIBRA civil/criminal matters was not found; results were Feb–Mar 2025 only.
- The Clanker/proxystudio May 2025 controversy was mentioned but not explained in any result.
- No 2026 Chainalysis crime-report figures on memecoin rugs were found; the Solidus Labs 2025 report remains the most-cited dataset.

---

## KQ2. Security practices and disclosures used by credible launchpads and v4 hook projects

### Takeaway
The credible pattern as of 2026 is: multiple named audits that explicitly cover the hook (Cork's failure was three audits that didn't), an active bug bounty, hook deployed immutable (no proxy), initialization restricted so random pools can't attach to your hook, every callback gated to `msg.sender == PoolManager`, LP positions sent to a locker with no withdraw path, and creator fee streams routed through a locker with on-chain-visible recipients. Uniswap's own v4 launch set the ceiling (nine audits, $2.35M competition, $15.5M bounty).

### Cited Findings

**What the reference standard looks like (Uniswap v4 core)**
- Uniswap v4 went live 31 Jan 2025 on 10 chains after nine audits, a $2.35M security competition with >500 participants, and a bug bounty of up to $15.5M (described as the largest in history); no critical bugs found; bounty remains active — [Uniswap blog](https://blog.uniswap.org/uniswap-v4-is-here)
- Uniswap Foundation runs a Security Fund (cohort 2) for hook teams — [Uniswap Foundation](https://uniswapfoundation.org/blog/uniswap-foundation-security-fund-cohort-2)

**Trail of Bits hook checklist (30 Jul 2026) — the most concrete public guidance**
- Restrict initialization in `beforeInitialize`; otherwise anyone can create a pool that uses your hook address; bind hook to canonical pools or keep a strict allowlist; re-derive `PoolId` from the supplied `PoolKey` on every user-controlled path — [Trail of Bits](https://blog.trailofbits.com/2026/07/30/building-secure-uniswap-v4-hooks/)
- Restrict callbacks to the PoolManager (use `BaseHook` and `SafeCallback`, plus explicit caller checks) — the Cork lesson — [Trail of Bits](https://blog.trailofbits.com/2026/07/30/building-secure-uniswap-v4-hooks/)
- Keep permission bits in sync with implemented return deltas (Sorella Angstrom finding: a missing `afterSwapReturnDelta` bit made every swap revert with `CurrencyNotSettled()` once a dynamic protocol fee was enabled) — [Trail of Bits](https://blog.trailofbits.com/2026/07/30/building-secure-uniswap-v4-hooks/)
- Prefer immutable, versioned deployments over proxies; if a proxy is used, review upgrade admin, delay, storage layout — [Trail of Bits](https://blog.trailofbits.com/2026/07/30/building-secure-uniswap-v4-hooks/)
- Dynamic-fee pitfalls: bound every fee, rate-limit privileged fee changes, don't derive fees from cheaply manipulable inputs, fuzz fee extremes — [Trail of Bits](https://blog.trailofbits.com/2026/07/30/building-secure-uniswap-v4-hooks/)
- Never let non-essential logic in `afterRemoveLiquidity` revert (it blocks withdrawals); wrap optional external calls in try/catch — [Trail of Bits](https://blog.trailofbits.com/2026/07/30/building-secure-uniswap-v4-hooks/)
- Invariants to test: users receive no output accounting didn't charge for; same-transaction round trips can't create value; internal accounting matches balances including fee-on-transfer/rebasing tokens; fuzz with Echidna/Medusa — [Trail of Bits](https://blog.trailofbits.com/2026/07/30/building-secure-uniswap-v4-hooks/)
- OpenZeppelin's LiquidityPenaltyHook JIT penalty was bypassed by collecting fees in a separate step first — an example that even OZ-authored hooks had logic gaps — [Trail of Bits](https://blog.trailofbits.com/2026/07/30/building-secure-uniswap-v4-hooks/)
- Uniswap's own AI/security guide: before interacting with a hook that uses `beforeSwapReturnDelta: true`, audit its code, check ownership and upgradeability, verify audit history, start with small amounts; checklist asks whether every callback checks `msg.sender == PoolManager` — [uniswap-ai v4 security foundations](https://skills.cat/skills/uniswap/uniswap-ai/v4-security-foundations)
- BlockSec: PoolManager only checks account *conservation*, not *correctness*, so a hook returning a fabricated delta can still settle — [BlockSec](https://blocksec.com/blog/lead-in-uniswap-v4-hook-risks)
- Other hook-audit methodology write-ups: [Hacken](https://hacken.io/discover/auditing-uniswap-v4-hooks/); [QuillAudits hooks ecosystem](https://www.quillaudits.com/research/uniswap-development/uniswap-v4/hooks-ecosystem)

**What launchpads actually do (Clanker as the best-documented v4 example)**
- Clanker v3-era: the Uniswap V3 position NFT is sent to a Clanker LP Locker V2 contract that has no withdraw method and cannot be upgraded, so initial liquidity is inaccessible to creators and team; creators got 40% of the 1% trading fee, Clanker 60% — [Paragraph (matthewb)](https://paragraph.xyz/@matthewb/clanker-pt1)
- Clanker v4: LP fees go to a dedicated fee locker; up to 7 reward recipients can be assigned at token creation, each modifiable by a paired "admin" address; WETH rewards claimable across multiple tokens in one tx; contracts audited by Macro & Cantina — [Paragraph (Introducing Clanker v4)](https://paragraph.xyz/@dish/introducing-clanker-v4); [Bankless](https://www.bankless.com/fr/read/clanker-v4-token-creator.md)
- Macro's public audit library lists Clanker-6 (20 Oct 2025) and Clanker-7 (7 Nov 2025, "ERC-20 token deployment on Base and rewards creators based on trading volume"); Clanker-7 is a private report — [Macro audit list](https://macro-website.onrender.com/works)
- Flaunch (Base) uses v4 hooks for fixed presale pricing, creator fee redirection and automated listing — [QuillAudits hooks ecosystem](https://www.quillaudits.com/research/uniswap-development/uniswap-v4/hooks-ecosystem)
- pump.fun's post-exploit playbook: halt trading, upgrade contracts, make affected pools whole, zero fees for 7 days — [Benzinga](https://benzinga.com/markets/cryptocurrency/24/05/38897152/solana-meme-coin-platform-pump-fun-exploited-for-1-9m-vows-to-repay-users)
- Meteora exposes its anti-sniper parameters (fee schedule shape, start/end fee, duration) in docs so launchers and traders can read them — [Meteora docs](https://docs.meteora.ag/meteoras-anti-sniper-suite-a.s.s./meteoras-anti-sniper-suite/fee-scheduler)

### Inferences
- A small team can realistically implement: (1) one reputable audit whose scope explicitly includes the hook and the locker (budget for a second, smaller review or a Code4rena/Cantina competition if the hook uses return deltas); (2) an Immunefi bounty even at modest size; (3) immutable hook + immutable locker with no withdraw function; (4) `beforeInitialize` allowlist so only launchpad-created pools attach; (5) hard-coded fee ceilings and a rate-limited fee-change path (or no privileged fee path at all); (6) published invariant/fuzz test suite.
- "Communicating" security to traders is mostly done by making it checkable on-chain: the locker address with no withdraw function (Clanker), verified source, and a public audit list. Private audit reports (Clanker-7) reduce trust value; publish the report.
- The Cork and Bunni losses argue strongly for keeping the launchpad hook *simple* (fee/gating only, no custom AMM math) — the complexity budget is the audit budget.

### Gaps
- No public audit reports were located for Flaunch, Doppler/Whetstone or pump.fun's contracts; Clanker's Macro report is private. Check each project's GitHub/docs "audits" folder directly.
- No data found on which launchpads run public bug bounties (Immunefi listings were not searched directly).

---

## KQ3. How token-safety scanners and wallets evaluate hook-based tokens; what makes a token show as "safe"

### Takeaway
Scanners (GoPlus) grade the *token contract* (honeypot, mint, tax, pause, blacklist, owner) and the *LP holders* (lock/burn), and GoPlus does recognise Uniswap V4 pools (`pool_manager`, `pool_fee`), but no scanner found evaluates hook logic itself. Wallet/DEX warnings (Uniswap, MetaMask, Coinbase) run on Blockaid and flag honeypots, impersonators, spam and 100% sell fees. A hook-based launch token therefore shows "safe" if the ERC-20 is a plain, ownerless, verified, non-taxed token and the LP is at a recognised lock/burn address — but any swap fee the hook imposes is invisible to the token-level scan and could be mistaken for a tax if it is extreme.

### Cited Findings
- GoPlus Token Security API fields: `is_open_source`, `is_proxy`, `is_mintable`, `owner_address`, `can_take_back_ownership`, `owner_change_balance`, `hidden_owner`, `selfdestruct`, `external_call`, `is_honeypot`, `transfer_pausable`, `is_blacklisted`, `is_whitelisted`, `buy_tax`/`sell_tax`/`transfer_tax`, `cannot_buy`, `cannot_sell_all`, `slippage_modifiable`, `is_anti_whale`, `trading_cooldown`, `is_in_dex`, `creator_percent`, `holder_count`, `lp_holders` (with `is_locked`, `locked_detail` amount/end_time), `trust_list`, `fake_token`, `launchpad_token` — [GoPlus docs](https://docs.gopluslabs.io/reference/response-details)
- GoPlus `dex` object includes `liquidity_type` limited to UniV2/V3/V4, and for UniV4 a `pool_manager` field plus `pool_fee`; docs state actual trade cost = token tax + `pool_fee`; hooks are not mentioned — [GoPlus docs](https://docs.gopluslabs.io/reference/response-details)
- GoPlus lock detection only recognises lock addresses on its own list; there is no dedicated "burned" flag — holdings at black-hole addresses are treated as burned — [GoPlus docs](https://docs.gopluslabs.io/reference/response-details)
- Academic mapping of GoPlus flags (`is_blacklisted`, `transfer_pausable`) to "trapdoor token" categories on Uniswap — [arXiv 2309.04700](https://arxiv.org/pdf/2309.04700)
- Uniswap's interface (via Blockaid, since Dec 2024) labels tokens flagged as malicious plus separate labels for honeypots, impersonators, spam, and 100% sell fees; warnings cover Ethereum ERC-20s and supported L2s — [Uniswap support](https://support.uniswap.org/hc/en-us/articles/8723118437133); [The Block](https://www.theblock.co/post/332249/uniswap-taps-blockaid-for-new-token-warning-system)
- MetaMask security alerts: token "Warning"/"Malicious" statuses for impersonation, unusual contract behaviour such as unexpected fees, and spam-style distribution; an address "Warning" can mean the contract is unverified on a block explorer such as Etherscan — [MetaMask support](https://support.metamask.io/configure/wallet/security-alerts/)
- Blockaid is used by Coinbase, Stellar and MetaMask and claims >$4B in prevented losses (company-reported) — [The Block](https://www.theblock.co/post/332249/uniswap-taps-blockaid-for-new-token-warning-system)
- Honeypot definition/guidance used by wallets: a token that allows purchases but prevents or restricts sales; common tell is a 100% sell tax — [Webacy](https://docs.webacy.com/glossary/honeypots.md); [TokenPocket](https://help.tokenpocket.pro/en/security-knowledge/security-measure/risky-token-link); [Trust Wallet](https://trustwallet.com/blog/security/how-to-spot-honeypot-tokens-scams)
- Trail of Bits notes that unless `beforeInitialize` is restricted, anyone can create a pool with your hook attached — meaning a hook's reputation can be hijacked by third-party pools — [Trail of Bits](https://blog.trailofbits.com/2026/07/30/building-secure-uniswap-v4-hooks/)

### Inferences
- To render "green" across GoPlus/Blockaid-style checks, the launched ERC-20 should be: verified source, no owner (or renounced with no hidden owner), non-mintable, non-pausable, no blacklist/whitelist, zero transfer tax, not a proxy, and 100% of LP at a recognised locker or burn address. Push the entire fee/anti-sniper logic into the hook, not the token.
- Because GoPlus reports `pool_fee` for V4 pools, a very high launch-phase dynamic fee (e.g. Meteora-style 50%) may surface as an alarming number or be misread as a sell tax. Mitigation: keep the launch-fee window short, document it, and expose the current fee via a view function and on the launchpad UI.
- Scanner "lock" detection depends on being on GoPlus's locker list; a new launchpad should ask GoPlus (and similar: De.Fi, TokenSniffer, Honeypot.is) to whitelist its locker contract, otherwise LP will show as held by an unknown contract.
- Nothing found suggests Phantom/Rabby/Blowfish perform hook-level analysis; hook risk is currently communicated only through audits and Uniswap's hook allowlist.

### Gaps
- No public documentation found on how Rabby, Phantom or Blowfish specifically score tokens; searches returned mostly phishing-domain reports.
- Could not confirm whether Etherscan runs its own token-reputation labels beyond source verification.
- No scanner was found that evaluates hook code (dynamic fee ceilings, callback access control) — this appears to be an unfilled gap as of Oct 2026.

---

## KQ4. Regulatory status 2025–2026 (SEC memecoin statement, GENIUS/CLARITY, pump.fun litigation, MiCA, enforcement, jurisdiction/KYC)

### Takeaway
US: the SEC staff's 27 Feb 2025 statement says most memecoins are not securities (non-binding; fraud still actionable), and the pump.fun class action's Securities Act claims were dismissed on 31 Aug 2026 for lack of a common enterprise, but RICO claims (wire fraud, illegal gambling, unlicensed money transmission) against pump.fun's operator survived — so the live US risk for a launchpad operator is fraud/gambling/money-transmission theories, not securities registration. The CLARITY Act failed cloture 49–50 on 15 Sep 2026, so there is no federal market-structure statute. EU: MiCA transition ended 1 Jul 2026; the Commission's Feb 2026 Q&A says tokens with no identifiable issuer need no white paper, but platforms still need CASP authorisation and must assess whether an issuer exists — and a launchpad that charges creation/trading fees is a poor candidate for the "no identifiable issuer" or "free offer" exemptions. The UK FCA warning that led pump.fun to geoblock the UK (Dec 2024) is the clearest launchpad-specific enforcement signal.

### Cited Findings

**SEC staff statement on meme coins (27 Feb 2025)**
- Defines a meme coin as "a type of crypto asset inspired by internet memes, characters, current events, or trends," typically purchased for entertainment/social purposes, with limited or no utility, "akin to collectibles"; concludes offer and sale generally does not involve a security; no common enterprise, no expectation of profit from others' efforts; promoters hyping on social media or seeking listings is unlikely alone to create such expectation — [SEC.gov](https://www.sec.gov/newsroom/speeches-statements/staff-statement-meme-coins)
- Caveats: does not cover "products that are labeled 'meme coins' in an effort to evade the application of the federal securities laws"; "fraudulent conduct related to the offer and sale of meme coins may be subject to enforcement action"; staff views only, no legal force — [SEC.gov](https://www.sec.gov/newsroom/speeches-statements/staff-statement-meme-coins)
- Commissioner Crenshaw dissented the same day, arguing Howey was misapplied and the term lacks definition — [Charltons](https://charltonsquantum.com/?p=22889); law-firm analyses: [Ropes & Gray](https://www.ropesgray.com/en/insights/alerts/2025/02/meme-coins-sec-staff-says-this-is-fine); [Polsinelli](https://www.polsinelli.com/bert-stemmler/publications/staff-statement-on-meme-coins-signals-shift); [King & Spalding](https://www.kslaw.com/insights/articles/meme-coins-collectibles-not-securities)

**pump.fun litigation (SDNY)**
- Filed 30 Jan 2025 by Diego Aguilar (Burwick Law, Wolf Popper) alleging Securities Act violations — [The Block](https://www.theblock.co/post/338170/investor-sues-pump-fun-for-losses-on-highly-volatile-memecoins-alleging-securities-violations); [The Defiant](https://thedefiant.io/news/defi/pump-fun-slammed-with-lawsuit-for-violating-us-securities-laws)
- Expanded ~Apr 2025 into a RICO case naming Solana Foundation, Solana Labs, Jito and executives — [The Block](https://www.theblock.co/post/363996/burwick-law-names-solana-and-jito-executives-in-expanded-rico-case-against-pump); Jito Labs won dismissal (Oct 2025) — [Skadden](https://www.skadden.com/about/news-and-rankings/news/2025/10/crypto-developer-jito-labs-wins-dismissal-of-class-action); PNUT case consolidated by Judge McMahon (Jun 2025) — [Decrypt](https://decrypt.co/331528)
- Pump.fun moved to dismiss the RICO complaint in March 2026 — [Law360](https://www.law360.co.uk/articles/2450466)
- Order of 31 Aug 2026 (Judge Colleen McMahon): dismissed claims against Solana Labs, Solana Foundation and executives; dismissed Securities Act unregistered-securities claims (FRED and GRIFFAIN memecoins did not involve a "common enterprise" under Howey); dismissed unjust enrichment and plaintiff Aguilar's RICO claims; RICO claims by plaintiffs Carnahan and Okafor against Baton Corporation and executives Tweedale, Cohen and Kerler survive — alleged predicate acts: wire fraud, illegal gambling, unlicensed money transmission; order criticised 25 unnamed KOLs for "concealing both their compensation and their own preexisting positions in the tokens they promoted" — [Protos](https://protos.com/solana-labs-dropped-from-burwick-laws-pump-fun-lawsuit/); [KuCoin](https://www.kucoin.com/news/flash/judge-dismisses-claims-against-solana-labs-in-pump-fun-lawsuit); [Blofin explainer](https://blofin.com/academy/education/pumpfun/pump-fun-lawsuits-explained). Note: all are secondary reports of the order; the docket itself was not read.
- The complaint claims >98% of >11M tokens collapsed within 24 hours (allegation, not finding) — [MEXC aggregation](https://www.mexc.com/news/62159)
- Burwick/Wolf Popper sent cease-and-desist letters over tokens impersonating the firms — [The Block](https://www.theblock.co/post/339191/law-firms-pump-fun-cease-desist-ip)

**CLARITY Act (H.R. 3633) and federal market structure**
- House passed Jul 2025; Senate Banking Committee reported it 15–9 on 14 May 2026 — [Eco](https://eco.com/support/en/articles/16060426-clarity-act-timeline-house-passage-senate-progress-and-what-s-next); [Tally](https://newsletter.tally.xyz/p/the-clarity-act-explained)
- Senate cloture on the motion to proceed failed 49–50 on 15 Sep 2026 (needed 60); 49 Republicans yes; Collins, Hawley, Moran, Tillis no (Tillis to preserve reconsideration); all voting Democrats no; disputes were ethics provisions (officials' crypto involvement), DeFi developer liability (Section 604) and stablecoin yield — [FinTech Weekly](https://www.fintechweekly.com/news/clarity-act-cloture-vote-fails-49-50-september-2026); [AMINA Bank](https://aminagroup.com/research/clarity-act-september-2026-why-the-senate-vote-failed-what-regulates-us-crypto-now/); [Fireblocks](https://www.fireblocks.com/blog/clarity-act-vote-fails-institutional-impact)
- Troutman Pepper Locke: the result "effectively" ends prospects for this Congress and agencies are moving forward without congressional action — [Troutman](https://www.troutman.com/insights/in-the-wake-of-clarity-acts-failure-agencies-move-forward-without-congressional-action-or-certainty/); others call it "almost dead" with a lame-duck reconsideration possible — [Finextra](https://www.finextra.com/blogposting/33035/is-the-us-clarity-act-dead-no)
- No source found linking CLARITY text to memecoin-specific treatment.

**EU / MiCA**
- ESMA confirmed (17 Apr 2026) the MiCA transitional period ends 1 Jul 2026 for all member states; entities serving EU clients without CASP authorisation after that date are in breach — [Coinpaprika](https://coinpaprika.com/ar/news/mica-transitional-period-ends-1-july-2026/); [InnReg guide](https://www.innreg.com/blog/mica-regulation-guide)
- ESMA final guidelines on market abuse, suitability and reverse solicitation published Mar 2026 — [Salvus Funds](https://salvusfunds.com/2026/08/27/roadmap-to-markets-in-crypto-assets-mica-regulation-in-2026-2/)
- Title II offer rules: offeror must be an EU legal person, draft and notify a white paper (no regulator approval needed), publish it; exemptions include offers to fewer than 150 persons and small offers; authorities may suspend/ban offers; white paper must be kept updated (Art. 12) — [ACPR presentation](https://acpr.banque-france.fr/sites/default/files/forum-fintech_2023_atelier_b_se_preparer_mica.pdf); [AMF notice (Mar 2025)](https://www.amf-france.org/sites/institutionnel/files/pdf/74923/en/Public_offerings_and_admission_to_trading_of_crypto-assets_procedures_for_notifying_the_AMF_from_the_entry_into_application_of_the_MICA_regulation.pdf?1765259284); [MiCA Art. 12](https://www.springlex.eu/fr/packages/mica/mica-regulation/article-12/)
- European Commission answer (18 Feb 2026, via ESMA Q&A): crypto-assets without an identifiable issuer fall outside Title II, so no white paper is required and the platform-side white-paper duty in Art. 5(2) has nothing to attach to; but platforms "are not relieved from obtaining authorisation and complying with their general obligations, including a suitability assessment of any admitted crypto-assets and determination of whether an identifiable issuer exists" — [ESMA Q&A 2552](https://www.esma.europa.eu/publications-data/questions-answers/2552); [ESMA PDF](https://www.esma.europa.eu/print/pdf/node/219621)
- Commentary: Recital 22 excludes issuerless tokens from Titles II–IV but MiCA never defines when an issuer is "unidentifiable"; memecoins are the main case; pseudonymous issuers who can be linked to persons may not qualify — [Conventus Law](https://conventuslaw.com/report/crypto-assets-without-an-identifiable-issuer-regulatory-reality-two-years-post-micar-application-date/); [Axis Advisory](https://axisadvisoryxyz.substack.com/p/mica-unidentifiable-issuers-of-crypto); [Bird & Bird](https://www.twobirds.com/en/insights/2023/global/markets-in-crypto-assets-regulation-what-happens-when-issuers-are-unknown)
- Art. 4(3): an offer is not "free" if the offeror receives "fees, commissions, or monetary or non-monetary benefits" — relevant to airdrops and to launchpad fee models — [Guest post on airdrops](https://davidlopezkurtz.substack.com/p/guest-post-are-airdrops-actually)

**Enforcement and jurisdiction / KYC practice**
- UK FCA warning (3 Dec 2024) that pump.fun "may be providing or promoting financial services or products without our permission"; pump.fun geoblocked UK users shortly after — [Cointelegraph](https://cointelegraph.com/news/fca-issues-warning-bans-pump-fun-uk); [The Defiant](https://thedefiant.io/news/regulation/united-kingdom-bans-pump-fun); [Blockworks](https://blockworks.co/news/pumpdotfun-restricts-uk-access)
- pump.fun terms exclude UK/US/EU/UN-sanctioned jurisdictions (Cuba, Iran, North Korea, Syria, Russia); a review site reports no KYC for trading, checks only on fiat deposits (secondary, unverified) — [Datawallet](https://www.datawallet.com/de/krypto/pump-fun-restricted-countries)
- Solana Foundation removed validators from its delegation program for sandwich attacks (a non-regulatory but ecosystem-level enforcement precedent) — [Bitcoinist](https://bitcoinist.com/solana-vs-ethereum-feud-validator-ouster/amp/)

### Inferences
- Practical US posture for a small team: the securities-registration risk for plain memecoins is low after the SEC staff statement and the Aug 2026 McMahon ruling, but (i) the ruling is one district court and limited to coins without shared-profit promises, (ii) the surviving theories (wire fraud, illegal gambling, unlicensed money transmission) target *operator conduct* — fee structures that resemble gambling, undisclosed insider positions, and custody of user funds. A non-custodial hook design with no operator-held withdraw authority and transparent fees directly addresses the money-transmission and gambling theories; the KOL-compensation finding argues for mandatory disclosure of creator/promoter allocations.
- The CLARITY failure means no safe harbour or federal preemption in 2026; state money-transmitter and consumer-protection laws remain the operative US risk. Treat the law as unsettled.
- EU: a launchpad front-end that takes fees and serves EU users is likely a CASP (operating a trading platform / exchange services) post 1 Jul 2026, regardless of whether individual tokens need white papers. Tokens created through the launchpad by identifiable creators who receive fee streams are weak candidates for the "no identifiable issuer" carve-out. Options: geoblock the EU/UK (pump.fun precedent), or limit to a permissionless contract + third-party interfaces.
- No launchpad found requires KYC for on-chain trading; geofencing is the de facto standard.

### Gaps
- GENIUS Act (stablecoin law): not searched directly in this pass; relevance to memecoin launchpads is limited to stablecoin-paired pools and should be confirmed from the statute text.
- The McMahon order's full reasoning on "common enterprise" and the status of any appeal or the KOL show-cause (due 10 Sep 2026) were not located; check PACER/CourtListener.
- No AMF/BaFin memecoin-specific position found; the ESMA Q&A is the only authoritative EU item.
- No SEC/CFTC/DOJ enforcement action *against a launchpad operator* was found for 2025–2026; absence of evidence here, not evidence of absence.

---

## KQ5. Ethereum mainnet feasibility: gas, MEV, private RPCs, mainnet launchpad volume, aggregator routing of hook pools

### Takeaway
Mainnet gas in Oct 2026 is extraordinarily cheap (Etherscan snapshot 19 Oct 2026: 0.159 gwei, ETH $2,401, swap ≈ $0.14), which makes a ~250k-gas hook swap cost roughly $0.10 and a full token launch under $1 at today's prices — but a 15 gwei day makes those $9 and ~$70, and a 50+ gwei spike makes memecoin-scale trading uneconomic. Mainnet's public mempool makes sandwiching "endemic and profitable" whereas rollups with private mempools (Base) see almost none, so a mainnet launchpad must default users to Flashbots Protect/MEV Blocker and/or price MEV into the hook fee. v4 has >50% of Uniswap mainnet volume and hooks reached double-digit shares in 2026, and aggregators (1inch, CoW, ParaSwap, Matcha) index hook pools their solvers can simulate — but there is no evidence yet of a successful *mainnet* memecoin launchpad; the volume went to Base, Solana and new chains (Robinhood Chain's pools.trade).

### Cited Findings

**Gas and block times**
- Etherscan gas tracker snapshot 19 Oct 2026 16:19 UTC: low/avg/high 0.159/0.159/0.16 gwei; ETH $2,401.63; featured "Swap" cost $0.136; NFT sale $0.23; bridging $0.044 — [Etherscan](https://etherscan.io/gastracker)
- An earlier (undated) Etherscan snapshot in search results showed ~15.3 gwei, ETH ~$3,370, swap ≈ $18.37 — illustrating the range — [Etherscan via search](https://goto.etherscan.com/gastracker)
- v4 pool creation is "up to 99.99% cheaper" than prior versions; multi-hop and native-ETH savings claimed without figures — [Uniswap blog](https://blog.uniswap.org/uniswap-v4-is-here)
- Hook overhead estimate: 5k–80k extra gas per callback; a swap through a complex hook ≈ 250k gas vs ≈ 95k on a no-hook pool; range 95k–280k; a searcher heuristic treats simulated `beforeSwap` usage above 200k gas as hostile and excludes the pool (vendor blog, unverified) — [FRB Research on dev.to](https://dev.to/frb_research/uniswap-v4-hooks-mev-2026-searcher-opportunities-and-risks-1kkk)
- On Robinhood Chain (not mainnet), hooks add "about a third" to swap gas — [Bitquery](https://bitquery.io/investigations/uniswap-v4-hooks-robinhood-chain)
- EIP-7782 proposes 6-second slots (from 12s) targeted at Glamsterdam; as of the latest sources it was not confirmed as scheduled — [Ethereum Magicians](https://ethereum-magicians.org/t/eip-7782-the-case-for-2x-shorter-slot-times-in-glamsterdam/24616); [Cointelegraph](https://cointelegraph.com/news/ethereum-dev-proposes-halving-slot-times-6-secs-doubling-blocks)

**MEV / sandwich exposure**
- Ethereum L1 (EigenPhi data, ~95,000 sandwiches, Nov 2024–Oct 2025): ~$60M annual trader losses; block builders capture most value via fees; attacker margin ~5%; extraction fell sharply in 2025, possibly due to more MEV-protection use — [Cointelegraph Research](https://cointelegraph.com/research/exclusive-data-from-eigenphi-reveals-that-sandwich-attacks-on-ethereum-have-waned)
- 2026 arXiv study: "Sandwiching, while endemic and profitable on Ethereum L1, is rare, unprofitable, and largely absent in rollups with private mempools"; absence arises from private mempools and medium-value swaps "rather than from inherent structural protections"; L2 sandwiching is probabilistic not atomic — [arXiv 2601.19570](https://arxiv.org/html/2601.19570v1)
- Solana: bots extracted $370–500M over 16 months to mid-2025; one bot did 1.55M sandwiches for 65,880 SOL (~$13.4M) in 30 days — [Solana Compass (Accelerate 2025)](https://satanisms.solanacompass.com/learn/accelerate-25/scale-or-die-at-accelerate-2025-the-state-of-solana-mev); [Helius](https://helius.dev/blog/solana-mev-report)
- Flashbots Protect had served 2.1M unique accounts and shielded $43B in DEX volume as of Oct 2024; MEV Blocker auctions backrun rights and rebates users; private pools carry execution risk and historically limited adoption — [DEXTools MEV guide](https://www.dextools.io/tutorials/what-is-mev-in-crypto-guide-2026); [arXiv 2206.04185](https://arxiv.org/pdf/2206.04185)
- Hook-specific MEV: dynamic-fee pools are exposed to front-running before fee hikes and back-running after fee drops; generic bots assuming static tiers misprice hook pools by 10–50 bps; hooks can internalise JIT liquidity (vendor claims) — [FRB Research](https://dev.to/frb_research/uniswap-v4-hooks-mev-2026-searcher-opportunities-and-risks-1kkk)

**Mainnet v4 and hook adoption; where launchpad volume went**
- On Ethereum, v4 accounted for more than half of Uniswap volume in recent months; hooks grew from single-digit to double-digit percentages of v4 volume in weeks during summer/early fall 2026 — [KuCoin](https://www.kucoin.com/blog/en-uniswap-v4-captures-arc-and-robinhood-chain-volume-as-hooks-drive-liquidity)
- Cumulative v4 volume ~$355B, ~$190B on Ethereum mainnet (DefiLlama via Datawallet); v4 on >15 networks by mid-2026 — [Datawallet](https://www.datawallet.com/it/crittografia/uniswap-v4-explained); [Datawallet DE](https://www.datawallet.com/de/krypto/uniswap-v4-explained)
- pools.trade (Robinhood Chain launchpad, v4-hook compatible) did ~$73.6M v4 volume on day one vs ~$47.2M on Ethereum mainnet the same day — [KuCoin](https://www.kucoin.com/blog/robinhood-chain-uniswap-v4-pools-trade-launch)
- Base overtook Solana in daily tokens created as pump.fun shrank (2025) — [Decrypt](https://decrypt.co/332573/base-overtakes-solana-in-daily-tokens-created-as-pump-fun-continues-to-shrink); [CoinEx "launchpad wars"](https://www.coinex.com/en/insight/report/2025-launchpad-wars-base-vs-solana-68a29bdc9609f21454c0e673)
- No source found describing a memecoin launchpad on Ethereum mainnet with meaningful 2025–2026 volume.

**Aggregator routing of hook pools and protocol-fee changes**
- 1inch, CoW Swap, ParaSwap and Matcha index v4 pools "including hook-enabled ones their solvers can simulate safely" — [Datawallet FR](https://www.datawallet.com/fr/crypto/uniswap-v4-explained)
- 1inch ~59% of Ethereum aggregator volume mid-2025; CoW positioned on batch auctions/MEV protection — [Spark](https://www.spark.money/tools/dex-aggregator-comparison)
- Dynamic fees: hook's fee logic runs before each swap — [Metalamp](https://metalamp.io/magazine/article/uniswap-v4-explained-hooks-singleton-architecture-dynamic-fees-erc-6909); [Uniswap v4 llms.txt](https://developers.uniswap.org/docs/uniswap-ai/v4-llms.txt)
- Uniswap Labs' Jul 2026 proposal to activate v4 protocol fees via a V4 Fee Controller covering static-fee pools, Continuous Clearing Auction pools and aggregator-hook pools; aggregator hooks multiply assigned fees by 25 to allow a 250 bps cap (PoolManager hard cap 10 bps); 10 bp default / 3 bp stable on most chains, 3 bp / 1 bp on Base; Snapshot 7–12 Jul 2026, on-chain the week of 13 Jul; outcome not found — [Uniswap gov forum](https://gov.uniswap.org/t/temp-check-activate-v4-protocol-fees/26162); [Agora proposal 100](https://vote.uniswapfoundation.org/proposals/100); [The Defiant](https://thedefiant.io/news/defi/uniswap-floats-turning-on-protocol-fees-for-v4-pools); UNIfication background — [The Block](https://www.theblock.co/post/383121/hayden-adams-unification-proposal-final-governance-vote)

### Inferences
- Cost arithmetic (my calculation from cited inputs; gas-per-op figures are vendor estimates): a 250k-gas hook swap = 0.00004 ETH ≈ $0.10 at 0.16 gwei/$2,400 ETH; ≈ $9 at 15 gwei; ≈ $30 at 50 gwei. A launch bundle of ~2M gas (ERC-20 deploy + pool init + initial liquidity) ≈ $0.77 at 0.16 gwei, ≈ $72 at 15 gwei, ≈ $240 at 50 gwei. At today's prices mainnet is viable for sub-$50 memecoin trades; the design must assume gas can rise 100x within days, so the UI should show live fee-in-USD and the hook should not have per-swap logic that balloons gas (keep `beforeSwap` well under 200k to avoid being excluded by searcher/aggregator heuristics).
- Mainnet's 12s blocks (6s only if EIP-7782 lands) mean launch sniping is a block-0 bundle game won by builders/searchers; the practical answer is Meteora-style decaying launch fees and size limits inside the hook plus defaulting the frontend to a private RPC (Flashbots Protect / MEV Blocker, which also returns backrun rebates).
- Aggregator inclusion is conditional on the hook being simulable, cheap and not using exotic return-delta behaviour. A fee-only hook with bounded dynamic fees is the most routable design; publishing the fee function and ceiling helps solvers price it correctly (the 10–50 bps mispricing issue). The pending v4 protocol-fee change could add 10 bps (or up to 250 bps for "aggregator hooks") on top of LP fees — monitor the governance outcome.
- Volume reality: nothing found shows a mainnet launchpad succeeding; the thesis for mainnet must be a different trader (larger tickets, aggregator/CEX-adjacent flow, trust premium) rather than competing with Base/Solana on $5 trades.

### Gaps
- No primary, dated benchmark of per-swap gas for a specific mainnet v4 hook pool; the 95k vs 250k figures are from a vendor blog. Recommended: measure with Foundry against a forked mainnet.
- No 2025–2026 adoption figures for Flashbots Protect or MEV Blocker share of mainnet DEX flow.
- No Base-specific sandwich dataset from a primary source; the arXiv study's rollup findings are the best available.
- Outcome of the Uniswap v4 protocol-fee on-chain vote (Jul 2026) not found.
- Whether 0x/Matcha route v4 hook pools with dynamic fees specifically was not confirmed; 1inch/CoW/ParaSwap/Matcha inclusion comes from one secondary explainer.

---

## KQ6. Disclosure and UX patterns that build trust without legal exposure

### Takeaway
The patterns that survived 2025–2026 scrutiny are those that are checkable on-chain and worded precisely: "LP position held by locker contract 0x… with no withdraw function" rather than "liquidity locked"; fee splits and recipient addresses visible at creation (Clanker's up to 7 recipients and admin pairing); anti-sniper fee schedules published with parameters; and prominent, non-investment-advice-framed risk labels (Uniswap/Blockaid style). The pump.fun order's criticism of KOLs concealing compensation and pre-existing positions, and the SEC's "fraud is still fraud" caveat, make creator/promoter allocation disclosure the single highest-value disclosure.

### Cited Findings
- Clanker v3 sent LP NFTs to a locker "which lacks a method to withdraw it and cannot be upgraded" — a claim a reader can verify on-chain — [Paragraph (matthewb)](https://paragraph.xyz/@matthewb/clanker-pt1)
- Clanker v4: fee locker; up to 7 reward recipients set at creation, each with a paired admin address; recipients can receive the launched token, the paired token, or both; Bankr interface fee default 20% (2000 bps) per a third-party skill listing — [Paragraph (Clanker v4)](https://paragraph.xyz/@dish/introducing-clanker-v4); [Bankless](https://www.bankless.com/fr/read/clanker-v4-token-creator.md); [skill listing](https://skillselion.com/skills/bankrbot/openclaw-skills/clanker)
- Meteora publishes anti-sniper fee parameters (start fee, end fee, duration, curve shape) in docs — [Meteora Fee Scheduler](https://docs.meteora.ag/meteoras-anti-sniper-suite-a.s.s./meteoras-anti-sniper-suite/fee-scheduler)
- Uniswap's token warnings are explicitly "not investment advice or recommendations on a particular token" — [Uniswap support](https://support.uniswap.org/hc/en-us/articles/8723118437133)
- GoPlus will only show LP as locked if the locker is on its list; otherwise LP appears as held by an unknown contract — [GoPlus docs](https://docs.gopluslabs.io/reference/response-details)
- The McMahon order faulted KOLs for "concealing both their compensation and their own preexisting positions in the tokens they promoted" — [Protos](https://protos.com/solana-labs-dropped-from-burwick-laws-pump-fun-lawsuit/)
- SEC staff: fraud in memecoin sales remains actionable even if the coin is not a security; labels used to evade securities law are disregarded — [SEC.gov](https://www.sec.gov/newsroom/speeches-statements/staff-statement-meme-coins)
- MiCA Art. 12: white papers must be updated for material changes for as long as the asset is offered/admitted — relevant if a project ever opts into a white paper — [MiCA Art. 12](https://www.springlex.eu/fr/packages/mica/mica-regulation/article-12/)
- Post-incident transparency precedent: pump.fun's halt/upgrade/make-whole/zero-fee response — [Benzinga](https://benzinga.com/markets/cryptocurrency/24/05/38897152/solana-meme-coin-platform-pump-fun-exploited-for-1-9m-vows-to-repay-users); Cork's dated public post-mortem naming the upstream dependency — [Cork](https://www.cork.tech/blog/post-mortem)

### Inferences
- Wording: avoid "liquidity burned/locked forever" unless the LP is literally at a burn address or an immutable locker with no withdraw path; say what is true and link the contract. "Permanent" is defensible only when the locker is non-upgradeable and the hook cannot remove liquidity; otherwise say "locked until <date> in <contract>" and let scanners (GoPlus `locked_detail`) corroborate.
- Fee display: show the live effective swap fee (LP fee + hook dynamic fee + any protocol fee, in bps and USD) in the trade panel, with the fee schedule chart for launches; expose a `getCurrentFee()` view so wallets/aggregators and auditors can read it.
- Creator payouts: show the fee split and recipient addresses on the token page at creation and in perpetuity; flag any creator pre-mine/allocation and vesting; log claims on-chain. This is the direct response to the KOL and insider-trading fact patterns.
- Legal framing: follow Uniswap's "not investment advice" disclaimer pattern, avoid "safe"/"rug-proof" language (use "what this contract can and cannot do"), avoid gamified/lottery mechanics given the surviving "illegal gambling" RICO theory, and publish terms with geofencing where regulators have warned (UK) or where the operator would be a CASP (EU post-Jul 2026).
- Incident playbook disclosed in advance (pause scope — ideally none for user exits per Trail of Bits — public post-mortem within days, make-whole policy) is itself a trust signal.

### Gaps
- No study found that measures whether specific disclosure wording changes trader behaviour or legal outcomes; the above is inference from incidents and regulator language.
- No example found of a launchpad publishing a formal, lawyer-reviewed disclosure template; the closest artefacts are Clanker's contract-level transparency and Meteora's parameter docs.
