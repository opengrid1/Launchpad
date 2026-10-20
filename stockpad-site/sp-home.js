/* Markets page: session ledger, ticker strip (stock filter), the coin board with sparklines, pager. */
window.SP_PAGE=function(){
  const pg=$('#pg-markets'); if(!pg) return;
  const params=new URLSearchParams(location.search); let stock=params.get('stock')||'', sort='trend', q='', page=1; const PER=25;
  const now=()=>Math.floor(Date.now()/1000);
  const counts=()=>{ const c={}; TOK.forEach(x=>{ c[x.pair]=(c[x.pair]||0)+1; }); return c; };
  const fee=x=>(x.feeBps||100)/100, feeTxt=x=>fee(x).toFixed(fee(x)%1?(fee(x)*10%1?2:1):0)+'% fee';
  const px=v=>v?'$'+(v>=100?v.toFixed(0):v>=1?v.toFixed(2):fmtPrice(v)):'';
  const stockOf=x=>SP.stockBySym(x.pair);
  const match=x=>{ if(!q) return true; const v=q.toLowerCase(); return x.n.toLowerCase().includes(v)||x.t.toLowerCase().includes(v)||x.addr.includes(v)||(x.pair||'').toLowerCase().includes(v); };
  const list=()=>TOK.filter(x=>(!stock||x.pair===stock)&&match(x));
  function sorted(){ const l=list().slice(); const score=x=>(x.vol||0)*2+(x.mc||0)*0.1+Math.max(0,86400*3-(now()-(x.createdAt||0)))*0.01;
    if(sort==='new') l.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)); else if(sort==='vol') l.sort((a,b)=>(b.vol||0)-(a.vol||0)); else if(sort==='mc') l.sort((a,b)=>(b.mc||0)-(a.mc||0)); else if(sort==='gain') l.sort((a,b)=>(b.c24||0)-(a.c24||0)); else l.sort((a,b)=>score(b)-score(a)); return l; }

  /* ---------- sparklines from the trade index ---------- */
  const SPK={};
  async function spark(x){ const k=x.addr; const c=SPK[k]; if(c&&Date.now()-c.at<60000) return c.svg;
    let svg=''; try{ const tr=(await CHAIN.trades(k)).slice().sort((a,b)=>a.ts-b.ts); const t0=now()-86400; let pts=tr.filter(t=>t.ts>=t0).map(t=>CHAIN.tradePrice(t)); if(pts.length<2) pts=tr.slice(-40).map(t=>CHAIN.tradePrice(t)); pts=pts.filter(v=>v>0); if(x.pxPair>0) pts.push(x.pxPair); if(pts.length===1) pts=[pts[0],pts[0]];
      if(pts.length>=2){ const W=150,H=36,P=2; const mn=Math.min(...pts), mx=Math.max(...pts), rg=(mx-mn)||mn||1; const step=(W-2*P)/(pts.length-1); const Y=v=>(H-P-((v-mn)/rg)*(H-2*P)).toFixed(1);
        const line=pts.map((v,i)=>(i?'L':'M')+(P+i*step).toFixed(1)+' '+Y(v)).join(' '); const dir=pts[pts.length-1]>pts[0]*1.0005?'up':pts[pts.length-1]<pts[0]*0.9995?'dn':'flat';
        svg=`<svg class="spark ${dir}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path class="a" d="${line} L${(P+(pts.length-1)*step).toFixed(1)} ${H} L${P} ${H} Z"/><path class="l" d="${line}"/></svg>`; } }catch(e){ console.warn('spark',e); }
    SPK[k]={at:Date.now(),svg}; return svg; }
  function paintSparks(){ $$('[data-spark]',pg).forEach(async el=>{ const x=SP.token(el.dataset.spark); if(!x) return; const s=await spark(x); el.innerHTML=s||'<svg class="spark flat" viewBox="0 0 150 36" preserveAspectRatio="none"><path class="l" d="M2 18 L148 18"/></svg>'; }); }

  /* ---------- session ledger ---------- */
  function session(){ const mk=SP.market(); const l=TOK; const vol=l.reduce((s,x)=>s+(x.vol||0),0), fees=l.reduce((s,x)=>s+(x.vol||0)*fee(x)/100,0), holders=l.reduce((s,x)=>s+(x.h||0),0), trades=l.reduce((s,x)=>s+(x.trades||0),0); const nst=Object.keys(counts()).length;
    $('#mk-date').textContent=new Date().toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
    const rows=[['NYSE',`<i class="dot ${mk.open?'open':''}"></i>${mk.open?'Open':'Closed'}<small>${esc(mk.open?'closes in '+mk.until:'opens in '+mk.until)}</small>`],['ETH',SP.prices[WETH]?px(SP.prices[WETH]):'<span class="sk"></span>'],['Volume 24h',fmtUsd(vol)],['Fees paid 24h',fmtUsd(fees)+'<small>in stocks</small>'],['Coins listed',l.length.toLocaleString()+`<small>on ${nst} ${nst===1?'stock':'stocks'}</small>`],['Holders',holders.toLocaleString()+`<small>${trades.toLocaleString()} trades</small>`]];
    $('#mk-session').innerHTML=rows.map(r=>`<div class="lr"><span>${r[0]}</span><i></i><b>${r[1]}</b></div>`).join(''); }

  /* ---------- ticker strip ---------- */
  function strip(){ const c=counts();
    const items=SP.stocks.map(s=>{ const p=SP.prices[s.address.toLowerCase()], n=c[s.symbol]||0; return `<a class="ti ${stock===s.symbol?'on':''}" href="/?stock=${s.symbol}" data-st="${s.symbol}" title="${esc(s.name)} · ${esc(s.symbol)}"><img src="${s.logo}" alt="" onerror="this.onerror=null;this.src='/img/eth.png'"><b>${esc(s.ticker)}</b><span class="num" data-px="${s.address.toLowerCase()}">${px(p)||'…'}</span><span class="n ${n?'has':''}">${n} ${n===1?'coin':'coins'}</span></a>`; }).join('');
    $('#mk-strip').innerHTML=`<a class="ti all ${!stock?'on':''}" href="/" data-st=""><b>All stocks</b><span class="n">${TOK.length} ${TOK.length===1?'coin':'coins'}</span></a>`+items;
    $$('#mk-strip [data-st]').forEach(a=>a.onclick=e=>{ e.preventDefault(); stock=a.dataset.st; page=1; const u=new URL(location.href); if(stock) u.searchParams.set('stock',stock); else u.searchParams.delete('stock'); history.replaceState(null,'',u); render(); }); }

  /* ---------- board ---------- */
  function row(x){ const st=stockOf(x); const sp=st?SP.prices[st.address.toLowerCase()]:SP.prices[WETH]; const mk=SP.market();
    return `<a class="br" href="${tokenUrl(x)}">
      <div class="c coin"><span class="av2"><img class="lg" src="${SP.coinLogo(x)}" alt="" onerror="this.onerror=null;this.src='${DEF_LOGO}'"><img class="stb" src="${pairImg(x.pair)}" alt="" onerror="this.onerror=null;this.src='/img/eth.png'"></span><div><b>${esc(x.n)}</b><small>$${esc(x.t)} · ${feeTxt(x)} · ${ageStr(x.age||'0s')}${x.rewards?' · holder rewards':''}</small></div></div>
      <div class="c pair"><img src="${pairImg(x.pair)}" alt="" onerror="this.onerror=null;this.src='/img/eth.png'"><div><b>${esc(st?st.ticker:'ETH')}</b><small>${px(sp)||'…'} · ${st?(mk.open?'NYSE open':'NYSE closed'):'24/7'}</small></div></div>
      <div class="c r price"><b class="px">$${fmtPrice(x.px)}</b><small>${SP.fmtPct(x.c24||0)}</small></div>
      <div class="c r mcap"><b>${fmtUsd(x.mc)}</b><small>mcap</small></div>
      <div class="c r hm2"><b>${fmtUsd(x.vol)}</b><small>vol 24h</small></div>
      <div class="c r hm2"><b>${(x.h||0).toLocaleString()}</b><small>holders</small></div>
      <div class="c sp" data-spark="${x.addr}"></div>
      <div class="c act"><span class="btn sm line">Trade</span></div></a>`; }
  function render(){ session(); strip(); const l=sorted(); const pages=Math.max(1,Math.ceil(l.length/PER)); if(page>pages) page=pages; const st=SP.stockBySym(stock);
    const slice=l.slice((page-1)*PER,page*PER);
    $('#mk-rows').innerHTML=slice.length?slice.map(row).join(''):`<div class="empty"><b>No coins ${stock?'on '+esc(st?st.ticker:stock):''}${q?' matching “'+esc(q)+'”':''} yet.</b>Be the first: a launch is one transaction.<div style="margin-top:16px"><a class="btn pri" href="/launch${stock?'?pair='+stock:''}">Launch a coin</a></div></div>`;
    $('#mk-pager').innerHTML=l.length>PER?`<button class="btn sm line" id="pg-prev" ${page<=1?'disabled':''}>Prev</button><span>${page} / ${pages}</span><button class="btn sm line" id="pg-next" ${page>=pages?'disabled':''}>Next</button>`:'';
    const pv=$('#pg-prev'), nx=$('#pg-next'); if(pv) pv.onclick=()=>{ page--; render(); }; if(nx) nx.onclick=()=>{ page++; render(); };
    $$('#mk-sort button').forEach(b=>b.classList.toggle('on',b.dataset.s===sort)); if(window.CHAIN) paintSparks(); }

  $$('#mk-sort button').forEach(b=>b.onclick=()=>{ sort=b.dataset.s; page=1; render(); });
  let qt; $('#mk-q').addEventListener('input',e=>{ clearTimeout(qt); qt=setTimeout(()=>{ q=e.target.value.trim(); page=1; render(); },120); });
  render(); SP.onUpdate(render); setInterval(session,30000);
};
