#!/usr/bin/env python3
"""Build the undo.fun site: wrap each page in the shared shell and write dist/.

    python3 build.py    # preview: sample coins until the contracts are deployed
"""
import hashlib, json, os, re, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.join(HERE, 'site')
DIST = os.path.join(HERE, 'dist')
DESC = 'Launch a coin paired with ETH, gold or 500+ tokenized stocks, where every buy can be undone. Rent a window of 30 minutes to 7 days, cancel inside it for a full refund. The rent is burned.'
SITE_URL = os.environ.get('SITE_URL', 'https://undo.fun').rstrip('/')
X_HANDLE = os.environ.get('X_HANDLE', '')

FONTS = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700;12..96,800&family=Instrument+Sans:wdth,wght@75..100,400..700&family=Martian+Mono:wght@400;500;600&display=swap'
NAV = [('explore', '/', 'Explore', 'Explore'), ('launch', '/launch', 'Launch', 'Launch'), ('portfolio', '/portfolio', 'Portfolio', 'Portfolio'), ('docs', '/docs', 'How it works', 'Docs')]
ICON = {
    'compass': '<circle cx="12" cy="12" r="10"/><path d="m16.24 7.76-2.12 6.36-6.36 2.12 2.12-6.36z"/>',
    'wallet': '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
    'book': '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
    'plus': '<path d="M5 12h14M12 5v14"/>',
    'search': '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
}
# the mark: a keycap with an undo arrow (brand/brand.html renders the PNGs)
MARK = '<img class="mark" src="/img/mark-128.png" alt="" width="30" height="30">'
WORDMARK = '<b class="wm">undo<i>.fun</i></b>'
ETH_GLYPH = '<svg viewBox="0 0 10 16" aria-hidden="true"><path d="M5 0 0 8.1 5 11l5-2.9z" fill="currentColor" opacity=".55"/><path d="M5 12 0 9.1 5 16l5-6.9z" fill="currentColor"/></svg>'
X_GLYPH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18.9 2H22l-6.8 7.8L23 22h-6.2l-4.9-6.4L6.3 22H3.2l7.3-8.3L1 2h6.3l4.4 5.9L18.9 2Zm-1.1 18.1h1.7L6.3 3.8H4.5l13.3 16.3Z"/></svg>'


def ic(n):
    return f'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{ICON[n]}</svg>'


def config():
    cfg = {
        'chainId': 1, 'chainName': 'Ethereum', 'explorer': 'https://etherscan.io',
        'rpcs': os.environ['RPCS'].split(',') if os.environ.get('RPCS') else ['https://ethereum-rpc.publicnode.com', 'https://rpc.mevblocker.io', 'https://ethereum.publicnode.com'],
        'feeds': {'ETH': '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419', 'BTC': '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c', 'XAU': '0x214eD9Da11D2fbe465a6fc601a91E62EbEc1a0D6'},
        'weth': '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        'contracts': {}, 'prelaunch': True,
        'reownProjectId': os.environ.get('REOWN_PROJECT_ID', '5b1ae833abd22d348cbf5d53cf58b3b2'),
        # the rules every coin shares (see /docs): a 1% tax, and a window premium of 0.05 ETH per 6 hours
        'taxBps': 100, 'split': {'creator': 70, 'platform': 30},
        'premium': {'refEth': 0.05, 'baseH': 6, 'minH': 0.5, 'maxH': 168, 'maxBps': 3000}, 'startCap': 5000,
        'tokens': json.load(open(os.path.join(HERE, 'tokens.json'))), 'social': {'x': X_HANDLE and f'https://x.com/{X_HANDLE}'},
    }
    return 'window.UNDO = ' + json.dumps(cfg, separators=(',', ':')) + ';\n'


def shell(meta, body):
    nav = meta.get('nav', '')
    links = ''.join(f'<a href="{href}" class="key {"down" if key == nav else ""}"><span class="full">{label}</span><span class="short">{short}</span></a>' for key, href, label, short in NAV)
    title = meta['title']
    desc = meta.get('desc', DESC)
    scripts = ''.join(f'<script src="/js/{s}" defer></script>' for s in meta.get('scripts', []))
    head = meta.get('head', '')
    x_link = f'<a class="key sq x-link" href="https://x.com/{X_HANDLE}" target="_blank" rel="noopener" aria-label="undo.fun on X">{X_GLYPH}</a>' if X_HANDLE else ''
    x_foot = f'<a href="https://x.com/{X_HANDLE}" target="_blank" rel="noopener">X @{X_HANDLE}</a>' if X_HANDLE else ''
    x_meta = f'<meta name="twitter:site" content="@{X_HANDLE}">' if X_HANDLE else ''
    return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{title}</title>
<meta name="description" content="{desc}">
<meta name="theme-color" content="#efeee8">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:url" content="{SITE_URL}">
<meta property="og:image" content="{SITE_URL}/img/og.png">
<meta property="og:type" content="website">
<meta property="og:site_name" content="undo.fun">
<meta name="twitter:card" content="summary_large_image">
{x_meta}
<meta name="twitter:title" content="{title}">
<meta name="twitter:description" content="{desc}">
<meta name="twitter:image" content="{SITE_URL}/img/og.png">
<link rel="apple-touch-icon" href="/img/apple-touch-icon.png">
<link rel="icon" href="/img/favicon-32.png" type="image/png" sizes="32x32">
<link rel="icon" href="/img/favicon-64.png" type="image/png" sizes="64x64">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="{FONTS}">
<link rel="stylesheet" href="/css/app.css">
<script src="/config.js"></script>
{head}<script src="/js/ui.js" defer></script>
<script src="/js/data.js" defer></script>
<script src="/js/wallet.js" defer></script>
{scripts}
</head>
<body>
<header class="top">
  <div class="top-in">
    <a class="brand" href="/" aria-label="undo.fun home">{MARK}{WORDMARK}</a>
    <nav class="nav" aria-label="Main">{links}</nav>
    <div class="top-r">
      <button class="key sq" data-search aria-label="Search coins" title="Search (/)">{ic("search")}</button>
      {x_link}
      <button class="key ink wallet-btn" data-wallet-btn>Connect</button>
    </div>
  </div>
</header>
<main class="page" id="page">
{body}
</main>
<footer class="foot">
  <div class="foot-in">
    <a class="brand" href="/" aria-label="undo.fun home">{MARK}{WORDMARK}</a>
    <span class="net" title="Ethereum mainnet">{ETH_GLYPH}Ethereum mainnet</span>
    <nav aria-label="Footer"><a href="/docs">How it works</a><a href="/docs#faq">FAQ</a><a href="/launch">Launch</a>{x_foot}</nav>
  </div>
</footer>
</body>
</html>
'''


def build():
    if os.path.exists(DIST):
        shutil.rmtree(DIST)
    os.makedirs(DIST)
    for d in ('css', 'js', 'img'):
        shutil.copytree(os.path.join(SITE, d), os.path.join(DIST, d))
    # TradingView Advanced Charts, the same library as the other sites (web/replica)
    lib = next(p for p in (os.environ.get('CHARTING_LIBRARY', ''), os.path.join(SITE, 'charting_library'), os.path.join(HERE, '..', 'replica', 'charting_library')) if p and os.path.isdir(p))
    shutil.copytree(lib, os.path.join(DIST, 'charting_library'))
    shutil.copy(os.path.join(SITE, 'tv-theme.css'), os.path.join(DIST, 'charting_library', 'tv-theme.css'))
    open(os.path.join(DIST, 'config.js'), 'w').write(config())
    shutil.copy(os.path.join(SITE, 'backing.json'), os.path.join(DIST, 'backing.json'))
    for f in sorted(os.listdir(os.path.join(SITE, 'pages'))):
        src = open(os.path.join(SITE, 'pages', f)).read()
        m = re.match(r'<!--(\{.*?\})-->\s*', src, re.S)
        meta = json.loads(m.group(1))
        open(os.path.join(DIST, f), 'w').write(shell(meta, src[m.end():]))
    # cache-bust our own css and js by content hash
    ver = {}
    for d in ('css', 'js'):
        for n in os.listdir(os.path.join(DIST, d)):
            ver[f'/{d}/{n}'] = hashlib.md5(open(os.path.join(DIST, d, n), 'rb').read()).hexdigest()[:8]
    for f in os.listdir(DIST):
        if f.endswith('.html'):
            fp = os.path.join(DIST, f); txt = open(fp).read()
            for p, h in ver.items():
                txt = txt.replace(f'"{p}"', f'"{p}?v={h}"')
            open(fp, 'w').write(txt)
    json.dump({
        'cleanUrls': True, 'trailingSlash': False,
        'rewrites': [{'source': '/coin/:addr', 'destination': '/coin'}],
        'headers': [{'source': '/(.*)', 'headers': [{'key': 'X-Content-Type-Options', 'value': 'nosniff'}, {'key': 'Referrer-Policy', 'value': 'strict-origin-when-cross-origin'}]},
                    {'source': '/img/(.*)', 'headers': [{'key': 'Cache-Control', 'value': 'public, max-age=86400'}]}],
    }, open(os.path.join(DIST, 'vercel.json'), 'w'), indent=1)
    print('built ->', DIST, sorted(os.listdir(DIST)))


if __name__ == '__main__':
    build()
