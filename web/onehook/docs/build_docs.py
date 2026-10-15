#!/usr/bin/env python3
"""Build the OneHook docs (Mintlify layout) from the rendered page shell plus our
own content. Run from web/onehook/docs: python3 build_docs.py"""
import html as H
import re
from bs4 import BeautifulSoup, NavigableString

REF = '../ref/o1-docs-launchpad.html'
OUT = '.'
SITE = 'OneHook'

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
# OneHook is not deployed to Ethereum mainnet yet. Addresses are published at
# go-live; every contract below renders as a "— not deployed" placeholder.
NA = '<code class="addr-na">— not deployed</code>'
def ex(addr, label=None):
    # kept for any future deployed address; links to Etherscan on Ethereum
    short = addr[:6] + '…' + addr[-4:]
    return f'<a class="link" href="https://etherscan.io/address/{addr}" target="_blank" rel="noopener"><code>{label or short}</code></a>'

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
 dict(tab=L, group='Overview', slug='introduction', title='Introduction', desc='Launch a fixed-supply memecoin on Ethereum, born with instincts under one immutable Uniswap v4 hook and a constitution none can break.', body=[
  note('<strong>Contracts are not deployed yet.</strong> OneHook has not launched on Ethereum mainnet. Addresses are published here at go-live (see <a class="link" href="/docs/production-contracts">Contract addresses</a>). Everything below is a fixed rule of the contracts.'),
  p('OneHook turns a token idea into a live Uniswap v4 market on Ethereum in one transaction. Every coin is a plain fixed-supply ERC-20 with no owner and no mint, born with the composable <em>instincts</em> its creator picks at launch. One immutable hook enforces those instincts, and a constitution that no coin, creator or admin can break.'),
  cards(2,
   ('coins', '1 billion fixed supply', 'Every coin is created with exactly 1,000,000,000 tokens, 18 decimals, no mint function, no owner.'),
   ('lock', 'Liquidity locked in the hook', 'The whole supply seeds a single-sided Uniswap v4 position held under the hook, which has no function to withdraw it.'),
   ('zap', 'One immutable hook', 'Every coin trades through the same OneHook v4 hook. It charges the fee, runs the instincts and enforces the constitution on every swap, wherever it happens.'),
   ('shield', 'A constitution none can break', 'Anti-sandwich protection, sells that can never be blocked, a reserved launch block and a fixed, ownerless supply apply to every coin forever.')),
  h2('Instincts a creator picks at launch'),
  p('Instincts are the behaviours a creator composes into a coin at launch. They are fixed in the contracts the moment the coin is born and can never be changed.'),
  cards(2,
   ('scale', 'Fee engine', 'Flat, dynamic or MEV-tax. The fee is 1% by default, capped at 3% and never below 0.10%, charged in ETH on every swap.'),
   ('shield', 'Anti-snipe', 'A decaying launch tax of up to 30% on buys only, over an opening block window. Snipers pay the coin, not the other way round.'),
   ('zap', 'Reflexive buyback', 'A share of the fee buys the coin back and burns it in the pool, tightening supply as volume grows.'),
   ('gift', 'Dividends', 'A share of the fee is paid to holders pro-rata in ETH, so holding earns from every trade.'),
   ('users', 'Max-wallet', 'An opening-window per-wallet buy cap that spreads the first supply across more holders.')),
  note('Buyback and dividend shares are each at most 50% of the fee, and at most 80% of the fee combined.'),
  h2('Where the fee goes'),
  p('The hook charges the fee in ETH on every swap. It first funds the buyback and dividend pots the creator chose; whatever remains splits 60% to the creator and 40% to the platform.'),
  table(['Part of the fee', 'Share', 'Paid in'], [
   ['Buyback pot', 'up to 50% of the fee (creator sets)', 'buys and burns the coin in the pool'],
   ['Dividends pot', 'up to 50% of the fee (creator sets)', 'ETH, pro-rata to holders'],
   ['Creator', '60% of what is left', 'ETH, claimable any time'],
   ['Platform', '40% of what is left', 'ETH']]),
  note('With both pots off, the whole fee simply splits 60% creator / 40% platform.'),
  h2('Where to go next'),
  cards(2,
   ('rocket', 'How it works', 'The launch transaction, the pool, the hook and the fee flow, step by step. <a class="link" href="/docs/how-it-works">Read</a>'),
   ('wallet', 'Plan your launch', 'Pick a paired asset, choose your instincts and size your first buy. <a class="link" href="/docs/launch-planning">Read</a>'),
   ('layers', 'Instincts', 'The fee engine, anti-snipe, buyback, dividends and max-wallet in detail. <a class="link" href="/docs/instincts">Read</a>'),
   ('code', 'Developers', 'Contracts, trading, events and limits for integrators. <a class="link" href="/docs/direct-integration">Read</a>')),
 ]),
 dict(tab=L, group='Overview', slug='how-it-works', title='How it works', desc='From the launch transaction to the first dividend: what the factory, the hook and the coin contract do.', body=[
  h2('The launch transaction'),
  steps(
   ('Deploy the coin', 'The factory asks the token deployer for a new coin with a CREATE2 salt: 1 billion supply minted to the factory, no owner, no mint, the chosen instincts fixed in the constructor.'),
   ('Create the pool', 'A Uniswap v4 pool is initialised for coin / paired asset with the OneHook hook attached, a 0 LP fee and a fixed tick spacing.'),
   ('Seed the liquidity', 'The entire supply goes into a single-sided range starting at the opening market cap. The position is held under the hook, which has no function to remove it, so liquidity is locked.'),
   ('Register instincts', 'The hook stores the pool, its paired asset, the fee engine and every instinct the creator picked. Nothing can change them afterwards.'),
   ('Reserved first buy', 'The launch block is reserved for the creator. Any ETH sent with the launch is swapped into the fresh pool; the coins go to the creator and the buy is public on the token page.')),
  h2('Every trade after that'),
  p('The hook runs on every swap in the pool. It charges the fee in ETH, funds the buyback and dividend pots the creator chose, then credits the rest 60% to the creator and 40% to the platform. It also applies the constitution on every swap: an MEV priority-fee tax deters sandwiching, and a sell can never be blocked. Because the fee and the instincts live in the hook, they are identical on this site, on Uniswap, through an aggregator or in a bot.'),
  note('For the opening block window the anti-snipe instinct, if enabled, charges a decaying tax of up to 30% on buys only. The creator\'s own reserved first buy pays the base fee.'),
  h2('Buyback and dividends'),
  p('The buyback pot swaps its accrued ETH for the coin and burns it directly in the pool, so every eligible holder\'s share of supply grows. The dividend pot accrues to holders pro-rata and is paid in ETH; selling stops future credit but never takes away what was already earned.'),
  h2('Claiming'),
  p('Holders accrue dividends per token held from the moment of each trade. A claim settles the holder and pays them in ETH. The creator\'s share and the platform\'s share sit in the coin until anyone pushes them to their fixed recipients. There is no lockup and no approval step.'),
 ]),
 dict(tab=L, group='Overview', slug='launch-planning', title='Plan your launch', desc='The decisions that cannot be changed after launch, and how to make them.', body=[
  h2('Paired asset'),
  p('Your coin is priced in the asset you pair it with, and every fee is collected in ETH. Pair with ETH for the deepest routes and the simplest story, or with any oracle-priced token when that token is the meme. The opening price is read from the paired asset\'s oracle price at launch.'),
  table(['Pair', 'Price moves with', 'Traders need'], [
   ['ETH', 'ETH', 'ETH only'],
   ['Any oracle-priced token', 'that token', 'ETH only; the router walks the route']]),
  h2('Instincts'),
  p('Decide which instincts the coin is born with. All of them are optional except the constitution, which is always on.'),
  ul('Fee engine: flat, dynamic or MEV-tax, 1% by default, capped at 3%, never below 0.10%.',
     'Anti-snipe: a decaying launch tax of up to 30% on buys only, over an opening block window.',
     'Reflexive buyback: a share of the fee buys and burns the coin in the pool.',
     'Dividends: a share of the fee paid to holders pro-rata in ETH.',
     'Max-wallet: an opening-window per-wallet buy cap.'),
  warn('Name, symbol, supply, paired asset, the fee engine and every instinct are immutable. Logo, description and links can be edited later.'),
  h2('First buy'),
  p('The launch block is reserved for you. A first buy in the launch transaction, at the opening price, is the only buy allowed in that block and is shown on the token page, so size it like a public statement.'),
 ]),
 dict(tab=L, group='Create', slug='token-creation', title='Token creation', desc='What you fill in on the launch form and what each field becomes on-chain.', body=[
  table(['Field', 'On-chain', 'Rules'], [
   ['Name, symbol', 'ERC-20 name and symbol', 'Required. Symbol 2 to 10 characters, A to Z and 0 to 9.'],
   ['Logo, description, links', 'metadataURI (JSON)', 'Editable after launch.'],
   ['Paired asset', '<code>pair</code>', 'WETH or an approved oracle-priced token.'],
   ['Fee engine', '<code>feeMode</code>, <code>feeBps</code>', 'Flat, dynamic or MEV-tax. 100 bps (1%) default, max 300 (3%), min 10 (0.10%).'],
   ['Buyback', '<code>buybackBps</code>', 'Share of the fee, at most 50% and at most 80% combined with dividends.'],
   ['Dividends', '<code>dividendBps</code>', 'Share of the fee, at most 50% and at most 80% combined with buyback.'],
   ['Anti-snipe', '<code>snipeStartBps</code>, <code>snipeBlocks</code>', 'Decaying launch tax up to 30% on buys, over a block window.'],
   ['Max-wallet', '<code>maxWalletBps</code>, <code>maxWalletBlocks</code>', 'Opening-window per-wallet buy cap.'],
   ['Dev buy', 'ETH sent with the call', 'The reserved launch-block buy; <code>minCoinOut</code> protects it from sandwiching.']]),
  h2('Cost'),
  p('There is no creation fee. You pay gas for one transaction on Ethereum, plus the ETH of your optional first buy.'),
  h2('Launch protection'),
  p('The constitution and the instincts you enable protect the opening:'),
  ul('The launch block is reserved: only the creator may receive coins from the pool in it.',
     'If max-wallet is on, each wallet is capped at the chosen per-wallet amount for the opening window.',
     'If anti-snipe is on, the buy tax decays from up to 30% back to the base fee over the opening block window.'),
 ]),
 dict(tab=L, group='Create', slug='instincts', title='Instincts', desc='The five behaviours a creator composes into a coin at launch, and the caps that bound them.', body=[
  p('Instincts are the optional behaviours a coin is born with. Each is fixed in the contracts at launch and enforced by the one immutable hook on every swap. The constitution is separate: it is always on and covered on <a class="link" href="/docs/constitution">The constitution</a>.'),
  h2('Fee engine'),
  p('Every coin charges a fee in ETH on every swap. The creator picks the engine:'),
  table(['Mode', 'How the rate is set'], [
   ['Flat', 'A single rate for every swap.'],
   ['Dynamic', 'The rate moves within the bounds with pool conditions.'],
   ['MEV-tax', 'The rate rises with the swap\'s priority fee, taxing the trades that crowd the block.']]),
  note('The fee is 1% by default, capped at 3% and never below 0.10% (10 bps), whichever engine is chosen.'),
  h2('Anti-snipe'),
  p('A decaying launch tax of up to 30% on buys only, charged over an opening block window and decaying back to the base fee. It applies to buys, never to sells, so a sniper pays the coin while ordinary sellers are untouched. The creator\'s reserved first buy pays the base fee.'),
  h2('Reflexive buyback'),
  p('A share of the fee is set aside and periodically swapped for the coin and burned in the pool. Burning supply lifts every remaining holder\'s share. The buyback share is at most 50% of the fee.'),
  h2('Dividends'),
  p('A share of the fee is paid to holders pro-rata in ETH, accrued per token held from the moment of each trade. Holders claim their ETH any time; the pool, the factory, the hook and the router are excluded and never earn. The dividend share is at most 50% of the fee.'),
  h2('Max-wallet'),
  p('An opening-window per-wallet buy cap. For the chosen number of opening blocks no wallet may buy past the cap, spreading the first supply across more holders. After the window it lifts automatically.'),
  h2('The caps'),
  cards(2,
   ('scale', 'Each pot at most half', 'The buyback share and the dividend share are each at most 50% of the fee.'),
   ('scale', 'Together at most four fifths', 'Buyback and dividends together take at most 80% of the fee; the rest splits 60% creator / 40% platform.')),
 ]),
 dict(tab=L, group='Trading', slug='fees', title='Fees and anti-snipe', desc='The fee engine, the split after the pots, and the decaying launch tax.', body=[
  h2('The fee'),
  p('The hook charges the fee in ETH on every swap, in whichever direction. The rate comes from the fee engine the creator chose and is 1% by default, capped at 3% and never below 0.10%.'),
  table(['Part of the fee', 'Share', 'Goes to'], [
   ['Buyback pot', 'up to 50% of the fee', 'buys and burns the coin in the pool'],
   ['Dividends pot', 'up to 50% of the fee', 'holders, pro-rata in ETH'],
   ['Creator', '60% of what is left', 'the creator, claimable any time'],
   ['Platform', '40% of what is left', 'the platform fee recipient']]),
  note('Buyback and dividends are each at most 50% of the fee and at most 80% combined. With both off, the whole fee splits 60% creator / 40% platform.'),
  h2('Where the fee is taken'),
  p('The hook takes its share of the ETH side of every swap. When the ETH is the specified amount (exact-input buy, exact-output sell) it is returned from <code>beforeSwap</code> as a delta; otherwise from <code>afterSwap</code>. The accrued ETH funds the pots first, then credits the creator and the platform.'),
  h2('Anti-snipe'),
  p('If the anti-snipe instinct is on, the buy tax starts as high as 30% at launch and decays linearly to the base fee over the opening block window. It applies to buys only; sells always pay the base fee and can never be blocked. A bot that buys in the first block pays most of its buy to the coin, which routes it through the pots and the 60/40 split like any other fee.'),
  h2('Wherever you trade'),
  p('Because the fee and the instincts live in the hook, they are identical on this site, on Uniswap, through an aggregator or in a bot. No router can bypass them, and no router needs to implement them.'),
 ]),
 dict(tab=L, group='Trading', slug='constitution', title='The constitution', desc='The rules every OneHook coin obeys forever, that no creator, coin or admin can change.', body=[
  p('The instincts are what a creator chooses. The constitution is what every coin obeys regardless. It is always on, immutable, and enforced by the one hook on every swap.'),
  cards(2,
   ('shield', 'Anti-sandwich', 'An MEV priority-fee tax makes sandwiching the pool uneconomic, protecting ordinary swaps.'),
   ('zap', 'Sells can never be blocked', 'No instinct, creator or admin can stop a holder from selling. There is no blacklist and no transfer freeze on a coin.'),
   ('rocket', 'The launch block is reserved', 'The first block after launch is reserved for the creator\'s first buy; no one can snipe it.'),
   ('lock', 'Liquidity is locked in the hook', 'The single-sided position is held under the hook, which has no function to withdraw it.'),
   ('coins', 'Fixed supply, no owner', 'Every coin is 1,000,000,000 tokens with no mint and no owner. The only state a coin keeps is its instinct accounting.')),
  note('These rules hold for every coin launched through OneHook, forever. They are the floor beneath whatever instincts a creator adds.'),
 ]),
 dict(tab=L, group='Security', slug='security', title='Security model', desc='What can and cannot happen to a coin, its liquidity and its holders, and the limited powers of the admin.', body=[
  cards(2,
   ('lock', 'Liquidity cannot be removed', 'The position is held under the hook, which has no function to withdraw it. Only the disclosed admin collect can pull pool liquidity.'),
   ('shield', 'Coins have no owner', 'No mint, no pause, no blacklist, no transfer tax edit, no balance edit. The only state a coin keeps is its instinct accounting.'),
   ('scale', 'Instincts and fees are fixed', 'Set once at launch and enforced by the hook. No function, and no admin, can change a coin\'s fee or instincts.'),
   ('users', 'Payouts are permissionless', 'Creator, platform, buyback and dividend flows are pushed by anyone to fixed recipients and holders.')),
  h2('The admin'),
  p('The admin is an immutable wallet. Its powers are deliberately narrow and operational; it can never touch a coin\'s rules, supply or balances.'),
  table(['Admin can', 'What it does'], [
   ['<code>pause</code> / <code>resume</code>', 'pause or resume new launches'],
   ['<code>setHidden</code>', 'hide or unhide a coin in the app listing'],
   ['<code>setCoinMetadata</code>', 'correct a coin\'s display metadata'],
   ['<code>setFeeRecipient</code>', 'change the platform fee recipient'],
   ['<code>setTokenBlocked</code>', 'block a token from being used as a new pair'],
   ['<code>setStartCap</code>', 'set the opening market cap used for new launches'],
   ['<code>renounceOwnership</code>', 'give up the admin role entirely'],
   ['<code>collect</code>', 'pull pool liquidity (disclosed on-chain and in the app)'],
   ['<code>pushPlatformFees</code>', 'push accrued platform fees to the recipient']]),
  warn('The admin cannot mint, cannot change a coin\'s fee or instincts, cannot freeze transfers, and cannot move anyone\'s coins.'),
  h2('Testing'),
  p('Unit, fuzz and fork tests run against the real Uniswap v4 PoolManager and WETH on an Ethereum mainnet fork: launch, the reserved first buy, each fee engine, the buyback and dividend pots, max-wallet, anti-snipe decay and the admin surface. An external audit is planned before the first public launch.'),
  h2('Known limits'),
  ul('Oracle prices for a non-ETH pair only set the opening launch price; they never affect fees, instincts or dividends after launch.',
     'The router passes the swap route the caller supplies. A bad route reverts; it cannot lose funds.',
     'Contracts are not deployed to mainnet yet; addresses and audit results are published at go-live.'),
 ]),
 # ---------------- Developers tab
 dict(tab=D, group='Integration', slug='direct-integration', title='Direct contract integration', desc='Trade, launch and claim from your own contracts or bots.', body=[
  p('OneHook coins are plain ERC-20s and their pools are plain Uniswap v4 pools with the OneHook hook. Any v4-capable router on Ethereum can trade them. The OneHook router is a convenience for ETH-in, ETH-out trading on any pair.'),
  h2('Trade through the OneHook router'),
  code('// ETH in, coins out (route is empty for a WETH pair)\nrouter.buy{value: amountIn}(coin, route, minCoinOut);\n// coins in, ETH out\nIERC20(coin).approve(address(router), amountIn);\nrouter.sell(coin, amountIn, route, minEthOut);\n// already holding the paired asset\nrouter.buyWithPair(coin, pairIn, minCoinOut);\nrouter.sellForPair(coin, amountIn, minPairOut);', 'solidity'),
  h2('Trade through any v4 router'),
  p('Use <code>factory.poolKeyOf(coin)</code> for the PoolKey. The hook takes its fee from the ETH side of the delta and runs the coin\'s instincts and the constitution. No router can bypass the hook.'),
  code('PoolKey memory key = factory.poolKeyOf(coin);\npoolManager.swap(key, params, "");', 'solidity'),
  h2('Launch'),
  code('factory.launch{value: devBuyEth}(\n  OneHookFactory.LaunchParams({\n    name: "Mogcat", symbol: "MOGCAT", metadataURI: json,\n    pair: WETH, minCoinOut: 0,\n    feeMode: FeeMode.Flat, feeBps: 100,\n    buybackBps: 2000, dividendBps: 3000,\n    snipeStartBps: 3000, snipeBlocks: 5,\n    maxWalletBps: 100, maxWalletBlocks: 10\n  }), salt, route);', 'solidity'),
  h2('Claim'),
  code('coin.claimDividends();          // holder pulls their ETH dividends\ncoin.payCreator();              // anyone pushes the creator share\ncoin.payPlatform();             // anyone pushes the platform share', 'solidity'),
 ]),
 dict(tab=D, group='Integration', slug='data', title='Data access', desc='Everything the site shows is readable from the contracts and their events.', body=[
  table(['Need', 'Read'], [
   ['All coins', '<code>factory.allTokens(i)</code>, <code>totalTokens()</code>, <code>listings(token)</code>, <code>hidden(token)</code>'],
   ['Metadata to display', '<code>factory.metadataOf(token)</code>'],
   ['Fee and instincts', '<code>coin.feeBps()</code>, <code>feeMode()</code>, <code>buybackBps()</code>, <code>dividendBps()</code>, <code>pairAsset()</code>'],
   ['A holder\'s pending dividends', '<code>coin.pendingDividends(holder)</code>'],
   ['Current fee incl. anti-snipe', '<code>hook.feeBpsNow(poolId, isBuy)</code>'],
   ['Buyback accrued', '<code>coin.buybackPending()</code>']]),
  h2('Events to index'),
  ul('<code>Launched(token, creator, pair, feeMode, feeBps, buybackBps, dividendBps, poolId)</code> on the factory',
     '<code>FeeTaken(token, fee)</code> on the hook',
     '<code>DividendsAccrued(token, amount)</code>, <code>BuybackBurned(token, coinBurned, ethSpent)</code> on each coin',
     '<code>DividendsClaimed(holder, amount)</code>, <code>CreatorFeesPaid</code>, <code>PlatformFeesPaid</code> on each coin'),
 ]),
 dict(tab=D, group='Reference', slug='production-contracts', title='Contract addresses', desc='OneHook is not deployed to Ethereum mainnet yet; addresses are published here at go-live.', body=[
  note('OneHook has not launched. The addresses below are published and source-verified on Etherscan at go-live. Until then every entry reads <strong>— not deployed</strong>.'),
  table(['Contract', 'Address', 'Role'], [
   ['OneHookFactory', NA, 'launches coins, holds the locked positions'],
   ['OneHookHook', NA, 'charges the fee, runs the instincts, enforces the constitution'],
   ['OneHookRouter', NA, 'ETH in / out trading on any pair, claim routing'],
   ['OneHookTokenDeployer', NA, 'creates each coin for the factory'],
   ['Uniswap v4 PoolManager', NA, 'Uniswap\'s, on Ethereum; address pinned at go-live'],
   ['WETH', NA, 'paired asset; canonical WETH pinned at go-live']]),
 ]),
 dict(tab=D, group='Reference', slug='functions-events', title='Functions and events', desc='The public surface of each contract.', body=[
  h2('OneHookFactory'),
  table(['Function', 'Who', 'Notes'], [
   ['launch(params, salt, route) payable', 'anyone', 'returns (token, poolId); ETH sent is the reserved first buy'],
   ['poolKeyOf(token), listings(token), allTokens(i)', 'view', ''],
   ['pairPrice(pair), quoteAssets(pair)', 'view', 'oracle feed used for the opening launch price'],
   ['pushPlatformFees(tokens[])', 'anyone', 'pays the platform fee recipient'],
   ]),
  h2('OneHookToken'),
  table(['Function', 'Who', 'Notes'], [
   ['sync()', 'anyone', 'credits the ETH that arrived since the last sync'],
   ['pendingDividends(holder), unsynced()', 'view', ''],
   ['claimDividends, claimFor', 'holder / anyone', 'pays ETH'],
   ['payCreator, payPlatform', 'anyone', 'fixed recipients'],
   ['burn(amount)', 'holder', '']]),
  h2('OneHookHook'),
  table(['Function', 'Who', 'Notes'], [
   ['feeBpsNow(poolId, isBuy)', 'view', 'current fee incl. anti-snipe decay, plus the base'],
   ['flush(token)', 'anyone', 'delivers fees held as v4 claims and runs the buyback'],
   ['config(poolId), pairOf(token), owed(token)', 'view', '']]),
  h2('Admin'),
  table(['Function', 'Who', 'Notes'], [
   ['pause, resume', 'admin', 'new launches'],
   ['setHidden, setCoinMetadata, setFeeRecipient', 'admin', 'listing and recipient'],
   ['setTokenBlocked, setStartCap', 'admin', 'new pairs and opening cap'],
   ['collect, pushPlatformFees, renounceOwnership', 'admin', 'collect is disclosed on-chain']]),
 ]),
 dict(tab=D, group='Reference', slug='limits', title='Limits and validation', desc='Constants and reverts you will meet.', body=[
  table(['Constant', 'Value'], [
   ['TOTAL_SUPPLY', '1,000,000,000 × 10¹⁸'],
   ['FEE_BPS default / max / min', '100 (1%) / 300 (3%) / 10 (0.10%)'],
   ['BUYBACK_BPS, DIVIDEND_BPS max', '5000 each (50% of the fee)'],
   ['BUYBACK + DIVIDEND combined max', '8000 (80% of the fee)'],
   ['Fee split after the pots', '60% creator / 40% platform'],
   ['SNIPE_START_BPS max', '3000 (30% on buys, decaying)'],
   ['LP_FEE', '0 (the only fee is the hook\'s)']]),
  h2('Reverts'),
  table(['Error', 'Reason'], [
   ['LaunchesPaused', 'new launches are paused by the admin'],
   ['QuoteNotApproved', 'the paired asset is not an approved or oracle-priced token, or is blocked'],
   ['InvalidParams', 'empty name or symbol, fee out of bounds, or buyback/dividend over the caps'],
   ['NoPrice', 'the pair has no usable oracle price'],
   ['LaunchGuard / WalletCap', 'reserved launch block or the max-wallet opening window'],
   ['Slippage / BadRoute', 'router minimums not met or a route that does not start at WETH and end at the pair']]),
 ]),
]
GROUP_ORDER = {L: ['Overview', 'Create', 'Trading', 'Security'], D: ['Integration', 'Reference']}
TABS = [(L, 'Launchpad', '/docs/introduction'), (D, 'Developers', '/docs/direct-integration')]

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
            out += (f'<li class="relative scroll-m-4 first:scroll-m-20"{li_attr} data-title="{pg["title"]}" id="/{pg["slug"]}"><a{a_attr} class="{A_ON if on else A_OFF}" href="/docs/{pg["slug"]}" style="padding-left:1rem">'
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
        out += f'<a aria-label="Previous: {prev["title"]}" class="group flex items-center min-w-0 gap-3 rounded-sm pagination-prev" href="/docs/{prev["slug"]}" rel="prev">{I["prev"]}<div class="truncate group-hover:text-gray-900 dark:group-hover:text-white">{prev["title"]}</div></a>'
    if nxt:
        out += f'<a aria-label="Next: {nxt["title"]}" class="group flex items-center min-w-0 gap-3 rounded-sm ml-auto pagination-next" href="/docs/{nxt["slug"]}" rel="next"><div class="truncate group-hover:text-gray-900 dark:group-hover:text-white">{nxt["title"]}</div>{I["next"]}</a>'
    return out + '</nav>'

# ---------------------------------------------------------------- shell
def frag(h):
    return BeautifulSoup(h, 'html.parser')

def build(page, prev, nxt):
    soup = BeautifulSoup(open(REF).read(), 'html.parser')
    for t in soup.select('script, noscript, link[rel="preload"], link[rel="stylesheet"], link[rel="icon"], link[rel="apple-touch-icon"], meta[property], meta[name="description"]'): t.decompose()
    # strip leftover o1/Mintlify head metadata so it cannot leak into the OneHook docs
    for t in soup.select('meta[name="generator"], meta[name="application-name"], meta[name="apple-mobile-web-app-title"], '
                         'meta[name="msapplication-config"], meta[name="msapplication-TileColor"], meta[name="theme-color"], '
                         'meta[name^="twitter:"], meta[name^="og:"], '
                         'link[rel="canonical"], link[rel="alternate"], link[rel="manifest"], link[href*="mintlify-assets"]'): t.decompose()
    for t in soup.select('blockquote.sr-only, [data-assistant-bar], #theme-preference-menu-trigger'): t.decompose()
    for st in soup.find_all('style'):
        if '--primary' in st.get_text(): st.decompose()
    soup.html['class'] = ['dark']
    soup.html['lang'] = 'en'
    head = soup.head
    for t in head.find_all('title'): t.decompose()
    head.insert(0, frag(f'<title>{page["title"]} | {SITE} docs</title><meta name="description" content="{H.escape(page["desc"])}">'
                        f'<meta name="theme-color" content="#0a0e18">'
                        f'<meta property="og:type" content="website"><meta property="og:site_name" content="{SITE}">'
                        f'<meta property="og:title" content="{page["title"]} | {SITE} docs"><meta property="og:description" content="{H.escape(page["desc"])}">'
                        f'<meta name="twitter:card" content="summary"><meta name="twitter:title" content="{page["title"]} | {SITE} docs"><meta name="twitter:description" content="{H.escape(page["desc"])}">'
                        '<link rel="icon" href="../img/favicon.ico" sizes="any"><link rel="icon" type="image/svg+xml" href="../img/favicon.svg">'
                        '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
                        '<link href="https://fonts.googleapis.com/css2?family=Geist:wght@100..900&family=JetBrains+Mono:wght@100..800&display=swap" rel="stylesheet">'
                        '<link rel="stylesheet" href="mint-a.css"><link rel="stylesheet" href="mint-b.css"><link rel="stylesheet" href="docs-theme.css">'))
    # navbar: logo, cta, search labels
    nb = soup.select_one('#navbar')
    logo_a = nb.select_one('a.select-none')
    logo_a['href'] = '/'
    logo_a.clear(); logo_a.append(frag(f'<span class="sr-only">{SITE} home page</span><img alt="{SITE}" class="nav-logo w-auto h-7 relative object-contain shrink-0 block" src="../img/hero-wordmark.png">'))
    for a in nb.select('a[href="https://o1.exchange"]'):
        a['href'] = '/launch'; a['target'] = '_self'
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
    ft.clear(); ft.append(frag(f'<div class="flex gap-6 flex-wrap"><a class="h-fit" href="https://x.com/onehook" rel="noopener noreferrer" target="_blank"><span class="sr-only">x</span>{I["x"]}</a></div><div class="flex items-center justify-between"><div class="sm:flex"><span class="text-sm text-gray-400 dark:text-gray-500">{SITE} on Ethereum</span></div></div>'))
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
    idx = [{'t': pg['title'], 'g': pg['group'], 'u': '/docs/' + pg['slug'], 'd': pg['desc']} for pg in PAGES]
    open(f'{OUT}/search.json', 'w').write(json.dumps(idx))

if __name__ == '__main__':
    main()
