#!/usr/bin/env python3
"""Fetch a logo for every tokenized stock in site/backing.json into site/img/stocks/<TICKER>.webp (56px).
Sources: Financial Modeling Prep's image-stock, then Parqet. Tickers neither has get a lettered tile.

    python3 stock-logos.py            # only missing files
    python3 stock-logos.py --refresh  # everything again
"""
import io, json, os, ssl, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'site', 'img', 'stocks')
SIZE = 56
SOURCES = ['https://financialmodelingprep.com/image-stock/{t}.png', 'https://assets.parqet.com/logos/symbol/{t}?format=png']
ctx = ssl.create_default_context(cafile=os.environ.get('SSL_CERT_FILE', '/root/.ccr/ca-bundle.crt')) if os.path.exists('/root/.ccr/ca-bundle.crt') else ssl.create_default_context()
os.makedirs(OUT, exist_ok=True)
refresh = '--refresh' in sys.argv


def fetch(url):
    r = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=20, context=ctx)
    b = r.read()
    if r.status != 200 or 'image' not in r.headers.get('content-type', '') or len(b) < 300:
        raise ValueError('no image')
    return b


def tile(ticker):
    # fallback: the ticker on an ink tile, the same look as the on-site chip
    im = Image.new('RGBA', (SIZE, SIZE), (21, 23, 26, 255)); d = ImageDraw.Draw(im)
    text = ticker[:4]
    try: f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 15 if len(text) > 3 else 18)
    except Exception: f = ImageFont.load_default()
    w, h = d.textbbox((0, 0), text, font=f)[2:]
    d.text(((SIZE - w) / 2, (SIZE - h) / 2 - 2), text, font=f, fill=(242, 243, 238, 255))
    return im


def square(im):
    im = im.convert('RGBA'); bg = Image.new('RGBA', im.size, (255, 255, 255, 255)); bg.alpha_composite(im); im = bg
    s = max(im.size); canvas = Image.new('RGBA', (s, s), (255, 255, 255, 255)); canvas.paste(im, ((s - im.width) // 2, (s - im.height) // 2))
    return canvas.resize((SIZE, SIZE), Image.LANCZOS)


def one(ticker):
    path = os.path.join(OUT, ticker + '.webp')
    if os.path.exists(path) and not refresh: return ticker, 'kept'
    for src in SOURCES:
        try:
            im = square(Image.open(io.BytesIO(fetch(src.format(t=ticker.replace('.', '-'))))))
            im.convert('RGB').save(path, 'WEBP', quality=82, method=6); return ticker, 'ok'
        except Exception: continue
    tile(ticker).convert('RGB').save(path, 'WEBP', quality=82, method=6); return ticker, 'tile'


if __name__ == '__main__':
    toks = json.load(open(os.path.join(HERE, 'site', 'backing.json')))['tokens']
    tickers = sorted({t['ticker'] for t in toks if not t.get('skip')})
    with ThreadPoolExecutor(8) as ex: res = list(ex.map(one, tickers))
    by = {}
    for t, s in res: by.setdefault(s, []).append(t)
    print({k: len(v) for k, v in by.items()}); print('tiles:', by.get('tile', []))
