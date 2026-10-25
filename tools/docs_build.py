#!/usr/bin/env python3
"""Builds the Equo docs pages (stockpad-site/docs/*.html) around their content.

Each page's content lives in its own file, inside <div class="dx-body">. This script wraps it in the docs shell:
header, sidebar, title and lead, table of contents, previous/next links. Run it after changing a page's content,
the page list (docs/search.json) or the shell itself:

    python3 tools/docs_build.py

The first run also converted the earlier exported pages (Mintlify markup) into plain HTML; that path is kept for
reference but no longer runs once a page has a dx-body.
Icons are Solar Bold Duotone (480 Design, CC BY 4.0), read from a local copy of @iconify-json/solar when given:
    SOLAR_JSON=/path/to/icons.json python3 tools/docs_build.py
otherwise from the icons already inlined in docs/icons.json.
"""
import html
import json
import os
import re
import sys
from bs4 import BeautifulSoup, NavigableString, Tag

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "stockpad-site")
DOCS = os.path.join(ROOT, "docs")
V = "3"  # docs.css / docs.js version

PAGE_IC = {
    "introduction": "book-2", "how-it-works": "routing-2", "launch-planning": "clipboard-list", "token-creation": "rocket-2",
    "features": "widget-4", "fees": "wad-of-money", "constitution": "diploma", "security": "shield-check",
    "direct-integration": "plug-circle", "data": "database", "production-contracts": "document-text",
    "functions-events": "code-square", "limits": "tuning-2",
}
CARD_IC = [("supply", "layers"), ("liquidity", "waterdrop"), ("stock", "graph-up"), ("pair", "graph-up"), ("hook", "bolt"),
           ("holder", "hand-money"), ("reward", "hand-money"), ("fee", "wad-of-money"), ("creator", "rocket-2"),
           ("snipe", "shield-check"), ("secur", "shield-check"), ("owner", "lock-keyhole"), ("mint", "lock-keyhole"),
           ("address", "document-text"), ("contract", "document-text"), ("event", "code-square"), ("function", "code-square"),
           ("data", "database"), ("api", "database"), ("launch", "rocket-2"), ("price", "chart-2"), ("router", "routing-2"),
           ("chain", "global"), ("trade", "chart-2"), ("rule", "scale")]
CALLOUT_IC = {"note": "info-circle", "info": "info-circle", "warning": "danger-triangle", "danger": "danger-triangle",
              "tip": "lightbulb-bolt", "check": "check-circle"}
UI_IC = ["magnifer", "hamburger-menu", "close-circle", "alt-arrow-left", "alt-arrow-right", "copy", "check-circle", "link-round"]


def load_icons():
    names = set(PAGE_IC.values()) | {v for _, v in CARD_IC} | set(CALLOUT_IC.values()) | set(UI_IC) | {"bolt"}
    src = os.environ.get("SOLAR_JSON")
    cache = os.path.join(DOCS, "icons.json")
    if src:
        I = json.load(open(src))["icons"]
        out = {n: I[n + "-bold-duotone"]["body"] for n in sorted(names)}
        json.dump(out, open(cache, "w"), separators=(",", ":"))
        return out
    return json.load(open(cache))


ICONS = load_icons()


def svg(name, cls="i"):
    return f'<svg class="{cls}" viewBox="0 0 24 24" aria-hidden="true">{ICONS[name]}</svg>'


def esc(s):
    return html.escape(s, quote=True)


def clean_text(s):
    return s.replace("​", "")


KEEP = {"table", "thead", "tbody", "tr", "th", "td", "ul", "ol", "li", "strong", "em", "b", "i", "code", "sup", "sub", "br", "pre", "p", "blockquote", "hr"}


def conv(el):
    """Earlier exported markup to plain HTML."""
    if isinstance(el, NavigableString):
        return esc(clean_text(str(el)))
    if not isinstance(el, Tag):
        return ""
    cls = el.get("class") or []
    part = el.get("data-component-part")
    if el.name in ("svg", "button", "script", "style"):
        return ""
    if el.name == "span" and el.get("data-as") == "p":
        return f"<p>{kids(el)}</p>"
    if "callout" in cls and el.get("data-callout-type"):
        t = el["data-callout-type"]
        body = el.find(attrs={"data-component-part": "callout-content"})
        return f'<div class="call {t}">{svg(CALLOUT_IC.get(t, "info-circle"))}<div>{kids(body)}</div></div>'
    if "card-group" in cls:
        cols = re.search(r"--cols:\s*(\d+)", el.get("style") or "")
        cards = [c for c in el.find_all(class_="card") if "card" in (c.get("class") or [])]
        return f'<div class="cards" style="--cols:{cols.group(1) if cols else 2}">' + "".join(card(c) for c in cards) + "</div>"
    if "card" in cls:
        return f'<div class="cards" style="--cols:1">{card(el)}</div>'
    if "steps" in cls:
        titles = el.find_all(attrs={"data-component-part": "step-title"})
        bodies = el.find_all(attrs={"data-component-part": "step-content"})
        items = "".join(f"<li><h4>{kids(t)}</h4>{kids(b)}</li>" for t, b in zip(titles, bodies))
        return f'<ol class="steps">{items}</ol>'
    if el.get("data-table-wrapper"):
        t = el.find("table")
        return f'<div class="tw">{conv(t)}</div>' if t else ""
    if "ip-code" in cls:
        code = el.find("code")
        return f"<pre><code>{esc(code.get_text())}</code></pre>" if code else ""
    if el.name in ("h1", "h2", "h3", "h4"):
        a = el.find("div", class_="absolute")
        if a:
            a.decompose()
        hid = el.get("id") or slug(el.get_text())
        return f'<{el.name} id="{esc(hid)}">{kids(el).strip()}</{el.name}>'
    if el.name == "a":
        return f'<a href="{esc(el.get("href", "#"))}"{" target=\"_blank\" rel=\"noopener\"" if (el.get("href") or "").startswith("http") else ""}>{kids(el)}</a>'
    if el.name in KEEP:
        attrs = "".join(f' {k}="{esc(el[k])}"' for k in ("colspan", "rowspan", "start") if el.get(k))
        return f"<{el.name}{attrs}>{kids(el)}</{el.name}>"
    return kids(el)


def kids(el):
    return "".join(conv(c) for c in el.children) if el else ""


def card(c):
    title = c.find(attrs={"data-component-part": "card-title"})
    body = c.find(attrs={"data-component-part": "card-content"})
    t = clean_text(title.get_text(" ", strip=True)) if title else ""
    ic = next((v for k, v in CARD_IC if k in t.lower()), "bolt")
    href = c.get("href") if c.name == "a" else None
    inner = f'<span class="ci">{svg(ic)}</span><b>{esc(t)}</b>{kids(body)}'
    return f'<a class="card" href="{esc(href)}">{inner}</a>' if href else f'<div class="card">{inner}</div>'


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", clean_text(s).lower()).strip("-")


# how it works opens with the path a coin takes, drawn
FLOW = """<div class="flow" aria-label="From launch to fees">
<div class="fn"><span class="fi">{rocket}</span><b>Launch</b><small>One transaction to the factory</small></div><i class="fa"></i>
<div class="fn"><span class="fi">{layers}</span><b>Coin and pool</b><small>1,000,000,000 coins seed a Uniswap v4 pool</small></div><i class="fa"></i>
<div class="fn"><span class="fi">{bolt}</span><b>Every swap</b><small>The hook takes the fee inside the pool</small></div><i class="fa"></i>
<div class="fn"><span class="fi">{money}</span><b>Fees paid out</b><small>Holders first if on, then 60% creator, 40% platform</small></div>
</div>"""


def shell(page, pages, body):
    i = next(n for n, p in enumerate(pages) if p["slug"] == page["slug"])
    prev, nxt = (pages[i - 1] if i > 0 else None), (pages[i + 1] if i < len(pages) - 1 else None)
    groups = []
    for p in pages:
        if not groups or groups[-1][0] != p["g"]:
            groups.append((p["g"], []))
        groups[-1][1].append(p)
    side = "".join(
        f'<div class="sg"><div class="sgt">{esc(g)}</div>' + "".join(
            f'<a href="{p["u"]}" class="{"on" if p["slug"] == page["slug"] else ""}">{svg(PAGE_IC.get(p["slug"], "book-2"))}<span>{esc(p["t"])}</span></a>' for p in ps) + "</div>"
        for g, ps in groups)
    soup = BeautifulSoup(body, "html.parser")
    toc = "".join(f'<a href="#{esc(h["id"])}" class="t{h.name[1]}">{esc(h.get_text(" ", strip=True))}</a>' for h in soup.find_all(["h2", "h3"]) if h.get("id"))
    pn = (f'<a class="pv" href="{prev["u"]}">{svg("alt-arrow-left")}<span><small>Previous</small><b>{esc(prev["t"])}</b></span></a>' if prev else "<span></span>") + \
         (f'<a class="nx" href="{nxt["u"]}"><span><small>Next</small><b>{esc(nxt["t"])}</b></span>{svg("alt-arrow-right")}</a>' if nxt else "<span></span>")
    title, desc = page["t"], page["d"]
    return f"""<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>{esc(title)} | Equo docs</title><meta name="description" content="{esc(desc)}">
<link rel="icon" href="/img/favicon.svg?v=16" type="image/svg+xml"><link rel="apple-touch-icon" href="/img/apple-touch-icon.png?v=16"><meta name="theme-color" content="#000000">
<meta property="og:title" content="{esc(title)} | Equo docs"><meta property="og:description" content="{esc(desc)}"><meta property="og:image" content="/img/og.png?v=17"><meta name="twitter:card" content="summary_large_image">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@500;600;700;800&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="/docs/docs.css?v={V}">
</head><body>
<header class="dh"><div class="in">
<button type="button" class="dmenu" id="dmenu" aria-label="Open menu">{svg("hamburger-menu")}</button>
<a class="brand" href="/"><img src="/img/logo.svg?v=15" alt=""><span>Equo</span><em>Docs</em></a>
<button type="button" class="dsearch" id="dsearch">{svg("magnifer")}<span>Search the docs</span><kbd>/</kbd></button>
<nav class="dlinks"><a href="https://x.com/equofun" target="_blank" rel="noopener" aria-label="Equo on X"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.65l-5.21-6.82-5.97 6.82H1.68l7.73-8.84L1.25 2.25h6.83l4.71 6.23zm-1.16 17.52h1.83L7.08 4.13H5.12z"/></svg></a><a class="dapp" href="/markets">Open app</a></nav>
</div></header>
<div class="dwrap">
<aside class="dside" id="dside"><div class="dsh"><a class="brand" href="/"><img src="/img/logo.svg?v=15" alt=""><span>Equo</span><em>Docs</em></a><button type="button" class="dx" id="dclose" aria-label="Close menu">{svg("close-circle")}</button></div>{side}</aside>
<main class="dmain"><article class="doc" data-page="{page["slug"]}">
<div class="crumb">{esc(page["g"])}</div><h1>{esc(title)}</h1><p class="lead">{esc(desc)}</p>
<div class="dx-body">
{body}
</div>
<nav class="pn">{pn}</nav>
<footer class="df"><span>Equo docs</span><a href="/markets">Open the app</a><a href="https://x.com/equofun" target="_blank" rel="noopener">@equofun</a></footer>
</article></main>
<aside class="dtoc">{('<div class="tt">On this page</div>' + toc) if toc else ""}</aside>
</div>
<script src="/docs/docs.js?v={V}"></script>
</body></html>
"""


def main():
    pages = json.load(open(os.path.join(DOCS, "search.json")))
    for p in pages:
        p["slug"] = p["u"].rsplit("/", 1)[-1]
    for p in pages:
        f = os.path.join(DOCS, p["slug"] + ".html")
        s = BeautifulSoup(open(f).read(), "html.parser")
        cur = s.select_one("div.dx-body")
        if cur is not None:
            body = cur.decode_contents().strip()
        else:
            c = s.select_one("#content")
            if c is None:
                sys.exit(f"{f}: no content found")
            body = kids(c)
            if p["slug"] == "how-it-works":
                body = FLOW.format(rocket=svg("rocket-2"), layers=svg("layers"), bolt=svg("bolt"), money=svg("wad-of-money")) + body
            body = re.sub(r"<p>\s*</p>", "", body)
        open(f, "w").write(shell(p, pages, body))
        print("built", p["slug"])


if __name__ == "__main__":
    main()
