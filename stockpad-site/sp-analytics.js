/* Analytics page: one range (24h, 7d, 30d, all) for everything. A band of headline figures against the period before,
   a chart stacked by chain, every chain's liquidity, volume and trades, leaderboards, live trades, and where the fees went.
   Everything comes from the trade index (CHAIN.allTrades) and the token list; USD uses each coin's pair price. */
window.SP_PAGE=function(){
  const pg=$('#pg-analytics'); if(!pg) return;
  const RANGES={ '24h':[86400,3600,'past 24 hours'], '7d':[7*86400,6*3600,'past 7 days'], '30d':[30*86400,86400,'past 30 days'], all:[0,86400,'all time'] };
  let range='7d', metric='vol', board='coins', boardBy='vol', chBy='liq', TR=[], seen=new Set();
  const DAY=86400, now=()=>Math.floor(Date.now()/1000);
  const tok=a=>TOK.find(x=>x.addr===String(a||'').toLowerCase())||null;
  const usdOf=t=>{ const x=tok(t.token); return x?Number(t.pair)/1e18*(x.pairUsd||0):0; };
  const feeUsd=t=>{ const x=tok(t.token); return x?Number(t.fee)/1e18*(x.pairUsd||0):0; };
  const chOf=t=>t.chain||'eth';
  const wKey=a=>{ a=String(a||''); return /^0x/i.test(a)?a.toLowerCase():a; };
  const sum=(l,f)=>l.reduce((s,v)=>s+f(v),0);
  const logo=x=>`<img class="lg" src="${SP.coinLogo(x)}" alt="" onerror="this.onerror=null;this.src='${DEF_LOGO}'">`;
  const chainsOn=()=>SP.chains.filter(c=>c.live||TOK.some(x=>SP.coinChains(x).includes(c.key)));

  /* ---------- the range: its window, the one before it, and its buckets ---------- */
  function win(){ const t1=now(), [len,st0]=RANGES[range]; let t0, step=st0;
    if(len) t0=t1-len; else { const first=Math.min(t1-7*DAY,...TOK.map(x=>x.createdAt||t1),...TR.map(t=>t.ts)); t0=Math.floor(first/DAY)*DAY; if(t1-t0>120*DAY) step=7*DAY; }
    const b0=Math.floor(t0/step)*step, B=[]; for(let b=b0;b<=t1;b+=step) B.push(b);
    return {t0,t1,len,step,B,prev:len?[t0-len,t0]:null}; }
  const inW=(W,t)=>t.ts>=W.t0;

  /* ---------- headline figures, each against the period before ---------- */
  function band(W){ const cur=TR.filter(t=>inW(W,t)), pre=W.prev?TR.filter(t=>t.ts>=W.prev[0]&&t.ts<W.prev[1]):null;
    const figs=l=>({vol:sum(l,usdOf),fees:sum(l,feeUsd),trades:l.length,traders:new Set(l.map(t=>wKey(t.wallet))).size});
    const a=figs(cur), b=pre?figs(pre):null, launched=TOK.filter(x=>(x.createdAt||0)>=W.t0).length, launchedB=W.prev?TOK.filter(x=>(x.createdAt||0)>=W.prev[0]&&(x.createdAt||0)<W.prev[1]).length:null;
    const d=(v,p)=>{ if(p==null) return ''; if(!p) return v?'<em class="up">new</em>':''; const c=(v/p-1)*100; return `<em class="${c>=0?'up':'dn'}">${c>=0?'▲':'▼'} ${Math.abs(c)>=1000?Math.round(Math.abs(c)).toLocaleString():Math.abs(c).toFixed(1)}%</em>`; };
    const K=[['Volume',fmtUsd(a.vol),d(a.vol,b&&b.vol)],['Fees',fmtUsd(a.fees),d(a.fees,b&&b.fees)],['Trades',a.trades.toLocaleString(),d(a.trades,b&&b.trades)],['Traders',a.traders.toLocaleString(),d(a.traders,b&&b.traders)],['New coins',launched.toLocaleString(),d(launched,launchedB)]];
    $('#an-band').innerHTML=K.map(k=>`<div class="st"><span class="l">${k[0]}</span><b>${k[1]}</b><span class="d">${k[2]||'&nbsp;'}${k[2]&&W.prev?'<small>vs the period before</small>':''}</span></div>`).join(''); }

  /* ---------- chart: per bucket, stacked by chain ---------- */
  let CH=null;
  function chart(W){ const keys=chainsOn().map(c=>c.key), n=W.B.length, idx=t=>Math.min(n-1,Math.floor((t-W.B[0])/W.step));
    const rows=W.B.map(t=>({t,by:{},tot:0}));
    if(metric==='new') TOK.forEach(x=>{ const c=x.createdAt||0; if(c<W.B[0]) return; const r=rows[idx(c)]; r.by._=(r.by._||0)+1; r.tot++; });
    else TR.forEach(t=>{ if(t.ts<W.B[0]) return; const v=metric==='vol'?usdOf(t):metric==='fees'?feeUsd(t):1; const r=rows[idx(t.ts)], k=chOf(t); r.by[k]=(r.by[k]||0)+v; r.tot+=v; });
    CH={W,rows,keys}; drawChart();
    const on=metric==='new'?[]:keys.filter(k=>rows.some(r=>r.by[k]>0));
    $('#an-lgd').innerHTML=on.map(k=>{ const c=SP.chain(k)||{}; return `<span><i style="background:${c.color}"></i>${esc(c.short||c.name||k)}</span>`; }).join('');
    const tot=sum(rows,r=>r.tot); $('#an-ch-tot').innerHTML=`<b>${metric==='vol'||metric==='fees'?fmtUsd(tot):tot.toLocaleString()}</b><span>${RANGES[range][2]}</span>`; }
  const nice=v=>{ if(!(v>0)) return 1; const p=Math.pow(10,Math.floor(Math.log10(v))), f=v/p; return ([1,1.2,1.6,2,2.5,3,4,5,6,8,10].find(s=>f<=s)||10)*p; };
  const fmtM=v=>metric==='vol'||metric==='fees'?fmtUsd(v).replace('.00',''):Math.round(v).toLocaleString();
  function tlab(t,full){ const d=new Date(t*1000), s=CH.W.step;
    if(full) return s<DAY?d.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric'}):s>DAY?'Week of '+d.toLocaleDateString(undefined,{month:'short',day:'numeric'}):d.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});
    return s<DAY&&CH.W.len<=DAY?d.toLocaleTimeString(undefined,{hour:'numeric'}):d.toLocaleDateString(undefined,{month:'short',day:'numeric'}); }
  function drawChart(hi){ const box=$('#an-chart'); if(!CH||!box) return; const {rows,keys}=CH, n=rows.length;
    const Wd=Math.max(280,box.clientWidth), Hd=box.clientHeight||260, L=4, R=54, T=10, B=24, pw=Wd-L-R, ph=Hd-T-B;
    const mx=nice(Math.max(...rows.map(r=>r.tot),0)*1.08), slot=pw/n, bw=Math.max(2,Math.min(28,slot*0.62)), ys=v=>T+ph-(v/mx)*ph;
    let s=`<svg viewBox="0 0 ${Wd} ${Hd}" width="${Wd}" height="${Hd}" aria-hidden="true">`;
    [0.25,0.5,0.75,1].forEach(f=>{ const y=ys(mx*f); s+=`<line class="g" x1="${L}" x2="${L+pw}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/><text class="yl" x="${L+pw+8}" y="${(y+4).toFixed(1)}">${fmtM(mx*f)}</text>`; });
    s+=`<line class="base" x1="${L}" x2="${L+pw}" y1="${T+ph}" y2="${T+ph}"/>`;
    if(hi!=null) s+=`<rect class="hl" x="${(L+slot*hi+1).toFixed(1)}" y="${T}" width="${(slot-2).toFixed(1)}" height="${ph}" rx="6"/>`;
    rows.forEach((r,i)=>{ const x=L+slot*i+(slot-bw)/2; let y=T+ph; const segs=metric==='new'?[['_',r.by._||0]]:keys.map(k=>[k,r.by[k]||0]).filter(q=>q[1]>0);
      segs.forEach(([k,v],j)=>{ const h=Math.max(1.5,(v/mx)*ph); y-=h; const c=k==='_'?'var(--ac)':(SP.chain(k)||{}).color||'#8e8e97'; s+=`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1,h-(j<segs.length-1?1:0)).toFixed(1)}" rx="${Math.min(3,bw/3)}" fill="${c}" opacity="${hi==null||hi===i?1:.45}"/>`; });
      if(!segs.length) s+=`<rect x="${x.toFixed(1)}" y="${(T+ph-1.5).toFixed(1)}" width="${bw.toFixed(1)}" height="1.5" rx="1" class="z"/>`; });
    const lab=Math.max(2,Math.min(7,Math.floor(pw/90))); for(let j=0;j<lab;j++){ const i=Math.round(j*(n-1)/(lab-1)); s+=`<text class="xl" x="${(L+slot*i+slot/2).toFixed(1)}" y="${Hd-6}" text-anchor="${j===0?'start':j===lab-1?'end':'middle'}">${tlab(rows[i].t)}</text>`; }
    box.innerHTML=s+'</svg><div class="tip" id="an-tip" hidden></div>';
    if(hi!=null) tip(hi,L+slot*hi+slot/2,Wd); }
  function tip(i,x,Wd){ const r=CH.rows[i], el=$('#an-tip'); if(!el) return; const segs=metric==='new'?[]:CH.keys.map(k=>[k,r.by[k]||0]).filter(q=>q[1]>0).sort((a,b)=>b[1]-a[1]);
    el.innerHTML=`<div class="tt">${tlab(r.t,true)}</div><div class="tv">${fmtM(r.tot)}<small>${metric==='vol'?'volume':metric==='fees'?'fees':metric==='trades'?'trades':'new coins'}</small></div>${segs.map(([k,v])=>{ const c=SP.chain(k)||{}; return `<div class="tr"><i style="background:${c.color}"></i>${esc(c.name||k)}<b>${fmtM(v)}</b></div>`; }).join('')}`;
    el.hidden=false; const w=el.offsetWidth; el.style.left=Math.max(4,Math.min(Wd-w-4,x+14>Wd-w-60?x-w-14:x+14))+'px'; }
  const cbox=$('#an-chart');
  cbox.addEventListener('pointermove',e=>{ if(!CH) return; const r=cbox.getBoundingClientRect(), pw=Math.max(280,cbox.clientWidth)-58, i=Math.floor((e.clientX-r.left-4)/(pw/CH.rows.length)); if(i<0||i>=CH.rows.length){ drawChart(); return; } if(cbox.dataset.hi!==String(i)){ cbox.dataset.hi=i; drawChart(i); } });
  cbox.addEventListener('pointerleave',()=>{ cbox.dataset.hi=''; drawChart(); });
  new ResizeObserver(()=>drawChart()).observe(cbox);

  /* ---------- every chain: liquidity now, volume and trades in the range ---------- */
  function chains(W){ const cur=TR.filter(t=>inW(W,t));
    const L=chainsOn().map(c=>{ const k=c.key, coins=TOK.filter(x=>SP.coinChains(x).includes(k));
      const liq=sum(coins,x=>{ const p=x.pools&&x.pools[k]; return p&&p.liquidityUsd!=null?p.liquidityUsd:SP.coinChains(x).length===1?(x.liqAll||x.liq||0):0; });
      const tr=cur.filter(t=>chOf(t)===k); return {c,k,liq,pools:coins.length,vol:sum(tr,usdOf),trades:tr.length}; });
    const val=r=>r[chBy], tot=sum(L,val); L.sort((a,b)=>val(b)-val(a)||b.pools-a.pools);
    const f=v=>chBy==='trades'?v.toLocaleString():fmtUsd(v);
    $('#an-cht').innerHTML=`<b>${f(tot)}</b><span>${chBy==='liq'?'in every pool now':RANGES[range][2]}</span>`;
    $('#an-chbar').innerHTML=tot?L.filter(r=>val(r)>0).map(r=>`<i style="flex:${val(r)};background:${r.c.color}" title="${esc(r.c.name)} ${f(val(r))}"></i>`).join(''):'<i style="flex:1;background:var(--s4)"></i>';
    $('#an-chl').innerHTML=L.map(r=>{ const sh=tot?val(r)/tot*100:0; return `<a class="cr" href="/markets?chain=${r.k}" style="--c:${r.c.color}"><img src="${r.c.logo}" alt=""><span class="nm"><b>${esc(r.c.name)}</b><small>${r.pools?`${r.pools} pool${r.pools===1?'':'s'} · ${r.trades.toLocaleString()} trades`:'No pools yet'}</small></span><span class="v"><b>${f(val(r))}</b><small>${sh.toFixed(sh&&sh<1?1:0)}%</small></span><span class="br"><i style="width:${sh.toFixed(2)}%"></i></span></a>`; }).join(''); }

  /* ---------- leaderboards ---------- */
  const BOARDS={ coins:[['vol','Volume'],['fees','Fees'],['mc','Market cap'],['h','Holders']], traders:[['pnl','PnL'],['vol','Volume']], creators:[['fees','Fees earned'],['vol','Volume']] };
  function boards(W){ const cur=TR.filter(t=>inW(W,t)); const by=BOARDS[board];
    $('#an-bsort').innerHTML=by.map(b=>`<button data-k="${b[0]}" class="${b[0]===boardBy?'on':''}">${b[1]}</button>`).join(''); $('#an-bsort').hidden=!by.length;
    $$('#an-bsort button').forEach(b=>b.onclick=()=>{ boardBy=b.dataset.k; render(); });
    const rank=i=>`<span class="rk r${i+1}">${i+1}</span>`; let rows=[];
    if(board==='coins'){ const st={}; cur.forEach(t=>{ const s=st[t.token]||(st[t.token]={vol:0,fees:0}); s.vol+=usdOf(t); s.fees+=feeUsd(t); });
      rows=TOK.map(x=>({x,vol:(st[x.addr]||{}).vol||0,fees:(st[x.addr]||{}).fees||0,mc:x.mc||0,h:x.h||0})).sort((a,b)=>b[boardBy]-a[boardBy]).slice(0,10)
        .map((r,i)=>`<a class="lr" href="${tokenUrl(r.x)}">${rank(i)}<span class="who">${logo(r.x)}<span><b>${esc(r.x.n)}</b><small>$${esc(r.x.t)} ${SP.chainStack(SP.coinChains(r.x),14)}</small></span></span><span class="v"><b>${boardBy==='h'?r.h.toLocaleString():fmtUsd(r[boardBy])}</b><small>${boardBy==='mc'?fmtUsd(r.vol)+' vol':'MC '+fmtUsd(r.mc)}</small></span></a>`); }
    else if(board==='traders'){ const P={}; cur.forEach(t=>{ const x=tok(t.token); if(!x) return; const w=wKey(t.wallet); const r=P[w]||(P[w]={w,pos:{},vol:0,n:0}); const p=r.pos[x.addr]||(r.pos[x.addr]={x,cash:0,net:0}); const pair=Number(t.pair)/1e18, coin=Number(t.coin)/1e18; if(t.buy){ p.cash-=pair; p.net+=coin; } else { p.cash+=pair; p.net-=coin; } r.vol+=pair*(x.pairUsd||0); r.n++; });
      rows=Object.values(P).map(r=>({...r,pnl:sum(Object.values(r.pos),p=>p.cash*(p.x.pairUsd||0)+Math.max(0,p.net)*(p.x.px||0))})).sort((a,b)=>b[boardBy]-a[boardBy]).slice(0,10)
        .map((r,i)=>`<a class="lr" href="/profile?a=${r.w}">${rank(i)}<span class="who"><span class="av">${SP.avatar(r.w,32)}</span><span><b>${shortAddr(cs(r.w))}</b><small>${r.n.toLocaleString()} trades · ${Object.keys(r.pos).length} coin${Object.keys(r.pos).length===1?'':'s'}</small></span></span><span class="v"><b class="${boardBy==='pnl'?(r.pnl>=0?'up':'dn'):''}">${boardBy==='pnl'?(r.pnl>=0?'+':'-')+fmtUsd(Math.abs(r.pnl)):fmtUsd(r.vol)}</b><small>${boardBy==='pnl'?fmtUsd(r.vol)+' vol':(r.pnl>=0?'+':'-')+fmtUsd(Math.abs(r.pnl))+' PnL'}</small></span></a>`); }
    else if(board==='creators'){ const C={}, vb={}; cur.forEach(t=>{ vb[t.token]=(vb[t.token]||0)+usdOf(t); });
      TOK.forEach(x=>{ const c=C[x.creator]||(C[x.creator]={w:x.creator,n:0,fees:0,vol:0}); c.n++; c.vol+=vb[x.addr]||0; c.fees+=(x.totalCreatorFees||0)*(x.pairUsd||0); });
      rows=Object.values(C).filter(r=>r.w).sort((a,b)=>b[boardBy]-a[boardBy]).slice(0,10)
        .map((r,i)=>`<a class="lr" href="/profile?a=${r.w}">${rank(i)}<span class="who"><span class="av">${SP.avatar(r.w,32)}</span><span><b>${shortAddr(cs(r.w))}</b><small>${r.n} coin${r.n===1?'':'s'}</small></span></span><span class="v"><b>${fmtUsd(r[boardBy])}</b><small>${boardBy==='fees'?fmtUsd(r.vol)+' vol':fmtUsd(r.fees)+' earned'}</small></span></a>`); }
    const empty={coins:'No coins yet',traders:'No trades in this range',creators:'No creators yet'}[board];
    $('#an-board').innerHTML=rows.join('')||`<div class="empty">${empty}</div>`; }
  $$('#an-btabs button').forEach(b=>b.onclick=()=>{ board=b.dataset.b; boardBy=(BOARDS[board][0]||[''])[0]; $$('#an-btabs button').forEach(x=>x.classList.toggle('on',x===b)); render(); });

  /* ---------- live trades ---------- */
  function feed(fresh){ const l=TR.slice().sort((a,b)=>b.ts-a.ts||(b.index||0)-(a.index||0)).slice(0,16);
    $('#an-feed').innerHTML=l.length?l.map(t=>{ const x=tok(t.token); if(!x) return ''; const k=t.tx+':'+t.index, c=SP.chain(chOf(t))||{}; return `<a class="fr ${fresh&&fresh.has(k)?'new':''}" href="${tokenUrl(x)}"><span class="cl">${logo(x)}<img class="cb" src="${c.logo||'/img/eth.png'}" alt="" title="${esc(c.name||'')}"></span><span class="nm"><b>${esc(x.n)}</b><small><span class="${t.buy?'up':'dn'}">${t.buy?'Buy':'Sell'}</span> · ${shortAddr(cs(String(t.wallet)))}</small></span><span class="v"><b>${fmtUsd(usdOf(t))}</b><small>${ago(Math.max(0,now()-t.ts))} ago</small></span></a>`; }).join(''):'<div class="empty">No trades yet</div>'; }

  /* ---------- where the fees went: each coin's genes split its fees ---------- */
  const splitOf=x=>{ const g=x.genes||{}; const h=(g.divShareBps||0)/10000, b=(g.buybackShareBps||0)/10000; const rest=Math.max(0,1-h-b); return {h,b,c:rest*0.6,p:rest*0.4}; };
  const FC=[['c','Creators','var(--ac)'],['h','Holder rewards','var(--amber)'],['b','Buyback & burn','var(--dn)'],['p','Platform','#8e8e97']];
  function fees(W){ const cur=TR.filter(t=>inW(W,t)); const per=TOK.map(x=>{ const sp=splitOf(x), paid=sum(cur.filter(t=>t.token===x.addr),feeUsd); return {x,sp,paid,c:paid*sp.c,h:paid*sp.h,b:paid*sp.b,p:paid*sp.p}; });
    const T={paid:0,c:0,h:0,b:0,p:0}; per.forEach(r=>{ for(const k in T) T[k]+=r[k]; }); const pu=x=>x.pairUsd||0;
    const owed={c:sum(TOK,x=>(x.creatorOwed||0)*pu(x)),h:sum(TOK,x=>(x.dividendPot||0)*pu(x)),b:sum(TOK,x=>(x.buybackPot||0)*pu(x)),p:sum(TOK,x=>(x.platformOwed||0)*pu(x))};
    const sub={c:`${fmtUsd(owed.c)} claimable now`,h:`${fmtUsd(owed.h)} waiting to pay out`,b:`${fmtUsd(owed.b)} waiting to buy back`,p:`${fmtUsd(owed.p)} claimable now`};
    let a=0; const stops=T.paid?FC.map(f=>{ const s=a; a+=T[f[0]]/T.paid*360; return `${f[2]} ${s.toFixed(2)}deg ${a.toFixed(2)}deg`; }).join(','):'var(--s4) 0deg 360deg';
    $('#an-donut').style.background=`conic-gradient(${stops})`; $('#an-donut').innerHTML=`<span><b>${fmtUsd(T.paid)}</b><small>fees, ${RANGES[range][2]}</small></span>`;
    $('#an-flegend').innerHTML=FC.map(f=>`<div class="fl"><i style="background:${f[2]}"></i><span class="n"><b>${f[1]}</b><small>${sub[f[0]]}</small></span><span class="v"><b>${fmtUsd(T[f[0]])}</b><small>${T.paid?(T[f[0]]/T.paid*100).toFixed(0):0}%</small></span></div>`).join('');
    const rows=per.filter(r=>r.paid>0).sort((a,b)=>b.paid-a.paid).slice(0,8);
    $('#an-fcoins').innerHTML=rows.length?rows.map(r=>{ const sp=r.sp; return `<a class="fc" href="${tokenUrl(r.x)}"><span class="who">${logo(r.x)}<span><b>${esc(r.x.n)}</b><small>${((r.x.feeBps||100)/100).toFixed(2)}% fee</small></span></span><span class="sp4" title="Creator ${Math.round(sp.c*100)}% · holders ${Math.round(sp.h*100)}% · buyback ${Math.round(sp.b*100)}% · platform ${Math.round(sp.p*100)}%">${FC.map(f=>`<i style="flex:${sp[f[0]]};background:${f[2]}"></i>`).join('')}</span><b class="v">${fmtUsd(r.paid)}</b></a>`; }).join(''):'<div class="empty">No fees in this range</div>'; }

  /* ---------- cashback, from the hook's events (the platform's share pays it) ---------- */
  let rwAt=0;
  async function rewards(){ const EQ=window.CHAIN&&CHAIN.equo, box=$('#an-rwk'); if(!EQ||!box||!EQ.rewardStats) return; if(Date.now()-rwAt<60000) return; rwAt=Date.now();
    if(EQ.split) EQ.split().then(sp=>{ $('#an-rw-split').textContent=`${sp.cashbackBps/100}% of the platform share`; }).catch(()=>{});
    try{ const r=await EQ.rewardStats(SP.prices);
      box.innerHTML=[['Cashback paid',fmtUsd(r.cashback),`${r.earners.toLocaleString()} trader${r.earners===1?'':'s'}`],['Claimed',fmtUsd(r.claimed),'by the earners'],['Unclaimed',fmtUsd(r.unclaimed),'held by the hook']].map(f=>`<div><span>${f[0]}</span><b>${f[1]}</b><small>${f[2]}</small></div>`).join(''); }
    catch(e){ rwAt=0; box.innerHTML=`<div class="wide muted">Could not load rewards (${esc(SP.errMsg(e))}).</div>`; } }

  async function load(first){ try{ const tr=(await CHAIN.allTrades()).filter(t=>tok(t.token)); const fresh=new Set(tr.filter(t=>!seen.has(t.tx+':'+t.index)).map(t=>t.tx+':'+t.index)); tr.forEach(t=>seen.add(t.tx+':'+t.index)); TR=tr; render(first?null:fresh); }
    catch(e){ console.warn('analytics',e); if(first) $('#an-band').innerHTML=`<div class="notice warn" style="grid-column:1/-1">${ic('warn')}<span>Could not load the trade index (${esc(SP.errMsg(e))}).</span></div>`; } }
  function render(fresh){ const W=win(); band(W); chart(W); chains(W); boards(W); feed(fresh); fees(W); rewards(); }
  const seg=(id,set)=>$$('#'+id+' button').forEach(b=>b.onclick=()=>{ set(b.dataset.v); $$('#'+id+' button').forEach(x=>x.classList.toggle('on',x===b)); render(); });
  seg('an-range',v=>{ range=v; }); seg('an-metric',v=>{ metric=v; }); seg('an-chby',v=>{ chBy=v; });
  $('#an-band').innerHTML='<div class="st"><span class="sk w6"></span></div>'.repeat(5);
  $('#an-rwk').innerHTML=['Cashback paid','Claimed','Unclaimed'].map(l=>`<div><span>${l}</span><b>—</b><small>reading the hook…</small></div>`).join('');
  load(true); SP.onUpdate(()=>load(false)); setInterval(()=>{ if(!document.hidden) load(false); },15000);
};
