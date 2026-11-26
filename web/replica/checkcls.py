import re,sys
from bs4 import BeautifulSoup
css=open('o1.css').read()+open('extra.css').read()
def lit(c): return '.'+''.join(ch if re.match(r'[A-Za-z0-9_-]',ch) else '\\'+ch for ch in c)
for f in sys.argv[1:]:
    soup=BeautifulSoup(open(f).read(),'html.parser'); seen=set(); missing=[]
    for el in soup.find_all(True):
        for c in el.get('class',[]):
            if c in seen: continue
            seen.add(c); s=lit(c); i=css.find(s); ok=False
            while i!=-1:
                nxt=css[i+len(s):i+len(s)+1]
                if not re.match(r'[A-Za-z0-9_-]',nxt): ok=True; break
                i=css.find(s,i+1)
            if not ok: missing.append(c)
    print(f,'unknown:',sorted(missing))
