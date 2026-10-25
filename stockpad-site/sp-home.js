/* Markets page: bold hero with a belt of featured coins, a sticky toolbar (sort, watchlist, chain, search), a grid of
   square coin cards with a small sparkline, pager. */
window.SP_PAGE=function(){
  const pg=$('#pg-markets'); if(!pg) return;
  const params=new URLSearchParams(location.search); let chain=params.get('chain')||'', sort='trend', q='', page=1, watchOnly=params.get('watch')==='1'; const PER=30;
  const now=()=>Math.floor(Date.now()/1000);
  const fee=x=>(x.feeBps||100)/100;
  const match=x=>{ if(!q) return true; const v=q.toLowerCase(); return x.n.toLowerCase().includes(v)||x.t.toLowerCase().includes(v)||x.addr.includes(v); };
  const list=()=>TOK.filter(x=>(!chain||SP.coinChains(x).includes(chain))&&(!watchOnly||SP.watch.has(x.addr))&&match(x));
  const score=x=>(x.vol||0)*2+(x.mc||0)*0.1+Math.max(0,86400*3-(now()-(x.createdAt||0)))*0.01;
  function sorted(){ const l=list().slice();
    if(sort==='new') l.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)); else if(sort==='vol') l.sort((a,b)=>(b.vol||0)-(a.vol||0)); else if(sort==='mc') l.sort((a,b)=>(b.mc||0)-(a.mc||0)); else l.sort((a,b)=>score(b)-score(a)); return l; }
  const chg=x=>{ const c=x.c24||0; return `<span class="ch ${c>=0?'up':'dn'}">${c>=0?'▲':'▼'} ${Math.abs(c).toFixed(1)}%</span>`; };
  // the coin's logo, centred over a blurred copy of itself
  const logo=x=>{ const src=SP.coinLogo(x), err=`onerror="this.onerror=null;this.src='${DEF_LOGO}'"`; return `<img class="bg" src="${src}" alt="" loading="lazy" aria-hidden="true" ${err}><img class="lg" src="${src}" alt="" loading="lazy" ${err}>`; };

  /* ---------- sparkline from the last day of trades ---------- */
  const TRC={};
  async function spark(x){ const k=x.addr; const c=TRC[k]; if(c&&Date.now()-c.at<60000) return c.svg;
    let svg=''; try{ const tr=(await CHAIN.trades(k)).slice().sort((a,b)=>a.ts-b.ts); const day=tr.filter(t=>t.ts>=now()-86400);
      let pts=day.map(t=>CHAIN.tradePrice(t)); if(pts.length<2) pts=tr.slice(-40).map(t=>CHAIN.tradePrice(t)); pts=pts.filter(v=>v>0); if(x.pxPair>0) pts.push(x.pxPair); if(pts.length===1) pts=[pts[0],pts[0]];
      if(pts.length>=2){ const W=100,H=30,P=2; const mn=Math.min(...pts), mx=Math.max(...pts), rg=(mx-mn)||mn||1; const step=(W-2*P)/(pts.length-1); const Y=v=>(H-P-((v-mn)/rg)*(H-2*P)).toFixed(1);
        const dir=pts[pts.length-1]>pts[0]*1.0005?'up':pts[pts.length-1]<pts[0]*0.9995?'dn':'flat';
        svg=`<svg class="spark ${dir}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path class="l" d="${pts.map((v,i)=>(i?'L':'M')+(P+i*step).toFixed(1)+' '+Y(v)).join(' ')}"/></svg>`; } }
    catch(e){ console.warn('trades',e); }
    TRC[k]={at:Date.now(),svg}; return svg; }
  function paintSparks(){ $$('[data-sp]',pg).forEach(async el=>{ const x=SP.token(el.dataset.sp); if(!x) return; el.innerHTML=(await spark(x))||'<svg class="spark flat" viewBox="0 0 100 30" preserveAspectRatio="none"><path class="l" d="M2 15 L98 15"/></svg>'; }); }

  /* ---------- hero: platform figures and the featured belt ---------- */
  function figs(){ const l=TOK; const vol=l.reduce((s,x)=>s+(x.vol||0),0), fees=l.reduce((s,x)=>s+(x.vol||0)*fee(x)/100,0), trades=l.reduce((s,x)=>s+(x.trades||0),0);
    $('#mk-figs').innerHTML=[['Vol 24h',fmtUsd(vol)],['Fees 24h',fmtUsd(fees)],['Coins',l.length.toLocaleString()],['Trades',trades.toLocaleString()]].map(s=>`<span>${s[0]}<b>${s[1]}</b></span>`).join(''); }
  let beltKey=null;
  function belt(){ const top=TOK.slice().sort((a,b)=>score(b)-score(a)).slice(0,10);
    // the busiest coins slide past; with no coins yet, one still card leads to the launch page
    const tilt=i=>['-3deg','2deg','-1.5deg','3deg','-2deg'][i%5];
    const key=top.map(x=>x.addr+Math.round(x.mc||0)).join(); if(key===beltKey) return; beltKey=key;
    const bl=$('#mk-belt'); bl.classList.toggle('still',!top.length);
    if(!top.length){ bl.innerHTML=`<a class="fc slot" href="/launch"><i>${ic('rocket')}</i><b>Be the first to launch</b><small>Live on every chain at once</small></a>`; return; }
    const one=top.map((x,i)=>`<a class="fc" href="${tokenUrl(x)}" style="--r:${tilt(i)}"><span class="im">${logo(x)}</span><span class="tx"><span style="min-width:0"><b>${esc(x.n)}</b><small>$${esc(x.t)}</small></span><span class="mc">${fmtUsd(x.mc||0)}</span></span></a>`).join('');
    // repeated to fill the width, then twice over, so the belt loops without a gap
    const fill=one.repeat(Math.ceil(6/top.length)); bl.innerHTML=fill+fill; bl.style.setProperty('--dur',Math.max(24,Math.ceil(6/top.length)*top.length*6)+'s'); }

  /* ---------- toolbar ---------- */
  const SORTS={trend:['flame','Trending'],mc:['coins','Top'],vol:['trend','Volume'],new:['clock','New']};
  $$('#mk-sort [data-s]').forEach(b=>{ const s=SORTS[b.dataset.s]; b.innerHTML=ic(s[0])+s[1]; b.onclick=()=>{ sort=b.dataset.s; page=1; render(); }; });
  $('#mk-qi').innerHTML=ic('search'); $('#mk-launch').innerHTML=ic('rocket')+'Launch a coin';
  function chainBtn(){ const c=SP.chain(chain), b=$('#mk-chain'); b.classList.toggle('on',!!chain); b.innerHTML=c?`<img src="${c.logo}" alt="">${esc(c.name)}${ic('down')}`:`${ic('globe')}All chains${ic('down')}`; }
  $('#mk-chain').onclick=e=>{ e.stopPropagation(); const cnt={}; TOK.forEach(x=>SP.coinChains(x).forEach(k=>{ cnt[k]=(cnt[k]||0)+1; }));
    const m=SP.menu(e.currentTarget,`<button data-ch="" class="${!chain?'on':''}">${ic('globe')}<span>All chains</span><span class="num muted" style="margin-left:auto">${TOK.length}</span></button>`+SP.chains.map(c=>`<button data-ch="${c.key}" class="${chain===c.key?'on':''}"><img src="${c.logo}" alt="" style="width:20px;height:20px;border-radius:50%"><span>${esc(c.name)}</span><span style="margin-left:auto">${c.live||cnt[c.key]?`<span class="num muted">${cnt[c.key]||0}</span>`:'<span class="soonb">Soon</span>'}</span></button>`).join(''));
    $$('[data-ch]',m).forEach(b=>b.onclick=()=>{ m.remove(); setChain(b.dataset.ch); }); };
  function setChain(k){ chain=k; page=1; const u=new URL(location.href); if(chain) u.searchParams.set('chain',chain); else u.searchParams.delete('chain'); history.replaceState(null,'',u); render(); }
  function setWatch(on){ watchOnly=on; page=1; const u=new URL(location.href); if(on) u.searchParams.set('watch','1'); else u.searchParams.delete('watch'); history.replaceState(null,'',u); render(); }
  $('#mk-watch').onclick=()=>setWatch(!watchOnly);
  const watchN=()=>SP.watch.list().filter(a=>TOK.some(x=>x.addr===a)).length;
  document.addEventListener('watch-change',()=>{ if(watchOnly) render(); else { const n=$('#mk-watch .n'); if(n) n.textContent=watchN(); } });
  let qt; $('#mk-q').addEventListener('input',e=>{ clearTimeout(qt); qt=setTimeout(()=>{ q=e.target.value.trim(); page=1; render(); },120); });

  /* ---------- cards ---------- */
  function card(x){ return `<a class="cd" href="${tokenUrl(x)}">
    <div class="im">${logo(x)}${x.rewards?`<span class="rw">${ic('star')}Rewards</span>`:''}<span class="st">${SP.star(x.addr)}</span><span class="chs2">${SP.chainStack(SP.coinChains(x),16)}</span></div>
    <div class="bd"><div class="r1"><b>${esc(x.n)}</b>${chg(x)}</div><span class="tk">$${esc(x.t)} · ${ageStr(x.age||'0s')}</span>
      <div class="r2"><span class="mc">${fmtUsd(x.mc||0)}</span><span class="sp" data-sp="${x.addr}"></span></div></div></a>`; }
  function render(){ figs(); belt(); chainBtn(); const l=sorted(); const pages=Math.max(1,Math.ceil(l.length/PER)); if(page>pages) page=pages;
    const slice=l.slice((page-1)*PER,page*PER);
    const wb=$('#mk-watch'); wb.classList.toggle('on',watchOnly); wb.innerHTML=`${ic('star')}Watchlist<span class="n">${watchN()}</span>`;
    $$('#mk-sort [data-s]').forEach(b=>b.classList.toggle('on',b.dataset.s===sort));
    $('#mk-cards').innerHTML=slice.length?slice.map(card).join(''):watchOnly?`<div class="empty"><b>Your watchlist is empty</b>Tap the star on any coin to keep it here.<div style="margin-top:14px"><button class="btn" id="mk-watch-off">Show all coins</button></div></div>`:chain&&!(SP.chain(chain)||{}).live?`<div class="empty"><b>${esc(SP.chain(chain).name)} opens with multichain launches</b>Coins launched there will show up here, with their price on every chain.<div style="margin-top:14px"><a class="btn pri" href="/launch">Launch a coin</a> <button class="btn" id="mk-chain-off">Show all chains</button></div></div>`:`<div class="empty"><b>${q?'No coins match that search':'No coins yet'}</b><div style="margin-top:14px"><a class="btn pri" href="/launch">Launch a coin</a></div></div>`;
    const wo=$('#mk-watch-off'); if(wo) wo.onclick=()=>setWatch(false); const co=$('#mk-chain-off'); if(co) co.onclick=()=>setChain('');
    $('#mk-pager').innerHTML=pages>1?`<button class="btn sm line" id="pg-prev" ${page<=1?'disabled':''}>Prev</button><span>${page} / ${pages}</span><button class="btn sm line" id="pg-next" ${page>=pages?'disabled':''}>Next</button>`:'';
    const go=d=>{ page+=d; render(); scrollTo({top:$('#mk-fbar').offsetTop-80,behavior:'smooth'}); };
    const pv=$('#pg-prev'), nx=$('#pg-next'); if(pv) pv.onclick=()=>go(-1); if(nx) nx.onclick=()=>go(1);
    if(window.CHAIN) paintSparks(); }
  // stars on cards toggle the watchlist without opening the coin
  pg.addEventListener('click',e=>{ if(e.target.closest('.wstar')) e.preventDefault(); },true);
  render(); SP.onUpdate(render);
};
