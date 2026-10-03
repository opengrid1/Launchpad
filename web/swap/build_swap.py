#!/usr/bin/env python3
"""Build the Inkypump Swap site (swap.inkypump.fun) from the same o1 shell as the launchpad.
Run from this folder: python3 build_swap.py"""
import re, copy, os, json
from bs4 import BeautifulSoup, NavigableString

# reuse the launchpad build helpers (stylesheet, icons, shell cleanup, clean-url rules)
_helpers = open('../site2/build2.py').read().split('# TOKEN PAGE')[0]
exec(compile(_helpers, 'build2-helpers', 'exec'))

HEAD = HEAD.replace('<link rel="stylesheet" href="o1.css"><link rel="stylesheet" href="extra.css">', '<link rel="stylesheet" href="o1.css"><link rel="stylesheet" href="extra.css"><link rel="stylesheet" href="swap.css">')
HEAD = HEAD.replace('https://inkypump.fun/img/og.png', 'https://swap.inkypump.fun/img/og.png')
CLEAN = {'index.html': '/', 'pools.html': '/pools', 'liquidity.html': '/liquidity', 'stake.html': '/stake', 'profile.html': '/liquidity'}
def clean_url(h):
    if h == '' or re.match(r'^(https?:|//|#|mailto:|data:|javascript:|blob:)', h): return h
    base = re.split(r'[#?]', h, 1)[0]; tail = h[len(base):]
    if base in CLEAN: return CLEAN[base] + tail
    return ('/' + base if not base.startswith('/') else base) + tail
def absolutize(html):
    return re.sub(r'\b(src|href|data-href|data-go)="([^"]*)"', lambda m: '%s="%s"' % (m.group(1), clean_url(m.group(2))), html)

NAV = {'Dashboard': ('Swap', 'index.html', None), 'Profile': ('Pools', 'pools.html', 'grid'), 'Cooking': ('Stake', 'stake.html', 'coins'), 'Staking': ('Launchpad', 'https://www.inkypump.fun', 'rocket'),
       'Search': ('Pools', 'pools.html', 'grid'), 'Launch Token': ('Add liquidity', 'liquidity.html', None), 'Leaderboard': ('Stake', 'stake.html', 'coins')}
ICONS = {'__CHEV__': svg('chev', 'lucide-chevron-down size-4'), '__INFO__': svg('info', 'lucide-info h-3 w-3 cursor-help text-text-muted'), '__FLIP__': svg('arrowdown', 'lucide-arrow-down size-4'),
         '__PLUS__': svg('plus', 'lucide-plus size-4'), '__COINS__': svg('coins', 'lucide-hand-coins size-4'), '__LOCK__': svg('lock', 'lucide-lock size-3'), '__CHECK__': svg('check', 'lucide-check size-3'),
         '__ROCKET__': svg('rocket', 'lucide-rocket size-4'), '__SHIELD__': svg('shield', 'lucide-shield-check size-4'), '__ZAP__': svg('zap', 'lucide-zap size-4'), '__GRID__': svg('grid', 'lucide-grid size-4'),
         '__EXT__': svg('ext', 'lucide-external-link size-3'), '__SPARK__': svg('sparkle', 'lucide-sparkles size-4'), '__SETTINGS__': svg('settings', 'lucide-settings size-4'), '__SEARCH__': svg('search', 'lucide-search size-4'), '__WALLET__': svg('wallet', 'lucide-wallet size-4')}

def shell(active):
    t = load('o1-token.html'); r = t.select_one('div.flex.h-dvh'); common_clean(r); kill(r.select_one('section'))
    # nav labels + links
    for b in r.select('header nav button, nav.h-14 > button, header .hidden.sm\\:block > button'):
        label = b.get_text(' ', strip=True)
        if label not in NAV: continue
        name, href, icon = NAV[label]
        if icon:
            for s_ in b.select('svg'): s_.decompose()
            b.insert(0, frag(svg(icon, 'lucide size-4')))
        direct = [n for n in b.find_all(string=True, recursive=False) if n.strip()]
        if direct: direct[0].replace_with(name)
        else:
            sp = next((x for x in b.select('span') if x.get_text(strip=True) and not x.get('aria-hidden')), None)
            (settext(sp, name) if sp else settext(b, name))
        b['data-href'] = href
    # the pink header CTA: keep its icon span, swap the text node
    for b in r.select('header button'):
        if b.get_text(' ', strip=True) == 'Launch Token':
            for n in b.find_all(string=True, recursive=False):
                if n.strip(): n.replace_with('Add liquidity')
            b['data-href'] = 'liquidity.html'
    # mobile bottom nav: Swap · Pools · Add · Stake · Positions
    for b in r.select('nav.h-14 > button'):
        label = b.get_text(' ', strip=True)
        if label == 'Add liquidity':
            for sp in b.select('span'):
                if sp.get_text(strip=True) == 'Add liquidity': settext(sp, 'Add')
        if label == 'Pools' and b is r.select('nav.h-14 > button')[-1]:
            for s_ in b.select('svg'): s_.decompose()
            b.insert(0, frag(svg('coins', 'lucide size-4')))
            sp = b.select_one('span'); (settext(sp, 'Positions') if sp else settext(b, 'Positions')); b['data-href'] = 'liquidity.html'
    # brand pill
    for sp in r.select('button[aria-label="Launchpad"] span.max-sm\\:hidden'):
        sp.insert_after(frag('<span class="sw-pill">Swap</span>'))
    for b in r.select('button[aria-label="Launchpad"]'): b['aria-label'] = 'Inkypump'
    # header search -> token search (handled by swapapp.js)
    for b in r.select('header button.flex.h-9.w-full'): b['data-href'] = '#search'
    dev = r.select_one('header button[aria-label="Developers"]')
    if dev: dev['data-href'] = 'https://www.inkypump.fun/docs/direct-integration'
    # active state
    on = 'bg-accent/15 font-semibold text-accent'.split(); off = 'font-medium text-text-secondary hover:bg-bg-card-hover hover:text-text-primary'.split()
    for b in r.select('header nav button'):
        b['class'] = [c for c in b['class'] if c not in on + off] + (on if b.get_text(' ', strip=True) == active else off)
    for b in r.select('nav.h-14 > button'):
        txt = b.get_text(' ', strip=True)
        if txt == 'Add liquidity': continue
        b['class'] = [c for c in b['class'] if c not in ('text-accent', 'text-text-muted', 'hover:text-text-primary')] + (['text-accent'] if txt == active else ['text-text-muted', 'hover:text-text-primary'])
    # drop the history sub bar
    sub = r.select_one('header ~ div')
    if sub: sub.decompose()
    r['id'] = 'app'
    return r

def page_shell(root, title, desc):
    return absolutize('''<!doctype html>
<html lang="en" translate="no" dir="ltr">
<head><title>%s</title><meta name="description" content="%s">%s<style id="prehide">main{visibility:hidden}</style></head>
<body data-dynamic-theme="dark" data-dynamic-theme-brand="bold">
%s
<script>document.getElementById('prehide').remove()</script>
<script src="config.js"></script><script src="data.js"></script><script src="avatar.js"></script><script src="i18n.js"></script><script src="app.js"></script><script src="swapapp.js"></script><script src="wallet.js" defer></script>
</body></html>''' % (title, desc, HEAD, str(root)))

def build(name, title, desc, active):
    r = shell(active)
    m = r.select_one('main'); inner = m.select_one('div.relative.z-\\[1\\]'); inner.clear()
    body = open('pages/' + name).read()
    for k, v in ICONS.items(): body = body.replace(k, v)
    inner.append(BeautifulSoup(body, 'html.parser'))
    r.append(frag('<div id="layer"></div>'))
    open(name, 'w').write(page_shell(r, title, desc)); print(name, 'ok')

build('index.html', 'Inkypump Swap', 'Swap any token on Ink. Fees go to $INKY stakers.', 'Swap')
build('pools.html', 'Pools | Inkypump Swap', 'Liquidity pools on Inkypump Swap: TVL, volume and fees.', 'Pools')
build('liquidity.html', 'Liquidity | Inkypump Swap', 'Add or remove liquidity on Inkypump Swap.', 'Add liquidity')
build('stake.html', 'Stake INKY | Inkypump Swap', 'Stake $INKY and earn the swap fees from every trade on Ink.', 'Stake')
open('vercel.json', 'w').write(json.dumps({'cleanUrls': True, 'trailingSlash': False,
    'redirects': [{'source': '/swap', 'destination': '/', 'permanent': False}, {'source': '/profile', 'destination': '/liquidity', 'permanent': False}],
    'headers': [{'source': '/(.*)', 'headers': [{'key': 'X-Content-Type-Options', 'value': 'nosniff'}]}, {'source': '/(app|swapapp|wallet|avatar|i18n|data).js', 'headers': [{'key': 'Cache-Control', 'value': 'public, max-age=0, must-revalidate'}]}]}, indent=1))
print('vercel.json ok')
