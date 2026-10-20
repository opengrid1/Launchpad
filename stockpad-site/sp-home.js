/* Markets page: hero (stock chips, top coins), platform figures, filter bar, coin cards with area sparklines, pager. */
window.SP_PAGE=function(){
  const pg=$('#pg-markets'); if(!pg) return;
  const params=new URLSearchParams(location.search); let stock=params.get('stock')||'', sort='trend', q='', page=1; const PER=24;
  const now=()=>Math.floor(Date.now()/1000);
  const counts=()=>{ const c={}; TOK.forEach(x=>{ c[x.pair]=(c[x.pair]||0)+1; }); return c; };
  const fee=x=>(x.feeBps||100)/100, feeTxt=x=>fee(x).toFixed(fee(x)%1?(fee(x)*10%1?2:1):0)+'% fee';
  const px=v=>v?'$'+(v>=100?v.toFixed(0):v>=1?v.toFixed(2):fmtPrice(v)):'';
  const stockOf=x=>SP.stockBySym(x.pair);
  const match=x=>{ if(!q) return true; const v=q.toLowerCase(); return x.n.toLowerCase().includes(v)||x.t.toLowerCase().includes(v)||x.addr.includes(v)||(x.pair||'').toLowerCase().includes(v); };
  const list=()=>TOK.filter(x=>(!stock||x.pair===stock)&&match(x));
  function sorted(){ const l=list().slice(); const score=x=>(x.vol||0)*2+(x.mc||0)*0.1+Math.max(0,86400*3-(now()-(x.createdAt||0)))*0.01;
    if(sort==='new') l.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)); else if(sort==='vol') l.sort((a,b)=>(b.vol||0)-(a.vol||0)); else if(sort==='mc') l.sort((a,b)=>(b.mc||0)-(a.mc||0)); else l.sort((a,b)=>score(b)-score(a)); return l; }
  pg.addEventListener('click',e=>{ const b=e.target.closest('[data-copy]'); if(b){ e.preventDefault(); e.stopPropagation(); SP.copy(b.dataset.copy,'Address copied'); } });

  /* ---------- trade-derived bits: area sparkline, buy/sell split ---------- */
  const TRC={};
  async function tradeInfo(x){ const k=x.addr; const c=TRC[k]; if(c&&Date.now()-c.at<60000) return c;
    let out={at:Date.now(),svg:'',buyPct:null}; try{ const tr=(await CHAIN.trades(k)).slice().sort((a,b)=>a.ts-b.ts); const t0=now()-86400; const day=tr.filter(t=>t.ts>=t0);
      let pts=day.map(t=>CHAIN.tradePrice(t)); if(pts.length<2) pts=tr.slice(-40).map(t=>CHAIN.tradePrice(t)); pts=pts.filter(v=>v>0); if(x.pxPair>0) pts.push(x.pxPair); if(pts.length===1) pts=[pts[0],pts[0]];
      if(pts.length>=2){ const W=300,H=40,P=2; const mn=Math.min(...pts), mx=Math.max(...pts), rg=(mx-mn)||mn||1; const step=(W-2*P)/(pts.length-1); const Y=v=>(H-P-((v-mn)/rg)*(H-2*P)).toFixed(1);
        const line=pts.map((v,i)=>(i?'L':'M')+(P+i*step).toFixed(1)+' '+Y(v)).join(' '); const dir=pts[pts.length-1]>pts[0]*1.0005?'up':pts[pts.length-1]<pts[0]*0.9995?'dn':'flat';
        out.svg=`<svg class="spark ${dir}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path class="a" d="${line} L${(P+(pts.length-1)*step).toFixed(1)} ${H} L${P} ${H} Z"/><path class="l" d="${line}"/></svg>`; }
      const bv=day.filter(t=>t.buy).reduce((s,t)=>s+Number(t.pair)/1e18,0), sv=day.filter(t=>!t.buy).reduce((s,t)=>s+Number(t.pair)/1e18,0); if(bv+sv>0) out.buyPct=Math.round(bv/(bv+sv)*100);
    }catch(e){ console.warn('trades',e); }
    TRC[k]=out; return out; }
  function paintTradeBits(){ $$('[data-tr]',pg).forEach(async el=>{ const x=SP.token(el.dataset.tr); if(!x) return; const t=await tradeInfo(x); const sp=$('.sp',el), fl=$('.flow .num',el), sb=$('.split',el);
    if(sp) sp.innerHTML=t.svg||'<svg class="spark flat" viewBox="0 0 300 40" preserveAspectRatio="none"><path class="l" d="M2 20 L298 20"/></svg>';
    if(fl) fl.textContent=t.buyPct==null?'no trades in 24h':`${t.buyPct}% buys · ${100-t.buyPct}% sells`; if(sb) sb.innerHTML=t.buyPct==null?'<i class="b" style="width:0"></i>':`<i class="b" style="width:${t.buyPct}%"></i><i class="s" style="flex:1"></i>`; }); }

  /* ---------- hero ---------- */
  function hero(){ const c=counts(); const mk=SP.market(); const top=SP.stocks.slice().sort((a,b)=>(c[b.symbol]||0)-(c[a.symbol]||0)).slice(0,3);
    $('#hero-stocks').innerHTML=top.map(s=>`<a class="hs" href="/?stock=${s.symbol}"><img src="${s.logo}" alt="" onerror="this.onerror=null;this.src='/img/eth.png'"><span><b>${esc(s.ticker)}</b><small><span data-px="${s.address.toLowerCase()}">${px(SP.prices[s.address.toLowerCase()])||'…'}</span>${c[s.symbol]?`<span class="cnt">${c[s.symbol]} ${c[s.symbol]===1?'coin':'coins'}</span>`:`<span class="mk">${mk.open?'open':'closed'}</span>`}</small></span></a>`).join('');
    const best=TOK.slice().sort((a,b)=>(b.mc||0)-(a.mc||0)).slice(0,2);
    $('#hero-top').innerHTML=best.map((x,i)=>{ const st=stockOf(x); return `<a class="hf" href="${tokenUrl(x)}">${i===0?`<span class="badge acl">${ic('shield')} Top market cap</span>`:''}<div class="t"><span class="av2"><img class="lg" src="${SP.coinLogo(x)}" alt="" onerror="this.onerror=null;this.src='${DEF_LOGO}'"><img class="stb" src="${pairImg(x.pair)}" alt="" onerror="this.onerror=null;this.src='/img/eth.png'"></span><div><b>$${esc(x.t)}<span>${esc(x.n)}</span></b><small>Paired with <img src="${pairImg(x.pair)}" alt="">${esc(st?st.ticker:'ETH')}</small></div></div><div class="b"><b>${fmtUsd(x.mc)}<small>market cap</small></b>${SP.fmtPct(x.c24||0)}</div></a>`; }).join(''); }
  function figs(){ const l=TOK; const vol=l.reduce((s,x)=>s+(x.vol||0),0), fees=l.reduce((s,x)=>s+(x.vol||0)*fee(x)/100,0), holders=l.reduce((s,x)=>s+(x.h||0),0), trades=l.reduce((s,x)=>s+(x.trades||0),0);
    $('#mk-figs').innerHTML=[['Volume 24h',fmtUsd(vol),'across all coins'],['Fees paid 24h',fmtUsd(fees),'in the paired stocks'],['Coins',l.length.toLocaleString(),SP.stocks.length+' stocks to pair with'],['Holders',holders.toLocaleString(),trades.toLocaleString()+' trades']].map(s=>`<div class="sbox lg"><span class="lab">${s[0]}</span><b>${s[1]}</b><i>${s[2]}</i></div>`).join(''); }

  /* ---------- filter bar ---------- */
  function pills(){ const c=counts(); const all=SP.stocks.slice().sort((a,b)=>(c[b.symbol]||0)-(c[a.symbol]||0)); const show=all.slice(0,4), more=all.slice(4);
    const pill=s=>`<button class="pill ${stock===s.symbol?'on':''}" data-st="${s.symbol}"><img src="${s.logo}" alt="" onerror="this.onerror=null;this.src='/img/eth.png'">${esc(s.ticker)}<span class="n">${c[s.symbol]||0}</span></button>`;
    const sel=more.find(s=>s.symbol===stock);
    $('#mk-stockpills').innerHTML=`<button class="pill ${!stock?'on':''}" data-st="">All stocks</button>`+show.map(pill).join('')+(sel?pill(sel):'')+(more.length?`<button class="pill" id="mk-more">More ${ic('down')}</button>`:'');
    $$('#mk-stockpills [data-st]').forEach(b=>b.onclick=()=>setStock(b.dataset.st));
    const m=$('#mk-more'); if(m) m.onclick=e=>{ const menu=SP.menu(e.currentTarget,more.map(s=>`<button data-st="${s.symbol}"><img src="${s.logo}" style="width:18px;height:18px;border-radius:50%;background:#fff" alt=""><span>${esc(s.ticker)} <span class="muted">${esc(s.name)}</span></span><span class="num muted" style="margin-left:auto">${c[s.symbol]||0}</span></button>`).join('')); $$('[data-st]',menu).forEach(b=>b.onclick=()=>{ menu.remove(); setStock(b.dataset.st); }); }; }
  function setStock(s){ stock=s; page=1; const u=new URL(location.href); if(stock) u.searchParams.set('stock',stock); else u.searchParams.delete('stock'); history.replaceState(null,'',u); render(); }

  /* ---------- cards ---------- */
  function card(x){ return `<a class="cc panel" href="${tokenUrl(x)}" data-tr="${x.addr}">${x.rewards?`<span class="badge acl rb">${ic('star')}Holder rewards</span>`:''}
    <div class="top"><span class="av2"><img class="lg" src="${SP.coinLogo(x)}" alt="" onerror="this.onerror=null;this.src='${DEF_LOGO}'"><img class="stb" src="${pairImg(x.pair)}" alt="" onerror="this.onerror=null;this.src='/img/eth.png'"></span><div class="nm"><div class="t"><b>${esc(x.n)}</b><span class="sym">$${esc(x.t)}</span><span class="badge">${feeTxt(x)}</span></div>
      <div class="meta"><span class="cpb" data-copy="${cs(x.addr)}" title="Copy address">${shortAddr(cs(x.addr))}${ic('copy')}</span><span class="pairline"><img src="${SP.coinLogo(x)}" alt="" onerror="this.onerror=null;this.src='${DEF_LOGO}'">${esc(x.t)}<span class="sl">/</span><img src="${pairImg(x.pair)}" alt="" onerror="this.onerror=null;this.src='/img/eth.png'"><span class="st">${esc(x.pair)}</span></span></div></div><span class="age">${ageStr(x.age||'0s')}<span class="mk"><i class="dot ${SP.market().open?'open':''}"></i>${SP.market().open?'NYSE OPEN':'NYSE CLOSED'}</span></span></div>
    <div class="sp"><svg class="spark flat" viewBox="0 0 300 40" preserveAspectRatio="none"><path class="l" d="M2 20 L298 20" opacity=".3"/></svg></div>
    <div class="flow"><span class="lab">Flow 24h</span><span class="num">…</span></div><div class="split"></div>
    <div class="sboxes"><div class="sbox"><span class="lab">Mcap</span><b>${fmtUsd(x.mc)}</b></div><div class="sbox"><span class="lab">Vol 24h</span><b>${fmtUsd(x.vol)}</b></div><div class="sbox"><span class="lab">Trades</span><b>${(x.trades||0).toLocaleString()}</b></div></div></a>`; }
  function render(){ hero(); figs(); pills(); const l=sorted(); const pages=Math.max(1,Math.ceil(l.length/PER)); if(page>pages) page=pages; const st=SP.stockBySym(stock);
    const slice=l.slice((page-1)*PER,page*PER);
    $('#mk-cards').innerHTML=slice.length?slice.map(card).join(''):`<div class="empty"><b>No coins ${stock?'paired with '+esc(st?st.ticker:stock):''}${q?' matching "'+esc(q)+'"':''} yet</b>Be the first: a launch is one transaction.<div style="margin-top:14px"><a class="btn pri" href="/launch${stock?'?pair='+stock:''}">Launch a coin</a></div></div>`;
    $('#mk-pager').innerHTML=`<button class="btn sm line" id="pg-prev" ${page<=1?'disabled':''}>Prev</button><span>${page} / ${pages}</span><button class="btn sm line" id="pg-next" ${page>=pages?'disabled':''}>Next</button>`;
    const pv=$('#pg-prev'), nx=$('#pg-next'); if(pv) pv.onclick=()=>{ page--; render(); scrollTo({top:$('#mk-fbar').offsetTop-80,behavior:'smooth'}); }; if(nx) nx.onclick=()=>{ page++; render(); scrollTo({top:$('#mk-fbar').offsetTop-80,behavior:'smooth'}); };
    $$('#mk-sort button').forEach(b=>b.classList.toggle('on',b.dataset.s===sort)); if(window.CHAIN) paintTradeBits(); }

  $$('#mk-sort button').forEach(b=>b.onclick=()=>{ sort=b.dataset.s; page=1; render(); });
  let qt; $('#mk-q').addEventListener('input',e=>{ clearTimeout(qt); qt=setTimeout(()=>{ q=e.target.value.trim(); page=1; render(); },120); });
  render(); SP.onUpdate(render);
};
