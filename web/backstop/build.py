#!/usr/bin/env python3
"""Build the Etherhook site: wrap each page in the shared shell and write dist/.

    python3 build.py preview   # Ethereum mainnet reads, sample strategy coins, launches closed
"""
import hashlib, json, os, re, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.join(HERE, 'site')
DIST = os.path.join(HERE, 'dist')
MODE = sys.argv[1] if len(sys.argv) > 1 else 'preview'
DESC = 'Launch a coin on Ethereum with a strategy built in: a vault that backs every coin, buybacks on every 20% dip, burns from take-profit, and redeem at backing.'
SITE_URL = os.environ.get('SITE_URL', 'https://etherhook.fun').rstrip('/')

FONTS = 'https://fonts.googleapis.com/css2?family=Lilita+One&family=Archivo:wdth,wght@62..125,400..900&family=JetBrains+Mono:wght@400;500;600&family=Public+Sans:wght@400;500;600;700&display=swap'
NAV = [('explore', '/', 'Explore'), ('launch', '/launch', 'Launch'), ('portfolio', '/portfolio', 'Portfolio'), ('docs', '/docs', 'How it works')]
ICON = {
    'compass': '<circle cx="12" cy="12" r="10"/><path d="m16.24 7.76-2.12 6.36-6.36 2.12 2.12-6.36z"/>',
    'wallet': '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
    'book': '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
    'plus': '<path d="M5 12h14M12 5v14"/>',
    'search': '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
}
# the mark: a price line that dips onto a bar and recovers; colours come from the theme
MARK = '<img class="mark" src="/img/logo.png" alt="" width="20" height="34">'
WORDMARK = '<b class="wm"><i>ether</i>hook</b>'
ETH_GLYPH = '<svg viewBox="0 0 10 16" aria-hidden="true"><path d="M5 0 0 8.1 5 11l5-2.9z" fill="currentColor" opacity=".55"/><path d="M5 12 0 9.1 5 16l5-6.9z" fill="currentColor"/></svg>'


def ic(n):
    return f'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{ICON[n]}</svg>'


def deployed():
    # live addresses from the mainnet deploy record, when the repo has it
    p = os.environ.get('DEPLOY_JSON') or os.path.join(HERE, '..', '..', 'contracts', 'deployments', 'eth-backstop.json')
    if not os.path.exists(p):
        return {}
    d = json.load(open(p)); c = d['contracts']
    out = {k: c[k] for k in ('factory', 'router', 'hook', 'oracle') if k in c}
    if d.get('deployBlock'):
        out['deployBlock'] = d['deployBlock']
    return out


def config():
    tokens = json.load(open(os.path.join(HERE, 'tokens.json')))
    cfg = {
        'chainId': 1, 'chainName': 'Ethereum', 'explorer': 'https://etherscan.io',
        'rpcs': os.environ['RPCS'].split(',') if os.environ.get('RPCS') else ['https://ethereum-rpc.publicnode.com', 'https://rpc.mevblocker.io', 'https://mainnet.gateway.tenderly.co', 'https://eth-pokt.nodies.app', 'https://ethereum.publicnode.com'],
        'weth': '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', 'usdc': '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        'ethUsdFeed': '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419', 'poolManager': '0x000000000004444c5dc75cB358380D2e3dE08A90',
        'uniV2Factory': '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f', 'uniV3Factory': '0x1F98431c8aD98523631AE4a59f267346ea31F984',
        'contracts': deployed(), 'prelaunch': not deployed().get('factory'),
        'deployBlock': deployed().get('deployBlock', 0), 'blockscout': os.environ.get('BLOCKSCOUT', 'https://eth.blockscout.com'),
        'admin': os.environ.get('ADMIN', '0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b'),
        'reownProjectId': os.environ.get('REOWN_PROJECT_ID', '5b1ae833abd22d348cbf5d53cf58b3b2'),
        'startCap': 5000, 'minDepth': 10000, 'launchGas': 4200000,
        'tokens': tokens, 'social': {},
    }
    return 'window.BACKSTOP = ' + json.dumps(cfg, separators=(',', ':')) + ';\n'


def shell(meta, body):
    nav = meta.get('nav', '')
    links = ''.join(f'<a href="{href}" class="{"on" if key == nav else ""}">{label}</a>' for key, href, label in NAV)
    links += f'<a href="/admin" class="hidden {"on" if nav == "admin" else ""}" data-admin-link>Admin</a>'
    tabbar = (f'<a href="/" class="{"on" if nav == "explore" else ""}">{ic("compass")}Explore</a>'
              f'<a href="/launch" class="{"on" if nav == "launch" else ""}">{ic("plus")}Launch</a>'
              f'<a href="/portfolio" class="{"on" if nav == "portfolio" else ""}">{ic("wallet")}Portfolio</a>'
              f'<a href="/docs" class="{"on" if nav == "docs" else ""}">{ic("book")}Docs</a>')
    title = meta['title']
    desc = meta.get('desc', DESC)
    scripts = ''.join(f'<script src="/js/{s}" defer></script>' for s in meta.get('scripts', []))
    vendor = ''.join(f'<script src="/vendor/{s}" defer></script>' for s in meta.get('vendor', [])) + meta.get('head', '')
    return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{title}</title>
<meta name="description" content="{desc}">
<meta name="theme-color" content="#eef1f4" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0a0f17" media="(prefers-color-scheme: dark)">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:url" content="{SITE_URL}">
<meta property="og:image" content="{SITE_URL}/img/og.png">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Etherhook">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{title}">
<meta name="twitter:description" content="{desc}">
<meta name="twitter:image" content="{SITE_URL}/img/og.png">
<link rel="apple-touch-icon" href="/img/apple-touch-icon.png">
<link rel="icon" href="/img/favicon-32.png" type="image/png" sizes="32x32">
<link rel="icon" href="/img/favicon-64.png" type="image/png" sizes="64x64">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="{FONTS}">
<link rel="stylesheet" href="/css/app.css">
<script>try{{var t=localStorage.getItem('bs:theme');if(t)document.documentElement.dataset.theme=t}}catch(e){{}}</script>
<script src="/config.js"></script>
{vendor}<script src="/js/ui.js" defer></script>
<script src="/js/bs.js" defer></script>
<script src="/js/wallet.js" defer></script>
{scripts}
</head>
<body>
<header class="top">
  <div class="top-in">
    <a class="brand" href="/" aria-label="Etherhook home">{MARK}{WORDMARK}</a>
    <nav class="nav" aria-label="Main">{links}</nav>
    <div class="top-r">
      <button class="search-trigger" data-search aria-label="Search coins">{ic("search")}<span>Search coins or paste an address</span><kbd>/</kbd></button>
      <span class="net" title="Ethereum mainnet">{ETH_GLYPH}<span>Ethereum</span></span>
      <button class="icon-btn" data-theme-btn aria-label="Theme"></button>
      <button class="btn btn-ink wallet-btn" data-wallet-btn>Connect</button>
    </div>
  </div>
</header>
<main class="page" id="page">
{body}
</main>
<footer class="foot">
  <div class="foot-in">
    <a class="brand" href="/" aria-label="Etherhook home">{MARK}{WORDMARK}</a>
    <nav aria-label="Footer"><a href="/docs">How it works</a><a href="/docs#faq">FAQ</a><a href="/launch">Launch</a></nav>
  </div>
</footer>
<nav class="tabbar" aria-label="Main">{tabbar}</nav>
</body>
</html>
'''


def build():
    if os.path.exists(DIST):
        shutil.rmtree(DIST)
    os.makedirs(DIST)
    for d in ('css', 'js', 'img'):
        shutil.copytree(os.path.join(SITE, d), os.path.join(DIST, d))
    # TradingView Advanced Charts: the same library as the Inkypump site (web/replica), with Etherhook's theme
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
                    {'source': '/(img|vendor)/(.*)', 'headers': [{'key': 'Cache-Control', 'value': 'public, max-age=86400'}]}],
    }, open(os.path.join(DIST, 'vercel.json'), 'w'), indent=1)
    print('built', MODE, '->', DIST, sorted(os.listdir(DIST)))


if __name__ == '__main__':
    build()
