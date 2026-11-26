#!/usr/bin/env python3
"""Local preview of dist/ with Vercel-style clean URLs: /launch -> launch.html, /coin/0x.. -> coin.html."""
import http.server, os, sys
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'dist')
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def translate_path(self, path):
        p = path.split('?', 1)[0].split('#', 1)[0]
        if p.startswith('/coin/'): p = '/coin.html'
        elif p != '/' and '.' not in os.path.basename(p) and os.path.exists(os.path.join(ROOT, p.lstrip('/') + '.html')): p = p + '.html'
        return super().translate_path(p)
    def end_headers(self): self.send_header('Cache-Control', 'no-store'); super().end_headers()
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1]) if len(sys.argv) > 1 else 8790), H).serve_forever()
