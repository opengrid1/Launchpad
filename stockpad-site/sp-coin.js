/* Coin page (Equo v2): header and stats across chains, chart, trades / holders / pools, and on the right the trade
   card (pick a chain, buy or sell in its native coin), that chain's last-buyer pot and crash shield, and the creator
   fees waiting on every chain. Reads the coin address (any chain's) from /token/<addr> or /token.html?t=<addr>. */
window.SP_PAGE=function(){
  const pg=$('#pg-coin'); if(!pg||!window.V2) return;
  const addrFromUrl=()=>{ const m=location.pathname.match(/\/token\/(0x[0-9a-fA-F]{40})/); if(m) return m[1].toLowerCase(); const q=new URLSearchParams(location.search).get('t')||''; return /^0x[0-9a-fA-F]{40}$/.test(q)?q.toLowerCase():''; };
  const addr=addrFromUrl();
  let X=addr?V2.coin(addr):null;
  if(!X){
    if(addr&&!SP_PAGE._tried){ SP_PAGE._tried=1; V2.detail(addr).then(()=>SP_PAGE()).catch(()=>SP_PAGE()); return; }
    $('#cn-page').classList.add('hidden'); const e=$('#cn-empty'); e.classList.remove('hidden');
    $('#cn-crumb').innerHTML=`<a href="/markets">Markets</a>`;
    e.innerHTML=`<b>${addr?'Coin not found':'No coin selected'}</b>${addr?'No Equo coin has that address yet. A coin launched a moment ago shows up within a minute.':'Open a coin from the markets page.'}<div style="margin-top:14px"><a class="btn" href="/markets">${ic('back')}Back to markets</a></div>`;
    return;
  }
  const keys=()=>X.chains, ch=k=>SP.chain(k)||{name:k,native:'',logo:'',code:k};
  const nusd=k=>(V2.nativeUsd()||{})[k]||0;
  const W=()=>SP.W, me=()=>(W().connected&&W().address)||'';
  const n9=v=>Number(v)/1e9, n18=v=>Number(v)/1e18;
  const fmtN=(v,sym)=>SP.fmtNative?SP.fmtNative(v,sym):fmtAmt(v)+' '+sym;
  const LIVE={}; let tChain=keys().includes('eth')?'eth':keys()[0], side='buy', slip=1, qOut=0n, quoting=false, qSeq=0, bal={coin:0n,native:0n};
  const wl=(a,k)=>{ const c=k?ch(k):null; return `<span class="w"><span class="av">${SP.avatar(a,18)}</span><a href="${(c&&c.explorer)||EXPLORER}/address/${a}" target="_blank" rel="noopener">${shortAddr(cs(a))}</a>${me()&&a===me()?' <span class="tag mint">you</span>':''}</span>`; };
  const cimg=k=>`<img class="cimg" src="${ch(k).logo}" alt="" title="${esc(ch(k).name)}">`;
  const fmtTimer=s=>{ s=Math.max(0,Math.floor(s)); const m=Math.floor(s/60), r=s%60; return `${String(m).padStart(2,'0')}:${String(r).padStart(2,'0')}`; };
  pg.addEventListener('click',e=>{ const b=e.target.closest('[data-copy]'); if(b){ e.preventDefault(); SP.copy(b.dataset.copy,'Address copied'); } });

  /* ---------- header ---------- */
  function head(){
    const links=[['Website',X.links.web,'globe'],['X',X.links.x,'ext'],['Telegram',X.links.tg,'ext']].filter(l=>l[1]&&/^https?:\/\//i.test(l[1]));
    $('#cn-crumb').innerHTML=`<a href="/markets">Markets</a>${ic('chevr')}<span class="dim">$${esc(X.t)}</span>`;
    document.title=`${X.n} ($${X.t}) | Equo`;
    $('#cn-head').innerHTML=`<div class="hd"><img class="lg" src="${SP.coinLogo(X)}" alt="" onerror="this.onerror=null;this.src='${DEF_LOGO}'">
      <div style="min-width:0"><div class="t1"><h1>${esc(X.n)}</h1><span class="sym">$${esc(X.t)}</span>${SP.star(X.addr)}</div>
        <div class="t2"><span title="${esc(SP.fmtDate(X.createdAt))}">${ageStr(X.age||'0s')}</span><span class="badge">${(X.feeBps/100).toFixed(2).replace(/\.?0+$/,'')}% fee</span><span class="badge">${keys().length} chains</span>${links.map(l=>`<a class="lk" href="${esc(l[1])}" target="_blank" rel="noopener noreferrer nofollow">${ic(l[2])}${l[0]}</a>`).join('')}</div>
        ${X.desc?`<p class="desc">${esc(X.desc)}</p>`:''}
        <div class="by">Created by ${wl(X.creator)}</div>
        <div class="cas">${keys().map(k=>`<span class="ca" data-copy="${cs(X.addrs[k])}" title="Copy the ${esc(ch(k).name)} address">${cimg(k).replace('cimg','')}${esc(ch(k).code||ch(k).short)} ${shortAddr(cs(X.addrs[k]))}${ic('copy')}</span>`).join('')}</div></div>
      <div class="big"><span>Market cap</span><b id="cn-mc">${fmtUsd(X.mc)}</b><small class="${(X.c24||0)>=0?'up':'dn'}" id="cn-c24">${(X.c24||0)>=0?'+':''}${(X.c24||0).toFixed(2)}% 24h</small></div></div>
      <div class="srow" id="cn-stats"></div>`;
    stats(); }
  function stats(){ const el=$('#cn-stats'); if(!el) return;
    el.innerHTML=[['Price','$'+fmtPrice(X.px)],['Liquidity',fmtUsd(X.liq||0)],['Volume 24h',fmtUsd(X.vol||0)],['Holders',(X.h||0).toLocaleString()],['Supply',(X.supplyAll>=1e9?(Math.round(X.supplyAll/1e7)/100)+'B':fmtAmt(X.supplyAll))]].map(s=>`<div><span>${s[0]}</span><b>${s[1]}</b></div>`).join('');
    const m=$('#cn-mc'); if(m) m.textContent=fmtUsd(X.mc); }

  /* ---------- tabs ---------- */
  let tab='trades';
  $$('#cn-tabs button').forEach(b=>b.onclick=()=>{ tab=b.dataset.t; $$('#cn-tabs button').forEach(x=>x.classList.toggle('on',x===b)); $$('#pg-coin .pane').forEach(p=>p.classList.toggle('on',p.id==='cn-'+tab)); paintTab(); });
  let TR=[], HO=[];
  function paintTab(){
    if(tab==='trades') $('#cn-trades').innerHTML=TR.length?`<table><thead><tr><th>Time</th><th>Chain</th><th>Type</th><th class="r">USD</th><th class="r">${esc(X.t)}</th><th class="r">Paid</th><th>Wallet</th><th></th></tr></thead><tbody>${TR.slice(0,100).map(t=>{ const c=ch(t.chain); return `<tr><td>${ago(Math.max(0,Math.floor(Date.now()/1000)-t.ts))} ago</td><td>${cimg(t.chain)}${esc(c.code||c.short||'')}</td><td class="${t.buy?'b':'s'}">${t.buy?'Buy':'Sell'}</td><td class="r">${t.value!=null?fmtUsd(t.value):'—'}</td><td class="r">${fmtAmt(n18(t.coin))}</td><td class="r">${fmtN(n18(t.pair),c.native)}</td><td>${wl(t.wallet,t.chain)}</td><td><a class="txl" href="${c.explorer}/tx/${t.tx}" target="_blank" rel="noopener">${ic('ext')}</a></td></tr>`; }).join('')}</tbody></table>`:`<div class="empty"><b>No trades yet</b>The first buy on any chain shows here.</div>`;
    if(tab==='holders') $('#cn-holders').innerHTML=HO.length?`<table><thead><tr><th>#</th><th>Wallet</th><th class="r">${esc(X.t)}</th><th class="r">Share</th><th>Chains</th></tr></thead><tbody>${HO.map((h,i)=>`<tr><td>${i+1}</td><td>${wl(h.wallet)}</td><td class="r">${fmtAmt(h.bal)}</td><td class="r">${h.share.toFixed(2)}%</td><td>${Object.keys(h.byChain||{}).filter(k=>Number(h.byChain[k])>0).map(cimg).join('')}</td></tr>`).join('')}</tbody></table>`:`<div class="empty"><b>No holders yet</b></div>`;
    if(tab==='pools') $('#cn-pools').innerHTML=`<table><thead><tr><th>Chain</th><th class="r">Price</th><th class="r">Liquidity</th><th class="r">In pool</th><th class="r">Volume 24h</th><th>Coin</th></tr></thead><tbody>${keys().map(k=>{ const p=(X.pools||{})[k]||{}, b=(X.byChain||{})[k]||{}, c=ch(k); return `<tr><td>${cimg(k)}${esc(c.name)}</td><td class="r">${p.priceUsd?'$'+fmtPrice(p.priceUsd):'—'}</td><td class="r">${p.liquidityUsd!=null?fmtUsd(p.liquidityUsd):'—'}</td><td class="r">${p.coinsInPool!=null?fmtAmt(p.coinsInPool)+' '+esc(X.t)+' · '+fmtN(p.pairInPool||0,c.native):'—'}</td><td class="r">${fmtUsd(b.vol||0)}</td><td><a href="${c.explorer}/token/${X.addrs[k]}" target="_blank" rel="noopener">${shortAddr(cs(X.addrs[k]))}</a></td></tr>`; }).join('')}</tbody></table>`;
  }
  async function loadLists(){ try{ TR=await CHAIN.trades(X.addr); TR=TR.slice().reverse(); }catch(e){ console.warn('trades',e); }
    try{ HO=await CHAIN.holders(X.addr); }catch(e){ console.warn('holders',e); } paintTab(); }

  /* ---------- trade card ---------- */
  const amtEl=$('#cn-amt'), ctaEl=$('#cn-cta');
  const amtVal=()=>{ const v=parseFloat(String(amtEl.value).replace(/,/g,'')); return isFinite(v)&&v>0?v:0; };
  const toRaw=(v,d)=>{ const s=v.toFixed(d); return BigInt(s.replace('.','')); };
  const lv=()=>LIVE[tChain];
  function chips(){ $('#cn-chips').innerHTML=keys().map(k=>{ const c=ch(k), l=LIVE[k]; const px=l&&l.priceNative&&nusd(k)?' · $'+fmtPrice(l.priceNative*nusd(k)):''; return `<button type="button" class="chip ${k===tChain?'on':''}" data-k="${k}" style="--cc:${c.color}" title="${esc(c.name)}${px}"><img src="${c.logo}" alt="">${esc(c.code||c.short)}</button>`; }).join('');
    $$('#cn-chips [data-k]').forEach(b=>b.onclick=()=>{ tChain=b.dataset.k; amtEl.value=''; resetQuote(); chips(); paintSide(); potCard(); shieldCard(); loadBal(); }); }
  function paintSide(){ $$('#cn-sides button').forEach(b=>b.classList.toggle('on',b.dataset.side===side));
    const c=ch(tChain), coin=`<img src="${SP.coinLogo(X)}" alt="" onerror="this.onerror=null;this.src='${DEF_LOGO}'"><span>${esc(X.t)}</span>`, nat=`<img src="${c.logo}" alt=""><span>${esc(c.native)}</span>`;
    $('#cn-asset-in').innerHTML=side==='buy'?nat:coin; $('#cn-asset-out').innerHTML=side==='buy'?coin:nat;
    ctaEl.classList.toggle('bu',side==='buy'); ctaEl.classList.toggle('se',side==='sell');
    $('#cn-quick').innerHTML=side==='buy'?[10,50,100,500].map(u=>`<button type="button" data-u="${u}">$${u}</button>`).join(''):[25,50,100].map(p=>`<button type="button" data-p="${p}">${p}%</button>`).join('');
    $$('#cn-quick [data-u]').forEach(b=>b.onclick=()=>{ const u=nusd(tChain); if(!u) return; amtEl.value=(+b.dataset.u/u).toPrecision(4); updQuote(); });
    $$('#cn-quick [data-p]').forEach(b=>b.onclick=()=>{ amtEl.value=String(n9(bal.coin*BigInt(b.dataset.p)/100n)); updQuote(); });
    paintBal(); cta(); }
  function paintBal(){ const c=ch(tChain), nb=me()?fmtN(n18(bal.native),c.native):'—', cb=me()?fmtAmt(n9(bal.coin))+' '+X.t:'—';
    $('#cn-bal-in').textContent='Balance: '+(side==='buy'?nb:cb); $('#cn-bal-out').textContent='Balance: '+(side==='buy'?cb:nb); }
  async function loadBal(){ if(!me()){ bal={coin:0n,native:0n}; paintBal(); cta(); return; } try{ bal=await V2.balances(X,tChain,me()); }catch{} paintBal(); cta(); }
  function resetQuote(){ qOut=0n; const o=$('#cn-out'); o.textContent='0'; o.classList.add('dim'); $('#cn-min').textContent='—'; $('#cn-fee').textContent='—'; $('#cn-note').textContent=''; }
  function updQuote(){ const v=amtVal(), l=lv(); if(!v||!l){ resetQuote(); cta(); return; }
    const seq=++qSeq; quoting=true;
    const raw=side==='buy'?toRaw(v,18):toRaw(v,9), q=V2.quote(l,side,raw); if(seq!==qSeq) return; quoting=false; qOut=q.out;
    const c=ch(tChain), out=side==='buy'?n9(q.out):n18(q.out), min=out*(1-slip/100), o=$('#cn-out');
    o.textContent=out>0?(side==='buy'?fmtAmt(out):fmtN(out,c.native)):'0'; o.classList.toggle('dim',!(out>0));
    $('#cn-min').textContent=out>0?(side==='buy'?fmtAmt(min)+' '+X.t:fmtN(min,c.native)):'—';
    const bps=side==='buy'?l.feeBuyBps:l.feeSellBps; $('#cn-fee-l').textContent=`Fee ${(bps/100).toFixed(2)}%${l.shieldBps>0?' · shield':''}`;
    $('#cn-fee').textContent=q.fee?fmtN(n18(q.fee),c.native)+(nusd(tChain)?' · '+fmtUsd(n18(q.fee)*nusd(tChain)):''):'—';
    const usdIn=side==='buy'?v*nusd(tChain):0, minBuyUsd=l.pot&&nusd(tChain)?n18(l.pot.minBuy)*nusd(tChain):50;
    $('#cn-note').textContent=q.limited?'The pool cannot take all of it: the sell stops at the opening price and returns the rest.':side==='buy'&&usdIn>0?(usdIn*(1-bps/1e4)>=minBuyUsd?`This buy takes the pot's 20-minute timer on ${c.name}.`:`Buys of ${fmtUsd(minBuyUsd)} or more take the pot's timer.`):'';
    cta(); }
  function cta(){ if(ctaEl.dataset.busy) return; const v=amtVal(), c=ch(tChain); let t, dis=false;
    if(!W().connected) t='Connect a wallet'; else if(!lv()){ t='Loading the pool…'; dis=true; } else if(!v){ t='Enter an amount'; dis=true; }
    else if(side==='buy'&&toRaw(v,18)>bal.native){ t='Not enough '+c.native+' on '+c.name; dis=true; } else if(side==='sell'&&toRaw(v,9)>bal.coin){ t='Not enough '+X.t+' on '+c.name; dis=true; }
    else if(!(qOut>0n)){ t='No quote'; dis=true; } else t=`${side==='buy'?'Buy':'Sell'} ${X.t} on ${c.name}`;
    ctaEl.textContent=t; ctaEl.disabled=dis; }
  async function doSwap(){ if(!W().connected) return SP.W.connect?SP.W.connect().catch(e=>SP.toast(SP.errMsg(e),'err')):null;
    const v=amtVal(); if(!v||!(qOut>0n)) return; const min=qOut-qOut*BigInt(Math.round(slip*100))/10000n;
    ctaEl.dataset.busy='1'; ctaEl.disabled=true; ctaEl.textContent='Confirm in your wallet…';
    try{ if(side==='buy') await V2.buy(X,tChain,toRaw(v,18),min); else await V2.sell(X,tChain,toRaw(v,9),min);
      SP.toast(`${side==='buy'?'Bought':'Sold'} ${X.t} on ${ch(tChain).name}`); amtEl.value=''; resetQuote();
      await Promise.all([liveOne(tChain),loadBal()]); setTimeout(()=>{ refresh(true); },4000); }
    catch(e){ SP.toast(SP.errMsg(e),'err'); }
    delete ctaEl.dataset.busy; cta(); }
  $$('#cn-sides button').forEach(b=>b.onclick=()=>{ if(side!==b.dataset.side){ side=b.dataset.side; amtEl.value=''; resetQuote(); } paintSide(); });
  $$('#cn-slip [data-s]').forEach(b=>b.onclick=()=>{ slip=+b.dataset.s; $$('#cn-slip [data-s]').forEach(x=>x.classList.toggle('on',x===b)); updQuote(); });
  let qt; amtEl.addEventListener('input',()=>{ clearTimeout(qt); cta(); qt=setTimeout(updQuote,120); });
  ctaEl.onclick=doSwap;

  /* ---------- pot, shield, creator fees ---------- */
  function potCard(){ const l=lv(), c=ch(tChain), el=$('#cn-pot'); $('#cn-pot-ch').innerHTML=`${cimg(tChain)}${esc(c.name)}`; if(!l||!l.pot){ el.innerHTML='<div class="dim">Loading…</div>'; return; }
    const p=l.pot, amt=n18(p.amount), u=nusd(tChain), now=Math.floor(Date.now()/1000), left=p.deadline-now, minUsd=u?n18(p.minBuy)*u:50;
    const total=keys().reduce((s,k)=>s+(LIVE[k]&&LIVE[k].pot?n18(LIVE[k].pot.amount)*nusd(k):0),0);
    let state;
    if(p.lastBuyer&&p.lastBuyer!=='0x0000000000000000000000000000000000000000'){
      state=left>0?`<div class="timer ${left<120?'hot':''}"><div><span>Last buyer</span><div>${wl(p.lastBuyer,tChain)}</div></div><div style="text-align:right"><span>Wins in</span><b data-dl="${p.deadline}">${fmtTimer(left)}</b></div></div>`
        :`<div class="timer hot"><div><span>Round over · winner</span><div>${wl(p.lastBuyer,tChain)}</div></div><button class="btn sm" id="cn-settle">Send the prize</button></div><p class="note">The next trade on ${esc(c.name)} sends the prize too.</p>`;
    } else state=`<div class="timer"><div><span>No timer running</span><div style="font-size:12.5px;color:var(--fg-2)">A buy of ${fmtUsd(minUsd)} or more starts it</div></div><b>20:00</b></div>`;
    el.innerHTML=`<div class="potv"><b>${u?fmtUsd(amt*u):fmtN(amt,c.native)}</b><small>${fmtN(amt,c.native)} · round ${p.round+1}</small></div>${state}
      <p class="note">0.1% of every trade fills this chain's pot. The last buy of ${fmtUsd(minUsd)}+ before 20 minutes pass wins 80%, sent to the wallet; 20% starts the next round. Selling gives your spot up.${total>0?` All chains: ${fmtUsd(total)}.`:''}</p>`;
    const s=$('#cn-settle'); if(s) s.onclick=async()=>{ s.disabled=true; try{ await V2.settle(X,tChain); SP.toast('Prize sent'); await liveOne(tChain); }catch(e){ SP.toast(SP.errMsg(e),'err'); } s.disabled=false; }; }
  function shieldCard(){ const l=lv(), el=$('#cn-shield'), p=$('#cn-shield-p'); if(!l){ el.innerHTML='<div class="dim">Loading…</div>'; return; }
    const up=l.shieldBps>0; p.classList.toggle('up',up);
    el.innerHTML=up?`<div class="kv"><span>Status</span><b style="color:var(--amber)">Up on ${esc(ch(tChain).name)}</b></div><div class="kv"><span>Sell fee now</span><b>${(l.feeSellBps/100).toFixed(2)}%</b></div><div class="kv"><span>Buy fee now</span><b>${(l.feeBuyBps/100).toFixed(2)}%</b></div><div class="sbar"><i style="width:${l.shieldBps/100}%"></i></div><p class="note">The price fell 20% within 10 minutes. Sells pay up to 5% more, into the pot; buys pay up to half the fee less. It fades over 30 minutes.</p>`
      :`<div class="kv"><span>Status</span><b>Down</b></div><div class="kv"><span>Fee now</span><b>${(l.feeBuyBps/100).toFixed(2)}% buy · ${(l.feeSellBps/100).toFixed(2)}% sell</b></div><p class="note">If the price falls 20% within 10 minutes, sells pay up to 5% more (into the pot) and buys pay up to half the fee less, fading over 30 minutes.</p>`; }
  function creatorCard(){ const el=$('#cn-crt'); const rows=keys().map(k=>{ const l=LIVE[k]; return l?[k,n18(l.creatorOwed)]:[k,null]; });
    const tot=rows.reduce((s,[k,v])=>s+(v?v*nusd(k):0),0), mine=me()&&me()===X.creator;
    el.innerHTML=`<div class="potv"><b>${fmtUsd(tot)}</b><small>waiting on ${rows.filter(r=>r[1]>0).length} chains</small></div>${rows.map(([k,v])=>`<div class="kv"><span>${cimg(k)}${esc(ch(k).name)}</span><b>${v==null?'…':fmtN(v,ch(k).native)}${v>0?` <button class="btn sm line" data-pay="${k}">Pay</button>`:''}</b></div>`).join('')}
      <p class="note">${mine?'Your share of every fee, in each chain\'s native coin. Paying sends it to your wallet on that chain.':'The creator\'s share of every fee. Anyone can send it; it always goes to the creator.'}</p>`;
    $$('[data-pay]',el).forEach(b=>b.onclick=async()=>{ b.disabled=true; try{ await V2.payCreator(X,b.dataset.pay); SP.toast('Creator fees sent on '+ch(b.dataset.pay).name); await liveOne(b.dataset.pay); creatorCard(); }catch(e){ SP.toast(SP.errMsg(e),'err'); b.disabled=false; } }); }

  /* ---------- live data ---------- */
  async function liveOne(k){ try{ LIVE[k]=await V2.live(X,k); }catch(e){ console.warn('live',k,e.message); } if(k===tChain){ potCard(); shieldCard(); updQuote(); } }
  async function liveAll(){ await Promise.all(keys().map(liveOne)); chips(); creatorCard(); potCard(); }
  async function refresh(lists){ try{ X=await V2.detail(X.addr); }catch{} stats(); if(tab==='pools') paintTab(); if(lists) await loadLists(); }

  head(); chips(); paintSide(); paintTab(); potCard(); shieldCard(); creatorCard();
  if(window.initTV) try{ initTV('tv',X); }catch(e){ console.warn('chart',e); }
  liveAll(); loadBal(); loadLists(); refresh(false);
  V2.prices().then(()=>{ potCard(); creatorCard(); chips(); updQuote(); });
  SP.onWallet(()=>{ loadBal(); creatorCard(); });
  setInterval(()=>{ $$('[data-dl]').forEach(b=>{ const left=+b.dataset.dl-Math.floor(Date.now()/1000); b.textContent=fmtTimer(left); if(left<=0) potCard(); }); },1000);
  setInterval(()=>{ if(document.visibilityState!=='hidden') liveAll(); },15000);
  setInterval(()=>{ if(document.visibilityState!=='hidden'){ refresh(true); if(window.tvTick) try{ tvTick(X.pxPair,TR.slice(0,1)); }catch{} } },30000);
};
