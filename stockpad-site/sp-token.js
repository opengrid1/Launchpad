/* Token page: header, stat strip, TradingView chart, trades / holders / top traders / info panel,
   the trade card (quotes, slippage, buy, sell), the position and creator-fee cards, live refresh.
   Reads the coin address from /token/<addr> (cleanUrls rewrite) or /token.html?t=<addr>. */
window.SP_PAGE=function(){
  const pg=$('#pg-token'); if(!pg) return;
    const addrFromUrl=()=>{ const m=location.pathname.match(/\/token\/(0x[0-9a-fA-F]{40})/); if(m) return m[1].toLowerCase(); const q=new URLSearchParams(location.search).get('t')||''; return /^0x[0-9a-fA-F]{40}$/.test(q)?q.toLowerCase():''; };
  const addr=addrFromUrl(); let X=addr?SP.token(addr):null;
  if(!X||!window.CHAIN){ $('#tk-page').classList.add('hidden'); const e=$('#tk-empty'); e.classList.remove('hidden');
    $('#tk-crumb').innerHTML=`<a href="/markets">Markets</a>`; e.innerHTML=`<b>${addr?'Token not found':'No token selected'}</b>${addr?'No coin with that address was launched on Equo, or it is not listed here.':'Open a coin from the markets page.'}<div style="margin-top:14px"><a class="btn" href="/markets">${ic('back')}Back to markets</a></div>`; return; }
  X={...X};
  const C=(window.INKY&&INKY.contracts)||{}; const PM=String(C.poolManager||'').toLowerCase();
  const stock=SP.stockBySym(X.pair); const isStock=X.pair!=='ETH';
  const inPair=v=>(X.pair!=='ETH'&&v>0&&v<1e-4)?fmtPrice(v)+' '+X.pair:SP.fmtPair(v,X), pairUsd=()=>X.pairUsd||SP.prices[String(X.pairAddr||'').toLowerCase()]||0, ethUsd=()=>SP.prices[WETH]||ETH||0;
  const feePct=()=>((X.feeBps||100)/100).toFixed(2), feeR=()=>(X.feeBps||100)/10000;
  const youTag=a=>SP.W.connected&&a===SP.W.address?'<span class="tag mint">you</span>':'';
  // EVM addresses compare in lower case; Solana's base58 keys are case sensitive and stay as they are
  const addrKey=a=>{ a=String(a||''); return /^0x/i.test(a)?a.toLowerCase():a; };
  const acctUrl=(a,k)=>{ const c=k?SP.chain(k):!/^0x/i.test(String(a))?SP.chain('sol'):null; return c&&c.evm===false?`${c.explorer}/account/${a}`:`${(c&&c.explorer)||EXPLORER}/address/${a}`; };
  const wl=(a,tags='',k)=>`<span class="w"><span class="av">${SP.avatar(a,20)}</span><a href="${acctUrl(a,k)}" target="_blank" rel="noopener">${shortAddr(cs(a))}</a>${tags}${youTag(a)}</span>`;
  const emptyRow=(n,t)=>`<tr><td colspan="${n}"><div class="empty">${t}</div></td></tr>`;
  const agoTxt=ts=>ago(Math.max(0,Math.floor(Date.now()/1000)-ts))+' ago';
  const stockPx=()=>SP.prices[String(X.pairAddr||'').toLowerCase()]||X.pairUsd||0;
  const fmtStockPx=p=>p?'$'+(p>=100?p.toFixed(0):p>=1?p.toFixed(2):fmtPrice(p)):'…';
  pg.addEventListener('click',e=>{ const b=e.target.closest('[data-copy]'); if(b){ e.preventDefault(); SP.copy(b.dataset.copy,'Address copied'); if(b.classList.contains('cac')){ b.classList.add('ok'); b.innerHTML=ic('check')+'<span class="cl">Copied</span>'; setTimeout(()=>{ b.classList.remove('ok'); b.innerHTML=ic('copy')+'<span class="cl">Copy</span>'; },1600); } } });

  /* ---------- header ---------- */
  function head(){ const mk=SP.market();
    const links=[['Website',X.links&&X.links.web,'globe'],['X',X.links&&X.links.x,'ext'],['Telegram',X.links&&X.links.tg,'ext']].filter(l=>l[1]&&/^https?:\/\//i.test(l[1]));
    $('#tk-crumb').innerHTML=`<a href="/markets">Markets</a>${ic('chevr')}<a href="/markets?stock=${esc(X.pair)}">${esc(isStock&&stock?stock.ticker+' coins':'ETH coins')}</a>${ic('chevr')}<span class="dim">$${esc(X.t)}</span>`;
    $('#tk-head').innerHTML=`<span class="av2 big"><img class="lg" src="${SP.coinLogo(X)}" alt="" onerror="this.onerror=null;this.src='${DEF_LOGO}'"><img class="stb" src="${pairImg(X.pair)}" alt="" onerror="this.onerror=null;this.src='/img/eth.png'"></span>
      <div class="id">
        <div class="t1"><h1>${esc(X.n)}</h1><span class="sym">$${esc(X.t)}</span>${SP.star(X.addr)}</div>
        <div class="t2"><span title="${esc(SP.fmtDate(X.createdAt))}">${ageStr(X.age||'0s')}</span><span class="badge">${feePct()}% fee</span>${X.rewards?`<span class="badge acl">★ Holder rewards</span>`:''}${(X.genes||{}).buybackShareBps?`<span class="badge">${ic('flame')}Buyback ${((X.genes.buybackShareBps)/100).toFixed(0)}%</span>`:''}${links.map(l=>`<a class="lk" href="${esc(l[1])}" target="_blank" rel="noopener noreferrer nofollow">${ic(l[2])}${l[0]}</a>`).join('')}</div>
        <div class="cabar" id="tk-ca"></div><div class="pools" id="tk-pools"></div>
        ${X.desc?`<p class="desc">${esc(X.desc)}</p>`:''}
        <div class="by">Created by ${wl(X.creator)}</div>
      </div>`; }
  function headLive(){ const p=$('#tk-stock-px'); if(p) p.textContent=fmtStockPx(isStock?stockPx():ethUsd()); if(isStock){ const mk=SP.market(); const m=$('#tk-stock-mk'); if(m) m.textContent=mk.open?'NYSE open':'NYSE closed'; }
    $('#tk-chart-t').textContent=`${X.t} / ${X.pair}`; $('#tk-chart-r').textContent=`${fmtPrice(X.pxPair)} ${X.pair} · ${X.pair} at ${fmtStockPx(isStock?stockPx():ethUsd())}`; }

  /* ---------- stats ---------- */
  function stats(){ const pu=pairUsd(); const fees=X.totalCreatorFees||0;
    const S=[['Price','$'+fmtPrice(X.px)+SP.fmtPct(X.c24||0).replace('class="num','class="pc num'),`${fmtPrice(X.pxPair)} ${esc(X.pair)}`],['Market cap',fmtUsd(X.mc),SP.coinChains(X).length>1?`${SP.coinChains(X).length} chains × 1B`:inPair(X.pxPair*SUPPLY)],['Volume 24h',fmtUsd(X.vol),pu?inPair(X.vol/pu):'—'],['Trades',(X.trades||0).toLocaleString(),(X.traders||0).toLocaleString()+(X.traders===1?' trader':' traders')],['Holders',(X.h||0).toLocaleString(),'wallets'],liqStat()];
    const c24=X.c24||0, n=SP.coinChains(X).length, liq=liqStat();
    $('#tk-mcap').textContent=fmtUsd(X.mc); $('#tk-px').textContent='$'+fmtPrice(X.px);
    $('#tk-stats').innerHTML=[['24h',`<b class="${c24>=0?'up':'dn'}">${c24>=0?'+':''}${c24.toFixed(2)}%</b>`],['Liquidity',`<b>${liq[1]}</b>`],['Supply',`<b>${n>1?n+'B':'1B'}</b>`],['24h vol',`<b>${fmtUsd(X.vol)}</b>`],['Holders',`<b>${(X.h||0).toLocaleString()}</b>`],['Pools live',`<b>${X.poolsLive!=null?X.poolsLive:n}/${n}<span class="pdots">${SP.coinChains(X).map(k=>`<i style="background:${SP.chain(k).color}"></i>`).join('')}</span></b>`]].map(x=>`<div><span>${x[0]}</span>${x[1]}</div>`).join('');
    const g=X.genes||{}; const dv=(g.divShareBps||0)/100, bb=(g.buybackShareBps||0)/100, rest=100-dv-bb, cr=Math.round(rest*0.6), pl=rest-cr;
    $('#tk-feespaid').textContent=`${feePct()}% · ${dv?dv+'% holders · ':''}${bb?bb+'% buyback · ':''}${cr}% creator · ${pl}% platform`; $('#tk-feebar').innerHTML=(dv?`<i class="h" style="width:${dv}%"></i>`:'')+(bb?`<i style="width:${bb}%;background:var(--dn)"></i>`:'')+`<i class="c" style="width:${cr}%"></i><i class="p" style="flex:1"></i>`; }
  /** one chain: the Ethereum pool as the chain reader sees it; several: every pool added up by the indexer */
  function liqStat(){ const n=SP.coinChains(X).length; if(n<2) return ['Liquidity',fmtUsd(X.liq),inPair(X.liqPair)];
    return ['Liquidity',X.liqAll!=null?fmtUsd(X.liqAll):'…',`${n} pools combined`]; }
  /* ---------- activity: volume, buys and sells over a window ---------- */
  let tfW=86400; const TFS=[[300,'5m'],[3600,'1h'],[21600,'6h'],[86400,'24h']];
  function act(){ const now=Math.floor(Date.now()/1000), pu=pairUsd(), win=w=>TR.filter(v=>v.ts>=now-w), usd=l=>l.reduce((s,v)=>s+v.pair*pu,0);
    $('#tk-tf').innerHTML=TFS.map(([w,l])=>`<button type="button" data-tf="${w}" class="${w===tfW?'on':''}">${l}<b>${fmtUsd(usd(win(w)))}</b></button>`).join('');
    const L=win(tfW), B=L.filter(v=>v.buy), Sl=L.filter(v=>!v.buy), bu=usd(B), su=usd(Sl), net=bu-su;
    $('#tk-am').innerHTML=`<div><span>Vol</span><b>${fmtUsd(bu+su)}</b></div><div><span>Buys</span><b>${B.length} <small>/ ${fmtUsd(bu)}</small></b></div><div><span>Sells</span><b>${Sl.length} <small>/ ${fmtUsd(su)}</small></b></div><div class="r"><span>Net buy</span><b class="${net>=0?'up':'dn'}">${net>=0?'':'-'}${fmtUsd(Math.abs(net))}</b></div>`;
    $('#tk-abar').innerHTML=bu+su>0?`<i style="width:${bu/(bu+su)*100}%;background:var(--up)"></i><i style="flex:1;background:var(--dn)"></i>`:'<i style="flex:1;background:var(--line-2)"></i>'; }
  $('#tk-tf').addEventListener('click',e=>{ const b=e.target.closest('[data-tf]'); if(b){ tfW=+b.dataset.tf; act(); } });
  function flow(){ act(); const t0=Math.floor(Date.now()/1000)-86400; const day=TR.filter(v=>v.ts>=t0); const bv=day.filter(v=>v.buy).reduce((s,v)=>s+v.pair,0), sv=day.filter(v=>!v.buy).reduce((s,v)=>s+v.pair,0);
    const el=$('#tk-flow'), sp=$('#tk-split'); if(!(bv+sv>0)){ el.textContent='no trades in 24h'; sp.innerHTML=''; return; } const b=Math.round(bv/(bv+sv)*100); el.textContent=`${b}% buys · ${100-b}% sells`; sp.innerHTML=`<i class="b" style="width:${b}%"></i><i class="s" style="flex:1"></i>`; }

  /* ---------- chart ---------- */
  let tvOn=false;
  function chart(){ const tv=$('#tv'); if(window.initTV){ try{ initTV('tv',X); tvOn=true; return; }catch(e){ console.warn('chart',e); } } tv.innerHTML='<div class="tvno">Chart unavailable right now.</div>'; }

  /* ---------- trades ---------- */
  let TR=[], seen=new Set(), filter='all', shown=25, launchTrade=null;
  const key=t=>t.tx+':'+t.index;
  const view=t=>({k:key(t),ts:Number(t.ts),buy:!!t.buy,coin:Number(t.coin)/1e18,pair:Number(t.pair)/1e18,pxPair:CHAIN.tradePrice(t),fee:Number(t.fee)/1e18,wallet:addrKey(t.wallet),tx:t.tx,block:t.block,index:t.index,chain:t.chain||(SP.coinChains(X)[0]||'eth')});
  const sortTr=()=>TR.sort((a,b)=>(b.ts-a.ts)||((b.block||0)-(a.block||0))||((b.index||0)-(a.index||0)));
  function row(v,fresh){ const pu=pairUsd(); return `<tr data-k="${v.buy?'buy':'sell'}" class="${fresh&&fresh.has(v.k)?'new':''}"><td><span class="side ${v.buy?'b':'s'}">${v.buy?'Buy':'Sell'}</span></td><td>${wl(v.wallet,v.wallet===X.creator?'<span class="tag">creator</span>':'',v.chain)}</td><td class="r num">${fmtAmt(v.coin)} <span class="muted">${esc(X.t)}</span></td><td class="r num">${inPair(v.pair)}<small>fee ${inPair(v.fee)}</small></td><td class="r num">${fmtUsd(v.pair*pu)}</td><td class="r num">$${fmtPrice(v.pxPair*pu)}<small>${fmtPrice(v.pxPair)} ${esc(X.pair)}</small></td><td><span class="num muted" data-ts="${v.ts}" title="${new Date(v.ts*1000).toLocaleString()}">${agoTxt(v.ts)}</span></td><td>${chainCell(v.chain)}</td><td class="r"><a class="txl" href="${(SP.chain(v.chain)||{}).explorer||EXPLORER}/tx/${v.tx}" target="_blank" rel="noopener" title="View transaction">${ic('ext')}</a></td></tr>`; }
  function chainCell(k){ const c=SP.chain(k)||{}; return `<span class="chc" title="${esc(c.name||k)}"><img src="${c.logo||'/img/eth.png'}" alt="">${esc(c.code||k)}</span>`; }
  function renderTrades(fresh){ const tb=$('#tk-trades'); const L=TR.filter(v=>filter==='all'||(filter==='buy')===v.buy);
    $('#tk-th-coin').textContent='Amount'; $('#tk-th-pair').textContent='Paid / received'; $('#tk-trades-n').textContent=TR.length?'('+TR.length.toLocaleString()+(SP.coinChains(X).length>1?' · all chains':'')+')':''; flow();
    if(!L.length){ tb.innerHTML=emptyRow(9,TR.length?'No '+filter+'s yet.':'No trades yet. The first buy shows up here within seconds.'); $('#tk-more').classList.add('hidden'); return; }
    tb.innerHTML=L.slice(0,shown).map(v=>row(v,fresh)).join(''); $('#tk-more').classList.toggle('hidden',L.length<=shown); }
  $('#tk-more-btn').onclick=()=>{ shown+=25; renderTrades(); };
  $$('#tk-filter button').forEach(b=>b.onclick=()=>{ filter=b.dataset.f; $$('#tk-filter button').forEach(x=>x.classList.toggle('on',x===b)); shown=25; renderTrades(); });
  setInterval(()=>{ const now=Math.floor(Date.now()/1000); $$('[data-ts]',pg).forEach(e=>e.textContent=ago(Math.max(0,now-+e.dataset.ts))+' ago'); },10000);
  async function loadTrades(){ const tb=$('#tk-trades'); tb.innerHTML=emptyRow(9,'Loading trades…'); try{ const tr=await CHAIN.trades(X.addr); TR=tr.map(view); TR.forEach(v=>seen.add(v.k)); sortTr(); launchTrade=TR.slice().reverse().find(v=>v.wallet===X.creator&&v.buy&&v.ts<=X.createdAt+2)||null; renderTrades(); if(activeTab==='info') info(); }catch(e){ tb.innerHTML=emptyRow(9,'Could not load trades: '+esc(SP.errMsg(e))); } }

  /* ---------- holders, top traders ---------- */
  let holdersAt=0, topAt=0;
  async function holders(force){ const tb=$('#tk-holders'); if(!force&&holdersAt&&Date.now()-holdersAt<30000) return; holdersAt=Date.now(); if(!tb.children.length) tb.innerHTML=emptyRow(5,'Loading holders…');
    try{ let H=await CHAIN.holders(X.addr,50); H=(H||[]).filter(h=>h.bal>=1e-6); if(!H.length){ tb.innerHTML=emptyRow(5,'No holders yet.'); return; }
      tb.innerHTML=H.map((h,i)=>{ const w=addrKey(h.wallet); const tag=w===PM?'<span class="tag">Uniswap v4 pool</span>':w===X.creator?'<span class="tag">creator</span>':h.name?`<span class="tag">${esc(h.name)}</span>`:''; return `<tr><td class="num muted">${i+1}</td><td>${wl(w,tag)}</td><td class="r num">${fmtAmt(h.bal)} ${esc(X.t)}</td><td class="r num">${(+h.share||0).toFixed(2)}%</td><td class="r num">${fmtUsd(h.bal*X.px)}<small>${inPair(h.bal*X.pxPair)}</small></td></tr>`; }).join(''); }
    catch(e){ holdersAt=0; tb.innerHTML=emptyRow(5,'Could not load holders: '+esc(SP.errMsg(e))); } }
  async function top(force){ const tb=$('#tk-top'); if(!force&&topAt&&Date.now()-topAt<30000) return; topAt=Date.now(); if(!tb.children.length) tb.innerHTML=emptyRow(5,'Loading traders…');
    try{ const T=(await CHAIN.topTraders(X.addr))||[]; if(!T.length){ tb.innerHTML=emptyRow(5,'No trades yet.'); return; } const pu=pairUsd();
      tb.innerHTML=T.slice(0,25).map((r,i)=>{ const w=addrKey(r.wallet); return `<tr><td class="num muted">${i+1}</td><td>${wl(w,w===X.creator?'<span class="tag">creator</span>':'')}</td><td class="r num">${fmtUsd(r.volume||0)}<small>${pu?inPair((r.volume||0)/pu):''}</small></td><td class="r num">${r.trades||0}</td><td class="r">${r.holding?'<span class="up">Yes</span>':'<span class="muted">No</span>'}</td></tr>`; }).join(''); }
    catch(e){ topAt=0; tb.innerHTML=emptyRow(5,'Could not load traders: '+esc(SP.errMsg(e))); } }

  /* ---------- pools: one per chain, each with its own price and liquidity ---------- */
  const STATE={live:['liveb','Live'],empty:['soonb','Empty'],'not initialized':['soonb','Not set up'],'not answering':['soonb','No answer']};
  function pools(){ const tb=$('#tk-poolrows'); if(!tb) return; const on=SP.coinChains(X), P=X.pools||{}; let tl=0, tc=0, any=false;
    const rows=on.map(k=>{ const c=SP.chain(k)||{}, p=P[k], bc=(X.byChain||{})[k]||{};
      // a single-chain coin with no indexer answer still has the chain reader's own numbers
      const liq=p&&p.liquidityUsd!=null?p.liquidityUsd:(on.length===1?X.liq:null), px=p&&p.priceUsd!=null?p.priceUsd:(bc.px||X.px);
      if(liq!=null){ tl+=liq; any=true; } if(p&&p.coinsInPool!=null) tc+=p.coinsInPool;
      const st=p?(STATE[p.state]||['soonb',p.state]):c.live?['soonb','Loading']:['soonb','Soon'];
      return `<tr><td><span class="chc"><img src="${c.logo||'/img/eth.png'}" alt="">${esc(c.name||k)}</span></td><td>${esc(c.dex||'Uniswap v4')}</td><td class="r num">$${fmtPrice(px)}${p&&p.priceInPair!=null?`<small>${fmtPrice(p.priceInPair)} ${esc(c.native||'ETH')}</small>`:''}</td><td class="r num">${liq!=null?fmtUsd(liq):'—'}</td><td class="r num">${p&&p.pairInPool!=null?fmtAmt(p.pairInPool)+' '+esc(c.native||'ETH')+(p.pairUsd!=null?`<small>${fmtUsd(p.pairUsd)}</small>`:''):p&&p.pairUsd!=null?fmtUsd(p.pairUsd):'—'}</td><td class="r num">${p&&p.coinsInPool!=null?fmtAmt(p.coinsInPool)+' '+esc(X.t):'—'}</td><td><span class="${st[0]}">${esc(st[1])}</span></td></tr>`; });
    if(on.length>1) rows.push(`<tr class="tot"><td><b>All chains</b></td><td>${on.length} pools</td><td></td><td class="r num"><b>${any?fmtUsd(tl):'—'}</b></td><td></td><td class="r num">${tc?fmtAmt(tc)+' '+esc(X.t):'—'}</td><td>${X.poolsLive!=null?`<span class="num">${X.poolsLive}/${on.length} live</span>`:''}</td></tr>`);
    tb.innerHTML=rows.join('')||emptyRow(7,'No pools yet.');
    $('#tk-poolnote').textContent=on.length>1?'Each chain has its own Uniswap v4 pool. Liquidity is both sides of a pool at its own price; the total adds every chain. Arbitrage keeps the prices in line.':'Liquidity is both sides of the pool at its current price.'; }

  /* ---------- info ---------- */
  function info(){ const g=X.genes||{}; const div=(g.divShareBps||0)/100, bbk=(g.buybackShareBps||0)/100; const mk=SP.market();
    const arow=(label,a,href)=>`<div class="kv"><span>${label}</span><b><span class="mono">${shortAddr(a.length>42?a:cs(a))}</span><button data-copy="${a.length>42?a:cs(a)}" title="Copy" aria-label="Copy">${ic('copy')}</button>${href?`<a href="${href}" target="_blank" rel="noopener" title="Open" aria-label="Open">${ic('ext')}</a>`:''}</b></div>`;
    const pairText=`${esc(X.t)} / ${esc(X.pair)} on Uniswap v4${isStock&&stock?`. ${esc(X.pair)} is ${esc(stock.name)} stock, tokenized by Ondo, priced by Chainlink. NYSE ${mk.open?'open':'closed'} (${esc(mk.detail)}); the pool trades 24/7.`:'.'}`;
    $('#tk-info').innerHTML=`<div><h4>Fee breakdown</h4>
        <div class="kv"><span>Trading fee</span><b>${feePct()}% in ${esc(X.pair)}</b></div><div class="kv"><span>Holder rewards</span><b>${div>0?div.toFixed(0)+'% of the fee':'none'}</b></div><div class="kv"><span>Buyback and burn</span><b>${bbk>0?bbk.toFixed(0)+'% of the fee':'none'}</b></div>${bbk>0?`<div class="kv"><span>Buyback pot</span><b>${inPair(X.buybackPot||0)}</b></div>`:''}${g.maxWalletBps?`<div class="kv"><span>Max wallet</span><b>${(g.maxWalletBps/100).toFixed(g.maxWalletBps%100?1:0)}% for ${g.maxWalletSecs>=86400?String(+(g.maxWalletSecs/86400).toFixed(1))+' days':String(+(g.maxWalletSecs/3600).toFixed(2))+' h'} after launch</b></div>`:''}<div class="kv"><span>Creator</span><b>60% of the remainder</b></div><div class="kv"><span>Platform</span><b>40% of the remainder</b></div><div class="kv"><span>Supply</span><b>${fmtAmt(SUPPLY)} ${esc(X.t)}, fixed</b></div>
        <h4 style="margin-top:18px">Pair</h4><p>${pairText}</p></div>
      <div><h4>Contracts</h4>${arow('Coin',X.addr,EXPLORER+'/token/'+X.addr)}${X.poolId?arow('Pool id',String(X.poolId),'https://app.uniswap.org/explore/pools/ethereum/'+X.poolId):''}${X.pairAddr?arow(esc(X.pair),String(X.pairAddr).toLowerCase(),EXPLORER+'/token/'+String(X.pairAddr).toLowerCase()):''}${C.hook?arow('Hook',C.hook,EXPLORER+'/address/'+C.hook):''}${C.factory?arow('Factory',C.factory,EXPLORER+'/address/'+C.factory):''}${C.router?arow('Router',C.router,EXPLORER+'/address/'+C.router):''}${C.poolManager?arow('Pool manager',C.poolManager,EXPLORER+'/address/'+C.poolManager):''}
        <div class="kv"><span>Creator</span><b>${wl(X.creator)}</b></div><div class="kv"><span>Created</span><b>${SP.fmtDate(X.createdAt)} · ${ageStr(X.age||'0s')}</b></div>${launchTrade?`<div class="kv"><span>Launch block</span><b><span class="mono">${launchTrade.block||'—'}</span><a href="${EXPLORER}/tx/${launchTrade.tx}" target="_blank" rel="noopener" title="Launch transaction">${ic('ext')}</a></b></div>`:''}</div>`; }

  /* ---------- tabs ---------- */
  let activeTab='trades';
  $$('#tk-tabs button').forEach(b=>b.onclick=()=>{ activeTab=b.dataset.tab; $$('#tk-tabs button').forEach(x=>x.classList.toggle('on',x===b)); $$('.pane',pg).forEach(p=>p.classList.toggle('on',p.dataset.pane===activeTab)); if(activeTab==='holders') holders(); if(activeTab==='top') top(); if(activeTab==='pools') pools(); if(activeTab==='info') info(); });

  /* ---------- trade card ---------- */
  let side='buy', balEth=0, balCoin=0, balCoinWei=0n, slipMode='auto', qSeq=0, quoting=false, qOut=0n, qTimer=null;
  const amtEl=$('#tk-amt'), ctaEl=$('#tk-cta');
  const amtVal=()=>{ const v=parseFloat(String(amtEl.value).replace(/,/g,'')); return isFinite(v)&&v>0?v:0; };
  const slipPct=()=>{ if(slipMode==='custom'){ const v=parseFloat($('#tk-slip-in').value); return isFinite(v)?Math.min(50,Math.max(0.01,v)):1; } return slipMode==='auto'?1:parseFloat(slipMode); };
  const coinWei=v=>{ let w=CHAIN.parseEther(v.toFixed(18)); if(balCoinWei>0n&&w>balCoinWei&&v<=balCoin*1.000001) w=balCoinWei; return w; };
  const minOut=()=>qOut-qOut*BigInt(Math.round(slipPct()*100))/10000n;
  /* a stock with no ETH route trades in the stock itself: `bal` and amounts in are that stock, not ETH */
  /* multichain coins: each chain has its own pool; the trader picks which one to trade on and pays in that chain's coin */
  let tChain=SP.coinChains(X).includes('eth')?'eth':SP.coinChains(X)[0], CC=null, cheapest=false;
  const onEth=()=>tChain==='eth', tc=()=>SP.chain(tChain)||SP.chain('eth'), chainPx=k=>((X.byChain||{})[k]||{}).px||X.px, natUsd=()=>(CC&&CC[tChain]&&CC[tChain].nativeUsd)||0;
  const natImg=()=>['ETH'].includes(tc().native)?'/img/eth.png':tc().logo;
  const via=()=>onEth()&&!!(window.CHAIN&&CHAIN.equo&&X.pairAddr&&!CHAIN.equo.hasRoute(X.pairAddr)), payUsd=()=>!onEth()?natUsd():via()?pairUsd():ethUsd(), payFmt=v=>!onEth()?fmtAmt(v)+' '+tc().native:via()?inPair(v):fmtEth(v);
  /** the pool that pays the most for this side: lowest price to buy, highest to sell */
  const bestChain=()=>{ const on=SP.coinChains(X); return on.reduce((a,k)=>(side==='buy'?chainPx(k)<chainPx(a):chainPx(k)>chainPx(a))?k:a,on[0]); };
  /** with "Cheapest chain" on, follow the best pool; true when that moved the trade to another chain */
  function autoChain(){ if(!cheapest||SP.coinChains(X).length<2) return false; const b=bestChain(); if(b===tChain) return false; tChain=b; return true; }
  function paintTChain(){ const box=$('#tk-tchain'), on=SP.coinChains(X); if(!box) return; box.classList.toggle('hidden',on.length<2); if(on.length<2) return;
    const best=bestChain(), p=X.pools&&X.pools[tChain];
    box.innerHTML=`<div class="tchips">${on.map(k=>{ const c=SP.chain(k); return `<button type="button" class="tchip ${k===tChain?'on':''} ${SP.chainDeployed(k)||X.mock?'':'off'}" data-tk="${k}" style="--cc:${c.color}" title="${esc(c.name)} · $${fmtPrice(chainPx(k))}"><i></i>${esc(c.code||c.short)}</button>`; }).join('')}</div>
      <div class="tcinfo"><span><b>${esc(tc().name)}</b>'s pool${best===tChain?' · best price':''}</span><span>$${fmtPrice(chainPx(tChain))}</span></div>
      <label class="cheap2"><span><b>Cheapest chain</b> · use another chain's pool if it pays more</span><input type="checkbox" id="tk-cheap"${cheapest?' checked':''}></label>`;
    $('#tk-cheap').onchange=e=>{ cheapest=e.target.checked; if(autoChain()){ amtEl.value=''; resetQuote(); paintSide(); position(); } else paintTChain(); };
    $$('[data-tk]',box).forEach(b=>b.onclick=()=>{ tChain=b.dataset.tk; cheapest=false; amtEl.value=''; resetQuote(); paintTChain(); paintSide(); position(); }); }
  /* dollar buttons on the buy side: each sets the amount in the paying coin and shows the coins it gets at this pool's price */
  function paintQusd(){ const el=$('#tk-qusd'); if(!el) return; if(side!=='buy'){ el.innerHTML=''; return; } const px=chainPx(tChain), r=1-feeR();
    el.innerHTML=[10,50,100,500].map(u=>`<button type="button" data-u="${u}">$${u}<small>${px?fmtAmt(u/px*r)+' '+esc(X.t):''}</small></button>`).join(''); }
  function poolHolds(){ const p=X.pools&&X.pools[tChain], el=$('#tk-poolh'); if(!el) return; el.textContent=p&&p.coinsInPool!=null?`${fmtAmt(p.coinsInPool)} ${X.t}${p.pairInPool!=null?' and '+fmtAmt(p.pairInPool)+' '+tc().native:p.pairUsd!=null?' and '+fmtUsd(p.pairUsd):''}`:'—'; }
  async function quoteFor(v){ if(!onEth()){ const nu=natUsd(), px=chainPx(tChain), r=1-feeR(); if(!nu||!px) return 0n; return side==='buy'?BigInt(Math.floor(v*nu/px*r*1e6))*10n**12n:BigInt(Math.floor(v*px*r/nu*1e9))*10n**9n; }
    const vp=via(); return side==='buy'?await (vp?CHAIN.quoteBuy:CHAIN.quoteBuyEth)(X.addr,CHAIN.parseEther(v.toFixed(18))):await (vp?CHAIN.quoteSell:CHAIN.quoteSellEth)(X.addr,coinWei(v)); }
  function paintBal(){ const e=SP.W.connected?payFmt(balEth):'—', c=SP.W.connected?fmtAmt(balCoin)+' '+X.t:'—'; $('#tk-bal-in').textContent='Balance: '+(side==='buy'?e:c); $('#tk-bal-out').textContent='Balance: '+(side==='buy'?c:e); }
  function paintSide(){ if(autoChain()) resetQuote(); $$('#tk-sides button').forEach(b=>b.classList.toggle('on',b.dataset.side===side));
    const coin=`<img src="${SP.coinLogo(X)}" alt="" onerror="this.onerror=null;this.src='${DEF_LOGO}'"><span>${esc(X.t)}</span>`, eth=!onEth()?`<img src="${natImg()}" alt=""><span>${esc(tc().native)}</span>`:via()?`<img src="${pairImg(X.pair)}" alt="" onerror="this.onerror=null;this.src='/img/t-default.png'"><span>${esc(X.pair)}</span>`:`<img src="/img/eth.png" alt=""><span>ETH</span>`;
    $('#tk-asset-in').innerHTML=side==='buy'?eth:coin; $('#tk-asset-out').innerHTML=side==='buy'?coin:eth; amtEl.placeholder='0'; ctaEl.classList.toggle('s',side==='sell');
    $('#tk-note').textContent=`Fee ${feePct()}% in ${X.pair}`; $('#tk-payw').textContent=side==='buy'?(!onEth()?tc().native:via()?X.pair:'ETH'):X.t; paintTChain(); $('#tk-payw-note').textContent=via()?`No ETH route for ${X.pair}; you ${side==='buy'?'pay':'receive'} ${X.pair}`:'';
    paintQusd(); poolHolds(); paintBal(); updQuote(); }
  function resetQuote(){ qOut=0n; quoting=false; const o=$('#tk-out'); o.textContent='0'; o.classList.add('dim'); $('#tk-out-usd').textContent=''; $('#tk-amt-usd').textContent=''; $('#tk-min').textContent='—'; $('#tk-fee-l').textContent=`Fee ${feePct()}%`; $('#tk-fee').textContent='—'; const im=$('#tk-imp'); im.textContent='—'; im.className=''; }
  async function updQuote(){ const v=amtVal(); if(!v){ qSeq++; resetQuote(); cta(); return; }
    const seq=++qSeq; quoting=true; cta(); const pu=pairUsd(), eu=payUsd(), fr=feeR(), vp=via();
    $('#tk-amt-usd').textContent=side==='buy'?(eu?fmtUsd(v*eu):''):fmtUsd(v*X.px);
    try{ const out=await quoteFor(v);
      if(seq!==qSeq) return; qOut=BigInt(out||0); quoting=false; const o=Number(qOut)/1e18; const mn=Number(minOut())/1e18; const oe=$('#tk-out'); oe.classList.toggle('dim',!(o>0));
      let fee=0, spot=0;
      if(side==='buy'){ oe.textContent=o>0?fmtAmt(o):'0'; $('#tk-out-usd').textContent=o>0?fmtUsd(o*X.px):''; $('#tk-min').textContent=fmtAmt(mn)+' '+X.t; fee=pu&&eu?v*eu/pu*fr:0; spot=eu&&X.px>0?v*eu/X.px:0; }
      else { oe.textContent=o>0?payFmt(o):'0'; $('#tk-out-usd').textContent=o>0?fmtUsd(o*eu):''; $('#tk-min').textContent=payFmt(mn); fee=pu&&eu?o*eu/pu*fr/(1-fr):0; spot=eu&&X.px>0?v*X.px/eu:0; }
      $('#tk-fee-l').textContent=`Fee ${feePct()}%`; $('#tk-fee').innerHTML=fee>0?`${inPair(fee)} <span class="muted">${fmtUsd(fee*pu)}</span>`:'—';
      const im=$('#tk-imp'); if(spot>0&&o>0){ const imp=Math.max(0,(1-o/(spot*(1-fr)))*100); im.textContent=imp.toFixed(2)+'%'; im.className=imp>15?'bad':imp>5?'warn':''; } else { im.textContent='—'; im.className=''; }
    }catch(e){ if(seq!==qSeq) return; quoting=false; qOut=0n; const oe=$('#tk-out'); oe.textContent='—'; oe.classList.add('dim'); $('#tk-out-usd').textContent=''; $('#tk-min').textContent='—'; $('#tk-fee').textContent='—'; $('#tk-imp').textContent='—'; console.warn('quote',e); }
    cta(); }
  function cta(){ if(ctaEl.dataset.busy) return; if(!SP.chainDeployed(tChain)&&!X.mock){ ctaEl.textContent=`Trading on ${tc().name} opens soon`; ctaEl.disabled=true; return; } const v=amtVal(); const W=SP.W; let t, dis=false;
    if(!W.connected) t='Connect a wallet'; else if(!W.chainOk) t='Switch to Ethereum'; else if(!v){ t='Enter amount'; dis=true; } else if(side==='buy'&&v>balEth){ t='Insufficient '+(via()?X.pair:'ETH'); dis=true; } else if(side==='sell'&&v>balCoin*1.000001){ t='Insufficient '+X.t; dis=true; } else if(quoting){ t='Fetching quote…'; dis=true; } else if(!(qOut>0n)){ t='No quote available'; dis=true; } else t=(side==='buy'?'Buy ':'Sell ')+X.t;
    ctaEl.textContent=t; ctaEl.disabled=dis; }
  async function doSwap(){ const W=SP.W; if(!W.connected) return SP.W.connect(); if(!W.chainOk){ try{ await SP.W.switchChain(); }catch(e){ SP.toast(SP.errMsg(e),'err'); } return; }
    const v=amtVal(); if(!v) return SP.toast('Enter an amount','err'); if(quoting||!(qOut>0n)) return SP.toast('Fetching the quote, try again in a second','info');
    const min=minOut(); ctaEl.dataset.busy='1'; ctaEl.disabled=true; ctaEl.textContent='Confirm in wallet…';
    try{ const vp=via(); if(side==='buy') await (vp?CHAIN.equo.buyWithPair(X.addr,X.pairAddr,CHAIN.parseEther(v.toFixed(18)),min):CHAIN.buy(X.addr,CHAIN.parseEther(v.toFixed(18)),min)); else await (vp?CHAIN.equo.sellForPair(X.addr,coinWei(v),min):CHAIN.sell(X.addr,coinWei(v),min));
      SP.toast((side==='buy'?'Bought ':'Sold ')+X.t+' · confirmed'); amtEl.value=''; delete ctaEl.dataset.busy; resetQuote(); await sync(true); }
    catch(e){ delete ctaEl.dataset.busy; SP.toast(SP.errMsg(e),'err'); }
    ctaEl.disabled=false; cta(); updQuote(); }
  function setSide(s){ if(s!==side){ side=s; amtEl.value=''; resetQuote(); } paintSide(); }
  $$('#tk-sides button').forEach(b=>b.onclick=()=>setSide(b.dataset.side));
    amtEl.addEventListener('input',()=>{ clearTimeout(qTimer); cta(); qTimer=setTimeout(updQuote,160); });
  $$('#tk-quick button').forEach(b=>b.onclick=()=>{ if(!SP.W.connected) return SP.W.connect(); const q=+b.dataset.q; let v;
    if(side==='buy'){ const max=via()?balEth:Math.max(0,balEth-0.003); v=max*q/100; amtEl.value=v>0?String(+v.toFixed(6)):''; }
    else { v=balCoin*q/100; amtEl.value=v>0?(q===100?CHAIN.formatEther(balCoinWei):String(+v.toFixed(6))):''; }
    updQuote(); });
  $$('#tk-slip button').forEach(b=>b.onclick=()=>{ slipMode=b.dataset.sl; $$('#tk-slip button').forEach(x=>x.classList.toggle('on',x===b)); const inp=$('#tk-slip-in'); inp.classList.toggle('hidden',slipMode!=='custom'); if(slipMode==='custom'){ inp.focus(); } updQuote(); });
  $('#tk-slip-in').addEventListener('input',()=>updQuote());
  $('#tk-qusd').addEventListener('click',e=>{ const b=e.target.closest('[data-u]'); if(!b) return; const eu=payUsd(); if(!eu){ SP.toast('Loading prices, try again in a second','info'); return; } amtEl.value=String(+(+b.dataset.u/eu).toFixed(6)); updQuote(); });
  ctaEl.onclick=doSwap;
  if(/[?&]side=sell/.test(location.search)) side='sell';
  SP.chainCosts().then(c=>{ CC=c; if(!onEth()) updQuote(); }).catch(()=>{});

  /* ---------- position and creator cards ---------- */
  let posSeq=0;
  async function position(){ const W=SP.W; const pos=$('#tk-pos'), cre=$('#tk-cre'); const seq=++posSeq;
    if(!W.connected){ balEth=0; balCoin=0; balCoinWei=0n; paintBal(); pos.classList.add('hidden'); cre.classList.add('hidden'); cta(); return; }
    const u=W.address;
    try{ if(!onEth()){ balEth=0; balCoin=0; balCoinWei=0n; paintBal(); cta(); } const [eb,cb,pend,p]=await Promise.all([(!onEth()?Promise.resolve(0n):via()?CHAIN.equo.balanceOf(X.pairAddr,u):CHAIN.ethBalance(u)).catch(()=>0n),CHAIN.balance(X.addr,u).catch(()=>0n),X.rewards?CHAIN.pending(X.addr,u).catch(()=>0n):Promise.resolve(0n),CHAIN.position(X.addr,u).catch(()=>null)]);
      if(seq!==posSeq||SP.W.address!==u) return; balEth=Number(eb)/1e18; balCoinWei=BigInt(cb||0); balCoin=Number(balCoinWei)/1e18; paintBal(); cta();
      const pu=pairUsd(); const pendV=Number(pend||0)/1e18; const mine=TR.filter(v=>v.wallet===u); const pn=SP.pnl(mine,X,balCoin,true); const avg=p&&p.avg>0?p.avg:0; const pc=avg>0&&X.pxPair>0?(X.pxPair/avg-1)*100:null;
      $('#tk-pos-sym').textContent=X.t;
      $('#tk-pos-body').innerHTML=`<div class="kv"><span>Balance</span><b>${fmtAmt(balCoin)} ${esc(X.t)}</b></div><div class="kv"><span>Value</span><b>${fmtUsd(balCoin*X.px)} <span class="muted">${inPair(balCoin*X.pxPair)}</span></b></div><div class="kv"><span>Average entry</span><b>${avg>0?'$'+fmtPrice(avg*pu)+' <span class="muted">'+fmtPrice(avg)+' '+esc(X.pair)+'</span>':'—'}</b></div>${pc!=null&&balCoin>0?`<div class="kv"><span>Since entry</span><b class="${pc>=0?'up':'dn'}">${pc>=0?'+':''}${pc.toFixed(1)}%</b></div>`:''}
        <div class="kv"><span>Holder rewards</span><b>${X.rewards?inPair(pendV)+' <span class="muted">'+fmtUsd(pendV*pu)+'</span>':'<span class="muted">not enabled for this coin</span>'}</b></div>${X.rewards?`<button class="btn block" style="margin-top:10px" id="tk-claim" ${pendV>0?'':'disabled'}>Claim ${esc(X.pair)}</button>`:''}${mine.length?`<button class="btn line block" style="margin-top:8px" id="tk-sharepnl">${ic('share')}Share PnL <span class="num ${pn.pnl>=0?'up':'dn'}" style="margin-left:6px">${pn.pnl>=0?'+':''}${pn.pct.toFixed(1)}%</span></button>`:''}`;
      const sh=$('#tk-sharepnl'); if(sh) sh.onclick=()=>SP.pnlCard({x:X,pnl:pn,wallet:u});
      const cb2=$('#tk-claim'); if(cb2) cb2.onclick=()=>doClaim(cb2,()=>CHAIN.claim(X.addr),'Rewards claimed');
      pos.classList.remove('hidden');
      if(u===X.creator){ const owed=X.creatorOwed||0; $('#tk-cre-body').innerHTML=`<div class="sboxes"><div class="sbox"><span class="lab">Claimable</span><b>${inPair(owed)}</b><i>${fmtUsd(owed*pu)}</i></div><div class="sbox"><span class="lab">Your share</span><b>60%</b><i>of every fee</i></div></div><button class="btn pri block" id="tk-paycre" ${owed>0?'':'disabled'}>Claim fees</button>`;
        $('#tk-paycre').onclick=e=>doClaim(e.currentTarget,()=>CHAIN.payCreator(X.addr),'Creator fees claimed'); cre.classList.remove('hidden'); }
      else cre.classList.add('hidden');
    }catch(e){ console.warn('position',e); } }
  async function doClaim(btn,fn,msg){ if(!SP.W.connected) return SP.W.connect(); const t=btn.textContent; btn.disabled=true; btn.textContent='Confirm in wallet…';
    try{ await fn(); SP.toast(msg); await sync(true); }catch(e){ SP.toast(SP.errMsg(e),'err'); btn.disabled=false; btn.textContent=t; } }

  /* ---------- creator and takeover (Equo factory) ---------- */
  let crtBusy=false;
  async function creatorCard(){ const el=$('#tk-crt-body'); if(!el||!window.SPC||crtBusy) return; crtBusy=true; try{ await SPC.render(el,X,creatorCard); }finally{ crtBusy=false; } }
  SP.onWallet(()=>creatorCard()); setInterval(()=>{ if(!document.hidden) creatorCard(); },60000);

  /* ---------- live refresh ---------- */
  let ticking=false;
  /* ---------- contract address: one per chain, like each chain's own pool; pick the chain to copy its address ---------- */
  let caChain=SP.coinChains(X).includes('eth')?'eth':SP.coinChains(X)[0];
  function caBar(){ const el=$('#tk-ca'); if(!el) return; const on=SP.coinChains(X), c=SP.chain(caChain), a=cs(SP.coinAddr(X,caChain));
    el.innerHTML=`<button type="button" class="cach" id="tk-cach" title="Pick a chain"><i style="background:${c.color}"></i>${esc(c.code||c.short)}${ic('down')}</button><span class="cav"><span class="lg2">${a.slice(0,12)}…${a.slice(-10)}</span><span class="sm2">${a.slice(0,6)}…${a.slice(-4)}</span></span><button type="button" class="cac" data-copy="${a}" title="Copy the ${esc(c.name)} address">${ic('copy')}<span class="cl">Copy</span></button><a class="cax" href="${c.explorer}/token/${a}" target="_blank" rel="noopener" title="View on the ${esc(c.name)} explorer">${ic('ext')}</a>`;
    $('#tk-cach').onclick=e=>{ e.stopPropagation(); const m=SP.menu(e.currentTarget,`<div class="mh">Contract on</div>`+on.map(k=>{ const ch=SP.chain(k), ad=cs(SP.coinAddr(X,k)); return `<button data-ck="${k}" class="${k===caChain?'on':''}"><i style="width:8px;height:8px;border-radius:50%;background:${ch.color};flex:none"></i><span style="min-width:96px">${esc(ch.name)}</span><span class="num muted" style="margin-left:auto">${ad.slice(0,6)}…${ad.slice(-4)}</span><span style="width:16px;display:inline-flex">${k===caChain?ic('check'):''}</span></button>`; }).join(''));
      $$('[data-ck]',m).forEach(b=>b.onclick=()=>{ m.remove(); caChain=b.dataset.ck; caBar(); }); };
    poolPill(); }
  function poolPill(){ const pl=$('#tk-pools'), on=SP.coinChains(X); if(pl) pl.innerHTML=on.length>1?`<span>Pools live</span><b>${X.poolsLive!=null?X.poolsLive:on.length}/${on.length}</b>${on.map(k=>`<i style="background:${SP.chain(k).color}" title="${esc(SP.chain(k).name)}"></i>`).join('')}`:''; }
  /* ---------- chains: where this coin lives; HyperEVM and BNB Chain open with multichain launches ---------- */
  function chainsCard(){ const el=$('#tk-chains-body'); if(!el) return; const on=SP.coinChains(X);
    $('#tk-bridge').href='/bridge?coin='+X.addr;
    el.innerHTML=SP.chains.map(c=>{ const has=on.includes(c.key);
      return `<div class="chr${has?'':' off'}"><img src="${c.logo}" alt=""><span class="cn"><b>${esc(c.name)} ${has?'<span class="liveb">Live</span>':c.live?'':'<span class="soonb">Soon</span>'}</b><small>${has?`<span class="chx">${shortAddr(cs(SP.coinAddr(X,c.key)))}<button type="button" data-copy="${cs(SP.coinAddr(X,c.key))}" title="Copy the ${esc(c.name)} address">${ic('copy')}</button><a href="${c.explorer}/token/${SP.coinAddr(X,c.key)}" target="_blank" rel="noopener" title="View on the ${esc(c.name)} explorer">${ic('ext')}</a></span> · 1B supply`:'Not on this chain yet'}</small></span><span class="cv">${has?'$'+fmtPrice(((X.byChain||{})[c.key]||{}).px||X.px)+'<small>'+(((X.byChain||{})[c.key]||{}).vol!=null?fmtUsd(X.byChain[c.key].vol)+' vol':fmtUsd(X.mc/on.length)+' mcap')+'</small>':'—'}</span></div>`; }).join('')
      +`<p class="chnote">${on.length>1?'Each chain has its own pool; arbitrage keeps the prices in line. ':''}Coins launched on several chains move between them on the <a href="/bridge?coin=${X.addr}">Bridge</a>.</p>`; }
  function paintAll(){ stats(); headLive(); flow(); chainsCard(); poolPill(); if(activeTab==='pools') pools(); document.title=`${X.t} $${fmtPrice(X.px)} | Equo`; if(activeTab==='info') info(); }
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

  /* ---------- safety: what the contracts guarantee, stated plainly ---------- */
  function safety(){ const n=SP.coinChains(X).length, chk=ic('check');
    $('#tk-safe').innerHTML=`<div class="sh3">Safety<span>by the contracts</span></div><div class="sg">${n>1?`<div>${chk}Peers sealed<small>at launch</small></div><div>${chk}New supply<small>bridge only</small></div><div>${chk}Same address<small>every EVM chain</small></div>`:`<div>${chk}Supply<small>fixed at 1B</small></div><div>${chk}No mint<small>after launch</small></div>`}<div>${chk}Trading fee<small>set at launch</small></div></div>`;
    $('#tk-bridge2').href='/bridge?coin='+X.addr; }

  /* ---------- boot ---------- */
  safety(); creatorCard(); head(); caBar(); stats(); headLive(); chainsCard(); document.title=`${X.t} $${fmtPrice(X.px)} | Equo`; chart(); paintSide(); resetQuote(); cta(); loadTrades(); position();
};
