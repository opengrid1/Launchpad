/* Launch page: 3-step wizard (pair, identity, fee and launch) with a live summary card. Uses the core.js globals ($, $$, esc, ic, SP, TOK, WETH, EXPLORER, SITE, DEF_LOGO).
   The wizard is built on DOMContentLoaded so the form is usable while the chain layer loads; SP_PAGE (called by core.js once chain data is in) repaints prices, coin counts and the symbol check. */
let launchRepaint=null;
function launchInit(){
  const pg=$('#pg-launch'); if(!pg||launchRepaint) return;
  const g=id=>document.getElementById(id);
  const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
  const num=(id,d)=>{ const v=parseFloat(g(id).value); return isFinite(v)?v:d; };
  const IMG_IC='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/></svg>';
  const ETH_PAIR={address:WETH,symbol:NATIVE,ticker:NATIVE,name:"Hyperliquid's coin",logo:NATIVE_IMG,eth:true,route:true};
  const DEV_MAX=(window.INKY&&INKY.devBuyMax)||50, BLOCK_SECS=(window.INKY&&INKY.blockSecs)||1;
  const kindOf=p=>(p.eth||p.crypto)?'crypto':'stock';
  const PAIRS=[...SP.stocks.map(s=>({address:s.address.toLowerCase(),symbol:s.symbol,ticker:s.ticker||s.symbol,name:s.name,logo:s.logo,eth:false,route:!!s.route})),...((window.INKY&&INKY.cryptoPairs)||[]).map(s=>({address:s.address.toLowerCase(),symbol:s.symbol,ticker:s.ticker||s.symbol,name:s.name,logo:s.logo,eth:false,crypto:true,route:!!s.route})),...((window.INKY&&INKY.stocksOnly)?[]:[ETH_PAIR])];
  const PAIR_ROWS=60;
  const S={kind:'crypto',chains:SP.chains.filter(c=>SP.chainDeployed(c.key)).map(c=>c.key),pay:(SP.chains.find(c=>c.main)||SP.chains[0]||{}).key,step:1,maxStep:1,pair:null,logo:null,preset:0,presets:[],feeBps:100,feeCustom:false,snipe:false,div:false,bb:false,mw:false,dev:false,capUsd:3000,paused:false,busy:false,launched:null};
  const taken=()=>new Set(((window.CHAIN&&LIVE)?CHAIN.tokens():TOK).map(x=>String(x.t||'').toUpperCase()));
  const ethPx=()=>SP.prices[WETH]||ETH||0;
  const pairPx=()=>S.pair?(SP.prices[S.pair.address]||0):0;
  const fmtPx=v=>v?'$'+(v>=100?v.toFixed(0):v>=1?v.toFixed(2):fmtPrice(v)):'';
  const fmtCap=v=>'$'+Math.round(v).toLocaleString('en-US');
  const feePct=()=>(S.feeBps/100).toFixed(S.feeBps%100?(S.feeBps%10?2:1):0)+'%';
  const fmtInPair=v=>{ if(!S.pair) return ''; if(S.pair.eth) return fmtEth(v); return (v>=100?v.toFixed(0):v>=1?v.toFixed(2):fmtPrice(v))+' '+S.pair.symbol; };
  const link=v=>{ v=String(v||'').trim(); if(!v) return ''; if(!/^https?:\/\//i.test(v)) v='https://'+v; return v.slice(0,200); };
  const fields={ name:()=>g('f-name').value.trim(), sym:()=>g('f-sym').value.trim().toUpperCase(), desc:()=>g('f-desc').value.trim().slice(0,280),
    snipePct:()=>num('f-snipe',30), snipeMin:()=>num('f-snipemin',30), divPct:()=>num('f-div',20), devEth:()=>num('f-dev',0),
    bbPct:()=>num('f-bb',20), bbUsd:()=>num('f-bbusd',50), mwPct:()=>num('f-mw',2), mwH:()=>num('f-mwh',1) };

  /* ---------- derived numbers ---------- */
  function split(){ const dv=S.div?clamp(Math.round(fields.divPct()),10,50):0, bb=S.bb?clamp(Math.round(fields.bbPct()),10,50):0; const rest=Math.max(0,100-dv-bb), cr=Math.round(rest*0.6), pl=rest-cr; return {holders:dv,buyback:bb,creator:cr,platform:pl}; }
  function devCoins(){ const eth=S.dev?clamp(fields.devEth(),0,DEV_MAX):0; const usd=eth*ethPx(); return usd>0?usd/(S.capUsd+usd)*SUPPLY:0; }
  function optList(){ const a=[]; if(S.snipe) a.push('Anti-snipe'); if(S.div) a.push('Holder rewards'); if(S.bb) a.push('Buyback and burn'); if(S.mw) a.push('Max wallet'); return a; }
  function snipeBlocks(){ return clamp(Math.round(fields.snipeMin()*60/BLOCK_SECS),5,7200); }

  /* ---------- step 1: pairs ---------- */
  function paintPairs(){ const counts={}; TOK.forEach(x=>{ counts[x.pair]=(counts[x.pair]||0)+1; }); const mk=SP.market(); const natives=[...new Set(S.chains.map(k=>(SP.chain(k)||{}).native).filter(Boolean))]; g('mk-status').textContent=S.pair&&S.pair.eth?`Pairs with ${NATIVE}, Hyperliquid's own coin. Trades 24/7.`:S.pair&&S.pair.crypto?`Pairs with ${S.pair.ticker}. Trades 24/7.`:S.pair?`${S.pair.ticker} · NYSE ${mk.open?'open':'closed'} · ${mk.detail}`:'';
    const q=String(g('pair-q').value||'').trim().toLowerCase(), hit=p=>!q||p.ticker.toLowerCase().startsWith(q)||p.symbol.toLowerCase().startsWith(q)||p.name.toLowerCase().includes(q)||p.address===q;
    const list=PAIRS.filter(p=>kindOf(p)===S.kind&&hit(p)).sort((a,b)=>(counts[b.symbol]||0)-(counts[a.symbol]||0)||(q?(a.ticker.toLowerCase()===q?-1:b.ticker.toLowerCase()===q?1:0):0)), shown=list.slice(0,PAIR_ROWS);
    g('pairs-list').innerHTML=(shown.length?'':`<div class="pempty">No ${S.kind==='stock'?'stock':'pair'} matches "${esc(q)}"</div>`)+shown.map(p=>{ const px=SP.prices[p.address], n=counts[p.symbol]||0; return `<button type="button" class="pc${S.pair&&S.pair.address===p.address?' on':''}" data-p="${p.address}"><img src="${p.logo}" alt="" onerror="this.onerror=null;this.src='/img/t-default.png'"><span class="nm"><b>${esc(p.ticker)} <span class="muted" style="font-weight:400">${esc(p.name)}</span></b><small>${p.eth?'Hyperliquid\'s coin · default':esc(p.symbol)+' · '+(p.route?'buy with '+NATIVE:'trades in '+esc(p.symbol))}</small></span><span class="ft"><span>${(p.eth||p.crypto)?'TRADES 24/7':`<i class="dot ${mk.open?'open':''}"></i>${mk.open?'NYSE OPEN':'NYSE CLOSED'}`}</span><span class="cnt">${n} ${n===1?'coin':'coins'}</span></span><span class="px" data-px="${p.address}">${px?fmtPx(px):'…'}</span><span class="tick">${ic('check')}</span></button>`; }).join('')+(list.length>shown.length?`<div class="pempty">${list.length-shown.length} more · type to search</div>`:'');
    $$('#pairs [data-p]').forEach(b=>b.onclick=()=>{ setPair(PAIRS.find(p=>p.address===b.dataset.p)); g('pair-dd').classList.remove('open'); });
    const pv=g('pair-pv'); if(pv){ pv.innerHTML=S.pair&&S.pair.eth?`<img src="${NATIVE_IMG}" alt="">${esc(NATIVE)} <small>Hyperliquid's coin</small>`:S.pair?`<img src="${S.pair.logo}" alt="" onerror="this.onerror=null;this.src='/img/t-default.png'">${esc(S.pair.ticker)} <small>${esc(S.pair.name)} · ${esc(S.pair.symbol)}</small>`:'Select'; } }
  /** the dev buy is paid in HYPE, so it needs a HYPE route into the pair */
  function devRoute(){ const ok=!S.pair||S.pair.route; if(!ok&&S.dev){ S.dev=false; const sw=g('sw-dev'); sw.classList.remove('on'); sw.setAttribute('aria-checked','false'); g('opt-dev').classList.remove('on'); }
    g('opt-dev').classList.toggle('off',!ok); g('dev-hdr').textContent=ok?'Paid in '+NATIVE:`Off: ${S.pair.ticker} has no ${NATIVE} route`; }
  function paintKind(){ $$('#pair-kind button').forEach(b=>b.classList.toggle('on',b.dataset.k===S.kind)); g('pair-q').placeholder=S.kind==='stock'?`Search ${SP.stocks.length} stocks: ticker or name`:'Search pairs'; }
  function setPair(p){ S.pair=p||null; S.pairBad=''; g('pair-err').textContent=''; devRoute(); if(S.pair&&window.CHAIN&&CHAIN.equo&&CHAIN.equo.launchable) CHAIN.equo.launchable(S.pair.address).then(r=>{ if(S.pair!==p) return; S.pairBad=r.why; g('pair-err').textContent=r.why; sync(); }).catch(()=>{}); paintPairs(); if(S.pair){ const u=new URL(location.href); u.searchParams.set('pair',S.pair.symbol); history.replaceState(null,'',u); SP.pairUsd(S.pair.address).then(()=>{ paintPairs(); sync(); }).catch(()=>{}); } sync(); }
  function preselect(){ const q=(new URLSearchParams(location.search).get('pair')||'').trim().toLowerCase(); if(!q){ S.pair=ETH_PAIR; devRoute(); return; } const p=PAIRS.find(x=>x.symbol.toLowerCase()===q||x.ticker.toLowerCase()===q||x.address===q); if(p){ S.pair=p; S.kind=kindOf(p); S.pairBad=''; devRoute(); if(window.CHAIN&&CHAIN.equo&&CHAIN.equo.launchable) CHAIN.equo.launchable(p.address).then(r=>{ if(S.pair!==p) return; S.pairBad=r.why; g('pair-err').textContent=r.why; }).catch(()=>{}); } }

  /* ---------- step 2: identity ---------- */
  function paintLogo(){ const d=g('drop'), inn=g('drop-in'); d.classList.toggle('has',!!S.logo); inn.innerHTML=S.logo?`<img src="${S.logo}" alt="">`:'<span>Upload<br>image</span>'; }
  function loadLogo(file){ if(!file||!file.type||!file.type.startsWith('image/')){ SP.toast('Please choose an image file','err'); return; } if(file.size>4*1024*1024){ SP.toast('Logo too big, max 4 MB','err'); return; }
    const img=new Image(), url=URL.createObjectURL(file);
    img.onload=()=>{ URL.revokeObjectURL(url); const s=Math.min(img.width,img.height); let best=null;
      outer: for(const size of [128,112,96,80,64]){ const c=document.createElement('canvas'); c.width=c.height=size; const x=c.getContext('2d'); x.drawImage(img,(img.width-s)/2,(img.height-s)/2,s,s,0,0,size,size);
        for(let q=0.8;q>=0.35;q-=0.15){ const dd=c.toDataURL('image/webp',q); if(!best||dd.length<best.length) best=dd; if(dd.length<=4200) break outer; } }
      if(!best||!best.startsWith('data:image/webp')){ SP.toast('Could not process this image','err'); return; }
      S.logo=best; paintLogo(); sync(); SP.toast('Logo ready, '+(best.length/1024).toFixed(1)+' KB on-chain'+(best.length>4200?' (large; the launch may cost more gas)':'')); };
    img.onerror=()=>{ URL.revokeObjectURL(url); SP.toast('Could not read this image','err'); };
    img.src=url; }
  function symMsg(){ const t=fields.sym(), el=g('sym-msg'); el.className='hint'; if(!t){ el.textContent=''; return true; }
    if(!/^[A-Z0-9]{2,10}$/.test(t)){ el.className='err'; el.textContent='Symbol: 2 to 10 characters, A-Z and 0-9 only'; return false; }
    if(taken().has(t)){ el.className='err'; el.textContent=t+' is already taken by another coin'; return false; }
    el.className='hint ok'; el.textContent=t+' available'; return true; }
  function nameMsg(){ const n=fields.name(), el=g('name-msg'); el.textContent=!n?'':n.length>32?'Name: 32 characters max':''; return !!n&&n.length<=32; }

  /* ---------- step 3: fee and options ---------- */
  function readFee(){ if(S.feeCustom){ const v=num('f-fee',1); S.feeBps=clamp(Math.round(v*10),1,30)*10; } }
  function feeMsg(){ const el=g('fee-msg'); if(S.feeCustom){ const v=num('f-fee',NaN); if(!(v>=0.1&&v<=3)){ el.textContent='Fee: 0.1% to 3% in steps of 0.1'; return false; } } el.textContent=''; return true; }
  function snipeMsg(){ const el=g('snipe-msg'); if(!S.snipe){ el.textContent=''; return true; } const p=fields.snipePct(), m=fields.snipeMin(); let e='';
    if(!(p>=5&&p<=30)) e='Starting fee: 5% to 30%'; else if(p*100<=S.feeBps) e='Starting fee must be above the base fee'; else if(!(m>=1&&m<=120)) e='Duration: 1 to 120 minutes';
    el.textContent=e; g('snipe-hint').textContent=e?'':`${p}% → ${feePct()} over ${m} min (${snipeBlocks()} blocks)`; return !e; }
  function divMsg(){ const el=g('div-msg'); if(!S.div){ el.textContent=''; return true; } const v=fields.divPct(); const ok=v>=10&&v<=50&&Math.round(v)===v; el.textContent=ok?'':'Share: a whole number from 10% to 50%'; if(ok){ const sp=split(); g('div-hint').textContent=`${sp.holders}% holders · ${sp.buyback?sp.buyback+'% buyback · ':''}${sp.creator}% you · ${sp.platform}% platform`; } return ok; }
  function bbMsg(){ const el=g('bb-msg'); if(!S.bb){ el.textContent=''; return true; } const v=fields.bbPct(), u=fields.bbUsd(); let e='';
    if(!(v>=10&&v<=50&&Math.round(v)===v)) e='Share: a whole number from 10% to 50%'; else if(S.div&&Math.round(fields.divPct())+v>80) e='Holders and buyback together: 80% max'; else if(!(u>=5&&u<=10000)) e='Burn every: $5 to $10,000';
    el.textContent=e; if(!e){ const sp=split(); g('bb-hint').textContent=`${sp.buyback}% of fees pile up, then buy and burn ${S.pair?'the coin':'it'} each time $${Math.round(u).toLocaleString('en-US')} is reached`; } else g('bb-hint').textContent=''; return !e; }
  function bbThreshold(){ const px=pairPx(); if(!(px>0)) return 0n; const units=BigInt(Math.max(1,Math.round(fields.bbUsd()/px*1e6))); return units*10n**12n; }
  function mwMsg(){ const el=g('mw-msg'); if(!S.mw){ el.textContent=''; return true; } const p=fields.mwPct(), h=fields.mwH(); let e='';
    if(!(p>=0.5&&p<=20)) e='Max per wallet: 0.5% to 20%'; else if(!(h>=0.25&&h<=720)) e='Duration: 0.25 to 720 hours';
    el.textContent=e; g('mw-hint').textContent=e?'':`No wallet can hold more than ${fmtAmt(SUPPLY*p/100)} coins (${p}%) for the first ${h>=24?(h/24).toFixed(h%24?1:0)+' days':h+' h'}`; return !e; }
  function devMsg(){ const el=g('dev-msg'); if(!S.dev){ el.textContent=''; return true; } const v=fields.devEth(); const ok=v>=0&&v<=DEV_MAX; el.textContent=ok?'':`Dev buy: 0 to ${DEV_MAX} ${NATIVE}`;
    if(ok){ const c=devCoins(); g('dev-hint').textContent=v>0?`≈ ${fmtAmt(c)} coins (${(c/SUPPLY*100).toFixed(2)}%) · ${fmtUsd(v*ethPx())}`:''; } return ok; }
  function paintReview(){ const sp=split(); const px=pairPx(); const inPair=S.pair?(px?fmtInPair(S.capUsd/px):'loading the '+S.pair.symbol+' price'):'';
    g('rv-split').textContent=`${feePct()} per swap: ${sp.holders?sp.holders+'% holders, ':''}${sp.buyback?sp.buyback+'% buyback, ':''}${sp.creator}% creator, ${sp.platform}% platform`;
    g('rv-bar').innerHTML=(sp.holders?`<i class="h" style="width:${sp.holders}%"></i>`:'')+(sp.buyback?`<i style="width:${sp.buyback}%;background:var(--dn)"></i>`:'')+`<i class="c" style="width:${sp.creator}%"></i><i class="p" style="width:${sp.platform}%"></i>`;
    g('rv-legend').innerHTML=(sp.holders?`<span><i style="background:var(--amber)"></i>Holders ${sp.holders}%</span>`:'')+(sp.buyback?`<span><i style="background:var(--dn)"></i>Buyback ${sp.buyback}%</span>`:'')+`<span><i style="background:var(--mint)"></i>Creator ${sp.creator}%</span><span><i style="background:var(--fg-3)"></i>Platform ${sp.platform}%</span>`+(S.pair?`<span>paid in ${esc(S.pair.symbol)}</span>`:'');
    g('rv-cap').textContent=fmtCap(S.capUsd)+(inPair?' · '+inPair:''); }

  /* ---------- starting market cap presets (the factory's) ---------- */
  const capLabel=v=>'$'+(v>=1000?(v/1000).toFixed(v%1000?1:0)+'K':Math.round(v));
  function paintCaps(){ const seg=g('cap-seg'); if(!seg||!S.presets.length) return;
    seg.innerHTML=S.presets.map((v,i)=>`<button type="button" data-cap="${i}" class="${i===S.preset?'on':''}">${capLabel(v)}</button>`).join('');
    $$('#cap-seg button').forEach(b=>b.onclick=()=>{ S.preset=+b.dataset.cap; S.capUsd=S.presets[S.preset]; paintCaps(); sync(); });
    const px=pairPx(); g('cap-hint').textContent=`The coin opens at ${fmtCap(S.capUsd)} market cap${S.pair&&px?' ('+fmtInPair(S.capUsd/px)+')':''}. A higher start means the first buys move the price less.`; }

  /* ---------- summary card ---------- */
  function sync(){ readFee(); const n=fields.name(), t=fields.sym(), sp=split(); const letter=(t||n||'?')[0].toUpperCase();
    g('sm-step').textContent=S.launched?'Launched':S.pair?'Ready':'Pick a pair';
    g('sm-logo').innerHTML=S.logo?`<img src="${S.logo}" alt="">`:esc((t||n||'TOK').slice(0,3).toUpperCase()); g('sm-name').textContent=n||'Token name'; g('sm-sym').textContent='$'+(t||'TOKEN');
    g('sm-pair').innerHTML=S.pair?`Paired with <img src="${S.pair.logo}" alt="" onerror="this.onerror=null;this.src='/img/t-default.png'">${esc(S.pair.symbol)}`:'Pick a pair';
    g('sm-fee').textContent=feePct()+(S.snipe?' · anti-snipe':''); const opts=optList(); g('sm-opts').textContent=opts.length?opts.join(', '):'None';
    const px=pairPx(); g('sm-cap').textContent=fmtCap(S.capUsd);
    const dv=S.dev?clamp(fields.devEth(),0,DEV_MAX):0; g('sm-dev').textContent=dv>0?`${dv} ${NATIVE}`:'None';
    g('sm-cr').textContent=`${sp.creator}%`; g('sm-note').textContent=(S.pair?`Fees paid in ${S.pair.symbol}. `:'')+'Liquidity cannot be withdrawn.';
    if(S.snipe) snipeMsg(); if(S.div) divMsg(); if(S.bb) bbMsg(); if(S.mw) mwMsg(); if(S.dev) devMsg(); paintReview(); if(S.presets.length){ const px=pairPx(); g('cap-hint').textContent=`The coin opens at ${fmtCap(S.capUsd)} market cap${S.pair&&px?' ('+fmtInPair(S.capUsd/px)+')':''}. A higher start means the first buys move the price less.`; } chainPreview(); }

  /* ---------- steps ---------- */
  function validate(n){ if(n===1){ const ok=!!S.pair&&!S.pairBad; g('pair-err').textContent=!S.pair?'Pick a pair to continue':S.pairBad; return ok; }
    if(n===2){ const a=nameMsg(), b=symMsg()&&!!fields.sym(); if(!fields.sym()){ const el=g('sym-msg'); el.className='err'; el.textContent='Symbol is required'; } if(!fields.name()) g('name-msg').textContent='Name is required'; return a&&b; }
    if(n===3){ const a=feeMsg(), b=snipeMsg(), c=divMsg(), d=devMsg(), e=bbMsg(), f=mwMsg(); return a&&b&&c&&d&&e&&f; } return true; }
  function show(n){ S.step=n; S.maxStep=Math.max(S.maxStep,n); $$('#pg-launch .pane').forEach(p=>p.classList.toggle('on',+p.dataset.pane===n));
    $$('#steps button').forEach(b=>{ const k=+b.dataset.step; b.classList.toggle('on',k===n); b.classList.toggle('done',k<n); b.querySelector('.n').innerHTML=k<n?ic('check'):String(k); });
    sync(); if(n===3) paintCta(); }
  function go(n){ n=clamp(n,1,3); if(S.launched) return; if(n<=S.step){ show(n); return; } for(let i=S.step;i<n;i++){ if(!validate(i)){ if(i!==S.step) show(i); SP.toast('Fix the highlighted fields first','err'); return; } } show(n); }


  /* ---------- chains: pick where the coin goes live and where to pay; only live chains launch today ---------- */
  let CC=null;
  const chainNames=keys=>{ const n=keys.map(k=>SP.chain(k).name); return n.length>3?n.length+' chains':n.length<2?n.join(''):n.slice(0,-1).join(', ')+' and '+n[n.length-1]; };
  const multiOnly=()=>S.chains.some(k=>!SP.chainDeployed(k));
  function costTotal(){ if(!CC) return null; const p=CC[S.pay]; if(!p||!p.nativeUsd) return null; const usd=S.chains.reduce((a,k)=>a+((CC[k]||{}).launchUsd||0),0); return {usd,native:usd/p.nativeUsd}; }
  function paintChains(){ const box=g('ctiles'); if(!box) return; if(SP.chains.length<2){ g('chainsel').classList.add('hidden'); return; }
    box.innerHTML=SP.chains.map(c=>{ const on=S.chains.includes(c.key), q=CC&&CC[c.key];
      return `<button type="button" class="ctile${on?' on':''}" data-ck="${c.key}" style="--cc:${c.color}" aria-pressed="${on}">
        <span class="th"><img src="${c.logo}" alt=""><span class="tk">${ic('check')}</span></span>
        <span class="nm"><b>${esc(c.name)}</b>${c.main?'<span class="mainb">Main</span>':''}</span>
        <span class="bd">${c.live?'<span class="liveb">Live</span>':'<span class="soonb">Soon</span>'}<span class="st">${esc(c.stocks||'')}</span></span>
        <span class="cc">${q&&q.launchUsd?'$'+q.launchUsd.toFixed(2):'…'}<i>gas</i></span></button>`; }).join('');
    $$('#ctiles [data-ck]').forEach(b=>b.onclick=()=>{ const k=b.dataset.ck; if(S.chains.includes(k)){ if(S.chains.length===1){ SP.toast('A coin needs at least one chain','info'); return; } S.chains=S.chains.filter(x=>x!==k); } else S.chains=SP.chains.map(c=>c.key).filter(x=>x===k||S.chains.includes(x)); if(!S.chains.includes(S.pay)) S.pay=S.chains[0]; paintChains(); paintPairs(); sync(); paintCta(); });
    g('pay-seg').innerHTML=S.chains.map(k=>{ const c=SP.chain(k); return `<button type="button" data-pk="${k}" class="${S.pay===k?'on':''}" title="Pay in ${esc(c.native)} on ${esc(c.name)}"><img src="${c.logo}" alt="">${esc(c.short)}</button>`; }).join('');
    $$('#pay-seg [data-pk]').forEach(b=>b.onclick=()=>{ S.pay=b.dataset.pk; paintChains(); sync(); });
    const n=S.chains.length, t=costTotal(), pc=SP.chain(S.pay);
    g('cs-sum').textContent=`${n} ${n===1?'chain':'chains'} · ${n}B supply · ${fmtCap(S.capUsd*n)} opening cap`;
    g('cs-cost').innerHTML=t?`${SP.fmtNative(t.native,pc.native)}<small>≈ $${t.usd.toFixed(2)}</small>`:'<small>estimating…</small>';
    const soon=S.chains.filter(k=>!SP.chainDeployed(k));
    g('cs-note').innerHTML=soon.length?`<b>${esc(chainNames(soon))} opens soon.</b>`:''; }
  function chainPreview(){ const n=S.chains.length, el=g('sm-chs'); if(!el) return;
    el.innerHTML=SP.chainStack(S.chains,20); g('sm-sup').textContent=n+'B'; g('sm-cap').textContent=fmtCap(S.capUsd*n);
    const t=costTotal(), pc=SP.chain(S.pay);
    g('sm-lfee').innerHTML=`<span class="lh">Launch fee · gas on ${esc(pc.name)}</span>`+S.chains.map(k=>{ const c=SP.chain(k), q=CC&&CC[k]; return `<div class="lr"><span><img src="${c.logo}" alt="">${esc(c.name)}${q&&q.gwei?` <span class="muted">${q.gwei<1?q.gwei.toFixed(2):q.gwei.toFixed(1)} gwei</span>`:''}</span><b>${q&&q.launchUsd?'$'+q.launchUsd.toFixed(2):'…'}</b></div>`; }).join('')+`<div class="lt"><span>Total</span><b>${t?SP.fmtNative(t.native,pc.native):'…'}</b></div>`; }
  SP.chainCosts().then(c=>{ CC=c; paintChains(); chainPreview(); }).catch(()=>{});

  /* ---------- launch ---------- */
  const cta=g('cta');
  function paintCta(){ if(S.busy){ cta.disabled=true; cta.textContent='Confirm in wallet…'; return; } if(multiOnly()){ cta.disabled=true; cta.textContent=`Launches open when Liqio goes live on ${chainNames(S.chains.filter(k=>!SP.chainDeployed(k)))}`; return; } cta.disabled=S.paused; cta.textContent=S.paused?'Launches paused':!SP.W.connected?'Connect a wallet':!SP.W.chainOk?'Switch to '+CHAIN_NAME:'Create token'; }
  function launchErr(e){ let m=SP.errMsg(e); if(/instincts|evolution|BadGenes/i.test(m)) m='The fee or options are out of bounds; adjust them and try again.'; return m; }
  async function doLaunch(){ if(S.busy||S.paused||multiOnly()) return;
    if(!SP.W.connected){ SP.W.connect(); return; }
    if(!SP.W.chainOk){ try{ await SP.W.switchChain(); }catch(e){ SP.toast(SP.errMsg(e),'err'); } return; }
    for(const i of [1,2,3]) if(!validate(i)){ show(i); SP.toast('Fix the highlighted fields first','err'); return; }
    if(!LIVE||!window.CHAIN){ SP.toast('Launches open when the contracts are live','info'); return; }
    const name=fields.name(), symbol=fields.sym(); const meta={description:fields.desc()}; if(S.logo) meta.image=S.logo; const w=link(g('f-web').value), x=link(g('f-x').value), tg=link(g('f-tg').value); if(w) meta.website=w; if(x) meta.x=x; if(tg) meta.telegram=tg;
    const devEth=S.dev?clamp(fields.devEth(),0,DEV_MAX):0; const devWei=devEth>0?CHAIN.parseEther(devEth.toFixed(18)):0n;
    const bbT=S.bb?bbThreshold():0n; if(S.bb&&bbT<1000n){ SP.toast('Waiting for the '+S.pair.symbol+' price to set the burn size. Try again in a moment.','err'); return; }
    const genes={ feeMode:0, feeBps:S.feeBps, snipeBps:S.snipe?clamp(Math.round(fields.snipePct()*100),S.feeBps+1,3000):0, snipeBlocks:S.snipe?snipeBlocks():0, buybackShareBps:S.bb?clamp(Math.round(fields.bbPct()),10,50)*100:0, buybackThreshold:bbT, divShareBps:S.div?clamp(Math.round(fields.divPct()),10,50)*100:0, maxWalletBps:S.mw?clamp(Math.round(fields.mwPct()*100),50,2000):0, maxWalletSecs:S.mw?clamp(Math.round(fields.mwH()*3600),600,2592000):0, evolution:{enabled:false} };
    S.busy=true; paintCta();
    try{ const {rc,token}=await CHAIN.launch({name,symbol,metadataURI:JSON.stringify(meta),pair:S.pair.address,minPairOut:0,capPreset:S.preset,genes},devWei);
      if(!token) throw new Error('Launched, but the coin address was not found in the receipt. Check your wallet activity.');
      S.launched={addr:String(token).toLowerCase(),block:rc&&rc.blockNumber?Number(rc.blockNumber):0,name,symbol}; showDone(); SP.toast(name+' is live on '+CHAIN_NAME);
      try{ await CHAIN.refresh(); if(typeof syncTok==='function') syncTok(); }catch{} }
    catch(e){ SP.toast(launchErr(e),'err'); }
    finally{ S.busy=false; paintCta(); } }
  function showDone(){ const L=S.launched; $$('#pg-launch .pane').forEach(p=>p.classList.remove('on')); $$('#steps button').forEach(b=>{ b.classList.add('done'); b.classList.remove('on'); b.querySelector('.n').innerHTML=ic('check'); b.disabled=true; });
    const dn=g('done'); dn.classList.remove('hidden'); $$('#pg-launch .pane').forEach(p=>p.classList.add('hidden')); g('dn-block').textContent=L.block?'Block #'+L.block.toLocaleString('en-US'):'Mined'; g('dn-logo').src=S.logo||DEF_LOGO; g('dn-name').textContent=L.name+' · '+L.symbol; g('dn-sub').textContent=`Paired with ${S.pair.symbol} · live on Uniswap v4`;
    g('dn-addr').textContent=cs(L.addr); g('dn-copy').innerHTML=ic('copy'); g('dn-copy').onclick=()=>SP.copy(cs(L.addr),'Address copied');
    g('dn-pair').innerHTML=`<img src="${S.pair.logo}" alt="" style="width:14px;height:14px;border-radius:50%;background:#fff;display:inline-block;vertical-align:-2px;margin-right:6px" onerror="this.onerror=null;this.src='/img/t-default.png'">${esc(S.pair.symbol)}`; const sp=split(); g('dn-fee').textContent=`${feePct()} · ${sp.creator}% to you`;
    g('dn-open').href=tokenUrl(L.addr); g('dn-scan').href=EXPLORER+'/token/'+L.addr;
    const url=SITE+tokenUrl(L.addr); g('dn-x').href='https://x.com/intent/tweet?text='+encodeURIComponent(`$${L.symbol} is live on Liqio, paired with ${S.pair.symbol}. Fees settle in ${S.pair.symbol}, liquidity cannot be withdrawn. ${url}`);
    sync(); scrollTo({top:0,behavior:'smooth'}); }

  /* ---------- wiring ---------- */
  preselect(); paintChains(); paintKind(); paintPairs(); paintLogo();
  $$('#pair-kind button').forEach(b=>b.onclick=e=>{ e.stopPropagation(); S.kind=b.dataset.k; g('pair-q').value=''; paintKind(); paintPairs(); if(!S.pair||kindOf(S.pair)!==S.kind){ if(S.kind==='crypto') setPair(ETH_PAIR); else { g('pair-dd').classList.add('open'); setTimeout(()=>g('pair-q').focus(),0); } } });
  g('pair-btn').onclick=e=>{ e.stopPropagation(); const open=g('pair-dd').classList.toggle('open'); if(open) setTimeout(()=>g('pair-q').focus(),0); }; g('pair-q').addEventListener('input',paintPairs); g('pair-q').addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); const b=$('#pairs-list [data-p]'); if(b) b.click(); } }); document.addEventListener('click',e=>{ if(!e.target.closest('#pair-dd')) g('pair-dd').classList.remove('open'); });
  $$('#steps button').forEach(b=>b.onclick=()=>go(+b.dataset.step));
  $$('#pg-launch [data-next]').forEach(b=>b.onclick=()=>go(S.step+1)); $$('#pg-launch [data-back]').forEach(b=>b.onclick=()=>go(S.step-1));
  g('f-logo').addEventListener('change',e=>{ loadLogo(e.target.files[0]); e.target.value=''; });
  const dz=g('drop'); ['dragenter','dragover'].forEach(ev=>dz.addEventListener(ev,e=>{ e.preventDefault(); dz.classList.add('over'); })); ['dragleave','drop'].forEach(ev=>dz.addEventListener(ev,e=>{ e.preventDefault(); dz.classList.remove('over'); })); dz.addEventListener('drop',e=>loadLogo(e.dataTransfer.files[0]));
  g('f-name').addEventListener('input',()=>{ nameMsg(); sync(); });
  g('f-sym').addEventListener('input',e=>{ const p=e.target.selectionStart; e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,''); try{ e.target.setSelectionRange(p,p); }catch{} symMsg(); sync(); });
  g('f-desc').addEventListener('input',e=>{ g('desc-cnt').textContent=e.target.value.length+' / 280'; });
  $$('#fee-seg button').forEach(b=>b.onclick=()=>{ $$('#fee-seg button').forEach(x=>x.classList.toggle('on',x===b)); S.feeCustom=b.dataset.fee==='custom'; g('fee-custom').classList.toggle('hidden',!S.feeCustom); if(!S.feeCustom) S.feeBps=+b.dataset.fee; else g('f-fee').value=(S.feeBps/100).toString(); feeMsg(); sync(); });
  g('f-fee').addEventListener('input',()=>{ feeMsg(); sync(); });
  $$('#pg-launch [data-sw]').forEach(h=>h.addEventListener('click',e=>{ if(e.target.closest('input')) return; const k=h.dataset.sw, on=!S[k]; if(k==='dev'&&on&&S.pair&&!S.pair.route){ SP.toast(`${S.pair.ticker} has no ${NATIVE} route, so the dev buy is off. Buy after launch with ${S.pair.symbol}.`,'info'); return; } S[k]=on; const sw=g('sw-'+k); sw.classList.toggle('on',on); sw.setAttribute('aria-checked',String(on)); g('opt-'+k).classList.toggle('on',on); if(on){ const f=g('opt-'+k).querySelector('input'); if(f) setTimeout(()=>f.focus(),0); } sync(); }));
  ['f-snipe','f-snipemin','f-div','f-dev','f-bb','f-bbusd','f-mw','f-mwh'].forEach(id=>g(id).addEventListener('input',sync));
  cta.onclick=doLaunch; SP.onWallet(paintCta);
  launchRepaint=()=>{ paintPairs(); if(fields.sym()) symMsg(); sync(); paintCta(); }; SP.onUpdate(launchRepaint);
  sync(); paintCta();
  if(LIVE&&window.CHAIN){ (CHAIN.equo?CHAIN.equo.capPresets():CHAIN.startCapUsd().then(v=>[v])).then(v=>{ v=(v||[]).filter(x=>x>0); if(v.length){ S.presets=v; if(S.preset>=v.length) S.preset=0; S.capUsd=v[S.preset]; paintCaps(); sync(); } }).catch(()=>{});
    CHAIN.launchesPaused().then(p=>{ S.paused=!!p; const el=g('paused'); el.classList.toggle('hidden',!p); if(p) el.innerHTML=ic('warn')+'<span>Launches are paused by the operator right now. You can prepare the coin; the Launch button opens again when launches resume.</span>'; paintCta(); }).catch(()=>{});
    if(S.pair) SP.pairUsd(S.pair.address).then(()=>{ paintPairs(); sync(); }).catch(()=>{}); }
}
window.SP_PAGE=function(){ if(!launchRepaint) launchInit(); else launchRepaint(); };
document.addEventListener('DOMContentLoaded',launchInit);
