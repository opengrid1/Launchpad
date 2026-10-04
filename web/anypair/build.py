#!/usr/bin/env python3
"""Build the Anypair site: wrap each page in the shared shell and write dist/.

    python3 build.py fork   # local Base fork (127.0.0.1:8545), deployment from ../anypair-fork.json
    python3 build.py live   # Base mainnet, deployment from DEPLOY (contracts/deployments/base-anypair.json)
"""
import json, os, re, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.join(HERE, 'site')
DIST = os.path.join(HERE, 'dist')
MODE = sys.argv[1] if len(sys.argv) > 1 else 'fork'
DESC = 'Launch a coin on Base paired with any asset. Holders earn from every trade, paid in any assets the creator picks: ETH, stablecoins, BTC, real-world assets or any token.'
SITE_URL = os.environ.get('SITE_URL', 'https://anypair-tau.vercel.app').rstrip('/')

FONTS = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500..800&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap'
NAV = [('explore', '/', 'compass', 'Explore'), ('portfolio', '/portfolio', 'wallet', 'Portfolio'), ('docs', '/docs', 'book', 'How it works')]
ICON = {
    'compass': '<circle cx="12" cy="12" r="10"/><path d="m16.24 7.76-2.12 6.36-6.36 2.12 2.12-6.36z"/>',
    'wallet': '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
    'book': '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
    'plus': '<path d="M5 12h14M12 5v14"/>',
    'search': '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    'shield': '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
    'x': '<path fill="currentColor" stroke="none" d="M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.77zm-1.08 16.18h1.7L7.4 4.73H5.58z"/>',
}
LOGO = '<img src="/img/mark.svg" alt="" width="34" height="34">'


def ic(n):
    return f'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{ICON[n]}</svg>'


def config():
    tokens = json.load(open(os.path.join(HERE, 'tokens.json')))
    if MODE == 'preview':
        cfg = {'chainId': 8453, 'rpc': 'https://mainnet.base.org', 'rpcs': ['https://base-rpc.publicnode.com', 'https://base.drpc.org'], 'blockscout': 'https://base.blockscout.com', 'logSpan': 9000, 'prelaunch': True, 'demo': True,
               'contracts': {}, 'deployBlock': 1, 'admin': '', 'explorer': 'https://basescan.org', 'weth': '0x4200000000000000000000000000000000000006', 'usdc': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
               'reownProjectId': os.environ.get('REOWN_PROJECT_ID', '5b1ae833abd22d348cbf5d53cf58b3b2'), 'tokens': tokens, 'social': {'x': 'https://x.com/anypairfun'}}
        return 'window.ANYPAIR = ' + json.dumps(cfg, separators=(',', ':')) + ';\n'
    if MODE == 'fork':
        dep = json.load(open(os.environ.get('DEPLOY', os.path.join(HERE, '..', 'anypair-fork.json'))))
        cfg = {'chainId': 8453, 'rpc': 'http://127.0.0.1:8545', 'rpcs': [], 'blockscout': '', 'logSpan': 100000, 'injectedOnly': True, 'exactTimes': True}
    else:
        dep = json.load(open(os.environ.get('DEPLOY', '/home/user/Launchpad/contracts/deployments/base-anypair.json')))
        cfg = {'chainId': 8453, 'rpc': 'https://mainnet.base.org', 'rpcs': ['https://base-rpc.publicnode.com', 'https://base.drpc.org'], 'blockscout': 'https://base.blockscout.com', 'logSpan': 9000}
    c = dep['contracts']
    cfg.update({
        'contracts': {k: c[k] for k in ('factory', 'oracle', 'router', 'hook', 'tokenDeployer')},
        'deployBlock': dep.get('deployBlock', 1), 'admin': dep['admin'], 'explorer': 'https://basescan.org',
        'weth': '0x4200000000000000000000000000000000000006', 'usdc': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        'reownProjectId': os.environ.get('REOWN_PROJECT_ID', '5b1ae833abd22d348cbf5d53cf58b3b2'),
        'tokens': tokens, 'social': {'x': 'https://x.com/anypairfun'},
    })
    return 'window.ANYPAIR = ' + json.dumps(cfg, separators=(',', ':')) + ';\n'


def shell(meta, body):
    nav = meta.get('nav', '')
    links = ''.join(f'<a href="{href}" class="{"on" if key == nav else ""}">{ic(icon)}<span>{label}</span></a>' for key, href, icon, label in NAV)
    links += f'<a href="/admin" class="hidden {"on" if nav == "admin" else ""}" data-admin-link>{ic("shield")}<span>Admin</span></a>'
    links += f'<a href="/launch" class="launch-cta {"on" if nav == "launch" else ""}">{ic("plus")}<span>Launch a coin</span></a>'
    tabbar = (f'<a href="/" class="{"on" if nav == "explore" else ""}">{ic("compass")}Explore</a>'
              f'<a href="/launch" class="{"on" if nav == "launch" else ""}">{ic("plus")}Launch</a>'
              f'<a href="/portfolio" class="{"on" if nav == "portfolio" else ""}">{ic("wallet")}Portfolio</a>'
              f'<a href="/docs" class="{"on" if nav == "docs" else ""}">{ic("book")}Docs</a>')
    title = meta['title']
    scripts = ''.join(f'<script src="/js/{s}" defer></script>' for s in meta.get('scripts', []))
    vendor = ''.join(f'<script src="/vendor/{s}" defer></script>' for s in meta.get('vendor', [])) + meta.get('head', '')
    return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{title}</title>
<meta name="description" content="{meta.get('desc', DESC)}">
<meta name="theme-color" content="#f4f4f1">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{meta.get('desc', DESC)}">
<meta property="og:url" content="{SITE_URL}">
<meta name="twitter:title" content="{title}">
<meta name="twitter:description" content="{meta.get('desc', DESC)}">
<meta property="og:image" content="{SITE_URL}/img/og.png">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Anypair">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="{SITE_URL}/img/og.png">
<link rel="apple-touch-icon" href="/img/apple-touch-icon.png">
<link rel="icon" href="/img/favicon-64.png" type="image/png" sizes="64x64">
<link rel="icon" href="/img/icon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="{FONTS}">
<link rel="stylesheet" href="/css/app.css">
<script>try{{var t=localStorage.getItem('ap:theme');if(t)document.documentElement.dataset.theme=t}}catch(e){{}}</script>
<script src="/config.js"></script>
{vendor}<script src="/js/ui.js" defer></script>
<script src="/js/chain.js" defer></script>
<script src="/js/wallet.js" defer></script>
{scripts}
</head>
<body>
<div class="shell">
  <aside class="side">
    <a class="brand" href="/" aria-label="Anypair home">{LOGO}<b>any<span>pair</span></b></a>
    <nav class="nav" aria-label="Main">{links}</nav>
    <div><div class="side-h">Browse by pair</div><div class="pairs-nav" id="pairsNav"></div></div>
    <div class="side-foot">
      <div class="row"><button class="icon-btn" data-theme-btn aria-label="Theme"></button><a class="icon-btn" href="https://x.com/anypairfun" target="_blank" rel="noopener" aria-label="X">{ic("x")}</a></div>
      <small>Coins on Base, paired with any token. 2% fee on every trade.</small>
    </div>
  </aside>
  <div class="main">
    <header class="top">
      <a class="m-brand" href="/" aria-label="Anypair home">{LOGO}</a>
      <button class="search-trigger" data-search aria-label="Search">{ic("search")}<span>Search coins, tickers, addresses</span><kbd>/</kbd></button>
      <div class="top-right"><span class="net"><i></i>Base</span><button class="icon-btn m-theme hidden" data-theme-btn></button><button class="btn btn-ink wallet-btn" data-wallet-btn>Connect</button></div>
    </header>
    <main class="page" id="page">
{body}
    </main>
  </div>
</div>
<nav class="tabbar" aria-label="Main">{tabbar}</nav>
</body>
</html>
'''


def build():
    if os.path.exists(DIST):
        shutil.rmtree(DIST)
    os.makedirs(DIST)
    for d in ('css', 'js', 'img', 'vendor'):
        shutil.copytree(os.path.join(SITE, d), os.path.join(DIST, d))
    # TradingView Advanced Charts: the same library as the Inkypump site (web/replica), with Anypair's theme
    lib = next(p for p in (os.environ.get('CHARTING_LIBRARY', ''), os.path.join(SITE, 'charting_library'), os.path.join(HERE, '..', 'replica', 'charting_library')) if p and os.path.isdir(p))
    shutil.copytree(lib, os.path.join(DIST, 'charting_library'))
    shutil.copy(os.path.join(SITE, 'tv-theme.css'), os.path.join(DIST, 'charting_library', 'tv-theme.css'))
    open(os.path.join(DIST, 'config.js'), 'w').write(config())
    if MODE == 'preview' and os.path.exists(os.path.join(SITE, 'demo.json')):
        shutil.copy(os.path.join(SITE, 'demo.json'), os.path.join(DIST, 'demo.json'))
    for f in sorted(os.listdir(os.path.join(SITE, 'pages'))):
        src = open(os.path.join(SITE, 'pages', f)).read()
        m = re.match(r'<!--(\{.*?\})-->\s*', src, re.S)
        meta = json.loads(m.group(1))
        open(os.path.join(DIST, f), 'w').write(shell(meta, src[m.end():]))
    # brand images change: give them a content version so browsers never show an old logo
    import hashlib
    ver = {n: hashlib.md5(open(os.path.join(DIST, 'img', n), 'rb').read()).hexdigest()[:8] for n in ('mark.svg', 'icon.svg', 'favicon-64.png', 'apple-touch-icon.png', 'og.png', 'icon-192.png', 'logo-512.png')}
    for root, _, files in os.walk(DIST):
        for f in files:
            if not f.endswith(('.html', '.js')) or 'charting_library' in root or f in ('chain.js', 'wallet.js'):
                continue
            fp = os.path.join(root, f); txt = open(fp).read(); new = txt
            for n, h in ver.items():
                new = new.replace('/img/' + n + '"', '/img/' + n + '?v=' + h + '"').replace("/img/" + n + "'", "/img/" + n + "?v=" + h + "'")
            if new != txt:
                open(fp, 'w').write(new)
    json.dump({
        'cleanUrls': True, 'trailingSlash': False,
        'rewrites': [{'source': '/coin/:addr', 'destination': '/coin'}],
        'headers': [{'source': '/(.*)', 'headers': [{'key': 'X-Content-Type-Options', 'value': 'nosniff'}, {'key': 'Referrer-Policy', 'value': 'strict-origin-when-cross-origin'}]},
                    {'source': '/(img|vendor)/(.*)', 'headers': [{'key': 'Cache-Control', 'value': 'public, max-age=86400'}]}],
    }, open(os.path.join(DIST, 'vercel.json'), 'w'), indent=1)
    print('built', MODE, '->', DIST, sorted(os.listdir(DIST)))


if __name__ == '__main__':
    build()
