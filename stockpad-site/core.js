/* StockPad core: shell (rail, top bar, ticker), wallet state, chain boot, shared UI helpers. See DESIGN.md. */
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const ICONS={
  search:'<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>', plus:'<path d="M5 12h14"/><path d="M12 5v14"/>', x:'<path d="M18 6 6 18"/><path d="m6 6 12 12"/>', check:'<path d="M20 6 9 17l-5-5"/>',
  wallet:'<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  copy:'<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>', ext:'<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  chevr:'<path d="m9 18 6-6-6-6"/>', up:'<path d="m18 15-6-6-6 6"/>', down:'<path d="m6 9 6 6 6-6"/>', back:'<path d="m15 18-6-6 6-6"/>', arrow:'<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  globe:'<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>', user:'<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  logout:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>', shield:'<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  book:'<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>', rocket:'<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
  candle:'<path d="M9 5v4"/><rect width="4" height="6" x="7" y="9" rx="1"/><path d="M9 15v2"/><path d="M17 3v2"/><rect width="4" height="8" x="15" y="5" rx="1"/><path d="M17 13v3"/><path d="M3 3v16a2 2 0 0 0 2 2h16"/>', trend:'<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="m19 9-5 5-4-4-3 3"/>',
  swap:'<path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/>', lock:'<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>', info:'<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  clock:'<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>', filter:'<path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/>', grid:'<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>', list:'<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
  menu:'<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>', warn:'<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>', coins:'<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><path d="m16.71 13.88.7.71-2.82 2.82"/>',
};
const ic=(n,cls='ic')=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${cls}" aria-hidden="true">${ICONS[n]||''}</svg>`;
const DEF_LOGO='/img/t-default.png';
const WETH=((window.INKY&&INKY.weth)||'0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2').toLowerCase();
const EXPLORER=(window.INKY&&INKY.explorer)||'https://etherscan.io';
const SITE=(window.INKY&&INKY.site)||location.origin;

const SP={
  stocks:(window.INKY&&INKY.stocks)||[], prices:{}, W:{connected:false,address:null,short:'',chainOk:true},
  _upd:[], _wal:[], _readyP:null,
  stockBySym(s){ return SP.stocks.find(x=>x.symbol===s)||null; },
  stockByAddr(a){ a=String(a||'').toLowerCase(); return SP.stocks.find(x=>x.address.toLowerCase()===a)||null; },
  tokens(){ return TOK; }, token(a){ a=String(a||'').toLowerCase(); return TOK.find(x=>x.addr===a)||(window.CHAIN&&CHAIN.token(a))||null; },
  coinLogo(x){ return (x&&x.img)||DEF_LOGO; }, stockLogo(sym){ return pairImg(sym); },
  avatar(a,s){ return window.walletAvatar?walletAvatar(a,s):''; },
  usd:v=>fmtUsd(v), fmtPct:v=>`<span class="num ${v>=0?'up':'dn'}">${v>=0?'+':''}${(v||0).toFixed(1)}%</span>`,
  fmtPair:(v,x)=>(x&&x.pair!=='ETH')?fmtAmt(v)+' '+x.pair:fmtEth(v),
  fmtDate:ts=>new Date(ts*1000).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}),
  go(u){ location.href=u; },
  errMsg(e){ const m=String(e&&(e.shortMessage||e.reason||e.message)||e); if(/user rejected|denied|rejected the request|cancel/i.test(m)) return 'Transaction cancelled'; if(/insufficient funds/i.test(m)) return 'Not enough ETH in the wallet'; if(/coalesce|missing revert data/i.test(m)) return 'The transaction would fail; try a smaller amount or more slippage'; return m.length>160?m.slice(0,160)+'…':m; },
  async copy(t,msg){ try{ await navigator.clipboard.writeText(t); SP.toast(msg||'Copied'); }catch{ SP.toast('Copy failed','err'); } },
  isAdmin(){ const a=(window.INKY&&INKY.admin||'').toLowerCase(); return !!(SP.W.connected&&a&&SP.W.address===a); },
  async pairUsd(a){ a=String(a||WETH).toLowerCase(); if(!window.CHAIN) return SP.prices[a]||0; try{ const v=await CHAIN.pairUsd(a); if(v) SP.prices[a]=v; return v||SP.prices[a]||0; }catch{ return SP.prices[a]||0; } },
  async ethUsd(){ return SP.pairUsd(WETH); },
  market(){ const p=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short',hour:'numeric',minute:'numeric',hour12:false}).formatToParts(new Date()); const g=t=>(p.find(x=>x.type===t)||{}).value; const wd=g('weekday'), h=+g('hour')%24, m=+g('minute'); const mins=h*60+m; const weekday=!['Sat','Sun'].includes(wd); const open=weekday&&mins>=570&&mins<960;
    let detail; if(open) detail='Closes 4:00 PM ET'; else if(weekday&&mins<570) detail='Opens 9:30 AM ET'; else if(wd==='Fri'||wd==='Sat'||wd==='Sun') detail='Opens Mon 9:30 AM ET'; else detail='Opens 9:30 AM ET tomorrow';
    return {open,label:open?'Market open':'Market closed',detail}; },
  // toasts, dialogs, menus
  toast(msg,kind='ok'){ let w=$('.toasts'); if(!w){ w=document.createElement('div'); w.className='toasts'; document.body.appendChild(w); } const t=document.createElement('div'); t.className='toast '+kind; t.innerHTML=ic(kind==='err'?'x':kind==='info'?'info':'check')+'<span>'+esc(msg)+'</span>'; w.appendChild(t); setTimeout(()=>t.remove(),4200); },
  closeDialogs(){ $$('.ov,.menu').forEach(e=>e.remove()); },
  dialog(title,body){ SP.closeDialogs(); const ov=document.createElement('div'); ov.className='ov'; ov.innerHTML=`<div class="dlg" role="dialog"><div class="dh"><span>${esc(title)}</span><button class="btn ghost sm" data-close>${ic('x')}</button></div><div class="db">${body}</div></div>`; ov.addEventListener('click',e=>{ if(e.target===ov||e.target.closest('[data-close]')) ov.remove(); }); document.body.appendChild(ov); return ov; },
  menu(anchor,html){ SP.closeDialogs(); const m=document.createElement('div'); m.className='menu'; m.innerHTML=html; document.body.appendChild(m); const r=anchor.getBoundingClientRect(); m.style.top=(r.bottom+scrollY+6)+'px'; m.style.left=Math.max(8,Math.min(r.right+scrollX-m.offsetWidth,innerWidth-m.offsetWidth-8))+'px'; setTimeout(()=>document.addEventListener('click',function h(e){ if(!m.contains(e.target)){ m.remove(); document.removeEventListener('click',h); } }),0); return m; },
  onUpdate(fn){ SP._upd.push(fn); }, onWallet(fn){ SP._wal.push(fn); },
  ready(){ return SP._readyP; },
};

/* ---------- wallet ---------- */
function syncWallet(){ const d=window.inkyWallet; const W=SP.W; const was=W.connected+':'+W.address+':'+W.chainOk;
  W.connected=!!(d&&d.connected&&d.address); W.address=W.connected?String(d.address).toLowerCase():null; W.short=W.address?shortAddr(cs(W.address)):''; W.chainOk=!d||!d.chainId||Number(d.chainId)===Number((window.INKY&&INKY.chainId)||1);
  if(was!==W.connected+':'+W.address+':'+W.chainOk){ renderWalletBtn(); SP._wal.forEach(f=>{ try{ f(W); }catch(e){ console.warn(e); } }); document.dispatchEvent(new Event('wallet-change')); } }
SP.W.connect=()=>{ const d=window.inkyWallet; if(d&&d.open) d.open(); else SP.toast('Wallet is still loading, try again in a second','info'); };
SP.W.disconnect=()=>{ const d=window.inkyWallet; if(d&&d.logout) d.logout(); };
SP.W.switchChain=async()=>{ const d=window.inkyWallet; if(d&&d.switchChain) await d.switchChain(Number((window.INKY&&INKY.chainId)||1)); };
addEventListener('inky:wallet',syncWallet); document.addEventListener('wallet-change',()=>{ /* re-entrancy guard: syncWallet only dispatches on change */ });

/* ---------- shell ---------- */
const NAV=[['markets','/','Markets','candle'],['launch','/launch','Launch','rocket'],['portfolio','/profile','Portfolio','user'],['docs','/docs','Docs','book']];
function renderWalletBtn(){ const el=$('#sp-wallet'); if(!el) return; const W=SP.W;
  if(!W.connected){ el.innerHTML=`<button class="btn pri" id="wconnect">${ic('wallet')}<span>Connect</span></button>`; $('#wconnect',el).onclick=SP.W.connect; return; }
  el.innerHTML=`<button class="wbtn" id="wmenu"><span class="av">${SP.avatar(W.address,22)}</span>${esc(W.short)}${!W.chainOk?'<span class="tag red">Wrong network</span>':''}</button>`;
  $('#wmenu',el).onclick=e=>{ const m=SP.menu(e.currentTarget,`<button data-a="copy">${ic('copy')}Copy address</button><button data-a="pf">${ic('user')}Portfolio</button>${SP.isAdmin()?`<button data-a="adm">${ic('shield')}Operator</button>`:''}<button data-a="ex">${ic('globe')}View on Etherscan</button>${!W.chainOk?`<button data-a="sw">${ic('swap')}Switch to Ethereum</button>`:''}<div class="d"></div><button data-a="out">${ic('logout')}Disconnect</button>`);
    $$('[data-a]',m).forEach(b=>b.onclick=()=>{ const a=b.dataset.a; m.remove(); if(a==='copy') SP.copy(cs(W.address),'Address copied'); if(a==='pf') SP.go('/profile'); if(a==='adm') SP.go('/admin'); if(a==='ex') open(EXPLORER+'/address/'+W.address,'_blank'); if(a==='sw') SP.W.switchChain().catch(err=>SP.toast(SP.errMsg(err),'err')); if(a==='out') SP.W.disconnect(); }); }; }
function renderShell(){ const page=document.body.dataset.page||'markets';
  const side=$('#sp-side'); if(side) side.innerHTML=`<a class="brand" href="/"><img src="/img/logo.svg?v=9" alt=""><b>Stock<span>Pad</span></b></a>
    <nav class="nav">${NAV.map(n=>`<a href="${n[1]}" class="${page===n[0]?'on':''}">${ic(n[3])}${n[2]}</a>`).join('')}</nav>
    <div class="side-h">Stocks</div><div class="stocklist" id="sp-stocks">${SP.stocks.map(s=>`<a href="/?stock=${s.symbol}" data-s="${s.symbol}"><img src="${s.logo}" alt="" onerror="this.onerror=null;this.src='/img/eth.png'"><span><b>${esc(s.ticker||s.symbol)}</b><small>${esc(s.name)}</small></span><span class="px" data-px="${s.address.toLowerCase()}">…</span></a>`).join('')}</div>
    <div class="side-foot"><span>Ethereum · Uniswap v4</span><a href="/docs/production-contracts" class="dim">Contracts</a></div>`;
  const top=$('#sp-top'); if(top){ const mk=SP.market(); top.innerHTML=`<button class="btn ghost sm ham" id="sp-ham" aria-label="Menu">${ic('menu')}</button><a class="brand ham" href="/" style="border:0;padding:0;height:auto"><img src="/img/logo.svg?v=9" alt="" style="width:24px;height:24px"></a>
    <label class="search">${ic('search')}<input id="sp-q" placeholder="Search coins, stocks, addresses" autocomplete="off"><kbd>/</kbd></label>
    <div class="topr"><span class="mkt ${mk.open?'open':''}" title="${esc(mk.detail)}"><i></i><span>${mk.label}</span></span><a class="btn" href="/launch">${ic('plus')}<span>Launch</span></a><span id="sp-wallet"></span></div>`;
    $('#sp-ham').onclick=()=>$('#sp-side').classList.toggle('open'); document.addEventListener('click',e=>{ const s=$('#sp-side'); if(s&&s.classList.contains('open')&&!s.contains(e.target)&&!e.target.closest('#sp-ham')) s.classList.remove('open'); });
    const q=$('#sp-q'); q.addEventListener('input',()=>searchMenu(q)); q.addEventListener('focus',()=>searchMenu(q)); addEventListener('keydown',e=>{ if(e.key==='/'&&!['INPUT','TEXTAREA'].includes(document.activeElement.tagName)){ e.preventDefault(); q.focus(); } }); }
  renderWalletBtn(); renderTicker(); }
function searchMenu(q){ const v=q.value.trim().toLowerCase(); $$('.menu.srch').forEach(m=>m.remove()); if(!v) return;
  const hits=TOK.filter(x=>x.n.toLowerCase().includes(v)||x.t.toLowerCase().includes(v)||x.addr.includes(v)||(x.pair||'').toLowerCase().includes(v)).slice(0,8);
  const st=SP.stocks.filter(s=>s.symbol.toLowerCase().includes(v)||s.name.toLowerCase().includes(v)||(s.ticker||'').toLowerCase().includes(v)).slice(0,3);
  const m=document.createElement('div'); m.className='menu srch'; m.innerHTML=(hits.map(x=>`<button data-go="${tokenUrl(x)}"><img src="${SP.coinLogo(x)}" style="width:22px;height:22px;border-radius:6px"><span><b>${esc(x.t)}</b> <span class="muted">${esc(x.n)}</span></span><span class="num" style="margin-left:auto">${fmtUsd(x.mc)}</span></button>`).join('')+st.map(s=>`<button data-go="/?stock=${s.symbol}"><img src="${s.logo}" style="width:22px;height:22px;border-radius:50%;background:#fff"><span><b>${esc(s.ticker)}</b> <span class="muted">${esc(s.name)}</span></span></button>`).join(''))||'<div class="empty" style="padding:14px">No matches</div>';
  document.body.appendChild(m); const r=q.closest('.search').getBoundingClientRect(); m.style.top=(r.bottom+scrollY+6)+'px'; m.style.left=(r.left+scrollX)+'px'; m.style.minWidth=r.width+'px'; $$('[data-go]',m).forEach(b=>b.onclick=()=>SP.go(b.dataset.go));
  setTimeout(()=>document.addEventListener('click',function h(e){ if(!m.contains(e.target)&&e.target!==q){ m.remove(); document.removeEventListener('click',h); } }),0); }
function renderTicker(){ const t=$('#sp-ticker'); if(!t) return; const items=[{sym:'ETH',name:'Ether',addr:WETH,logo:'/img/eth.png'},...SP.stocks.map(s=>({sym:s.ticker||s.symbol,name:s.name,addr:s.address.toLowerCase(),logo:s.logo}))];
  const one=items.map(i=>`<span class="tk"><img src="${i.logo}" alt="" onerror="this.onerror=null;this.src='/img/eth.png'"><b>${esc(i.sym)}</b><span class="num" data-px="${i.addr}">${SP.prices[i.addr]?'$'+fmtPrice(SP.prices[i.addr]):'…'}</span></span>`).join('');
  t.innerHTML=`<div class="ticker-track">${one}${one}</div>`; }
function paintPrices(){ $$('[data-px]').forEach(el=>{ const v=SP.prices[el.dataset.px]; if(v) el.textContent='$'+(v>=100?v.toFixed(0):v>=1?v.toFixed(2):fmtPrice(v)); });
  const counts={}; TOK.forEach(x=>{ counts[x.pair]=(counts[x.pair]||0)+1; }); $$('#sp-stocks a').forEach(a=>{ const n=counts[a.dataset.s]||0; let c=a.querySelector('.cnt'); if(n){ if(!c){ c=document.createElement('small'); c.className='cnt'; a.querySelector('.px').appendChild(c); } c.textContent=n+(n===1?' coin':' coins'); } }); }
async function loadPrices(){ const addrs=[WETH,...SP.stocks.map(s=>s.address.toLowerCase())]; await Promise.all(addrs.map(a=>SP.pairUsd(a).catch(()=>0))); if(SP.prices[WETH]) ETH=SP.prices[WETH]; paintPrices(); }

/* ---------- boot ---------- */
function syncTok(){ if(!window.CHAIN) return; TOK=CHAIN.tokens().filter(x=>!x.hidden); }
SP._readyP=new Promise(resolve=>{ document.addEventListener('DOMContentLoaded',async()=>{ renderShell(); syncWallet();
  const main=$('#sp-main');
  if(!LIVE||!window.CHAIN){ TOK=[]; resolve(false); return; }
  loadPrices();
  try{ const ok=await Promise.race([CHAIN.ready,new Promise(r=>setTimeout(()=>r(null),40000))]); if(!ok) throw new Error('timeout'); syncTok(); }
  catch(e){ console.warn('chain load',e); if(main) main.insertAdjacentHTML('afterbegin',`<div class="notice warn" style="margin-bottom:16px">${ic('warn')}<span>Could not load on-chain data (${esc(SP.errMsg(e))}). Prices and coins may be stale; reload to retry.</span></div>`); }
  paintPrices(); resolve(true);
  addEventListener('chain-update',()=>{ syncTok(); paintPrices(); SP._upd.forEach(f=>{ try{ f(); }catch(err){ console.warn(err); } }); });
  setInterval(()=>{ const mk=SP.market(); const el=$('.mkt'); if(el){ el.classList.toggle('open',mk.open); el.title=mk.detail; const s=el.querySelector('span'); if(s) s.textContent=mk.label; } },60000);
}); });
SP.ready().then(()=>{ if(typeof window.SP_PAGE==='function') { try{ window.SP_PAGE(); }catch(e){ console.error('page init',e); SP.toast('Page failed to initialise: '+SP.errMsg(e),'err'); } } });
