/* Analytics page: platform totals with per-day bars, breakdown by stock, top coins, top creators, live trade feed.
   Everything comes from the trade index (CHAIN.allTrades) and the token list; USD uses each coin's pair price. */
window.SP_PAGE=function(){
  const pg=$('#pg-analytics'); if(!pg) return;
  let range=30, topBy='vol', TR=[], seen=new Set();
  const DAY=86400, now=()=>Math.floor(Date.now()/1000), day0=ts=>Math.floor(ts/DAY)*DAY;
  const tok=a=>TOK.find(x=>x.addr===String(a||'').toLowerCase())||null;
  const usdOf=t=>{ const x=tok(t.token); return x?Number(t.pair)/1e18*(x.pairUsd||0):0; };
  const feeUsd=t=>{ const x=tok(t.token); return x?Number(t.fee)/1e18*(x.pairUsd||0):0; };
  const px=v=>v?'$'+(v>=100?v.toFixed(0):v>=1?v.toFixed(2):fmtPrice(v)):'';

  /* ---------- per-day series ---------- */
  function days(){ const all=TOK.map(x=>x.createdAt||0).concat(TR.map(t=>t.ts)).filter(Boolean); const first=all.length?Math.min(...all):now(); const start=range?Math.max(day0(first),day0(now())-(range-1)*DAY):day0(first); const out=[]; for(let d=start;d<=day0(now());d+=DAY) out.push(d); return out; }
  function series(){ const D=days(); const idx={}; D.forEach((d,i)=>idx[d]=i); const vol=D.map(()=>0), fees=D.map(()=>0), trades=D.map(()=>0), launches=D.map(()=>0);
    TR.forEach(t=>{ const i=idx[day0(t.ts)]; if(i==null) return; vol[i]+=usdOf(t); fees[i]+=feeUsd(t); trades[i]++; });
    TOK.forEach(x=>{ const i=idx[day0(x.createdAt||0)]; if(i!=null) launches[i]++; });
    return {D,vol,fees,trades,launches}; }
  function bars(v,id){ const W=300,H=84,n=v.length; const mx=Math.max(...v,0)||1; const gap=n>40?1:2; const bw=Math.max(1,(W-gap*(n-1))/n);
    const r=v.map((y,i)=>{ const h=y>0?Math.max(2,(y/mx)*(H-6)):1; return `<rect class="${i===n-1?'last':''}" x="${(i*(bw+gap)).toFixed(2)}" y="${(H-h).toFixed(2)}" width="${bw.toFixed(2)}" height="${h.toFixed(2)}" rx="1"><title>${id}</title></rect>`; }).join('');
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><line x1="0" y1="${H-.5}" x2="${W}" y2="${H-.5}"/>${r}</svg>`; }
  const dlab=d=>new Date(d*1000).toLocaleDateString('en-US',{month:'short',day:'numeric'});
  function kpis(){ const S=series(); const t24=now()-DAY, t7=now()-7*DAY; const in24=TR.filter(t=>t.ts>=t24);
    const volAll=TR.reduce((s,t)=>s+usdOf(t),0), vol24=in24.reduce((s,t)=>s+usdOf(t),0), feesAll=TR.reduce((s,t)=>s+feeUsd(t),0), fees24=in24.reduce((s,t)=>s+feeUsd(t),0);
    const new24=TOK.filter(x=>(x.createdAt||0)>=t24).length, new7=TOK.filter(x=>(x.createdAt||0)>=t7).length, holders=TOK.reduce((s,x)=>s+(x.h||0),0);
    const K=[['Volume',fmtUsd(volAll),`<em>${fmtUsd(vol24)}</em> 24h`,S.vol],['Fees paid',fmtUsd(feesAll),`<em>${fmtUsd(fees24)}</em> 24h`,S.fees],['Trades',TR.length.toLocaleString(),`<em>${in24.length.toLocaleString()}</em> 24h`,S.trades],['Coins',TOK.length.toLocaleString(),`<em>${new24}</em> 24h · <em>${new7}</em> 7d · ${holders.toLocaleString()} holders`,S.launches]];
    $('#an-kpis').innerHTML=K.map(k=>`<div class="panel kpi"><div class="top"><span class="lab">${k[0]}</span><span class="d">${k[2]}</span></div><b>${k[1]}</b><div class="ch">${bars(k[3],k[0])}</div><div class="ax"><span>${S.D.length?dlab(S.D[0]):''}</span><span>${S.D.length?dlab(S.D[S.D.length-1]):''}</span></div></div>`).join(''); }

  /* ---------- by stock ---------- */
  function byStock(){ const rows=SP.stocks.map(s=>{ const coins=TOK.filter(x=>x.pair===s.symbol); const addrs=new Set(coins.map(x=>x.addr)); const tr=TR.filter(t=>addrs.has(t.token)); const vol=tr.reduce((a,t)=>a+usdOf(t),0), fees=tr.reduce((a,t)=>a+feeUsd(t),0), h=coins.reduce((a,x)=>a+(x.h||0),0); return {s,n:coins.length,vol,fees,tr:tr.length,h}; }).sort((a,b)=>b.vol-a.vol||b.n-a.n);
    const mx=Math.max(...rows.map(r=>r.vol),0)||1;
    $('#an-stocks tbody').innerHTML=rows.map(r=>`<tr class="go" data-go="/?stock=${r.s.symbol}"><td><div class="sc"><img src="${r.s.logo}" alt="" onerror="this.onerror=null;this.src='/img/eth.png'"><div><b>${esc(r.s.ticker)}</b><small>${esc(r.s.symbol)} · ${px(SP.prices[r.s.address.toLowerCase()])||'…'}</small></div></div></td><td class="r num">${r.n}</td><td class="r num">${fmtUsd(r.vol)}<div class="bar h"><i style="width:${(r.vol/mx*100).toFixed(1)}%"></i></div></td><td class="r num">${fmtUsd(r.fees)}</td><td class="r num hm">${r.tr.toLocaleString()}</td><td class="r num hm">${r.h.toLocaleString()}</td></tr>`).join('');
    $$('#an-stocks tr[data-go]').forEach(r=>r.onclick=()=>SP.go(r.dataset.go)); }

  /* ---------- top coins ---------- */
  function topCoins(){ const stat={}; TR.forEach(t=>{ const s=stat[t.token]||(stat[t.token]={vol:0,fees:0}); s.vol+=usdOf(t); s.fees+=feeUsd(t); });
    const l=TOK.map(x=>({x,vol:(stat[x.addr]||{}).vol||0,fees:(stat[x.addr]||{}).fees||0,h:x.h||0})).sort((a,b)=>b[topBy]-a[topBy]).slice(0,10);
    $('#an-top-h').textContent=topBy==='vol'?'Volume':topBy==='fees'?'Fees paid':'Holders';
    $('#an-top tbody').innerHTML=l.length?l.map((r,i)=>{ const st=SP.stockBySym(r.x.pair); return `<tr class="go" data-go="${tokenUrl(r.x)}"><td class="num muted">${i+1}</td><td><div class="coin"><span class="av2"><img class="lg" src="${SP.coinLogo(r.x)}" alt="" onerror="this.onerror=null;this.src='${DEF_LOGO}'"><img class="stb" src="${pairImg(r.x.pair)}" alt=""></span><div><b>${esc(r.x.n)}</b><small>$${esc(r.x.t)}</small></div></div></td><td><span class="pairchip"><img src="${pairImg(r.x.pair)}" alt="">${esc(st?st.ticker:'ETH')}</span></td><td class="r num">${topBy==='h'?r.h.toLocaleString():fmtUsd(r[topBy])}</td><td class="r num hm">${fmtUsd(r.x.mc)}</td></tr>`; }).join(''):'<tr><td colspan="5"><div class="empty">No coins yet</div></td></tr>';
    $$('#an-top tr[data-go]').forEach(r=>r.onclick=()=>SP.go(r.dataset.go)); }

  /* ---------- top creators ---------- */
  function creators(){ const stat={}; const fee=x=>(x.feeBps||100)/10000; TOK.forEach(x=>{ const c=stat[x.creator]||(stat[x.creator]={n:0,fees:0,vol:0}); c.n++; }); const volBy={}; TR.forEach(t=>{ volBy[t.token]=(volBy[t.token]||0)+usdOf(t); });
    TOK.forEach(x=>{ const c=stat[x.creator]; const dv=((x.genes||{}).divShareBps||0)/10000; c.vol+=volBy[x.addr]||0; c.fees+=(x.totalCreatorFees||0)*(x.pairUsd||0); });
    const l=Object.entries(stat).map(([w,c])=>({w,...c})).sort((a,b)=>b.fees-a.fees||b.vol-a.vol).slice(0,10);
    $('#an-creators tbody').innerHTML=l.length?l.map((r,i)=>`<tr class="go" data-go="/profile?a=${r.w}"><td class="num muted">${i+1}</td><td><span class="w"><span class="av">${SP.avatar(r.w,20)}</span><a href="/profile?a=${r.w}">${shortAddr(cs(r.w))}</a></span></td><td class="r num">${r.n}</td><td class="r num">${fmtUsd(r.fees)}</td><td class="r num hm">${fmtUsd(r.vol)}</td></tr>`).join(''):'<tr><td colspan="5"><div class="empty">No creators yet</div></td></tr>';
    $$('#an-creators tr[data-go]').forEach(r=>r.onclick=e=>{ if(e.target.closest('a')) return; SP.go(r.dataset.go); }); }

  /* ---------- feed ---------- */
  function feed(fresh){ const l=TR.slice().sort((a,b)=>b.ts-a.ts||(b.index||0)-(a.index||0)).slice(0,20); $('#an-feed-n').textContent=TR.length?TR.length.toLocaleString()+' trades':'';
    $('#an-feed').innerHTML=l.length?l.map(t=>{ const x=tok(t.token); if(!x) return ''; const k=t.tx+':'+t.index; const pair=Number(t.pair)/1e18; return `<a class="fr ${fresh&&fresh.has(k)?'new':''}" href="${tokenUrl(x)}"><span class="side ${t.buy?'b':'s'}">${t.buy?'Buy':'Sell'}</span><div class="coin"><img class="lg" src="${SP.coinLogo(x)}" alt="" onerror="this.onerror=null;this.src='${DEF_LOGO}'"><div><b>${esc(x.n)}</b><small>$${esc(x.t)} · ${shortAddr(cs(String(t.wallet)))}</small></div></div><span class="v">${fmtUsd(usdOf(t))}<small>${SP.fmtPair(pair,x)}</small></span><span class="t">${ago(Math.max(0,now()-t.ts))} ago</span></a>`; }).join(''):'<div class="empty">No trades yet</div>'; }

  async function load(first){ try{ const tr=(await CHAIN.allTrades()).filter(t=>tok(t.token)); const fresh=new Set(tr.filter(t=>!seen.has(t.tx+':'+t.index)).map(t=>t.tx+':'+t.index)); tr.forEach(t=>seen.add(t.tx+':'+t.index)); TR=tr; render(first?null:fresh); }catch(e){ console.warn('analytics',e); if(first) $('#an-kpis').innerHTML=`<div class="notice warn" style="grid-column:1/-1">${ic('warn')}<span>Could not load the trade index (${esc(SP.errMsg(e))}).</span></div>`; } }
  function render(fresh){ kpis(); byStock(); topCoins(); creators(); feed(fresh); }
  $$('#an-range button').forEach(b=>b.onclick=()=>{ range=+b.dataset.r; $$('#an-range button').forEach(x=>x.classList.toggle('on',x===b)); kpis(); });
  $$('#an-topby button').forEach(b=>b.onclick=()=>{ topBy=b.dataset.k; $$('#an-topby button').forEach(x=>x.classList.toggle('on',x===b)); topCoins(); });
  $('#an-kpis').innerHTML='<div class="panel kpi"><span class="sk w6"></span></div>'.repeat(4);
  load(true); SP.onUpdate(()=>load(false)); setInterval(()=>{ if(!document.hidden) load(false); },15000);
};
