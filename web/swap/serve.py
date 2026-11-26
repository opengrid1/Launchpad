#!/usr/bin/env python3
"""Local dev server that behaves like the Vercel config: clean URLs (/launch -> launch.html),
/token/<address> -> token.html, /docs/<slug> -> docs/<slug>.html."""
import http.server, os, re, sys, urllib.parse

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8767

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def translate_path(self, path):
        p = urllib.parse.urlparse(path).path
        if re.match(r'^/token/0x[0-9a-fA-F]{40}/?$', p): p = '/token.html'
        elif p in ('', '/'): p = '/index.html'
        elif p == '/profile': p = '/liquidity.html'
        elif p == '/docs': p = '/docs/introduction.html'
        else:
            full = os.path.join(ROOT, p.lstrip('/'))
            if not os.path.exists(full) and os.path.isfile(full + '.html'): p += '.html'
        return super().translate_path(p)
    def log_message(self, *a): pass

if __name__ == '__main__':
    http.server.ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
