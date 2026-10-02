#!/usr/bin/env python3
"""Build the Inkypump docs (Mintlify layout, as on docs.o1.exchange) from o1's
rendered page shell plus our own content. Run from site2/docs: python3 build_docs.py"""
import html as H
import re
from bs4 import BeautifulSoup, NavigableString

REF = '../../ref/o1-docs-launchpad.html'
OUT = '.'
SITE = 'Inkypump'

# ---------------------------------------------------------------- icons
I = {
    'search': '<svg aria-hidden="true" class="size-4 shrink-0" fill="none" height="16" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="16"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
    'arrow': '<svg aria-hidden="true" class="size-3.5 shrink-0 text-white" fill="none" height="24" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" viewBox="0 0 24 24" width="24"><path d="m9 18 6-6-6-6"/></svg>',
    'menu': '<svg aria-hidden="true" class="size-4" fill="none" height="24" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="24"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
    'chev': '<svg aria-hidden="true" class="size-3 shrink-0 text-gray-400" fill="none" height="24" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" viewBox="0 0 24 24" width="24"><path d="m9 18 6-6-6-6"/></svg>',
    'toc': '<svg aria-hidden="true" class="size-3.5" fill="none" height="24" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" viewBox="0 0 24 24" width="24"><path d="M4 6h16M4 12h10M4 18h7"/></svg>',
    'copy': '<svg aria-hidden="true" class="size-4 shrink-0" fill="none" height="18" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" viewBox="0 0 18 18" width="18"><path d="M14.25 5.25H7.25C6.14543 5.25 5.25 6.14543 5.25 7.25V14.25C5.25 15.3546 6.14543 16.25 7.25 16.25H14.25C15.3546 16.25 16.25 15.3546 16.25 14.25V7.25C16.25 6.14543 15.3546 5.25 14.25 5.25Z"/><path d="M2.80103 11.998L1.77203 5.07397C1.61003 3.98097 2.36403 2.96397 3.45603 2.80197L10.38 1.77297C11.311 1.63497 12.19 2.16097 12.531 2.99997"/></svg>',
    'hash': '<svg aria-hidden="true" class="size-3" fill="none" height="24" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="24"><path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/></svg>',
    'note': '<svg aria-hidden="true" class="size-4" fill="none" height="24" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
    'warn': '<svg aria-hidden="true" class="size-4" fill="none" height="24" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="24"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/></svg>',
    'x': '<svg aria-hidden="true" class="size-5 fill-gray-400 hover:fill-gray-500 dark:fill-gray-500 dark:hover:fill-gray-400" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
    'prev': '<svg aria-hidden="true" class="size-3.5 shrink-0" fill="none" height="24" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" viewBox="0 0 24 24" width="24"><path d="m15 18-6-6 6-6"/></svg>',
    'next': '<svg aria-hidden="true" class="size-3.5 shrink-0" fill="none" height="24" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" viewBox="0 0 24 24" width="24"><path d="m9 18 6-6-6-6"/></svg>',
    'close': '<svg aria-hidden="true" class="size-4" fill="none" height="24" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="24"><path d="M18 6 6 18M6 6l12 12"/></svg>',
}
# card icons (lucide, 24 box)
CI = {
    'coins': '<path d="M8 8a6 6 0 1 0 12 0 6 6 0 0 0-12 0"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18M7 6h1v4"/><path d="m16.71 13.88.7.71-2.82 2.82"/>',
    'lock': '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    'chart': '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="m19 9-5 5-4-4-3 3"/>',
    'gift': '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/>',
    'trophy': '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
    'rocket': '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
    'shield': '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
    'code': '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
    'book': '<path d="M12 7v14M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
    'layers': '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65M22 12.65l-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
    'zap': '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
    'wallet': '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
    'globe': '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20"/>',
    'users': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    'scale': '<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1M2 16l3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1M7 21h10M12 3v18M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>',
}
def cicon(n):
    return f'<svg aria-hidden="true" fill="none" height="24" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" viewBox="0 0 24 24" width="24">{CI[n]}</svg>'

# ---------------------------------------------------------------- addresses
A = {
    'pm': '0x360e68faccca8ca495c1b759fd9eee466db9fb32', 'weth': '0x4200000000000000000000000000000000000006',
    'r02': '0x177778F19E89dD1012BdBe603F144088A95C4B53', 'usdg': '0xe343167631d89B6Ffc58B88d6b7fB0228795491D',
}
STOCKS = [('wNVDAx', 'Nvidia', '0xa8ddb5Cd96b5222AFe198316E9A57CAA642850D5', '0.05%'), ('wSPYx', 'S&amp;P 500', '0xE7E553Cd128F0011777323A0b44a7b96EA1CB540', '0.3%'),
          ('wQQQx', 'Nasdaq 100', '0x4C1AE29c159838fC1b224636E28E086EB69101f7', '0.3%'), ('wTSLAx', 'Tesla', '0xc3FdBe3A68EE5dE461D30415a8165cf9Aefe1171', '0.05%'),
          ('wAAPLx', 'Apple', '0x943BF64D566c32A2Bcd41AC92FB63C111cC9De8f', '0.05%'), ('wMSTRx', 'Strategy', '0x30987adF0B11dc698438a99BA04ec3a1AB2c7EaB', '0.05%'),
          ('wSPCXx', 'SpaceX', '0x8e2eed8b8b5e13ea7bf38e50d7821d2c57309072', '0.05%'), ('wPLTRx', 'Palantir', '0x4A2df09536F62341C9f946427D16414C04e21342', '0.05%'),
          ('wNFLXx', 'Netflix', '0x7d87fD6A379714194a797c0bBB8B40c30D250856', '0.05%')]
def ex(addr, label=None):
    short = addr[:6] + '…' + addr[-4:]
    return f'<a class="link" href="https://explorer.inkonchain.com/address/{addr}" target="_blank" rel="noopener"><code>{label or short}</code></a>'

# ---------------------------------------------------------------- content DSL
def p(t): return ('p', t)
def h2(t): return ('h2', t)
def h3(t): return ('h3', t)
def ul(*items): return ('ul', items)
def table(head, rows): return ('table', head, rows)
def steps(*s): return ('steps', s)
def cards(cols, *c): return ('cards', cols, c)
def note(t): return ('callout', 'note', t)
def warn(t): return ('callout', 'warning', t)
def code(t, lang=''): return ('code', t, lang)

# ---------------------------------------------------------------- pages
L = 'launchpad'; D = 'developers'
PAGES = [
 # ---------------- Launchpad tab
 dict(tab=L, group='Overview', slug='introduction', title='Introduction', desc='Launch a fixed-supply memecoin on Ink with liquidity locked forever and a 2% fee that pays the creator, the holders and the platform on every trade.', body=[
  warn('<strong>Coming soon.</strong> The Inkypump contracts are not deployed yet. Launching, trading and claiming open the day they go live on Ink; until then the app shows empty states and the launch form does not send a transaction.'),
  p('Inkypump turns a token idea into a live Uniswap V4 market on Ink in one transaction. You choose the name, the asset it is paired with (ETH or a tokenized stock), and whether holders share the trading fees. The factory does the rest and keeps the liquidity forever.'),
  note('Every number below is a fixed rule of the contracts. Nothing here can change after a coin launches.'),
  cards(2,
   ('coins', '1 billion fixed supply', 'Every coin is created with exactly 1,000,000,000 tokens, 18 decimals, no mint function.'),
   ('lock', 'Liquidity locked forever', 'The whole supply seeds a single-sided Uniswap V4 position owned by the factory, which has no function to withdraw it.'),
   ('chart', '2% fee on every trade', 'Taken in the paired asset by the pool hook, wherever the trade happens: this site, Uniswap, aggregators or bots.'),
   ('gift', 'Rewards in stocks', 'With holder rewards on, 0.5% of every trade goes to holders, claimable as a basket of wrapped xStocks, as the paired asset, or as ETH.')),
  h2('What makes it different'),
  p('Most launchpads pay nothing to the people holding the coin. Inkypump moves a share of every trade to holders and lets the creator decide, at launch, whether that share exists and which stocks it is paid in. A second share goes to the creator forever, and a slice of the platform share funds a 3-day trader leaderboard.'),
  table(['Who', 'Share of every trade', 'Paid in'], [
   ['Creator', '0.70% (1.20% when holder rewards are off)', 'the paired asset, claimable any time'],
   ['Holders', '0.50% (0 when off)', 'the basket stocks, the paired asset, or ETH'],
   ['Platform', '0.80%', 'the paired asset; one eighth funds the leaderboard']]),
  h2('Where to go next'),
  cards(2,
   ('rocket', 'How it works', 'The launch transaction, the pool, the hook and the fee flow, step by step. <a class="link" href="how-it-works.html">Read</a>'),
   ('wallet', 'Plan your launch', 'Pick a paired asset, decide on holder rewards and a basket, size your first buy. <a class="link" href="launch-planning.html">Read</a>'),
   ('trophy', 'Leaderboard', 'How the 3-day prize pool is funded, ranked and paid. <a class="link" href="leaderboard.html">Read</a>'),
   ('code', 'Developers', 'Contracts, routes, events and limits for integrators. <a class="link" href="direct-integration.html">Read</a>')),
 ]),
 dict(tab=L, group='Overview', slug='how-it-works', title='How it works', desc='From the launch transaction to the first claim: what the factory, the pool hook and the coin contract do.', body=[
  h2('The launch transaction'),
  steps(
   ('Deploy the coin', 'The factory asks the token deployer for a new coin with a CREATE2 salt: 1 billion supply minted to the factory, no owner, fee split fixed in the constructor.'),
   ('Create the pool', 'A Uniswap V4 pool is initialised for coin / paired asset with the Inkypump hook attached, a 0 LP fee and a 60 tick spacing.'),
   ('Seed the liquidity', 'The entire supply goes into a single-sided range starting at a $3,000 market cap, priced from the paired asset\'s USD price in the factory. The factory holds the position and has no function to remove it.'),
   ('Register with the hook', 'The hook stores the pool, its paired asset and the fixed 2% fee. Nothing can change the fee afterwards.'),
   ('Optional first buy', 'Any ETH sent with the launch is swapped into the paired asset along the supplied route and then into the fresh pool. The coins go to the creator and the buy is public on the token page.')),
  h2('Every trade after that'),
  p('The hook runs on every swap in the pool. It takes 2% of the paired-asset side, sends it to the coin contract and calls the coin\'s permissionless <code>sync()</code>, which credits creator, holders and platform by the fixed split. It also reports the trade to the ledger, attributed to the wallet that signed the transaction, so trades through Uniswap, aggregators and bots count the same as trades on this site.'),
  note('For the first 20 seconds after launch the fee starts at 99% and decays linearly to 2%. Snipers pay the coin, not the other way round. The creator\'s own first buy pays the base fee.'),
  h2('Claiming'),
  p('Holders accrue rewards per token held from the moment of each trade. A claim settles the holder, then pays in the paired asset, or routes through the launchpad router to deliver ETH or equal shares of the basket stocks, each bought at claim time with the holder\'s own minimum.'),
  p('The creator\'s share and the platform\'s share sit in the coin until anyone pushes them to their fixed recipients. There is no lockup and no approval step.'),
 ]),
 dict(tab=L, group='Overview', slug='launch-planning', title='Plan your launch', desc='The three decisions that cannot be changed after launch, and how to make them.', body=[
  h2('Paired asset'),
  p('Your coin is priced in the asset you pair it with, and every fee is collected in it. Pair with ETH for the deepest routes and the simplest story, or with a wrapped xStock when the stock is the meme: a Tesla coin that trades against TSLAx moves in Tesla terms.'),
  table(['Pair', 'Price moves with', 'Fees and rewards paid in', 'Traders need'], [
   ['ETH', 'ETH', 'WETH', 'ETH only'],
   ['wNVDAx, wSPYx, wTSLAx, …', 'the stock', 'that stock', 'ETH only; the router walks the stock route']]),
  h2('Holder rewards'),
  p('On: 0.7% to you, 0.5% to holders, 0.8% to the platform. Off: 1.2% to you, 0 to holders, 0.8% to the platform. Holder rewards are a reason to hold rather than flip, and the basket is part of the coin\'s identity. Turning them off is right for a coin whose creator wants the full share, for example a community takeover where the creator is a multisig.'),
  h2('Basket'),
  p('With rewards on you may pick up to four wrapped xStocks. Holders claim their rewards as equal shares of them. No basket means rewards are paid in the paired asset, which only makes sense when that is itself a stock.'),
  warn('Name, symbol, supply, paired asset, the rewards switch and the basket are immutable. Logo, description and links can be edited later.'),
  h2('First buy'),
  p('Up to 0.5 ETH in the launch transaction, at the floor price, before anyone else can buy. It is the only buy allowed in the launch block and it is shown on the token page, so size it like a public statement.'),
 ]),
 dict(tab=L, group='Create', slug='token-creation', title='Token creation', desc='What you fill in on the launch form and what each field becomes on-chain.', body=[
  table(['Field', 'On-chain', 'Rules'], [
   ['Name, symbol', 'ERC-20 name and symbol', 'Required. Symbol 2 to 10 characters, A to Z and 0 to 9.'],
   ['Logo, description, links', 'metadataURI (JSON)', 'Editable after launch.'],
   ['Paired asset', '<code>pair</code>', 'WETH or an approved wrapped xStock.'],
   ['Holder rewards', '<code>holderRewards</code>', 'Fixed forever. Off means no basket.'],
   ['Basket', '<code>basket[]</code>', 'Up to 4 approved stocks, no repeats, not WETH.'],
   ['Dev buy', 'ETH sent with the call', 'Up to 0.5 ETH; <code>minPairOut</code> protects a stock-paired first buy from sandwiching.']]),
  h2('Cost'),
  p('There is no creation fee. You pay gas for one transaction, which on Ink is a fraction of a cent, plus the ETH of your optional first buy.'),
  h2('Launch protection'),
  ul('In the launch block only the creator may receive coins from the pool.',
     'For the next 3 blocks every wallet is capped at 3% of supply bought and 3% held.',
     'For 20 seconds the fee decays from 99% to 2%.'),
 ]),
 dict(tab=L, group='Create', slug='stock-paired-launches', title='Stock-paired launches', desc='Pairing a coin with a wrapped xStock instead of ETH.', body=[
  p('A stock-paired coin uses the stock as its quote asset. The pool is coin / stock, the price is in stock units, and the 2% fee is collected in the stock. Everything else, including liquidity lock, the fee split and the leaderboard, is identical.'),
  h2('Supported stocks'),
  p('Wrapped Backed xStocks with a funded USDG pool on Uniswap V3 on Ink. More are added as pools appear.'),
  table(['Stock', 'Underlying', 'Contract', 'USDG pool'], [[s, n, ex(a), f] for s, n, a, f in STOCKS]),
  h2('How traders pay in ETH'),
  p('The launchpad router accepts a route: a Uniswap V3 path from WETH to the stock and an optional V4 pool key. Buying walks it forward (ETH to USDG to stock to coin); selling walks it backwards. Wallets that already hold the stock can trade the pool directly with <code>buyWithPair</code> and <code>sellForPair</code>.'),
  code('route = abi.encode(bytes v3Path, PoolKey v4Key)\nv3Path = WETH (1%) USDG (0.05%) wNVDAx   // for a wNVDAx pair\nrouter.buy{value: 0.1 ether}(coin, route, minCoinOut);'),
  h2('Rewards on a stock pair'),
  p('Holders of a stock-paired coin are paid in that stock by default. A basket is optional: with one, the stock is first sold for WETH along the route backwards and the basket is bought from there. Claim as ETH works the same way for any pair.'),
 ]),
 dict(tab=L, group='Create', slug='holder-rewards', title='Holder rewards and baskets', desc='The switch, the accounting, and what a claim does.', body=[
  h2('The switch'),
  table(['', 'Creator', 'Holders', 'Platform'], [['Rewards on', '0.70%', '0.50%', '0.80%'], ['Rewards off', '1.20%', '0', '0.80%']]),
  p('The coin stores the split as <code>creatorBps</code> and <code>holderBps</code>, both immutable. When holder rewards are off the holder share is simply added to the creator share; the platform share never changes.'),
  h2('Accounting'),
  p('Rewards use a per-share accumulator. Each fee increases <code>accRewardPerShare</code> by fee divided by the eligible supply; each holder\'s debt is reset on every transfer so they earn exactly for the balance they held between trades. The pool, the factory, the hook and the router are excluded and never earn.'),
  ul('Selling stops future credit but never takes away what was already earned.',
     'Rewards do not expire; they wait in the coin until claimed.',
     'Anyone can <code>claimFor</code> a holder, paying them in the paired asset.',
     'Anyone can <code>fund</code> a coin to reward its holders directly.'),
  h2('Claim options'),
  cards(3,
   ('coins', 'Paired asset', '<code>claimRewards()</code>. WETH for an ETH pair, the stock for a stock pair.'),
   ('gift', 'Basket', '<code>claimRewardsAsBasket(pairRoute, routes[], minOuts[])</code>. Equal shares of the basket, each with your own minimum.'),
   ('wallet', 'ETH', '<code>claimRewardsAsEth(minEthOut, route)</code>. Routes the paired asset to native ETH.')),
  note('Minimum claim on the site is $1 so swaps stay sensible. The contracts have no minimum; small amounts simply keep accruing.'),
 ]),
 dict(tab=L, group='Trading', slug='liquidity', title='Single-sided liquidity', desc='Why the whole supply sits in one position and what that means for price.', body=[
  p('At launch the factory places all 1 billion coins in one Uniswap V4 range that starts at a $3,000 market cap and extends to the maximum tick. There is no paired asset in the pool at first; every buy adds some, every sell takes some back out. The curve is the only market maker.'),
  h2('Properties'),
  ul('No one can add a second position through the factory; traders may of course add their own liquidity on Uniswap.',
     'The position is owned by the factory, which has no function to withdraw it.',
     'LP fee is 0; the only fee is the hook\'s 2%.',
     'Tick spacing 60; price moves in 0.6% steps at the tick level, continuously inside a tick.'),
  h2('Start price'),
  p('$3,000 divided by 1 billion is $0.000003 per coin. In pair units that is 3,000 divided by the pair\'s USD price in the factory, so about 0.0₈12 ETH or 0.0₈7 TSLAx at today\'s prices.'),
 ]),
 dict(tab=L, group='Trading', slug='fees', title='Fees and anti-snipe', desc='The fixed 2% hook fee, the launch surcharge, and where each part goes.', body=[
  table(['Fee', 'Rate', 'Goes to'], [
   ['Launch', '0', 'gas only'],
   ['Trading, creator', '0.70% (1.20% with rewards off)', 'the creator, claimable any time'],
   ['Trading, holders', '0.50% (0 with rewards off)', 'holders, in the basket, the paired asset or ETH'],
   ['Trading, platform', '0.80%', 'the treasury; one eighth to the leaderboard pool'],
   ['Claim', '0', 'gas, plus the Uniswap pool fees of any route']]),
  h2('Where the fee is taken'),
  p('The hook takes 2% of the paired-asset side of every swap, whichever direction. When the pair is the specified amount (exact-input buy, exact-output sell) it is returned from <code>beforeSwap</code> as a delta; otherwise from <code>afterSwap</code>. If the PoolManager does not yet physically hold the pair (a fresh stock pool), the fee is kept as an ERC-6909 claim and delivered on the next swap or by <code>flush</code>, which the coin calls before every payout.'),
  h2('Anti-snipe'),
  p('For <code>SNIPE_SECONDS = 20</code> after launch the fee is 99% decaying linearly to 2%. A bot that buys in the first second pays almost everything to the coin, which splits it to the creator, the holders and the platform like any other fee.'),
  h2('Wherever you trade'),
  p('Because the fee lives in the hook, it is identical on this site, on Uniswap, through an aggregator or in a bot. No router can bypass it, and no router needs to implement it.'),
 ]),
 dict(tab=L, group='Trading', slug='claims', title='Claims', desc='Holders, creators and the platform all pull their share from the coin itself.', body=[
  h2('Holders'),
  p('Pending rewards are visible on the token page and in your profile. One claim per coin, or Claim all from the profile. Each claim is a single transaction to the coin contract.'),
  h2('Creators'),
  p('<code>payCreator()</code> pushes the creator\'s accrued share to the creator wallet in the paired asset. Anyone may call it; the destination is fixed in the coin.'),
  h2('Platform'),
  p('<code>payPlatform()</code> pushes the platform share to the factory\'s fee recipient, the treasury. <code>pushPlatformFees(tokens[])</code> on the factory does it for many coins at once. The treasury\'s <code>sweep</code> then sends one eighth to the leaderboard pool and the rest to the platform wallet. All permissionless.'),
  h2('Routes'),
  p('Claims that leave the paired asset (ETH or basket) need a route for a stock pair. The site keeps one route per stock and passes it for you; integrators find them under <a class="link" href="routes.html">Routes for stock pairs</a>.'),
 ]),
 dict(tab=L, group='Leaderboard', slug='leaderboard', title='How the leaderboard works', desc='Every 3 days the top traders split a prize pool funded by 0.1% of all volume.', body=[
  p('One eighth of the platform\'s 0.8% is 0.1% of every trade. The treasury sends it to the payout contract, and after each 3-day epoch the pool is split evenly across two boards.'),
  table(['Board', 'Ranked by', 'Why it cannot be gamed'], [
   ['PnL', 'Realized profit in USD for the epoch, from average cost basis', 'Wash trades realize zero minus fees'],
   ['Volume', 'Fees paid in USD (volume × 2%)', 'Washing costs 2% to compete for a share of a far smaller pool']]),
  h2('Every trade counts'),
  p('The hook reports each swap to the ledger with the wallet that signed the transaction, or the wallet a router named in 20 bytes of hook data. The ledger keeps an average-cost position per wallet and coin built only from that wallet\'s own buys, so coins received by transfer realize nothing when sold. Stats are converted to USD at the pair\'s price in the factory, so ETH-paired and stock-paired coins rank on the same board.'),
  h2('Ranking rules'),
  ul('Minimum $100 of volume in the epoch to rank.', 'Per board: 1st 40%, 2nd 25%, 3rd 15%, 4th 12%, 5th 8%.', 'Empty slots roll over to the next epoch.'),
 ]),
 dict(tab=L, group='Leaderboard', slug='payouts', title='Payouts', desc='Settlement after each epoch and how winners claim.', body=[
  steps(
   ('Epoch ends', 'Epochs are 3 days from the ledger\'s genesis timestamp. The current epoch and its end are public on the ledger.'),
   ('Settlement', 'The top 5 per board are credited from the pool\'s own balance, once per epoch, with amounts fixed by the tiers.'),
   ('Winners claim', '<code>claim()</code> on the payout contract sends ETH. Winnings never expire.')),
  note('Rankings are computed from the ledger\'s public stats, so anyone can verify the winners before and after settlement.'),
 ]),
 dict(tab=L, group='Security', slug='security', title='Security model', desc='What can and cannot happen to a coin and its liquidity.', body=[
  cards(2,
   ('lock', 'Liquidity cannot be removed', 'The position is owned by the factory, which has no function to withdraw it.'),
   ('shield', 'The coin has no owner', 'No mint, pause, blacklist, transfer tax or balance edit. The only state it keeps is reward accounting.'),
   ('scale', 'Fees are fixed', 'Set once per pool at registration. No function changes them.'),
   ('users', 'Payouts are permissionless', 'Creator, platform and holder shares are pushed by anyone to fixed recipients.')),
  h2('Testing'),
  p('Unit, fuzz and fork tests run against the real Uniswap V4 PoolManager, Uniswap V3 router, WETH and the wrapped xStocks on an Ink mainnet fork: launch, ETH and stock-paired first buys, fee split, basket claim, claim as ETH, cost-basis transfers, leaderboard settlement. An external audit is planned before the first public launch.'),
  h2('Known limits'),
  ul('Stock prices in the factory are fixed or Chainlink-fed; they only affect the launch price and the leaderboard\'s USD conversion, never fees or rewards.',
     'Basket claims depend on Uniswap V3 liquidity for each stock on Ink. Thin pools mean worse prices; holders set their own minimums.',
     'The router passes the swap route the caller supplies. A bad route reverts; it cannot lose funds.'),
 ]),
 # ---------------- Developers tab
 dict(tab=D, group='Integration', slug='direct-integration', title='Direct contract integration', desc='Trade, launch and claim from your own contracts or bots.', body=[
  p('Inkypump coins are plain ERC-20s and their pools are plain Uniswap V4 pools with a hook. Any V4-capable router on Ink can trade them. The launchpad router is a convenience for ETH-in, ETH-out trading on any pair.'),
  h2('Trade through the launchpad router'),
  code('// ETH in, coins out (route is empty for a WETH pair)\nrouter.buy{value: amountIn}(coin, route, minCoinOut);\n// coins in, ETH out\nIERC20(coin).approve(address(router), amountIn);\nrouter.sell(coin, amountIn, route, minEthOut);\n// already holding the paired asset\nrouter.buyWithPair(coin, pairIn, minCoinOut);\nrouter.sellForPair(coin, amountIn, minPairOut);', 'solidity'),
  h2('Trade through any V4 router'),
  p('Use <code>factory.poolKeyOf(coin)</code> for the PoolKey. The hook takes its fee from the paired-asset side of the delta. To have the trade attributed to your user on the leaderboard, pass the user\'s address as 20 bytes of hook data; with empty hook data the ledger credits <code>tx.origin</code>.'),
  code('PoolKey memory key = factory.poolKeyOf(coin);\nbytes memory hookData = abi.encodePacked(user); // optional\npoolManager.swap(key, params, hookData);', 'solidity'),
  h2('Launch'),
  code('factory.launch{value: devBuyEth}(\n  InkypumpFactory.LaunchParams({\n    name: "Mogcat", symbol: "MOGCAT", metadataURI: json,\n    pair: WETH, minPairOut: 0, basket: [wNVDAx, wSPYx], holderRewards: true\n  }), salt, route);', 'solidity'),
  h2('Claim'),
  code('coin.claimRewards();\ncoin.claimRewardsAsEth(minEthOut, route);\ncoin.claimRewardsAsBasket(pairRoute, routes, minOuts);\ncoin.payCreator(); coin.payPlatform(); // anyone', 'solidity'),
 ]),
 dict(tab=D, group='Integration', slug='routes', title='Routes for stock pairs', desc='How the router moves between ETH and a wrapped xStock.', body=[
  p('A route is <code>abi.encode(bytes v3Path, PoolKey v4Key)</code>. The V3 path runs from WETH to the stock through Uniswap V3 on Ink; the V4 key is an optional last hop. Either may be empty; for a WETH pair the whole route is empty. Selling and ETH claims walk the same route backwards.'),
  table(['Stock', 'V3 path', 'Pool fee'], [[s, f'WETH → USDG → {s}', f'1% then {f}'] for s, n, a, f in STOCKS]),
  code('bytes memory v3Path = abi.encodePacked(WETH, uint24(10000), USDG, uint24(500), wNVDAx);\nPoolKey memory none; // zeroed\nbytes memory route = abi.encode(v3Path, none);', 'solidity'),
  note('The router checks that the path starts at WETH and ends at the pair and reverts otherwise. It never holds funds between calls.'),
 ]),
 dict(tab=D, group='Integration', slug='data', title='Data access', desc='Everything the site shows is readable from the contracts and their events.', body=[
  table(['Need', 'Read'], [
   ['All coins', '<code>factory.allTokens(i)</code>, <code>totalTokens()</code>, <code>listings(token)</code>, <code>hidden(token)</code>'],
   ['Metadata to display', '<code>factory.metadataOf(token)</code> (the metadata to display)'],
   ['Fee split and basket', '<code>coin.creatorBps()</code>, <code>holderBps()</code>, <code>basketAssets()</code>, <code>pairAsset()</code>'],
   ['A holder\'s pending rewards', '<code>coin.pendingRewards(holder)</code>'],
   ['Trader stats', '<code>ledger.stats(epoch, wallet)</code> (USD, 8 decimals), <code>positions(wallet, token)</code>, <code>averageCost</code>'],
   ['Epoch timing', '<code>ledger.currentEpoch()</code>, <code>epochEnd(epoch)</code>'],
   ['Prize pool', '<code>payout.available()</code>, <code>claimable(wallet)</code>']]),
  h2('Events to index'),
  ul('<code>Launched(token, creator, pair, taxBps, poolId, pairUsdPrice8, holderRewards)</code> on the factory',
     '<code>FeeTaken(token, fee)</code> on the hook, <code>FeesAccrued(holder, creator, platform)</code> on each coin',
     '<code>Trade(wallet, token, epoch, isBuy, coinAmount, pairAmount, fee, realized)</code> on the ledger',
     '<code>RewardsClaimed</code>, <code>CreatorFeesPaid</code>, <code>PlatformFeesPaid</code> on each coin',
     '<code>Settled</code> and <code>Claimed</code> on the payout contract'),
 ]),
 dict(tab=D, group='Reference', slug='production-contracts', title='Production contracts', desc='Addresses on Ink (chain id 57073).', body=[
  warn('Inkypump contracts are not deployed yet. The table fills in at deployment; the Uniswap and stock addresses below are live today.'),
  table(['Contract', 'Address', 'Role'], [
   ['InkypumpFactory', '<code>pending</code>', 'launches coins, owns the locked positions'],
   ['InkypumpHook', '<code>pending</code>', 'takes the 2% fee, reports trades'],
   ['InkypumpRouter', '<code>pending</code>', 'ETH in / out trading on any pair, claim routing'],
   ['InkypumpLedger', '<code>pending</code>', 'cost basis, realized PnL, fees paid per epoch'],
   ['InkypumpPayout', '<code>pending</code>', 'leaderboard prize pool'],
   ['InkypumpTreasury', '<code>pending</code>', 'platform fee recipient, 1/8 to the pool'],
   ['Uniswap V4 PoolManager', ex(A['pm']), 'Uniswap\'s, on Ink'],
   ['Uniswap V3 SwapRouter02', ex(A['r02']), 'stock routes'],
   ['WETH', ex(A['weth']), 'paired asset'],
   ['USDG', ex(A['usdg']), 'route hop for stocks']]),
  h2('Wrapped xStocks'),
  table(['Stock', 'Address'], [[f'{s} ({n})', ex(a, a)] for s, n, a, f in STOCKS]),
 ]),
 dict(tab=D, group='Reference', slug='functions-events', title='Functions and events', desc='The public surface of each contract.', body=[
  h2('InkypumpFactory'),
  table(['Function', 'Who', 'Notes'], [
   ['launch(params, salt, route) payable', 'anyone', 'returns (token, poolId); ETH sent is the first buy'],
   ['poolKeyOf(token), listings(token), allTokens(i)', 'view', ''],
   ['pairUsdPrice(pair), quoteAssets(pair)', 'view', 'Chainlink feed when set and fresh, else the factory price'],
   ['pushPlatformFees(tokens[])', 'anyone', 'pays the treasury'],
   ]),
  h2('InkypumpToken'),
  table(['Function', 'Who', 'Notes'], [
   ['sync()', 'anyone', 'credits the pair asset that arrived since the last sync'],
   ['fund(amount)', 'anyone', 'rewards holders only'],
   ['pendingRewards(holder), unsynced()', 'view', ''],
   ['claimRewards, claimRewardsAsEth, claimRewardsAsBasket, claimFor', 'holder / anyone', ''],
   ['payCreator, payPlatform', 'anyone', 'fixed recipients'],
   ['burn(amount)', 'holder', '']]),
  h2('InkypumpHook'),
  table(['Function', 'Who', 'Notes'], [
   ['feeBpsNow(poolId, sender)', 'view', 'current total fee incl. anti-snipe, and the base'],
   ['flush(token)', 'anyone', 'delivers fees held as V4 claims'],
   ['config(poolId), pairOf(token), owed(token)', 'view', '']]),
  h2('Ledger and payout'),
  table(['Function', 'Who', 'Notes'], [
   ['ledger.stats(epoch, wallet)', 'view', 'pnl, fees, volume in USD (8 dp), trades'],
   ['ledger.positions(wallet, token), averageCost', 'view', 'pair wei'],
   ['payout.claim()', 'winner', 'ETH']]),
 ]),
 dict(tab=D, group='Reference', slug='limits', title='Limits and validation', desc='Constants and reverts you will meet.', body=[
  table(['Constant', 'Value'], [
   ['TOTAL_SUPPLY', '1,000,000,000 × 10¹⁸'], ['INITIAL_MARKET_CAP_USD', '$3,000'], ['TAX_BPS', '200 (2%)'],
   ['CREATOR_BPS / HOLDER_BPS of the fee', '3500 / 2500 (platform 4000)'], ['MAX_BASKET', '4'], ['SNIPE_START_BPS / SNIPE_SECONDS', '9900 / 20'],
   ['PROTECT_BLOCKS, MAX_BUY_BPS, MAX_HOLD_BPS', '3 blocks, 3%, 3%'], ['TICK_SPACING / LP_FEE', '60 / 0'],
   ['FEED_MAX_AGE', '7 days'], ['EPOCH', '3 days'], ['Payout tiers', '40 / 25 / 15 / 12 / 8 % per board']]),
  h2('Reverts'),
  table(['Error', 'Reason'], [
   ['LaunchesPaused', 'new launches are paused'],
   ['QuoteNotApproved', 'pair or basket asset not approved, or WETH in a basket'],
   ['InvalidParams', 'empty name or symbol, basket with rewards off, repeats, more than 4, bad bps'],
   ['NoPrice', 'the pair has no usable price'],
   ['LaunchGuard / BuyCap / HoldCap', 'launch block and 3-block protection'],
   ['Slippage / BadRoute', 'router minimums not met or a route that does not start at WETH and end at the pair'],
   ['NoBasket', 'basket claim on a coin without a basket'],
   ['EpochNotOver / AlreadySettled', 'an epoch is settled once, after it ends']]),
 ]),
]
GROUP_ORDER = {L: ['Overview', 'Create', 'Trading', 'Leaderboard', 'Security'], D: ['Integration', 'Reference']}
TABS = [(L, 'Launchpad', 'introduction.html'), (D, 'Developers', 'direct-integration.html')]

# ---------------------------------------------------------------- renderers
def slugify(t):
    return re.sub(r'[^a-z0-9]+', '-', t.lower()).strip('-')

def r_h2(t, tag='h2'):
    s = slugify(t)
    return f'<{tag} class="flex whitespace-pre-wrap group font-semibold" id="{s}"><div class="absolute" tabindex="-1"><a aria-label="Navigate to header" class="-ml-10 flex items-center opacity-0 border-0 group-hover:opacity-100 focus:opacity-100 focus:outline-0 group/link" href="#{s}">​<div class="size-6 rounded-md flex items-center justify-center shadow-xs text-gray-400 dark:text-white/50 dark:bg-background-dark dark:brightness-[1.35] dark:ring-1 dark:hover:brightness-150 bg-white ring-1 ring-gray-400/30 dark:ring-gray-700/25 hover:ring-gray-400/60 dark:hover:ring-white/20 group-focus/link:border-2 group-focus/link:border-primary dark:group-focus/link:border-primary-light">{I["hash"]}</div></a></div><span class="cursor-pointer">{t}</span></{tag}>'

def r_table(head, rows):
    th = ''.join(f'<th>{h}</th>' for h in head)
    tr = ''.join('<tr>' + ''.join(f'<td>{c}</td>' for c in r) + '</tr>' for r in rows)
    return ('<div class="min-w-0 [--page-padding:20px] flex w-[calc(100%+(var(--page-padding)*2))] my-[1em] py-[1em] -mx-(--page-padding) max-w-none [contain:inline-size]" data-component-part="scroll-area" data-table-wrapper="true" role="presentation" style="position:relative">'
            '<div aria-label="Scrollable table" class="size-full rounded-[inherit] [--scroll-area-fade-size:32px] overflow-y-hidden! base-ui-disable-scrollbar" data-component-part="scroll-area-viewport" role="region" style="overflow:scroll" tabindex="-1"><div class="flex" data-component-part="scroll-area-content" role="presentation" style="min-width:fit-content"><div class="px-(--page-padding) grow max-w-none table">'
            f'<table class="m-0 min-w-full w-full max-w-none table [&amp;_th]:text-left [&amp;_td[data-numeric]]:tabular-nums [&amp;_td]:min-w-[150px]"><thead><tr>{th}</tr></thead><tbody>{tr}</tbody></table></div></div></div></div>')

def r_steps(items):
    out = '<div class="steps ml-3.5 mt-10 mb-6" role="list">'
    for i, (t, b) in enumerate(items, 1):
        out += (f'<div class="step group/step step-container relative flex items-start pb-5" role="listitem"><div class="absolute w-px h-[calc(100%-2.75rem)] top-11 bg-gray-200/70 dark:bg-white/10" data-component-part="step-line"></div>'
                f'<div class="absolute ml-[-13px] py-2" data-component-part="step-number"><div class="group/step-indicator relative size-7 shrink-0 rounded-full bg-gray-50 dark:bg-white/10 text-xs text-gray-900 dark:text-gray-50 font-semibold flex items-center justify-center" data-component-part="step-indicator"><div>{i}</div></div></div>'
                f'<div class="w-full overflow-hidden pl-8 pr-px"><p class="mt-2 font-semibold prose dark:prose-invert text-gray-900 dark:text-gray-200" data-component-part="step-title">{t}</p><div class="prose dark:prose-invert" data-component-part="step-content"><span data-as="p">{b}</span></div></div></div>')
    return out + '</div>'

def r_cards(cols, items):
    out = f'<div class="columns prose dark:prose-invert grid max-w-none gap-4 sm:grid-cols-[repeat(var(--cols),minmax(0,1fr))] @2xl/columns-container:grid-cols-[repeat(var(--cols),minmax(0,1fr))] @[0px]/columns-container:grid-cols-1 card-group dark:prose-dark gap-y-0 sm:grid-cols-[repeat(var(--cols),minmax(0,1fr))]!" style="--cols:{cols}">'
    for ic, t, b in items:
        out += (f'<div class="card block font-normal group relative my-2 ring-2 ring-transparent rounded-2xl bg-white dark:bg-background-dark border border-gray-950/10 dark:border-white/10 overflow-hidden w-full"><div class="px-6 py-5 relative" data-component-part="card-content-container">'
                f'<div aria-hidden="true" class="size-6 fill-gray-800 dark:fill-gray-100 text-gray-800 dark:text-gray-100 [&amp;&gt;svg]:size-6" data-component-part="card-icon">{cicon(ic)}</div>'
                f'<div class="w-full"><h2 class="not-prose font-semibold text-base text-gray-800 dark:text-white mt-4" data-component-part="card-title">{t}</h2><div class="prose mt-1 font-normal text-base leading-6 text-gray-600 dark:text-gray-400" data-component-part="card-content"><span data-as="p">{b}</span></div></div></div></div>')
    return out + '</div>'

def r_callout(kind, t):
    if kind == 'warning':
        cls = 'border-amber-500/20 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10'; txt = 'text-amber-900 dark:text-amber-200'; ic = I['warn']; lbl = 'Warning'
    else:
        cls = 'border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-600/20'; txt = 'text-blue-800 dark:text-blue-300'; ic = I['note']; lbl = 'Note'
    return (f'<div aria-label="{lbl}" class="callout my-4 px-5 py-4 overflow-hidden rounded-2xl flex gap-3 border {cls}" data-callout-type="{kind}" role="note"><div class="mt-0.5 w-4" data-component-part="callout-icon">{ic}</div>'
            f'<div class="text-sm prose dark:prose-invert min-w-0 w-full [&amp;_code]:text-current! [&amp;_a]:text-current! [&amp;_a]:border-current [&amp;_strong]:text-current! {txt}" data-component-part="callout-content"><span data-as="p">{t}</span></div></div>')

def r_code(t, lang):
    return f'<div class="ip-code not-prose"><pre><code>{H.escape(t)}</code></pre><button type="button" class="ip-copy" aria-label="Copy code">{I["copy"]}</button></div>'

def render_body(body):
    out = []
    for item in body:
        k = item[0]
        if k == 'p': out.append(f'<span data-as="p">{item[1]}</span>')
        elif k == 'h2': out.append(r_h2(item[1]))
        elif k == 'h3': out.append(r_h2(item[1], 'h3'))
        elif k == 'ul': out.append('<ul>' + ''.join(f'<li>{x}</li>' for x in item[1]) + '</ul>')
        elif k == 'table': out.append(r_table(item[1], item[2]))
        elif k == 'steps': out.append(r_steps(item[1]))
        elif k == 'cards': out.append(r_cards(item[1], item[2]))
        elif k == 'callout': out.append(r_callout(item[1], item[2]))
        elif k == 'code': out.append(r_code(item[1], item[2]))
    return '\n'.join(out)

A_ON = 'group flex items-start pr-3 py-1.5 cursor-pointer gap-x-3 text-left focus-visible:-outline-offset-2 break-words hyphens-auto rounded-xl w-full outline-offset-[-1px] bg-primary/10 text-primary [text-shadow:-0.2px_0_0_currentColor,0.2px_0_0_currentColor] dark:text-primary-light dark:bg-primary-light/10'
A_OFF = 'group flex items-start pr-3 py-1.5 cursor-pointer gap-x-3 text-left focus-visible:-outline-offset-2 rounded-xl w-full outline-offset-[-1px] hover:bg-gray-600/5 dark:hover:bg-gray-200/5 text-gray-700 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-300'

def render_sidebar(tab, current):
    out = ''
    first = True
    for g in GROUP_ORDER[tab]:
        pages = [pg for pg in PAGES if pg['tab'] == tab and pg['group'] == g]
        out += f'<div class="{"" if first else "mt-6 lg:mt-8"}"><div class="sidebar-group-header flex items-center gap-2.5 pl-4 mb-3.5 lg:mb-2.5 font-semibold text-gray-900 dark:text-gray-200"><h3 class="sidebar-title text-[length:inherit] font-[inherit] leading-[inherit]"><span>{g}</span></h3></div><ul class="sidebar-group space-y-px">'
        for pg in pages:
            on = pg['slug'] == current
            li_attr = ' data-active="true" data-active-nav-item="true"' if on else ''
            a_attr = ' aria-current="page"' if on else ''
            out += (f'<li class="relative scroll-m-4 first:scroll-m-20"{li_attr} data-title="{pg["title"]}" id="/{pg["slug"]}"><a{a_attr} class="{A_ON if on else A_OFF}" href="{pg["slug"]}.html" style="padding-left:1rem">'
                    f'<div class="flex-1 flex min-w-0 items-start gap-x-2.5"><div class="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 [word-break:break-word]"><span class="min-w-0 max-w-full break-words hyphens-auto">{pg["title"]}</span></div></div></a></li>')
        out += '</ul></div>'
        first = False
    return out

def render_tabs(tab):
    out = '<div class="hidden lg:flex px-12 h-12"><div class="nav-tabs h-full flex text-sm gap-x-6">'
    for key, label, href in TABS:
        if key == tab:
            out += f'<a aria-current="location" class="link nav-tabs-item group relative h-full gap-2 flex items-center font-medium hover:text-gray-800 dark:hover:text-gray-300 text-gray-800 dark:text-gray-200 [text-shadow:-0.2px_0_0_currentColor,0.2px_0_0_currentColor]" data-active="true" href="{href}">{label}<div class="absolute bottom-0 h-[1.5px] w-full left-0 bg-primary dark:bg-primary-light"></div></a>'
        else:
            out += f'<a class="link nav-tabs-item group relative h-full gap-2 flex items-center font-medium text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-300" href="{href}">{label}<div class="absolute bottom-0 h-[1.5px] w-full left-0 group-hover:bg-gray-200 dark:group-hover:bg-gray-700"></div></a>'
    return out + '</div></div>'

def render_toc(body):
    items = [b[1] for b in body if b[0] == 'h2']
    if not items: return ''
    lis = ''.join(f'<li class="toc-item relative" data-depth="0"><a class="break-words py-1 block pl-[calc(var(--toc-padding-left)+var(--toc-focus-padding,0rem))] dark:text-gray-400 [li:not([data-active])&gt;&amp;:hover]:text-gray-900 dark:[li:not([data-active])&gt;&amp;:hover]:text-gray-300 [[data-active]&gt;&amp;]:text-primary dark:[[data-active]&gt;&amp;]:text-primary-light [[data-active]&gt;&amp;]:[text-shadow:-0.15px_0_0_currentColor,0.15px_0_0_currentColor]" href="#{slugify(t)}" style="--toc-padding-left:0rem">{t}</a></li>' for t in items)
    return (f'<nav aria-labelledby="toc-title"><h2 class="m-0 font-normal" id="toc-title"><button class="text-gray-700 dark:text-gray-300 font-medium flex items-center space-x-2 hover:text-gray-900 dark:hover:text-gray-100 transition-colors cursor-pointer" type="button">{I["toc"]}<span>On this page</span></button></h2>'
            f'<div><ul class="toc" id="table-of-contents-content">{lis}</ul></div></nav>')

def render_pagination(prev, nxt):
    out = '<nav aria-label="Pagination" class="px-0.5 flex items-center gap-6 text-sm font-semibold text-gray-700 dark:text-gray-200" id="pagination">'
    if prev:
        out += f'<a aria-label="Previous: {prev["title"]}" class="group flex items-center min-w-0 gap-3 rounded-sm pagination-prev" href="{prev["slug"]}.html" rel="prev">{I["prev"]}<div class="truncate group-hover:text-gray-900 dark:group-hover:text-white">{prev["title"]}</div></a>'
    if nxt:
        out += f'<a aria-label="Next: {nxt["title"]}" class="group flex items-center min-w-0 gap-3 rounded-sm ml-auto pagination-next" href="{nxt["slug"]}.html" rel="next"><div class="truncate group-hover:text-gray-900 dark:group-hover:text-white">{nxt["title"]}</div>{I["next"]}</a>'
    return out + '</nav>'

# ---------------------------------------------------------------- shell
def frag(h):
    return BeautifulSoup(h, 'html.parser')

def build(page, prev, nxt):
    soup = BeautifulSoup(open(REF).read(), 'html.parser')
    for t in soup.select('script, noscript, link[rel="preload"], link[rel="stylesheet"], link[rel="icon"], link[rel="apple-touch-icon"], meta[property], meta[name="description"]'): t.decompose()
    for t in soup.select('blockquote.sr-only, [data-assistant-bar], #theme-preference-menu-trigger'): t.decompose()
    for st in soup.find_all('style'):
        if '--primary' in st.get_text(): st.decompose()
    soup.html['class'] = ['dark']
    soup.html['lang'] = 'en'
    head = soup.head
    for t in head.find_all('title'): t.decompose()
    head.insert(0, frag(f'<title>{page["title"]} | {SITE} docs</title><meta name="description" content="{H.escape(page["desc"])}">'
                        '<link rel="icon" href="../img/favicon.ico" sizes="any"><link rel="icon" type="image/svg+xml" href="../img/favicon.svg">'
                        '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
                        '<link href="https://fonts.googleapis.com/css2?family=Geist:wght@100..900&family=JetBrains+Mono:wght@100..800&display=swap" rel="stylesheet">'
                        '<link rel="stylesheet" href="mint-a.css"><link rel="stylesheet" href="mint-b.css"><link rel="stylesheet" href="docs-theme.css">'))
    # navbar: logo, cta, search labels
    nb = soup.select_one('#navbar')
    logo_a = nb.select_one('a.select-none')
    logo_a['href'] = '../index.html'
    logo_a.clear(); logo_a.append(frag(f'<span class="sr-only">{SITE} home page</span><img alt="{SITE}" class="nav-logo w-auto h-7 relative object-contain shrink-0 block" src="../img/wordmark-dark.png">'))
    for a in nb.select('a[href="https://o1.exchange"]'):
        a['href'] = '../launch.html'; a['target'] = '_self'
        for s in a.find_all('span', string=re.compile('Start Trading')): s.string = 'Launch a token'
    kb = nb.select_one('#search-bar-entry span.flex-none')
    if kb: kb.string = 'Ctrl K'
    for b in nb.select('button[aria-label="More actions"]'): b.decompose()
    # mobile breadcrumb button
    mb = nb.select_one('button.lg\\:hidden')
    if mb:
        mb['id'] = 'mobile-nav-button'
        spans = mb.select('span')
        spans[-1].string = page['group']
        mb.select_one('div.font-semibold').string = page['title']
    # tabs
    tabs = nb.select_one('div.hidden.lg\\:flex.px-12.h-12')
    tabs.replace_with(frag(render_tabs(page['tab'])))
    # sidebar
    nav = soup.select_one('#navigation-items'); nav.clear(); nav.append(frag(render_sidebar(page['tab'], page['slug'])))
    # header
    hdr = soup.select_one('#header')
    hdr.select_one('.eyebrow').string = page['group']
    hdr.select_one('#page-title').string = page['title']
    desc = hdr.select_one('div.mt-2.text-lg p'); desc.string = page['desc']
    for m in hdr.select('#page-context-menu'):
        for b in m.select('button[aria-label="More actions"]'): b.decompose()
        cp = m.select_one('button[aria-label="Copy page"]')
        if cp:
            cp['class'] = [c for c in cp['class'] if c not in ('rounded-l-xl', 'border-r-0')] + ['rounded-xl']
            cp['data-copy-page'] = '1'
    # content
    content = soup.select_one('#content'); content.clear(); content.append(frag(render_body(page['body'])))
    pg = soup.select_one('#pagination'); pg.replace_with(frag(render_pagination(prev, nxt)))
    # toc
    toc = soup.select_one('#table-of-contents nav')
    toc_html = render_toc(page['body'])
    if toc_html: toc.replace_with(frag(toc_html))
    else: soup.select_one('#content-side-layout').decompose()
    # footer
    ft = soup.select_one('#footer')
    ft.clear(); ft.append(frag(f'<div class="flex gap-6 flex-wrap"><a class="h-fit" href="https://x.com/inkypump" rel="noopener noreferrer" target="_blank"><span class="sr-only">x</span>{I["x"]}</a></div><div class="flex items-center justify-between"><div class="sm:flex"><span class="text-sm text-gray-400 dark:text-gray-500">{SITE} on Ink</span></div></div>'))
    # scripts
    soup.body.append(frag('<script src="docs.js"></script>'))
    html = str(soup)
    html = re.sub(r' data-id="[^"]*"', '', html)
    return html

def main():
    for i, pg in enumerate(PAGES):
        same = [q for q in PAGES if q['tab'] == pg['tab']]
        j = same.index(pg)
        prev = same[j - 1] if j > 0 else None
        nxt = same[j + 1] if j + 1 < len(same) else None
        open(f'{OUT}/{pg["slug"]}.html', 'w').write(build(pg, prev, nxt))
        print(pg['slug'] + '.html ok')
    # search index
    import json
    idx = [{'t': pg['title'], 'g': pg['group'], 'u': pg['slug'] + '.html', 'd': pg['desc']} for pg in PAGES]
    open(f'{OUT}/search.json', 'w').write(json.dumps(idx))

if __name__ == '__main__':
    main()
