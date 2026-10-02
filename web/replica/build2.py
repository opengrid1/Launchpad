#!/usr/bin/env python3
"""Build the replica pages from o1's captured markup + compiled stylesheet, re-skinned with our palette."""
import re, copy, os
from bs4 import BeautifulSoup, NavigableString

REF = '../ref/'
OUT = '.'

# ---------- stylesheet ----------
css = open(REF + 'o1-real.css').read()
OVERRIDE = '''
/* ===== our palette + hosted fonts (everything else is o1's compiled stylesheet, untouched) ===== */
:root,:host{
  --font-sans:"Geist",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  --font-geist:"Geist",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  --font-mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
  --color-bg-primary:#0a0c11;--color-bg-card:#0e1117;--color-bg-card-deep:#0a0c11;--color-bg-hover:#131720;--color-bg-card-hover:#161b25;
  --color-bg-selector-hover:#222837;--color-bg-input:#1a1f2a;--color-bg-tile:#222837;--color-bg-raised:#262d3c;--color-bg-elevated:#222837;
  --color-border-default:#1e2430;--color-border-hover:#2a3140;--color-border-strong:#2a3140;
  --color-accent:#ff4fa3;--color-accent-hover:#ff6fb5;--color-accent-2:#ff8cc6;--color-accent-ink:#1a0511;
  --color-text-primary:#f3f5f9;--color-text-secondary:#c3c9d6;--color-text-muted:#7c8498;--color-text-disabled:#4a5366;
  --color-tag-blue:#60a5fa;--color-tag-yellow:#f0b541;--color-success:#2fd36b;--color-success-soft:#2fd36b1a;--color-warning:#f0b541;--color-warning-soft:#f0b5411a;--color-burn:#fb923c;--color-error:#f24a5c;
}
.bg-avatar-gradient{background-image:linear-gradient(135deg,#232a36,#343d4c)}
'''
open(OUT + '/o1.css', 'w').write(css + OVERRIDE)

PRELAUNCH = True  # no sample numbers in the markup; app.js reveals the page once the empty states are in place
HEAD = '''<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="theme-color" content="#0a0c11">
<link rel="icon" href="img/favicon.ico" sizes="any"><link rel="icon" type="image/svg+xml" href="img/favicon.svg"><link rel="apple-touch-icon" href="img/apple-touch-icon.png">
<meta property="og:site_name" content="Inkypump"><meta property="og:type" content="website"><meta property="og:image" content="https://inkypump.fun/img/og.png"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="https://inkypump.fun/img/og.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@100..900&family=JetBrains+Mono:wght@100..800&family=Titan+One&display=swap" rel="stylesheet">
<link rel="stylesheet" href="o1.css"><link rel="stylesheet" href="extra.css">'''

# ---------- helpers ----------
def load(name):
    return BeautifulSoup(open(REF + name).read(), 'html.parser')

def collapse_svg(el):
    pass

def settext(el, text):
    """replace the first direct text node of el (or all text if none)"""
    for c in el.contents:
        if isinstance(c, NavigableString) and str(c).strip():
            c.replace_with(text); return
    el.string = text

def byexact(root, text, tag=None):
    n = root.find(string=lambda s: s and s.strip() == text)
    if n is None: raise SystemExit('text not found: ' + text)
    return n.parent if tag is None else n.find_parent(tag)

def kill(el):
    if el is not None: el.decompose()

def svg(name, cls):
    """lucide-style icons (24 viewBox, stroke 2)"""
    P = {
      'trophy': '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
      'book': '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
      'x': '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
      'check': '<path d="M20 6 9 17l-5-5"/>',
      'wallet': '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
      'crown': '<path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z"/><path d="M5 21h14"/>',
      'medal': '<path d="M7.21 15 2.66 7.14a2 2 0 0 1 .13-2.2L4.4 2.8A2 2 0 0 1 6 2h12a2 2 0 0 1 1.6.8l1.6 2.14a2 2 0 0 1 .14 2.2L16.79 15"/><path d="M11 12 5.12 2.2"/><path d="m13 12 5.88-9.8"/><path d="M8 7h8"/><circle cx="12" cy="17" r="5"/><path d="M12 18v-2h-.5"/>',
      'zap': '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
      'ext': '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
      'copy': '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
      'chev': '<path d="m6 9 6 6 6-6"/>',
      'search': '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
      'info': '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
      'settings': '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
      'camera': '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
      'maximize': '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
      'undo': '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>',
      'redo': '<path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"/>',
      'candle': '<path d="M9 5v4"/><rect width="4" height="6" x="7" y="9" rx="1"/><path d="M9 15v2"/><path d="M17 3v2"/><rect width="4" height="8" x="15" y="5" rx="1"/><path d="M17 13v3"/><path d="M3 3v16a2 2 0 0 0 2 2h16"/>',
      'indicators': '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="m19 9-5 5-4-4-3 3"/>',
      'crosshair': '<circle cx="12" cy="12" r="10"/><path d="M22 12h-4"/><path d="M6 12H2"/><path d="M12 6V2"/><path d="M12 22v-4"/>',
      'line': '<path d="M5 19 19 5"/><circle cx="5" cy="19" r="1.5"/><circle cx="19" cy="5" r="1.5"/>',
      'fib': '<path d="M3 5h18"/><path d="M3 10h18"/><path d="M3 14h18"/><path d="M3 19h18"/>',
      'shapes': '<path d="M8.3 10a.7.7 0 0 1-.626-1.079L11.4 3a.7.7 0 0 1 1.198-.043L16.3 8.9a.7.7 0 0 1-.572 1.1Z"/><rect x="3" y="14" width="7" height="7" rx="1"/><circle cx="17.5" cy="17.5" r="3.5"/>',
      'text': '<path d="M12 4v16"/><path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2"/><path d="M9 20h6"/>',
      'smile': '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" x2="9.01" y1="9" y2="9"/><line x1="15" x2="15.01" y1="9" y2="9"/>',
      'ruler': '<path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z"/><path d="m14.5 12.5 2-2"/><path d="m11.5 9.5 2-2"/><path d="m8.5 6.5 2-2"/><path d="m17.5 15.5 2-2"/>',
      'zoomin': '<circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="11" x2="11" y1="8" y2="14"/><line x1="8" x2="14" y1="11" y2="11"/>',
      'magnet': '<path d="m6 15-4-4 6.75-6.77a7.79 7.79 0 0 1 11 11L13 22l-4-4 6.39-6.36a2.14 2.14 0 0 0-3-3L6 15"/><path d="m5 8 4 4"/><path d="m12 15 4 4"/>',
      'lock': '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
      'eye': '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
      'trash': '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
      'pen': '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>',
      'up': '<path d="m18 15-6-6-6 6"/>',
      'plus': '<path d="M5 12h14"/><path d="M12 5v14"/>',
      'arrowdown': '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
      'coins': '<path d="M11 15h2a2 2 0 1 0 0-4h-3c-.6 0-1.1.2-1.4.6L3 17"/><path d="m7 21 1.6-1.4c.3-.4.8-.6 1.4-.6h4c1.1 0 2.1-.4 2.8-1.2l4.6-4.4a2 2 0 0 0-2.75-2.91l-4.2 3.9"/><path d="m2 16 6 6"/><circle cx="16" cy="9" r="2.9"/><circle cx="6" cy="5" r="3"/>',
      'eth': '<path d="M12 2 5.5 12.5 12 16l6.5-3.5z" fill="currentColor" stroke="none" opacity=".9"/><path d="m5.5 13.8 6.5 8.2 6.5-8.2L12 17.4z" fill="currentColor" stroke="none" opacity=".6"/>',
      'menu': '<line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/>',
      'home': '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
      'user': '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
      'logout': '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
      'globe': '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
      'shield': '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
      'grid': '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
      'rocket': '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
      'code': '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',
      'bell': '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>',
      'hist': '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
      'flame': '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
      'sort': '<path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/>',
      'sparkle': '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide %s" aria-hidden="true">%s</svg>' % (cls, P[name])

def frag(html):
    soup = BeautifulSoup(html, 'html.parser')
    tags = [c for c in soup.contents if getattr(c, 'name', None)]
    return tags[0] if len(tags) == 1 and len([c for c in soup.contents if str(c).strip()]) == 1 else soup
def appendall(el, html):
    for c in list(BeautifulSoup(html, 'html.parser').contents): el.append(c)

BRAND_ICON = '<img src="img/logo.svg" alt="Inkypump" width="26" height="26" class="size-[26px] shrink-0 rounded-lg">'
INK_BADGE = '<img alt="Ink" class="size-full object-cover" src="img/ink.png">'

def common_clean(root):
    for t in root.select('script, style, noscript, iframe'): t.decompose()
    for t in root.find_all(True):
        for a in list(t.attrs):
            if a.startswith('data-base-ui') or a in ('id',) and str(t.get('id','')).startswith('base-ui'):
                del t.attrs[a]
    # brand
    img = root.select_one('img[alt="o1"]')
    if img: img.replace_with(frag(BRAND_ICON))
    for sp in root.select('button[aria-label="Launchpad"] span.max-sm\\:hidden'):
        sp.string = 'Inkypump'
    # avatar images: drop, keep the letter
    for img in root.select('img.object-cover'):
        if 'size-full' in img.get('class', []) and img.parent.name == 'span' and 'size-3' in img.parent.get('class', []):
            img.replace_with(frag(INK_BADGE))          # tiny chain badge on asset pills
        else:
            img.decompose()
    for img in root.select('img'):
        cls = ' '.join(img.get('class', []))
        if img.get('src', '').startswith('img/'):
            continue
        if 'rounded-full' in cls:
            img.replace_with(frag('<img alt="Ink" class="%s" src="img/ink.png">' % cls))
        else:
            img.decompose()

def set_nav(root):
    """header nav + mobile nav: Cooking -> Leaderboard, Staking -> Docs; make them links"""
    page_of = {'Dashboard': 'index.html', 'Profile': 'portfolio.html', 'Cooking': 'leaderboard.html', 'Staking': 'docs/introduction.html', 'Search': '#search', 'Launch Token': 'launch.html', 'Leaderboard': 'leaderboard.html', 'Docs': 'docs.html'}
    for b in root.select('header nav button, nav.h-14 > button, header .hidden.sm\\:block > button'):
        label = b.get_text(' ', strip=True)
        if label == 'Cooking':
            for s in b.select('svg'): s.decompose()
            b.insert(0, frag(svg('trophy', 'lucide-trophy size-4')))
            settext(b, 'Leaderboard') if not b.select_one('span') else settext(b.select_one('span'), 'Leaderboard'); label = 'Leaderboard'
        elif label == 'Staking':
            for s in b.select('svg'): s.decompose()
            b.insert(0, frag(svg('book', 'lucide-book-open size-4')))
            settext(b, 'Docs') if not b.select_one('span') else settext(b.select_one('span'), 'Docs'); label = 'Docs'
        if label in page_of: b['data-href'] = page_of[label]
    # history label is fine; developers button -> docs
    dev = root.select_one('header button[aria-label="Developers"]')
    if dev: dev['data-href'] = 'docs/direct-integration.html'

def mark_active(root, label):
    on = 'bg-accent/15 font-semibold text-accent'.split()
    off = 'font-medium text-text-secondary hover:bg-bg-card-hover hover:text-text-primary'.split()
    for b in root.select('header nav button'):
        cl = [c for c in b['class'] if c not in on + off]
        b['class'] = cl + (on if b.get_text(' ', strip=True) == label else off)
    for b in root.select('nav.h-14 > button'):
        txt = b.get_text(' ', strip=True)
        if txt == 'Launch Token': continue
        cl = [c for c in b['class'] if c not in ('text-accent', 'text-text-muted', 'hover:text-text-primary')]
        b['class'] = cl + (['text-accent'] if txt == label else ['text-text-muted', 'hover:text-text-primary'])

def page_shell(root, title, desc, extra_head=''):
    return '''<!doctype html>
<html lang="en" translate="no" dir="ltr">
<head><title>%s</title><meta name="description" content="%s">%s%s%s</head>
<body data-dynamic-theme="dark" data-dynamic-theme-brand="bold">
%s
<script src="config.js"></script><script src="data.js"></script><script src="i18n.js"></script><script src="app.js"></script><script src="wallet.js" defer></script>
</body></html>''' % (title, desc, HEAD, extra_head, '<style id="prehide">main{visibility:hidden}</style>' if PRELAUNCH else '', str(root))

# =====================================================================
# TOKEN PAGE
# =====================================================================
t = load('o1-token.html')
root = t.select_one('div.flex.h-dvh')
common_clean(root)
kill(root.select_one('section'))
set_nav(root); mark_active(root, 'Dashboard')
root['id'] = 'app'

# --- sub bar: keep one chip as template
sub = root.select_one('header ~ div')
chips = sub.select('div.group')
for c in chips[1:]: c.decompose()
chips[0]['data-tpl'] = 'chip'
chips[0].parent['id'] = 'hist'

main = root.select_one('main')
wrap = main.select_one('div.relative.z-\\[1\\] > div')
kids = [c for c in wrap.children if getattr(c, 'name', None)]
back, warn, hero, stats, grid, spacer, mbar = kids
back.select_one('button')['data-href'] = 'index.html'

# --- warning
warn['id'] = 'warn'
ws = warn.select_one('span.min-w-0')
for s in list(ws.contents):
    if isinstance(s, NavigableString): s.extract()
strongs = ws.select('strong')
strongs[0].insert_after(' Tokens launched here cannot mint more supply, pause or freeze trading, or remove the seeded liquidity. Always check holders, pool liquidity and a live sell quote before buying. Copycats may exist here; external honeypots may imitate legitimate launches. ')
settext(strongs[1], 'DYOR!')

# --- hero
av = hero.select_one('span.bg-avatar-gradient'); av['id'] = 'hAv'; av.select_one('span').string = 'M'; av.append(frag('<img alt="" class="absolute inset-0 size-full rounded-md object-cover" src="img/t-default.png">'))
settext(byexact(hero, 'BLUE CHIP', 'h1'), 'Mogcat')
for n in hero.find_all(string=lambda s: s and s.strip() == 'BLUECHIP'): n.replace_with('MOGCAT')
for n in hero.find_all(string=lambda s: s and s.strip() == '0xb200…4a01'): n.replace_with('0x7b26…4593')
for b in hero.select('button[aria-label="Copy token address"]'): b['data-copy'] = '0x7b26f2a1c3e9d0b4a7f6e5d4c3b2a1908f7e4593'
for b in hero.select('button[aria-label="Copy token referral link"]'): b['data-copy'] = 'https://ethpad-mock.vercel.app/token.html?ref=0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b'; b['data-toast'] = 'Referral link copied'
tags = hero.select_one('div.flex.flex-wrap')
pair_tag = tags.select('span.cursor-help')[0]
pair_av = pair_tag.select_one('span.bg-avatar-gradient'); pair_av.select_one('span').string = 'E'; pair_av.append(frag('<img alt="" class="absolute inset-0 size-full rounded-md object-cover" src="img/eth.png">'))
for n in pair_tag.find_all(string=lambda s: s and s.strip() == 'NVDA'): n.replace_with('ETH')
pair_tag['title'] = 'Paired asset: ETH on Uniswap V4'
tags['id'] = 'tags'
# basket tags are inserted by JS (clone of the pair tag)

# --- stats: ids by index
for i, st in enumerate(stats.select('div.max-sm\\:shrink-0')):
    vals = st.select('div.mt-2, div.mt-1\\.5, button.group span')
    st['data-stat'] = str(i)
settext(byexact(stats, 'Total supply'), 'Total supply')
labels = ['Market cap', 'Token price', 'Volume 24h', 'Pool liquidity', 'Total supply', 'Holders']

# --- chart: replace the iframe shell content with our chrome (filled by app.js)
shell = grid.select_one('[data-token-chart-shell]')
shell.clear(); shell['id'] = 'chartShell'
shell.append(frag('<div class="absolute inset-0" id="tv"></div>'))

# --- info
info = grid.select_one('section.mt-10')
creator = info.select_one('a'); creator['href'] = 'https://explorer.inkonchain.com/address/0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b'; creator.select_one('span').string = '0x5DdD…4A0b'
info.select_one('button[aria-label]')  # copy btn
cp = creator.find_next('button'); cp['data-copy'] = '0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b'
created = byexact(info, 'Aug 20, 2026'); settext(created, 'Sep 28, 2026'); settext(created.select_one('span'), '(3 days ago)')
settext(byexact(info, '1.00%'), '2.00%')
i2 = info.select('div.grid')[1]
cells = i2.select('div.min-w-0')
for cell, (lab, v, s) in zip(cells, [('Lifetime volume', '$7.68M', '3,159 ETH'), ('Creator revenue', '$53.8K', '22.11 ETH'), ('Holder rewards', '$38.4K', '15.79 ETH → stocks'), ('Protocol revenue', '$61.4K', '25.27 ETH')]):
    settext(cell.select_one('span.truncate'), lab); settext(cell.select('div')[1], v); settext(cell.select('div')[2], s)

# --- transactions
txsec = grid.select_one('div.mt-12.scroll-mt-4'); txsec['id'] = 'txsec'
tabs = txsec.select_one('div.flex.min-w-max'); tabs['id'] = 'tabs'
tabbtns = tabs.select('button.flex.shrink-0')
names = {'Transactions': 'tx', 'Holders': 'hold', 'Fees': 'rew', 'Updates': 'upd', 'Staking': 'top'}
for b in tabbtns:
    k = names[b.get_text(strip=True)]
    b['data-tab'] = k
    if k == 'rew': settext(b, 'Rewards')
    if k == 'top': settext(b, 'Top traders')
seg = tabs.select_one('div.-ml-4'); seg['id'] = 'seg'
for b in seg.select('button'): b['data-side'] = b.get_text(strip=True).lower()
pane = txsec.select_one('div.mt-4 > div.overflow-hidden'); pane['id'] = 'panes'
desk = pane.select_one('div.hidden.md\\:block'); desk['data-pane'] = 'tx'
tbody = desk.select_one('tbody'); tbody['id'] = 'tb'
rows = tbody.select('tr')
for r in rows[1:]: r.decompose()
rows[0]['data-tpl'] = 'tx'
loadmore = pane.select_one('div.flex.w-full.justify-center'); loadmore['id'] = 'loadmore'
# mobile transaction list (o1 renders it only on phones; rebuilt from the mobile capture)
mob = frag('''<div class="md:hidden" data-pane="tx"><div id="mtb">
<div class="border-b border-border-default py-3 last:border-b-0" data-tpl="mtx"><div class="flex items-center justify-between gap-3"><div class="min-w-0 truncate text-sm font-semibold"><span class="mr-1.5 text-success" data-f="side">Buy</span><span class="text-text-primary" data-f="amt">4.62K MOGCAT</span></div><span class="shrink-0 text-xs text-text-muted" data-f="time">34s ago</span></div>
<div class="mt-1 flex items-center justify-between gap-3 text-xs text-text-muted"><div class="flex min-w-0 items-center gap-1.5 truncate"><a class="inline-flex items-center gap-1 text-text-muted hover:text-accent" href="#" target="_blank" rel="noopener noreferrer"><span data-f="wallet">0x2b34…</span>%s</a><span>·</span><span data-f="px">$0.00867718</span><span>·</span><span data-f="fee">Fee 0.00175 ETH</span></div><span class="shrink-0" data-f="usd">approx $40.12</span></div></div>
</div></div>''' % svg('ext', 'lucide-external-link size-3 shrink-0'))
desk.insert_after(mob)
# extra panes (holders / rewards / top traders / updates) use the same table component
def table_pane(key, cols, widths, aligns):
    tp = copy.copy(desk); tp['data-pane'] = key; tp['class'] = ['hidden']
    th = tp.select('thead th')
    tr = tp.select_one('thead tr'); tr.clear()
    for c, w, a in zip(cols, widths, aligns):
        cell = copy.copy(th[0]); cell['class'] = [x for x in cell['class'] if not x.startswith('w-[') and x not in ('text-left', 'text-right')] + ['w-[%s]' % w, 'text-' + a]
        cell.string = c; tr.append(cell)
    tb = tp.select_one('tbody'); tb.clear(); tb['id'] = 'tb_' + key
    tp.select_one('div.overflow-auto')['class'] = tp.select_one('div.overflow-auto')['class']
    return tp
hold = table_pane('hold', ['#', 'Wallet', 'Balance', 'Share', 'Value', 'Rewards earned', 'Since'], ['7%', '15%', '15%', '13%', '14%', '14%', '12%'], ['left', 'left', 'right', 'right', 'right', 'right', 'right'])
top = table_pane('top', ['#', 'Wallet', 'Realized PnL', 'Volume', 'Trades', 'Still holding'], ['7%', '15%', '15%', '14%', '12%', '13%'], ['left', 'left', 'right', 'right', 'right', 'right'])
mob.insert_after(hold); hold.insert_after(top)
rew = frag('''<div class="hidden" data-pane="rew"><div class="grid grid-cols-2 gap-x-8 gap-y-5 lg:grid-cols-4 pt-2">
<div class="min-w-0"><div class="text-[13px] font-medium text-text-muted">Paid to holders · lifetime</div><div class="mt-2 truncate text-base font-semibold leading-snug text-text-primary tabular-nums">$38,400</div><div class="mt-0.5 truncate font-mono text-[13px] font-medium text-text-muted">15.79 ETH</div></div>
<div class="min-w-0"><div class="text-[13px] font-medium text-text-muted">Paid 24h</div><div class="mt-2 truncate text-base font-semibold leading-snug text-text-primary tabular-nums">$6,050</div><div class="mt-0.5 truncate font-mono text-[13px] font-medium text-text-muted">2.49 ETH</div></div>
<div class="min-w-0"><div class="text-[13px] font-medium text-text-muted">Claimed</div><div class="mt-2 truncate text-base font-semibold leading-snug text-text-primary tabular-nums">71%</div><div class="mt-0.5 truncate font-mono text-[13px] font-medium text-text-muted">5,120 wallets</div></div>
<div class="min-w-0"><div class="text-[13px] font-medium text-text-muted">Per $1K held / day</div><div class="mt-2 truncate text-base font-semibold leading-snug text-text-primary tabular-nums">$6.52</div><div class="mt-0.5 truncate font-mono text-[13px] font-medium text-text-muted">at 24h volume</div></div></div>
<p class="mt-5 max-w-[720px] text-[13px] leading-relaxed text-text-secondary md:text-xs">Every trade pays 0.5% in ETH to holders, pro-rata to balance. On claim the ETH is swapped on Uniswap into the basket in equal shares and sent as wrapped stock tokens. Claim as ETH is always available.</p>
<div class="mt-4 flex flex-wrap items-center gap-1.5" id="rewBasket"></div></div>''')
top.insert_after(rew)
upd = frag('<div class="hidden" data-pane="upd"><p class="py-6 text-center text-sm text-text-muted">No updates from the creator yet.</p></div>')
rew.insert_after(upd)

# --- disclosures
disc = grid.select_one('div.mt-12:not(.scroll-mt-4)')
items = disc.select('li')
texts = [('Locked liquidity and limited control', 'The Uniswap V4 position is permanently locked. The creator cannot mint additional tokens, pause or freeze trading, rebase the supply, remove liquidity, or otherwise control trading.'),
         ('No reserved supply', 'No tokens were sent directly to recipients or placed in a vesting vault at launch. The full fixed supply entered the pool; the creator bought 0.1 ETH in the launch transaction.'),
         ('Anti-sniping protection', 'For the first 20 seconds after launch, the total fee falls linearly every second from 90.00% to 2.00%. This makes instant sniping expensive: exact-input swaps remain available, while exact-output swaps are disabled until the window ends. The surcharge goes to the holders.'),
         ('Fee split', "The normal hook fee is 2.00%. Fees are always charged in ETH, the pool's paired asset. Buys use part of the ETH paid, and sells use part of the ETH received. It is split 35.00% creator, 25.00% holders (paid in NVDAx, SPYx, TSLAx and MSTRx) and 40.00% platform, of which an eighth funds the 3-day trader leaderboard.")]
for li, (h, p) in zip(items, texts):
    sp = li.select('span.block'); settext(sp[0], h); settext(sp[1], p)

# --- swap card
swap = [c for c in grid.children if getattr(c, 'name', None)][1]; swap['id'] = 'swapwrap'
card = swap.select_one('div.rounded-\\[20px\\]'); card['id'] = 'swapcard'
for n in card.find_all(string=lambda s: s and s.strip() == 'Base'): n.replace_with('Ink')
for n in card.find_all(string=lambda s: s and s.strip() == 'BLUECHIP'): n.replace_with('MOGCAT')
avs = card.select('span.bg-avatar-gradient')
avs[0].select_one('span').string = 'E'; avs[0]['data-av'] = 'in'; avs[0].append(frag('<img alt="" class="absolute inset-0 size-full rounded-md object-cover" src="img/eth.png">'))
avs[1].select_one('span').string = 'M'; avs[1]['data-av'] = 'out'; avs[1].append(frag('<img alt="" class="absolute inset-0 size-full rounded-md object-cover" src="img/t-default.png">'))
ins = card.select('input')
ins[0]['id'] = 'amtIn'; ins[0]['placeholder'] = '0'; ins[0]['inputmode'] = 'decimal'; ins[0]['autocomplete'] = 'off'
ins[1]['id'] = 'amtOut'; ins[1]['placeholder'] = '0'; ins[1]['readonly'] = ''
ins[2]['id'] = 'slip'; ins[2]['value'] = '1'
usd = card.select('div.h-4'); usd[0]['id'] = 'usdIn'; usd[1]['id'] = 'usdOut'
bals = [d.select_one('span.truncate') for d in card.select('div.min-h-6')]; bals[0]['id'] = 'balIn'; bals[1]['id'] = 'balOut'
assetBtn = card.select_one('button.flex.min-w-\\[124px\\]'); assetBtn['id'] = 'assetIn'
assetOut = card.select_one('div.flex.min-w-\\[124px\\]'); assetOut['id'] = 'assetOut'
card.select_one('button.pointer-events-auto')['id'] = 'flip'
for b in card.select('button.h-7'): b['data-q'] = b.get_text(strip=True)
det = card.select_one('button.flex.w-full.cursor-pointer.flex-col'); det['id'] = 'detBtn'
detBody = det.find_next_sibling('div'); detBody['id'] = 'detBody'
rowsd = detBody.select('div.flex.items-center.justify-between')
for r, (k, v) in zip(rowsd, [('minr', '0 MOGCAT'), ('fee', '2.00%'), ('net', '< $0.01'), ('impact', '0.42%')]):
    r.select('span.truncate')[-1]['id'] = 'd_' + k; settext(r.select('span.truncate')[-1], v)
    if k in ('fee', 'net'):
        pass
cta = card.select_one('button.border-transparent'); cta['id'] = 'cta'
foot = card.select_one('p.border-t'); foot.clear()
appendall(foot, '<span class="font-medium">Need more advanced trading features?</span> Trade MOGCAT on <a class="inline-flex items-center gap-1 font-medium text-text-primary transition-colors hover:text-accent" href="https://app.uniswap.org" target="_blank" rel="noopener noreferrer">Uniswap' + svg('ext', 'lucide-external-link size-3') + '</a> or any Ink terminal. Every trade still counts for holder rewards and the <a class="inline-flex items-center gap-1 font-medium text-text-primary transition-colors hover:text-accent" href="leaderboard.html">leaderboard</a>.')
# gas "Auto" button label keep; slippage auto button
for b in card.select('button'):
    if b.get_text(strip=True) == 'Auto' and 'rounded-full' in b.get('class', []): b['id'] = 'slipAuto'
# position box (shown when connected) inserted after CTA
pos = frag('''<div id="pos" class="hidden rounded-[16px] bg-bg-input px-4 py-3 text-[13px]">
<div class="flex items-center justify-between text-text-muted"><span class="font-medium">Your position</span><span class="font-mono" id="posBal">2,104,320 MOGCAT</span></div>
<div class="mt-2 space-y-1.5 font-medium"><div class="flex justify-between"><span class="text-text-muted">Value</span><span id="posVal">$1,950.70</span></div><div class="flex justify-between"><span class="text-text-muted">Avg entry</span><span>$0.0₃352</span></div><div class="flex justify-between"><span class="text-text-muted">Unrealized PnL</span><span class="text-success" id="posPnl">+163.4% · +$1,210</span></div><div class="flex justify-between"><span class="text-text-muted">Stock rewards pending</span><span class="text-success">$21.90</span></div></div>
<div class="mt-3 grid grid-cols-2 gap-1.5"><button class="h-8 cursor-pointer rounded-full bg-accent text-xs font-semibold text-accent-ink transition-colors hover:bg-accent-hover" data-toast="Claimed 0.009 ETH as NVDAx, SPYx, TSLAx, MSTRx">Claim basket</button><button class="h-8 cursor-pointer rounded-full bg-bg-elevated text-xs font-semibold text-text-primary transition-colors hover:bg-bg-selector-hover" data-toast="Claimed 0.009 ETH">Claim as ETH</button></div></div>''')
cta.insert_after(pos)

# --- mobile buy/sell bar
mbar['id'] = 'mbar'
bs = mbar.select('button'); bs[0]['data-side'] = 'buy'; bs[1]['data-side'] = 'sell'

# mobile nav
mnav = root.select_one('nav.h-14'); mnav['id'] = 'mnav'

# modals / sheets / toasts root
root.append(frag('<div id="layer"></div>'))

open(OUT + '/token.html', 'w').write(page_shell(root, 'Mogcat $0.000927 | Inkypump', 'MOGCAT on Ink: price, chart, trades, holders and stock rewards.',
    '<script src="charting_library/charting_library.standalone.js"></script><script src="tv.js"></script><script src="https://cdn.jsdelivr.net/npm/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js"></script>'))
print('token.html ok')

# =====================================================================
# HOME PAGE
# =====================================================================
h = load('o1-home.html')
root = h.select_one('div.flex.h-dvh')
common_clean(root)
kill(root.select_one('section'))
set_nav(root); mark_active(root, 'Dashboard')
root['id'] = 'app'
sub = root.select_one('header ~ div')
settext(byexact(sub, 'New'), 'New')
chips = sub.select('div.group')
for c in chips[1:]: c.decompose()
chips[0]['data-tpl'] = 'chip'; chips[0].parent['id'] = 'newchips'

main = root.select_one('main')
h1 = main.select_one('h1'); h1.clear(); h1.append(frag('<span class="hero-row"><img src="img/hero-wordmark.png" alt="Inkypump" class="hero-wm" decoding="async"><img src="img/inky-anim.svg" alt="" class="hero-inky" width="140" height="144"></span>'))
p = main.select_one('p.mt-5')
u = p.select('span.inline')
stack = p.select_one('span[role=list]')
p.clear()
def under(text, tip):
    s = copy.copy(u[0]); s.string = text; s['title'] = tip; return s
p.append('Give your community something to call its own. Launch ')
p.append(under('memecoins', 'Fixed-supply ERC-20s with no owner, no mint and no tax'))
p.append(' on ')
p.append(under('Ink', "Kraken's L2: 1-second blocks, fees under a cent, Uniswap V4 pools"))
p.append(' that pay holders in ')
p.append(under('stocks', 'Wrapped xStocks on Ink, chosen by the creator at launch'))
items = stack.select('span[role=listitem]')
for it in items[1:]: it.decompose()
stack['aria-label'] = 'Reward stocks'; stack['id'] = 'stack'
items[0]['data-tpl'] = 'stk'
ic = items[0].select_one('span.block'); ic.clear()
ic.append(frag('<img alt="" class="size-6 rounded-full bg-bg-card object-cover ring-2 ring-bg-primary" data-f="av" src="img/s-NVDAx.png">'))
p.append(' '); p.append(stack)
acts = main.select_one('div.mt-7')
ab = acts.select('button'); ab[0]['data-href'] = 'launch.html'; ab[1]['data-href'] = '#feed'
cards = main.select('div.rounded-2xl.bg-bg-input.px-4.py-3')
vals = [('0' if PRELAUNCH else '1,284', 'Tokens launched', 'Tokens launched through the factory'), ('0' if PRELAUNCH else '18.6K', 'Traders', 'Wallets with at least one trade'), ('$0' if PRELAUNCH else '$41.2M', 'Lifetime volume', 'All trades, both sides'), ('$0' if PRELAUNCH else '$206K', 'Paid to holders', 'Holder rewards paid out in stocks'), ('$0' if PRELAUNCH else '$288K', 'Paid to creators', 'Creator share of fees'), ('$0' if PRELAUNCH else '$2.41M', 'Highest market cap', 'Highest market cap reached by a token')]
for c, (v, l, tip) in zip(cards, vals):
    settext(c.select_one('div.text-lg'), v); settext(c.select_one('div.mt-0\\.5 span'), l); c.select_one('span.cursor-help')['title'] = tip
trend = main.select_one('div.rounded-\\[20px\\].bg-bg-input'); trend['id'] = 'trend'
trows = trend.select('button.relative.flex.h-16')
trows[0]['data-tpl'] = 'trendTop'; trows[3]['data-tpl'] = 'trendPlain'
for r in (trows[1], trows[2], trows[4]): r.decompose()
# remove the Tax tag inside template rows if any
for tg in trend.select('span.cursor-help'): tg.decompose()
trend.select_one('button.cursor-pointer.text-\\[13px\\]')['data-href'] = '#feed'
# filter bar
fb = main.select_one('div.sticky.top-0'); fb['id'] = 'feed'
ft = fb.select('div.flex.min-w-max button')
for b, (k, lab) in zip(ft, [('all', 'All'), ('new', 'New'), ('multi', 'Multi-stock')]):
    b['data-filter'] = k; settext(b, lab)
for b in fb.select('div.rounded-full.bg-bg-input button, div.h-10 button'):
    tx = b.get_text(strip=True)
    b['data-sort'] = {'🔥 Trending': 'trend', '⚡ Vol 24h': 'vol', '🌱 New': 'new', '💧 Liquidity': 'liq'}.get(tx, '')
for b in fb.select('button.flex.w-full'): b['data-dd'] = 'assets'
# feed
feedwrap = main.select_one('div.pb-20'); feedwrap['id'] = 'feedwrap'
desk = feedwrap.select_one('div.hidden.md\\:block')
rows = desk.select('div.group.flex.animate-card-in')
for r in rows[3:]: r.decompose()
for r in rows[:2]: r.decompose()
tpl = rows[2]; tpl['data-tpl'] = 'row'
tags = tpl.select('span.cursor-help')
for tg in tags: tg.decompose()   # Tax tag
newtag = tpl.select_one('span.inline-flex.items-center.gap-1\\.5'); newtag['data-f'] = 'new'
desk['id'] = 'rows'
hdr = desk.select_one('div.sticky')
labels = ['Token', 'Market cap', 'Liquidity', 'Volume 24h', 'Rewards 24h', 'Holders', 'Price']
for sp, lab in zip(hdr.select('span.text-sm'), labels): sp.string = lab
mobile = frag('''<div class="md:hidden" id="mrows"><div class="flex cursor-pointer items-center gap-3 border-b border-border-default py-3.5 last:border-b-0" data-tpl="mrow"><span class="relative flex shrink-0 overflow-hidden rounded-md bg-avatar-gradient ring-1 ring-inset ring-text-primary/10 size-11 text-sm"><span class="absolute inset-0 flex items-center justify-center rounded-md font-bold text-text-primary" data-f="av">M</span></span><div class="min-w-0 flex-1"><div class="flex min-w-0 items-center gap-2"><span class="min-w-0 shrink truncate text-sm font-bold leading-tight text-text-primary" data-f="sym">MOGCAT</span><span class="min-w-0 truncate text-sm font-medium text-text-muted" data-f="name">Mogcat</span></div><div class="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-[13px] leading-none text-text-muted"><span>ETH</span><span class="text-text-disabled">·</span><span data-f="age">3h ago</span><span data-f="vol"></span></div></div><div class="shrink-0 text-right"><div class="text-[17px] font-semibold tabular-nums text-text-primary" data-f="mc">$927.5K</div><div class="mt-1 text-xs tabular-nums" data-f="chg"></div></div></div></div>''')
desk.insert_after(mobile)
feedwrap.select_one('div.flex.w-full.justify-center button')['id'] = 'loadmore'
root.append(frag('<div id="layer"></div>'))
open(OUT + '/index.html', 'w').write(page_shell(root, 'Inkypump', 'Launch memecoins on Ink with locked Uniswap V4 liquidity that pay holders in stocks.'))
print('index.html ok')

# =====================================================================
# OTHER PAGES: the token page shell (header, history bar, mobile nav) around our own content
# =====================================================================
ICONS = {'__CHEVL__': svg('chev', 'lucide-chevron-left size-4').replace('m6 9 6 6 6-6', 'm15 18-6-6 6-6'), '__CHEVR__': svg('chev', 'lucide-chevron-right size-4').replace('m6 9 6 6 6-6', 'm9 18 6-6-6-6'),
         '__LOCK__': svg('lock', 'lucide-lock size-3'), '__SHIELD__': svg('shield', 'lucide-shield-alert mt-0.5 size-3.5 shrink-0 text-warning'), '__SHIELDOK__': svg('shield', 'lucide-shield-check size-3'),
         '__ROCKET__': svg('rocket', 'lucide-rocket size-4'), '__CHECK__': svg('check', 'lucide-check size-3'), '__COPY__': svg('copy', 'lucide-copy size-3.5'), '__EXT__': svg('ext', 'lucide-external-link size-3'),
         '__BOOK__': svg('book', 'lucide-book-open size-3.5'), '__COINS__': svg('coins', 'lucide-hand-coins size-3.5'), '__TROPHY__': svg('trophy', 'lucide-trophy size-3'), '__INFO__': svg('info', 'lucide-info'), '__CHEV__': svg('chev', 'lucide-chevron-down'), '__PLUS__': svg('plus', 'lucide-plus'), '__SPARK__': svg('sparkle', 'lucide-sparkles'), '__IMGPLUS__': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 5h6"/><path d="M19 2v6"/><path d="M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/><circle cx="9" cy="9" r="2"/></svg>'}
def other(name, title, desc, active, connected_only=False):
    t2 = load('o1-token.html'); r = t2.select_one('div.flex.h-dvh'); common_clean(r); kill(r.select_one('section')); set_nav(r); mark_active(r, active); r['id'] = 'app'
    sb = r.select_one('header ~ div'); ch = sb.select('div.group')
    for c in ch[1:]: c.decompose()
    ch[0]['data-tpl'] = 'chip'; ch[0].parent['id'] = 'hist'
    m = r.select_one('main'); inner = m.select_one('div.relative.z-\\[1\\]'); inner.clear()
    body = open('pages/' + name).read()
    for k, v in ICONS.items(): body = body.replace(k, v)
    inner.append(frag(body) if body.count('<div class="mx-auto') == 1 else BeautifulSoup(body, 'html.parser'))
    r.append(frag('<div id="layer"></div>'))
    html = page_shell(r, title, desc).replace('<script src="app.js"></script>', '<script src="app.js"></script><script src="pages.js"></script>')
    open(OUT + '/' + name, 'w').write(html); print(name, 'ok')
other('launch.html', 'Launch a token | Inkypump', 'Launch a memecoin on Ink with locked Uniswap V4 liquidity and a stock basket for holders.', 'Launch Token')
other('portfolio.html', 'Profile | Inkypump', 'Your holdings, stock rewards, creator fees and leaderboard payouts.', 'Profile')
other('leaderboard.html', 'Trader leaderboard | Inkypump', 'Top 5 traders by PnL and volume every 3 days, paid in ETH.', 'Leaderboard')

