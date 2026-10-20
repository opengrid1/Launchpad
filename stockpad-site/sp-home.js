/* Markets page: hero figures, stock row filter, coin list or cards with sparklines, stock directory. */
window.SP_PAGE=function(){
  const pg=$('#pg-markets'); if(!pg) return;
  $('#mk-view [data-v="list"]').innerHTML=ic('list'); $('#mk-view [data-v="grid"]').innerHTML=ic('grid');
  const params=new URLSearchParams(location.search); let stock=params.get('stock')||'', sort='trend', view=localStorage.getItem('sp:view')||'list';
  const now=()=>Math.floor(Date.now()/1000);
  const list=()=>TOK.filter(x=>!stock||x.pair===stock);
  const counts=()=>{ const c={}; TOK.forEach(x=>{ c[x.pair]=(c[x.pair]||0)+1; }); return c; };
  const fee=x=>(x.feeBps||100)/100, feeTxt=x=>fee(x).toFixed(fee(x)%1?2:0)+'%';
  const px=v=>v?'$'+(v>=100?v.toFixed(0):v>=1?v.toFixed(2):fmtPrice(v)):'';
  function sorted(){ const l=list().slice(); const score=x=>(x.vol||0)*2+(x.mc||0)*0.1+Math.max(0,86400*3-(now()-(x.createdAt||0)))*0.01;
    if(sort==='new') l.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)); else if(sort==='gain') l.sort((a,b)=>(b.c24||0)-(a.c24||0)); else if(sort==='mc') l.sort((a,b)=>(b.mc||0)-(a.mc||0)); else l.sort((a,b)=>score(b)-score(a)); return l; }

  /* ---------- hero figures ---------- */
  function figs(){ const l=TOK; const vol=l.reduce((s,x)=>s+(x.vol||0),0), fees=l.reduce((s,x)=>s+(x.vol||0)*fee(x)/100,0), holders=l.reduce((s,x)=>s+(x.h||0),0);
    $('#mk-figs').innerHTML=[['Volume 24h',fmtUsd(vol)],['Fees paid 24h',fmtUsd(fees)],['Coins',l.length.toLocaleString()],['Holders',holders.toLocaleString()]].map(s=>`<div><small>${s[0]}</small><b>${s[1]}</b></div>`).join(''); }

  /* ---------- stock row ---------- */
  function stockRow(){ const c=counts(); const mk=SP.market();
    const tile=s=>{ const p=SP.prices[s.address.toLowerCase()], n=c[s.symbol]||0; return `<a class="st ${stock===s.symbol?'on':''}" href="/?stock=${s.symbol}" data-st="${s.symbol}"><span class="t"><img src="${s.logo}" alt="" onerror="this.onerror=null;this.src='/img/eth.png'"><span><b>${esc(s.ticker)}</b><small>${esc(s.name)}</small></span></span><span class="px" data-px="${s.address.toLowerCase()}">${px(p)||'<span class="sk"></span>'}</span><span class="ft"><span><i class="dot ${mk.open?'open':''}"></i>${mk.open?'Open':'Closed'}</span><span>${n} ${n===1?'coin':'coins'}</span></span></a>`; };
    $('#mk-stockrow').innerHTML=`<a class="st all ${!stock?'on':''}" href="/" data-st=""><span class="t"><span><b>All</b><small>${SP.stocks.length} stocks</small></span></span><span class="px">${TOK.length}</span><span class="ft"><span>${TOK.length===1?'coin':'coins'} listed</span></span></a>`+SP.stocks.map(tile).join('');
    $$('#mk-stockrow [data-st]').forEach(a=>a.onclick=e=>{ e.preventDefault(); stock=a.dataset.st; const u=new URL(location.href); if(stock) u.searchParams.set('stock',stock); else u.searchParams.delete('stock'); history.replaceState(null,'',u); render(); $('#mk-coins').scrollIntoView({behavior:'smooth',block:'start'}); }); }

  /* ---------- sparklines from the trade index ---------- */
  const SPK={};
  async function spark(x){ const k=x.addr; const c=SPK[k]; if(c&&Date.now()-c.at<60000) return c.svg;
    let svg=''; try{ const tr=(await CHAIN.trades(k)).slice().sort((a,b)=>a.ts-b.ts); const t0=now()-86400; let pts=tr.filter(t=>t.ts>=t0).map(t=>CHAIN.tradePrice(t)); if(pts.length<2) pts=tr.slice(-30).map(t=>CHAIN.tradePrice(t)); pts=pts.filter(v=>v>0); if(x.pxPair>0) pts.push(x.pxPair);
      if(pts.length>=2){ const W=92,H=28,P=2; const mn=Math.min(...pts), mx=Math.max(...pts), rg=(mx-mn)||mn||1; const step=(W-2*P)/(pts.length-1);
        const d=pts.map((v,i)=>(i?'L':'M')+(P+i*step).toFixed(1)+' '+(H-P-((v-mn)/rg)*(H-2*P)).toFixed(1)).join(' '); const dir=pts[pts.length-1]>pts[0]*1.0005?'up':pts[pts.length-1]<pts[0]*0.9995?'dn':'flat';
        svg=`<svg class="spark ${dir}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><path d="${d}"/></svg>`; } }catch(e){ console.warn('spark',e); }
    SPK[k]={at:Date.now(),svg}; return svg; }
  function paintSparks(){ $$('[data-spark]',pg).forEach(async el=>{ const x=SP.token(el.dataset.spark); if(!x) return; const s=await spark(x); el.innerHTML=s||'<span class="muted">—</span>'; }); }

  /* ---------- coins ---------- */
  const stockOf=x=>SP.stockBySym(x.pair);
  const pairChip=x=>{ const st=stockOf(x); return `<span class="pairchip"><img src="${pairImg(x.pair)}" alt="" onerror="this.onerror=null;this.src='/img/eth.png'">${esc(st?st.ticker:'ETH')}</span>`; };
  function rowHtml(x,i){ return `<tr class="go" data-go="${tokenUrl(x)}"><td class="num">${i+1}</td><td><div class="coin"><img class="lg" src="${SP.coinLogo(x)}" alt="" onerror="this.onerror=null;this.src='${DEF_LOGO}'"><div><b>${esc(x.n)}</b><small><span class="mono">${esc(x.t)}</span>${x.rewards?'<span class="tag mint">rewards</span>':''}</small></div></div></td><td class="r num hm">$${fmtPrice(x.px)}</td><td class="r num">${fmtUsd(x.mc)}</td><td class="r">${SP.fmtPct(x.c24||0)}</td><td class="r num hm">${fmtUsd(x.vol)}</td><td class="r num hm">${(x.h||0).toLocaleString()}</td><td class="r num hm">${esc(x.age||'')}</td><td>${pairChip(x)}</td><td class="r hm"><span data-spark="${x.addr}"></span></td></tr>`; }
  function card(x){ return `<a class="cc" href="${tokenUrl(x)}"><div class="hd"><img class="lg" src="${SP.coinLogo(x)}" alt="" onerror="this.onerror=null;this.src='${DEF_LOGO}'"><div class="nm"><b>${esc(x.n)}</b><small>${esc(x.t)}</small></div><div class="px"><b>$${fmtPrice(x.px)}</b>${SP.fmtPct(x.c24||0)}</div></div>
    <div class="kv3"><div><small>Market cap</small><b>${fmtUsd(x.mc)}</b></div><div><small>Volume 24h</small><b>${fmtUsd(x.vol)}</b></div><div><small>Holders</small><b>${(x.h||0).toLocaleString()}</b></div></div>
    <div class="ft">${pairChip(x)}<span>${feeTxt(x)} fee · ${ageStr(x.age||'0s')}</span></div></a>`; }
  function render(){ figs(); stockRow(); const l=sorted(); const st=SP.stockBySym(stock);
    $('#mk-title').textContent=stock?(st?st.name+' coins':'ETH coins'):'All coins'; $('#mk-sub').textContent=stock&&st?`Paired with ${st.symbol}. Fees and trades settle in ${st.ticker}.`:(TOK.length?`${TOK.length} ${TOK.length===1?'coin':'coins'} across ${Object.keys(counts()).length} ${Object.keys(counts()).length===1?'stock':'stocks'}`:'');
    const empty=`<div class="empty"><b>No coins ${stock?'paired with '+esc(st?st.ticker:stock):''} yet</b>Be the first: a launch is one transaction.<div style="margin-top:14px"><a class="btn pri" href="/launch${stock?'?pair='+stock:''}">Launch a coin</a></div></div>`;
    $('#mk-table tbody').innerHTML=l.length?l.map(rowHtml).join(''):`<tr><td colspan="10" style="padding:0">${empty}</td></tr>`; $('#mk-cards').innerHTML=l.length?l.map(card).join(''):empty;
    $$('#mk-table tr[data-go]').forEach(r=>r.onclick=()=>SP.go(r.dataset.go));
    $('#mk-grid').classList.toggle('on',view==='grid'); $('#mk-list').classList.toggle('on',view==='list'); $$('#mk-view button').forEach(b=>b.classList.toggle('on',b.dataset.v===view));
    $$('#mk-sort button').forEach(b=>b.classList.toggle('on',b.dataset.s===sort)); directory(); if(window.CHAIN) paintSparks(); }

  /* ---------- directory ---------- */
  function directory(){ const c=counts(); const mk=SP.market();
    $('#mk-stocks tbody').innerHTML=SP.stocks.map(s=>{ const p=SP.prices[s.address.toLowerCase()]; const n=c[s.symbol]||0; const vol=TOK.filter(x=>x.pair===s.symbol).reduce((a,x)=>a+(x.vol||0),0);
      return `<tr><td><div class="sc"><img src="${s.logo}" alt="" onerror="this.onerror=null;this.src='/img/eth.png'"><div><b>${esc(s.name)}</b><small>${esc(s.ticker)}</small></div></div></td><td class="hm"><a class="w" href="${EXPLORER}/token/${s.address}" target="_blank" rel="noopener"><span class="mono" style="font-size:12.5px">${esc(s.symbol)}</span>${ic('ext')}</a></td><td class="r num" data-px="${s.address.toLowerCase()}">${px(p)||'<span class="sk"></span>'}</td><td class="hm"><i class="dot ${mk.open?'open':''}"></i>${mk.open?'Open':'Closed'}</td><td class="r num">${n}</td><td class="r num hm">${fmtUsd(vol)}</td><td class="r"><a class="btn sm" href="/launch?pair=${s.symbol}">Launch</a></td></tr>`; }).join(''); }

  $$('#mk-sort button').forEach(b=>b.onclick=()=>{ sort=b.dataset.s; render(); });
  $$('#mk-view button').forEach(b=>b.onclick=()=>{ view=b.dataset.v; localStorage.setItem('sp:view',view); render(); });
  render(); SP.onUpdate(render);
};
