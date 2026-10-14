#!/usr/bin/env python3
"""Build the Splice site: wrap each page in the shared shell and write dist/.

    python3 build.py              # preview: sample coins (contracts not deployed yet)

Splice is a launchpad on Base where every coin is spliced from composable on-chain
"genes" (fee, anti-snipe, buyback, dividends, MEV-tax, max-wallet, agent). One immutable
hook enforces a constitution no gene can break; each launch picks the genes it wants.
"""
import hashlib, json, os, re, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.join(HERE, 'site')
DIST = os.path.join(HERE, 'dist')
SITE_URL = os.environ.get('SITE_URL', 'https://splice.fun').rstrip('/')
X_HANDLE = os.environ.get('X_HANDLE', 'splicefun')
DESC = 'Launch a coin on Base spliced from composable on-chain genes — anti-snipe, buyback, dividends, MEV-tax, max-wallet, an optional AI agent. One immutable hook, a constitution no gene can break.'

FONTS = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700;12..96,800&family=Instrument+Sans:wght@400;500;600;700&family=Martian+Mono:wght@400;500;600&display=swap'
NAV = [('explore', '/', 'Explore'), ('launch', '/launch', 'Launch'), ('portfolio', '/portfolio', 'Portfolio'), ('docs', '/docs', 'Docs')]

# the mark: a double-helix "S" splice glyph, inline so no image fetch
MARK = ('<svg class="mark" viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">'
        '<path d="M8 5c0 6 16 6 16 11S8 21 8 27" fill="none" stroke="var(--accent)" stroke-width="2.4" stroke-linecap="round"/>'
        '<path d="M24 5c0 6-16 6-16 11s16 5 16 11" fill="none" stroke="var(--ink)" stroke-width="2.4" stroke-linecap="round" opacity=".55"/>'
        '<g stroke="var(--accent)" stroke-width="1.6" stroke-linecap="round" opacity=".8">'
        '<path d="M10.5 8.5h11"/><path d="M11.5 12h9"/><path d="M11.5 20h9"/><path d="M10.5 23.5h11"/></g></svg>')
WORDMARK = '<b class="wm">splice<i>.fun</i></b>'
X_GLYPH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18.9 2H22l-6.8 7.8L23 22h-6.2l-4.9-6.4L6.3 22H3.2l7.3-8.3L1 2h6.3l4.4 5.9L18.9 2Zm-1.1 18.1h1.7L6.3 3.8H4.5l13.3 16.3Z"/></svg>'
ETH_GLYPH = '<svg viewBox="0 0 10 16" aria-hidden="true"><path d="M5 0 0 8.1 5 11l5-2.9z" fill="currentColor" opacity=".55"/><path d="M5 12 0 9.1 5 16l5-6.9z" fill="currentColor"/></svg>'
ICON = {
    'search': '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    'menu': '<path d="M3 12h18M3 6h18M3 18h18"/>',
}


def ic(n):
    return f'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{ICON[n]}</svg>'


def config():
    cfg = {
        'chainId': 8453, 'chainName': 'Base', 'explorer': 'https://basescan.org',
        'rpcs': os.environ['RPCS'].split(',') if os.environ.get('RPCS') else ['https://base-rpc.publicnode.com', 'https://mainnet.base.org'],
        'weth': '0x4200000000000000000000000000000000000006',
        'poolManager': '0x498581fF718922c3f8e6A244956aF099B2652b2b',
        'contracts': {}, 'prelaunch': True,
        'admin': os.environ.get('ADMIN', '0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b'),
        'reownProjectId': os.environ.get('REOWN_PROJECT_ID', '5b1ae833abd22d348cbf5d53cf58b3b2'),
        'taxBps': 100, 'split': {'creator': 60, 'platform': 40},
        'social': {'x': X_HANDLE and f'https://x.com/{X_HANDLE}'},
    }
    return 'window.SPLICE = ' + json.dumps(cfg, separators=(',', ':')) + ';\n'


def shell(meta, body):
    nav = meta.get('nav', '')
    links = ''.join(f'<a href="{href}" class="navlink {"on" if key == nav else ""}">{label}</a>' for key, href, label in NAV)
    title = meta['title']
    desc = meta.get('desc', DESC)
    scripts = ''.join(f'<script src="/js/{s}" defer></script>' for s in meta.get('scripts', []))
    head = meta.get('head', '')
    x_link = f'<a class="iconbtn x-link" href="https://x.com/{X_HANDLE}" target="_blank" rel="noopener" aria-label="Splice on X">{X_GLYPH}</a>' if X_HANDLE else ''
    x_foot = f'<a href="https://x.com/{X_HANDLE}" target="_blank" rel="noopener">@{X_HANDLE}</a>' if X_HANDLE else ''
    x_meta = f'<meta name="twitter:site" content="@{X_HANDLE}">' if X_HANDLE else ''
    return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{title}</title>
<meta name="description" content="{desc}">
<meta name="theme-color" content="#0b0e11">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:url" content="{SITE_URL}">
<meta property="og:image" content="{SITE_URL}/img/og.png">
<meta property="og:type" content="website">
<meta property="og:site_name" content="splice.fun">
<meta name="twitter:card" content="summary_large_image">
{x_meta}
<meta name="twitter:title" content="{title}">
<meta name="twitter:description" content="{desc}">
<meta name="twitter:image" content="{SITE_URL}/img/og.png">
<link rel="icon" href="/img/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="{FONTS}">
<link rel="stylesheet" href="/css/app.css">
<script src="/config.js"></script>
<script src="/js/ui.js" defer></script>
<script src="/js/data.js" defer></script>
{scripts}
{head}
</head>
<body>
<header class="top">
  <div class="top-in">
    <a class="brand" href="/" aria-label="splice.fun home">{MARK}{WORDMARK}</a>
    <nav class="nav" aria-label="Main">{links}</nav>
    <div class="top-r">
      <button class="iconbtn" data-search aria-label="Search coins">{ic("search")}</button>
      <button class="iconbtn" data-theme-btn aria-label="Toggle theme"></button>
      {x_link}
      <button class="btn accent connect" data-connect>Connect</button>
      <button class="iconbtn navtoggle" data-nav-btn aria-label="Menu">{ic("menu")}</button>
    </div>
  </div>
</header>
<main class="page" id="page">
{body}
</main>
<footer class="foot">
  <div class="foot-in">
    <a class="brand sm" href="/">{MARK}{WORDMARK}</a>
    <span class="net">{ETH_GLYPH}Base</span>
    <nav aria-label="Footer"><a href="/docs">Docs</a><a href="/docs#genes">Genes</a><a href="/launch">Launch</a>{x_foot}</nav>
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
        src = os.path.join(SITE, d)
        if os.path.isdir(src):
            shutil.copytree(src, os.path.join(DIST, d))
    # TradingView Advanced Charts (shared library checked in under web/replica)
    lib = next(p for p in (os.environ.get('CHARTING_LIBRARY', ''), os.path.join(SITE, 'charting_library'), os.path.join(HERE, '..', 'replica', 'charting_library')) if p and os.path.isdir(p))
    shutil.copytree(lib, os.path.join(DIST, 'charting_library'))
    shutil.copy(os.path.join(SITE, 'tv-theme.css'), os.path.join(DIST, 'charting_library', 'tv-theme.css'))
    open(os.path.join(DIST, 'config.js'), 'w').write(config())
    for f in sorted(os.listdir(os.path.join(SITE, 'pages'))):
        src = open(os.path.join(SITE, 'pages', f)).read()
        m = re.match(r'<!--(\{.*?\})-->\s*', src, re.S)
        meta = json.loads(m.group(1))
        open(os.path.join(DIST, f), 'w').write(shell(meta, src[m.end():]))
    # cache-bust css/js by content hash
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
        'headers': [{'source': '/(.*)', 'headers': [{'key': 'X-Content-Type-Options', 'value': 'nosniff'}, {'key': 'Referrer-Policy', 'value': 'strict-origin-when-cross-origin'}]}],
    }, open(os.path.join(DIST, 'vercel.json'), 'w'), indent=1)
    print('built ->', DIST, sorted(os.listdir(DIST)))


if __name__ == '__main__':
    build()
