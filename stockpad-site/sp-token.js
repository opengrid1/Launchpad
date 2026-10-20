/* Token page: header, stat strip, TradingView chart, trades / holders / top traders / info panel,
   the trade card (quotes, slippage, buy, sell), the position and creator-fee cards, live refresh.
   Reads the coin address from /token/<addr> (cleanUrls rewrite) or /token.html?t=<addr>. */
window.SP_PAGE=function(){
  const pg=$('#pg-token'); if(!pg) return;
    const addrFromUrl=()=>{ const m=location.pathname.match(/\/token\/(0x[0-9a-fA-F]{40})/); if(m) return m[1].toLowerCase(); const q=new URLSearchParams(location.search).get('t')||''; return /^0x[0-9a-fA-F]{40}$/.test(q)?q.toLowerCase():''; };
  const addr=addrFromUrl(); let X=addr?SP.token(addr):null;
  if(!X||!window.CHAIN){ $('#tk-page').classList.add('hidden'); const e=$('#tk-empty'); e.classList.remove('hidden');
    $('#tk-crumb').innerHTML=`<a href="/">Markets</a>`; e.innerHTML=`<b>${addr?'Token not found':'No token selected'}</b>${addr?'No coin with that address was launched on StockPad, or it is not listed here.':'Open a coin from the markets page.'}<div style="margin-top:14px"><a class="btn" href="/">${ic('back')}Back to markets</a></div>`; return; }
  X={...X};
  const C=(window.INKY&&INKY.contracts)||{}; const PM=String(C.poolManager||'').toLowerCase();
  const stock=SP.stockBySym(X.pair); const isStock=X.pair!=='ETH';
  const inPair=v=>(X.pair!=='ETH'&&v>0&&v<1e-4)?fmtPrice(v)+' '+X.pair:SP.fmtPair(v,X), pairUsd=()=>X.pairUsd||SP.prices[String(X.pairAddr||'').toLowerCase()]||0, ethUsd=()=>SP.prices[WETH]||ETH||0;
  const feePct=()=>((X.feeBps||100)/100).toFixed(2), feeR=()=>(X.feeBps||100)/10000;
  const youTag=a=>SP.W.connected&&a===SP.W.address?'<span class="tag mint">you</span>':'';
  const wl=(a,tags='')=>`<span class="w"><span class="av">${SP.avatar(a,20)}</span><a href="${EXPLORER}/address/${a}" target="_blank" rel="noopener">${shortAddr(cs(a))}</a>${tags}${youTag(a)}</span>`;
  const emptyRow=(n,t)=>`<tr><td colspan="${n}"><div class="empty">${t}</div></td></tr>`;
  const agoTxt=ts=>ago(Math.max(0,Math.floor(Date.now()/1000)-ts))+' ago';
  const stockPx=()=>SP.prices[String(X.pairAddr||'').toLowerCase()]||X.pairUsd||0;
  const fmtStockPx=p=>p?'$'+(p>=100?p.toFixed(0):p>=1?p.toFixed(2):fmtPrice(p)):'…';
  pg.addEventListener('click',e=>{ const b=e.target.closest('[data-copy]'); if(b){ e.preventDefault(); SP.copy(b.dataset.copy,'Address copied'); } });

  /* ---------- header ---------- */
  function head(){ const mk=SP.market();
    const links=[['Website',X.links&&X.links.web,'globe'],['X',X.links&&X.links.x,'ext'],['Telegram',X.links&&X.links.tg,'ext']].filter(l=>l[1]&&/^https?:\/\//i.test(l[1]));
    $('#tk-crumb').innerHTML=`<a href="/">Markets</a>${ic('chevr')}<a href="/?stock=${esc(X.pair)}">${esc(isStock&&stock?stock.ticker+' coins':'ETH coins')}</a>${ic('chevr')}<span class="dim">$${esc(X.t)}</span>`;
    $('#tk-head').innerHTML=`<span class="av2 big"><img class="lg" src="${SP.coinLogo(X)}" alt="" onerror="this.onerror=null;this.src='${DEF_LOGO}'"><img class="stb" src="${pairImg(X.pair)}" alt="" onerror="this.onerror=null;this.src='/img/eth.png'"></span>
      <div class="id">
        <div class="t1"><h1>${esc(X.n)}</h1><span class="sym">$${esc(X.t)}</span></div>
        <div class="t2"><span class="cpb" data-copy="${cs(X.addr)}" title="Copy address">${shortAddr(cs(X.addr))}${ic('copy')}</span><a class="cpb" href="${EXPLORER}/token/${X.addr}" target="_blank" rel="noopener" title="View on Etherscan">${ic('ext')}</a><span title="${esc(SP.fmtDate(X.createdAt))}">${ageStr(X.age||'0s')}</span><span class="badge">${feePct()}% fee</span>${X.rewards?`<span class="badge acl">★ Holder rewards</span>`:''}${links.map(l=>`<a class="lk" href="${esc(l[1])}" target="_blank" rel="noopener noreferrer nofollow">${ic(l[2])}${l[0]}</a>`).join('')}</div>
        ${X.desc?`<p class="desc">${esc(X.desc)}</p>`:''}
        <div class="by">Created by ${wl(X.creator)}</div>
      </div>
      <a class="pairbig" href="/?stock=${esc(X.pair)}" title="Paired with ${esc(X.pair)}"><img class="cl" src="${SP.coinLogo(X)}" alt="" onerror="this.onerror=null;this.src='${DEF_LOGO}'"><span><b>${esc(X.t)}</b></span><span class="sl">/</span><img src="${pairImg(X.pair)}" alt="" onerror="this.onerror=null;this.src='/img/eth.png'"><span><b class="st">${esc(X.pair)}</b><small><span id="tk-stock-px">${fmtStockPx(isStock?stockPx():ethUsd())}</span> · <span id="tk-stock-mk">${isStock?(mk.open?'NYSE open':'NYSE closed'):'24/7'}</span></small></span></a>`; }
  function headLive(){ const p=$('#tk-stock-px'); if(p) p.textContent=fmtStockPx(isStock?stockPx():ethUsd()); if(isStock){ const mk=SP.market(); const m=$('#tk-stock-mk'); if(m) m.textContent=mk.open?'NYSE open':'NYSE closed'; }
    $('#tk-chart-t').textContent=`${X.t} / ${X.pair}`; $('#tk-chart-r').textContent=`${fmtPrice(X.pxPair)} ${X.pair} · ${X.pair} at ${fmtStockPx(isStock?stockPx():ethUsd())}`; }

  /* ---------- stats ---------- */
  function stats(){ const pu=pairUsd(); const fees=X.totalCreatorFees||0;
    const S=[['Price','$'+fmtPrice(X.px)+SP.fmtPct(X.c24||0).replace('class="num','class="pc num'),`${fmtPrice(X.pxPair)} ${esc(X.pair)}`],['Market cap',fmtUsd(X.mc),inPair(X.pxPair*SUPPLY)],['Volume 24h',fmtUsd(X.vol),pu?inPair(X.vol/pu):'—'],['Trades',(X.trades||0).toLocaleString(),(X.traders||0).toLocaleString()+(X.traders===1?' trader':' traders')],['Holders',(X.h||0).toLocaleString(),'wallets'],['Liquidity',fmtUsd(X.liq),inPair(X.liqPair)]];
    $('#tk-stats').innerHTML=S.map(s=>`<div class="sbox lg"><span class="lab">${s[0]}</span><b>${s[1]}</b><i>${s[2]}</i></div>`).join('');
    const g=X.genes||{}; const dv=(g.divShareBps||0)/100, rest=100-dv, cr=Math.round(rest*0.6), pl=rest-cr;
    $('#tk-feespaid').textContent=`${feePct()}% · ${dv?dv+'% holders · ':''}${cr}% creator · ${pl}% platform`; $('#tk-feebar').innerHTML=(dv?`<i class="h" style="width:${dv}%"></i>`:'')+`<i class="c" style="width:${cr}%"></i><i class="p" style="flex:1"></i>`; }
  function flow(){ const t0=Math.floor(Date.now()/1000)-86400; const day=TR.filter(v=>v.ts>=t0); const bv=day.filter(v=>v.buy).reduce((s,v)=>s+v.pair,0), sv=day.filter(v=>!v.buy).reduce((s,v)=>s+v.pair,0);
    const el=$('#tk-flow'), sp=$('#tk-split'); if(!(bv+sv>0)){ el.textContent='no trades in 24h'; sp.innerHTML=''; return; } const b=Math.round(bv/(bv+sv)*100); el.textContent=`${b}% buys · ${100-b}% sells`; sp.innerHTML=`<i class="b" style="width:${b}%"></i><i class="s" style="flex:1"></i>`; }

  /* ---------- chart ---------- */
  let tvOn=false;
  function chart(){ const tv=$('#tv'); if(window.TradingView&&window.initTV){ try{ initTV('tv',X); tvOn=true; return; }catch(e){ console.warn('tv',e); } } tv.innerHTML='<div class="tvno">Chart unavailable: the charting library did not load.</div>'; }

  /* ---------- trades ---------- */
  let TR=[], seen=new Set(), filter='all', shown=25, launchTrade=null;
  const key=t=>t.tx+':'+t.index;
  const view=t=>({k:key(t),ts:Number(t.ts),buy:!!t.buy,coin:Number(t.coin)/1e18,pair:Number(t.pair)/1e18,pxPair:CHAIN.tradePrice(t),fee:Number(t.fee)/1e18,wallet:String(t.wallet).toLowerCase(),tx:t.tx,block:t.block,index:t.index});
  const sortTr=()=>TR.sort((a,b)=>(b.ts-a.ts)||((b.block||0)-(a.block||0))||((b.index||0)-(a.index||0)));
  function row(v,fresh){ const pu=pairUsd(); return `<tr data-k="${v.buy?'buy':'sell'}" class="${fresh&&fresh.has(v.k)?'new':''}"><td><span class="side ${v.buy?'b':'s'}">${v.buy?'Buy':'Sell'}</span></td><td>${wl(v.wallet,v.wallet===X.creator?'<span class="tag">creator</span>':'')}</td><td class="r num">${fmtAmt(v.coin)} <span class="muted">${esc(X.t)}</span></td><td class="r num">${inPair(v.pair)}<small>fee ${inPair(v.fee)}</small></td><td class="r num">${fmtUsd(v.pair*pu)}</td><td class="r num">$${fmtPrice(v.pxPair*pu)}<small>${fmtPrice(v.pxPair)} ${esc(X.pair)}</small></td><td><span class="num muted" data-ts="${v.ts}" title="${new Date(v.ts*1000).toLocaleString()}">${agoTxt(v.ts)}</span></td><td class="r"><a class="txl" href="${EXPLORER}/tx/${v.tx}" target="_blank" rel="noopener" title="View transaction">${ic('ext')}</a></td></tr>`; }
  function renderTrades(fresh){ const tb=$('#tk-trades'); const L=TR.filter(v=>filter==='all'||(filter==='buy')===v.buy);
    $('#tk-th-coin').textContent='Amount'; $('#tk-th-pair').textContent='Paid / received'; $('#tk-trades-n').textContent=TR.length?'('+TR.length.toLocaleString()+')':''; flow();
    if(!L.length){ tb.innerHTML=emptyRow(8,TR.length?'No '+filter+'s yet.':'No trades yet. The first buy shows up here within seconds.'); $('#tk-more').classList.add('hidden'); return; }
    tb.innerHTML=L.slice(0,shown).map(v=>row(v,fresh)).join(''); $('#tk-more').classList.toggle('hidden',L.length<=shown); }
  $('#tk-more-btn').onclick=()=>{ shown+=25; renderTrades(); };
  $$('#tk-filter button').forEach(b=>b.onclick=()=>{ filter=b.dataset.f; $$('#tk-filter button').forEach(x=>x.classList.toggle('on',x===b)); shown=25; renderTrades(); });
  setInterval(()=>{ const now=Math.floor(Date.now()/1000); $$('[data-ts]',pg).forEach(e=>e.textContent=ago(Math.max(0,now-+e.dataset.ts))+' ago'); },10000);
  async function loadTrades(){ const tb=$('#tk-trades'); tb.innerHTML=emptyRow(8,'Loading trades…'); try{ const tr=await CHAIN.trades(X.addr); TR=tr.map(view); TR.forEach(v=>seen.add(v.k)); sortTr(); launchTrade=TR.slice().reverse().find(v=>v.wallet===X.creator&&v.buy&&v.ts<=X.createdAt+2)||null; renderTrades(); if(activeTab==='info') info(); }catch(e){ tb.innerHTML=emptyRow(8,'Could not load trades: '+esc(SP.errMsg(e))); } }

  /* ---------- holders, top traders ---------- */
  let holdersAt=0, topAt=0;
  async function holders(force){ const tb=$('#tk-holders'); if(!force&&holdersAt&&Date.now()-holdersAt<30000) return; holdersAt=Date.now(); if(!tb.children.length) tb.innerHTML=emptyRow(5,'Loading holders…');
    try{ let H=await CHAIN.holders(X.addr,50); H=(H||[]).filter(h=>h.bal>=1e-6); if(!H.length){ tb.innerHTML=emptyRow(5,'No holders yet.'); return; }
      tb.innerHTML=H.map((h,i)=>{ const w=String(h.wallet).toLowerCase(); const tag=w===PM?'<span class="tag">Uniswap v4 pool</span>':w===X.creator?'<span class="tag">creator</span>':h.name?`<span class="tag">${esc(h.name)}</span>`:''; return `<tr><td class="num muted">${i+1}</td><td>${wl(w,tag)}</td><td class="r num">${fmtAmt(h.bal)} ${esc(X.t)}</td><td class="r num">${(+h.share||0).toFixed(2)}%</td><td class="r num">${fmtUsd(h.bal*X.px)}<small>${inPair(h.bal*X.pxPair)}</small></td></tr>`; }).join(''); }
    catch(e){ holdersAt=0; tb.innerHTML=emptyRow(5,'Could not load holders: '+esc(SP.errMsg(e))); } }
  async function top(force){ const tb=$('#tk-top'); if(!force&&topAt&&Date.now()-topAt<30000) return; topAt=Date.now(); if(!tb.children.length) tb.innerHTML=emptyRow(5,'Loading traders…');
    try{ const T=(await CHAIN.topTraders(X.addr))||[]; if(!T.length){ tb.innerHTML=emptyRow(5,'No trades yet.'); return; } const pu=pairUsd();
      tb.innerHTML=T.slice(0,25).map((r,i)=>{ const w=String(r.wallet).toLowerCase(); return `<tr><td class="num muted">${i+1}</td><td>${wl(w,w===X.creator?'<span class="tag">creator</span>':'')}</td><td class="r num">${fmtUsd(r.volume||0)}<small>${pu?inPair((r.volume||0)/pu):''}</small></td><td class="r num">${r.trades||0}</td><td class="r">${r.holding?'<span class="up">Yes</span>':'<span class="muted">No</span>'}</td></tr>`; }).join(''); }
    catch(e){ topAt=0; tb.innerHTML=emptyRow(5,'Could not load traders: '+esc(SP.errMsg(e))); } }

  /* ---------- info ---------- */
  function info(){ const g=X.genes||{}; const div=(g.divShareBps||0)/100; const mk=SP.market();
    const arow=(label,a,href)=>`<div class="kv"><span>${label}</span><b><span class="mono">${shortAddr(a.length>42?a:cs(a))}</span><button data-copy="${a.length>42?a:cs(a)}" title="Copy" aria-label="Copy">${ic('copy')}</button>${href?`<a href="${href}" target="_blank" rel="noopener" title="Open" aria-label="Open">${ic('ext')}</a>`:''}</b></div>`;
    const pairText=`${esc(X.t)} / ${esc(X.pair)} on Uniswap v4${isStock&&stock?`. ${esc(X.pair)} is ${esc(stock.name)} stock, tokenized by Ondo, priced by Chainlink. NYSE ${mk.open?'open':'closed'} (${esc(mk.detail)}); the pool trades 24/7.`:'.'}`;
    $('#tk-info').innerHTML=`<div><h4>Fee breakdown</h4>
        <div class="kv"><span>Trading fee</span><b>${feePct()}% in ${esc(X.pair)}</b></div><div class="kv"><span>Holder rewards</span><b>${div>0?div.toFixed(0)+'% of the fee':'none'}</b></div><div class="kv"><span>Creator</span><b>60% of the remainder</b></div><div class="kv"><span>Platform</span><b>40% of the remainder</b></div><div class="kv"><span>Supply</span><b>${fmtAmt(SUPPLY)} ${esc(X.t)}, fixed</b></div>
        <h4 style="margin-top:18px">Pair</h4><p>${pairText}</p><p>Liquidity cannot be withdrawn.</p></div>
      <div><h4>Contracts</h4>${arow('Coin',X.addr,EXPLORER+'/token/'+X.addr)}${X.poolId?arow('Pool id',String(X.poolId),'https://app.uniswap.org/explore/pools/ethereum/'+X.poolId):''}${X.pairAddr?arow(esc(X.pair),String(X.pairAddr).toLowerCase(),EXPLORER+'/token/'+String(X.pairAddr).toLowerCase()):''}${C.hook?arow('Hook',C.hook,EXPLORER+'/address/'+C.hook):''}${C.factory?arow('Factory',C.factory,EXPLORER+'/address/'+C.factory):''}${C.router?arow('Router',C.router,EXPLORER+'/address/'+C.router):''}${C.poolManager?arow('Pool manager',C.poolManager,EXPLORER+'/address/'+C.poolManager):''}
        <div class="kv"><span>Creator</span><b>${wl(X.creator)}</b></div><div class="kv"><span>Created</span><b>${SP.fmtDate(X.createdAt)} · ${ageStr(X.age||'0s')}</b></div>${launchTrade?`<div class="kv"><span>Launch block</span><b><span class="mono">${launchTrade.block||'—'}</span><a href="${EXPLORER}/tx/${launchTrade.tx}" target="_blank" rel="noopener" title="Launch transaction">${ic('ext')}</a></b></div>`:''}</div>`; }

  /* ---------- tabs ---------- */
  let activeTab='trades';
  $$('#tk-tabs button').forEach(b=>b.onclick=()=>{ activeTab=b.dataset.tab; $$('#tk-tabs button').forEach(x=>x.classList.toggle('on',x===b)); $$('.pane',pg).forEach(p=>p.classList.toggle('on',p.dataset.pane===activeTab)); if(activeTab==='holders') holders(); if(activeTab==='top') top(); if(activeTab==='info') info(); });

  /* ---------- trade card ---------- */
  let side='buy', balEth=0, balCoin=0, balCoinWei=0n, slipMode='auto', qSeq=0, quoting=false, qOut=0n, qTimer=null;
  const amtEl=$('#tk-amt'), ctaEl=$('#tk-cta');
  const amtVal=()=>{ const v=parseFloat(String(amtEl.value).replace(/,/g,'')); return isFinite(v)&&v>0?v:0; };
  const slipPct=()=>{ if(slipMode==='custom'){ const v=parseFloat($('#tk-slip-in').value); return isFinite(v)?Math.min(50,Math.max(0.01,v)):1; } return slipMode==='auto'?1:parseFloat(slipMode); };
  const coinWei=v=>{ let w=CHAIN.parseEther(v.toFixed(18)); if(balCoinWei>0n&&w>balCoinWei&&v<=balCoin*1.000001) w=balCoinWei; return w; };
  const minOut=()=>qOut-qOut*BigInt(Math.round(slipPct()*100))/10000n;
  function paintBal(){ const e=SP.W.connected?fmtEth(balEth):'—', c=SP.W.connected?fmtAmt(balCoin)+' '+X.t:'—'; $('#tk-bal-in').textContent='Balance: '+(side==='buy'?e:c); $('#tk-bal-out').textContent='Balance: '+(side==='buy'?c:e); }
  function paintSide(){ $$('#tk-sides button').forEach(b=>b.classList.toggle('on',b.dataset.side===side));
    const coin=`<img src="${SP.coinLogo(X)}" alt="" onerror="this.onerror=null;this.src='${DEF_LOGO}'"><span>${esc(X.t)}</span>`, eth=`<img src="/img/eth.png" alt=""><span>ETH</span>`;
    $('#tk-asset-in').innerHTML=side==='buy'?eth:coin; $('#tk-asset-out').innerHTML=side==='buy'?coin:eth; amtEl.placeholder='0'; ctaEl.classList.toggle('s',side==='sell');
    $('#tk-note').textContent=`Fee ${feePct()}% in ${X.pair}`; $('#tk-payw').textContent=side==='buy'?'ETH':X.t; $('#tk-payw-note').textContent='';
    paintBal(); updQuote(); }
  function resetQuote(){ qOut=0n; quoting=false; const o=$('#tk-out'); o.textContent='0'; o.classList.add('dim'); $('#tk-out-usd').textContent=''; $('#tk-amt-usd').textContent=''; $('#tk-min').textContent='—'; $('#tk-fee-l').textContent=`Fee ${feePct()}%`; $('#tk-fee').textContent='—'; const im=$('#tk-imp'); im.textContent='—'; im.className=''; }
  async function updQuote(){ const v=amtVal(); if(!v){ qSeq++; resetQuote(); cta(); return; }
    const seq=++qSeq; quoting=true; cta(); const pu=pairUsd(), eu=ethUsd(), fr=feeR();
    $('#tk-amt-usd').textContent=side==='buy'?(eu?fmtUsd(v*eu):''):fmtUsd(v*X.px);
    try{ const out=side==='buy'?await CHAIN.quoteBuyEth(X.addr,CHAIN.parseEther(v.toFixed(18))):await CHAIN.quoteSellEth(X.addr,coinWei(v));
      if(seq!==qSeq) return; qOut=BigInt(out||0); quoting=false; const o=Number(qOut)/1e18; const mn=Number(minOut())/1e18; const oe=$('#tk-out'); oe.classList.toggle('dim',!(o>0));
      let fee=0, spot=0;
      if(side==='buy'){ oe.textContent=o>0?fmtAmt(o):'0'; $('#tk-out-usd').textContent=o>0?fmtUsd(o*X.px):''; $('#tk-min').textContent=fmtAmt(mn)+' '+X.t; fee=pu&&eu?v*eu/pu*fr:0; spot=eu&&X.px>0?v*eu/X.px:0; }
      else { oe.textContent=o>0?fmtEth(o):'0'; $('#tk-out-usd').textContent=o>0?fmtUsd(o*eu):''; $('#tk-min').textContent=fmtEth(mn); fee=pu&&eu?o*eu/pu*fr/(1-fr):0; spot=eu&&X.px>0?v*X.px/eu:0; }
      $('#tk-fee-l').textContent=`Fee ${feePct()}%`; $('#tk-fee').innerHTML=fee>0?`${inPair(fee)} <span class="muted">${fmtUsd(fee*pu)}</span>`:'—';
      const im=$('#tk-imp'); if(spot>0&&o>0){ const imp=Math.max(0,(1-o/(spot*(1-fr)))*100); im.textContent=imp.toFixed(2)+'%'; im.className=imp>15?'bad':imp>5?'warn':''; } else { im.textContent='—'; im.className=''; }
    }catch(e){ if(seq!==qSeq) return; quoting=false; qOut=0n; const oe=$('#tk-out'); oe.textContent='—'; oe.classList.add('dim'); $('#tk-out-usd').textContent=''; $('#tk-min').textContent='—'; $('#tk-fee').textContent='—'; $('#tk-imp').textContent='—'; console.warn('quote',e); }
    cta(); }
  function cta(){ if(ctaEl.dataset.busy) return; const v=amtVal(); const W=SP.W; let t, dis=false;
    if(!W.connected) t='Connect a wallet'; else if(!W.chainOk) t='Switch to Ethereum'; else if(!v){ t='Enter amount'; dis=true; } else if(side==='buy'&&v>balEth){ t='Insufficient ETH'; dis=true; } else if(side==='sell'&&v>balCoin*1.000001){ t='Insufficient '+X.t; dis=true; } else if(quoting){ t='Fetching quote…'; dis=true; } else if(!(qOut>0n)){ t='No quote available'; dis=true; } else t=(side==='buy'?'Buy ':'Sell ')+X.t;
    ctaEl.textContent=t; ctaEl.disabled=dis; }
  async function doSwap(){ const W=SP.W; if(!W.connected) return SP.W.connect(); if(!W.chainOk){ try{ await SP.W.switchChain(); }catch(e){ SP.toast(SP.errMsg(e),'err'); } return; }
    const v=amtVal(); if(!v) return SP.toast('Enter an amount','err'); if(quoting||!(qOut>0n)) return SP.toast('Fetching the quote, try again in a second','info');
    const min=minOut(); ctaEl.dataset.busy='1'; ctaEl.disabled=true; ctaEl.textContent='Confirm in wallet…';
    try{ if(side==='buy') await CHAIN.buy(X.addr,CHAIN.parseEther(v.toFixed(18)),min); else await CHAIN.sell(X.addr,coinWei(v),min);
      SP.toast((side==='buy'?'Bought ':'Sold ')+X.t+' · confirmed'); amtEl.value=''; delete ctaEl.dataset.busy; resetQuote(); await sync(true); }
    catch(e){ delete ctaEl.dataset.busy; SP.toast(SP.errMsg(e),'err'); }
    ctaEl.disabled=false; cta(); updQuote(); }
  function setSide(s){ if(s!==side){ side=s; amtEl.value=''; resetQuote(); } paintSide(); }
  $$('#tk-sides button').forEach(b=>b.onclick=()=>setSide(b.dataset.side));
    amtEl.addEventListener('input',()=>{ clearTimeout(qTimer); cta(); qTimer=setTimeout(updQuote,160); });
  $$('#tk-quick button').forEach(b=>b.onclick=()=>{ if(!SP.W.connected) return SP.W.connect(); const q=+b.dataset.q; let v;
    if(side==='buy'){ const max=Math.max(0,balEth-0.003); v=max*q/100; amtEl.value=v>0?String(+v.toFixed(6)):''; }
    else { v=balCoin*q/100; amtEl.value=v>0?(q===100?CHAIN.formatEther(balCoinWei):String(+v.toFixed(6))):''; }
    updQuote(); });
  $$('#tk-slip button').forEach(b=>b.onclick=()=>{ slipMode=b.dataset.sl; $$('#tk-slip button').forEach(x=>x.classList.toggle('on',x===b)); const inp=$('#tk-slip-in'); inp.classList.toggle('hidden',slipMode!=='custom'); if(slipMode==='custom'){ inp.focus(); } updQuote(); });
  $('#tk-slip-in').addEventListener('input',()=>updQuote());
  ctaEl.onclick=doSwap;
  if(/[?&]side=sell/.test(location.search)) side='sell';

  /* ---------- position and creator cards ---------- */
  let posSeq=0;
  async function position(){ const W=SP.W; const pos=$('#tk-pos'), cre=$('#tk-cre'); const seq=++posSeq;
    if(!W.connected){ balEth=0; balCoin=0; balCoinWei=0n; paintBal(); pos.classList.add('hidden'); cre.classList.add('hidden'); cta(); return; }
    const u=W.address;
    try{ const [eb,cb,pend,p]=await Promise.all([CHAIN.ethBalance(u).catch(()=>0n),CHAIN.balance(X.addr,u).catch(()=>0n),X.rewards?CHAIN.pending(X.addr,u).catch(()=>0n):Promise.resolve(0n),CHAIN.position(X.addr,u).catch(()=>null)]);
      if(seq!==posSeq||SP.W.address!==u) return; balEth=Number(eb)/1e18; balCoinWei=BigInt(cb||0); balCoin=Number(balCoinWei)/1e18; paintBal(); cta();
      const pu=pairUsd(); const pendV=Number(pend||0)/1e18; const avg=p&&p.avg>0?p.avg:0; const pc=avg>0&&X.pxPair>0?(X.pxPair/avg-1)*100:null;
      $('#tk-pos-sym').textContent=X.t;
      $('#tk-pos-body').innerHTML=`<div class="kv"><span>Balance</span><b>${fmtAmt(balCoin)} ${esc(X.t)}</b></div><div class="kv"><span>Value</span><b>${fmtUsd(balCoin*X.px)} <span class="muted">${inPair(balCoin*X.pxPair)}</span></b></div><div class="kv"><span>Average entry</span><b>${avg>0?'$'+fmtPrice(avg*pu)+' <span class="muted">'+fmtPrice(avg)+' '+esc(X.pair)+'</span>':'—'}</b></div>${pc!=null&&balCoin>0?`<div class="kv"><span>Since entry</span><b class="${pc>=0?'up':'dn'}">${pc>=0?'+':''}${pc.toFixed(1)}%</b></div>`:''}
        <div class="kv"><span>Holder rewards</span><b>${X.rewards?inPair(pendV)+' <span class="muted">'+fmtUsd(pendV*pu)+'</span>':'<span class="muted">not enabled for this coin</span>'}</b></div>${X.rewards?`<button class="btn block" style="margin-top:10px" id="tk-claim" ${pendV>0?'':'disabled'}>Claim ${esc(X.pair)}</button>`:''}`;
      const cb2=$('#tk-claim'); if(cb2) cb2.onclick=()=>doClaim(cb2,()=>CHAIN.claim(X.addr),'Rewards claimed');
      pos.classList.remove('hidden');
      if(u===X.creator){ const owed=X.creatorOwed||0; $('#tk-cre-body').innerHTML=`<div class="sboxes"><div class="sbox"><span class="lab">Claimable</span><b>${inPair(owed)}</b><i>${fmtUsd(owed*pu)}</i></div><div class="sbox"><span class="lab">Your share</span><b>60%</b><i>of every fee</i></div></div><button class="btn pri block" id="tk-paycre" ${owed>0?'':'disabled'}>Claim fees</button>`;
        $('#tk-paycre').onclick=e=>doClaim(e.currentTarget,()=>CHAIN.payCreator(X.addr),'Creator fees claimed'); cre.classList.remove('hidden'); }
      else cre.classList.add('hidden');
    }catch(e){ console.warn('position',e); } }
  async function doClaim(btn,fn,msg){ if(!SP.W.connected) return SP.W.connect(); const t=btn.textContent; btn.disabled=true; btn.textContent='Confirm in wallet…';
    try{ await fn(); SP.toast(msg); await sync(true); }catch(e){ SP.toast(SP.errMsg(e),'err'); btn.disabled=false; btn.textContent=t; } }

  /* ---------- live refresh ---------- */
  let ticking=false;
  function paintAll(){ stats(); headLive(); flow(); document.title=`${X.t} $${fmtPrice(X.px)} | StockPad`; if(activeTab==='info') info(); }
  async function sync(force){ if(ticking||(!force&&document.hidden)) return; ticking=true; const oldPx=X.pxPair;
    try{ const nx=await CHAIN.refresh(X.addr); if(nx) Object.assign(X,nx); const tr=await CHAIN.trades(X.addr); const fresh=tr.filter(t=>!seen.has(key(t)));
      if(fresh.length){ fresh.forEach(t=>seen.add(key(t))); TR=[...fresh.map(view),...TR]; sortTr(); renderTrades(new Set(fresh.map(key))); holdersAt=0; topAt=0; if(activeTab==='holders') holders(true); if(activeTab==='top') top(true); }
      else if(TR.length) renderTrades();
      paintAll(); if(tvOn&&window.tvTick) tvTick(X.pxPair,fresh.length?fresh:[]);
      if(fresh.length||X.pxPair!==oldPx) updQuote(); if(fresh.length||force) await position();
    }catch(e){ console.warn('refresh',e); } ticking=false; }
  setInterval(()=>sync(false),6000);
  SP.onUpdate(()=>{ const nx=SP.token(X.addr); if(nx) Object.assign(X,nx); paintAll(); });
  SP.onWallet(()=>{ position(); cta(); updQuote(); });
  setInterval(headLive,60000);

  /* ---------- boot ---------- */
  head(); stats(); headLive(); document.title=`${X.t} $${fmtPrice(X.px)} | StockPad`; chart(); paintSide(); resetQuote(); cta(); loadTrades(); position();
};
