/* Equo core: shell (rail, top bar, ticker), wallet state, chain boot, shared UI helpers. See DESIGN.md. */
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
  xlogo:'<path d="M4 4l16 16"/><path d="M20 4 4 20"/>', home:'<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>', star:'<path d="M11.5 2.5l2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L2.8 8.8l6.1-.7z"/>', menu:'<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>', warn:'<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>', chat:'<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>', gift:'<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5"/>', flame:'<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>', share:'<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="m16 6-4-4-4 4"/><path d="M12 2v13"/>', dl:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>', link:'<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>', bull:'<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>', bear:'<path d="m22 17-8.5-8.5-5 5L2 7"/><path d="M16 17h6v-6"/>',
  drop:'<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>', users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>', more:'<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  coins:'<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><path d="m16.71 13.88.7.71-2.82 2.82"/>',
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
  market(){ const p=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short',hour:'numeric',minute:'numeric',hour12:false}).formatToParts(new Date()); const g=t=>(p.find(x=>x.type===t)||{}).value; const wd=g('weekday'), h=+g('hour')%24, m=+g('minute'); const mins=h*60+m; const days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat']; const di=days.indexOf(wd); const weekday=di>=1&&di<=5; const open=weekday&&mins>=570&&mins<960;
    let detail, untilMin; if(open){ detail='Closes 4:00 PM ET'; untilMin=960-mins; } else if(weekday&&mins<570){ detail='Opens 9:30 AM ET'; untilMin=570-mins; } else { let d=1; let nd=(di+1)%7; while(nd===0||nd===6){ d++; nd=(nd+1)%7; } detail=d===1?'Opens 9:30 AM ET tomorrow':'Opens Mon 9:30 AM ET'; untilMin=(1440-mins)+(d-1)*1440+570; }
    const H=Math.floor(untilMin/60), M=untilMin%60; const until=H>=24?Math.round(H/24)+'d':H?H+'h '+String(M).padStart(2,'0')+'m':M+'m';
    return {open,label:open?'Market open':'Market closed',detail,until}; },
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
const NAV=[['markets','/','Home'],['calls','/calls','Calls'],['analytics','/analytics','Analytics'],['launch','/launch','Launch'],['rewards','/rewards','Rewards'],['portfolio','/profile','Profile']];
/* More menu (desktop) and Tools in the mobile menu: [key, href, label, icon, soon] */
const TOOLS=[['pools','/pools','Pools','drop'],['burns','/rewards#burns','Burns','flame'],['watch','/?watch=1','Watchlist','star'],['cto','','Takeover','users',1]];
const MORE_LINKS=[['docs','/docs','Docs','book'],['how','/docs/how-it-works','How it works','info']];
const TABS=['markets','calls','launch','rewards','analytics'];
function renderWalletBtn(){ const el=$('#sp-wallet'); if(!el) return; const W=SP.W;
  if(!W.connected){ el.innerHTML=`<button class="btn pri" id="wconnect">Connect wallet</button>`; $('#wconnect',el).onclick=SP.W.connect; return; }
  el.innerHTML=`<button class="wbtn" id="wmenu"><span class="av">${SP.avatar(W.address,22)}</span>${esc(W.short)}${!W.chainOk?'<span class="tag red">Wrong network</span>':''}</button>`;
  $('#wmenu',el).onclick=e=>{ const m=SP.menu(e.currentTarget,`<button data-a="copy">${ic('copy')}Copy address</button><button data-a="pf">${ic('user')}Profile</button><button data-a="rw">${ic('gift')}Rewards</button>${SP.isAdmin()?`<button data-a="adm">${ic('shield')}Operator</button>`:''}<button data-a="ex">${ic('globe')}View on Etherscan</button>${!W.chainOk?`<button data-a="sw">${ic('swap')}Switch to Ethereum</button>`:''}<div class="d"></div><button data-a="out">${ic('logout')}Disconnect</button>`);
    $$('[data-a]',m).forEach(b=>b.onclick=()=>{ const a=b.dataset.a; m.remove(); if(a==='copy') SP.copy(cs(W.address),'Address copied'); if(a==='pf') SP.go('/profile'); if(a==='rw') SP.go('/rewards'); if(a==='adm') SP.go('/admin'); if(a==='ex') open(EXPLORER+'/address/'+W.address,'_blank'); if(a==='sw') SP.W.switchChain().catch(err=>SP.toast(SP.errMsg(err),'err')); if(a==='out') SP.W.disconnect(); }); }; }
const NAV_IC={markets:'home',calls:'chat',launch:'rocket',analytics:'trend',rewards:'gift',portfolio:'user',docs:'book'};
const stockPx=v=>v?'$'+(v>=100?v.toFixed(0):v>=1?v.toFixed(2):fmtPrice(v)):'';
const navHtml=page=>{ const L=NAV.filter(n=>n[0]!=='launch'); const half=Math.ceil(L.length/2); const a=x=>`<a href="${x[1]}" class="${page===x[0]?'on':''}">${x[2]}</a>`; const moreOn=TOOLS.concat(MORE_LINKS).some(t=>t[0]===page)||page==='docs'; return L.slice(0,half).map(a).join('')+`<a href="/launch" class="btn pri lnch ${page==='launch'?'on':''}">${ic('rocket')}Launch a coin</a>`+L.slice(half).map(a).join('')+`<button type="button" class="morebtn ${moreOn?'on':''}" id="sp-more" aria-haspopup="true">More${ic('down')}</button>`; };
const toolRow=t=>t[4]?`<span class="mi soon-i">${ic(t[3])}<span>${t[2]}</span><span class="soon">Soon</span></span>`:`<a class="mi" href="${t[1]}">${ic(t[3])}<span>${t[2]}</span></a>`;
function openMore(btn){ const m=SP.menu(btn,`<div class="mh">Tools</div>${TOOLS.map(toolRow).join('')}<div class="d"></div>${MORE_LINKS.map(toolRow).join('')}`); m.classList.add('more'); }
function openSheet(){ SP.closeDialogs(); const page=document.body.dataset.page||'markets'; const ov=document.createElement('div'); ov.className='ov sheet-ov';
  ov.innerHTML=`<div class="sheet" role="dialog" aria-label="Menu"><div class="sh-top"><a class="brand" href="/"><img src="/img/logo.svg?v=14" alt=""><span class="wm">Equo</span></a><button class="btn ghost sm ic" data-close aria-label="Close menu">${ic('x')}</button></div>
    <div class="sh-acts"><a class="btn pri" href="/launch">${ic('rocket')}Launch a coin</a><span id="sh-wallet"></span></div>
    <nav class="sh-nav">${NAV.filter(n=>n[0]!=='launch').map(n=>`<a href="${n[1]}" class="${page===n[0]?'on':''}">${ic(NAV_IC[n[0]])}${n[2]}</a>`).join('')}</nav>
    <div class="mh">Tools</div><nav class="sh-nav">${TOOLS.map(toolRow).join('')}</nav>
    <div class="mh">Learn</div><nav class="sh-nav">${MORE_LINKS.map(toolRow).join('')}</nav>
    <div class="sh-foot">${clockHtml().replace('id="sp-clock"','')}<span>Ethereum</span></div></div>`;
  ov.addEventListener('click',e=>{ if(e.target===ov||e.target.closest('[data-close]')) ov.remove(); }); document.body.appendChild(ov);
  const w=$('#sh-wallet',ov); if(SP.W.connected){ w.innerHTML=`<a class="btn" href="/profile"><span class="av" style="width:18px;height:18px;border-radius:5px;overflow:hidden;display:inline-block">${SP.avatar(SP.W.address,18)}</span>${esc(SP.W.short)}</a>`; } else { w.innerHTML=`<button class="btn">${ic('wallet')}Connect</button>`; w.firstChild.onclick=()=>{ ov.remove(); SP.W.connect(); }; } }
function clockHtml(){ const mk=SP.market(); return `<span class="mkt ${mk.open?'open':''}" id="sp-clock" title="${esc(mk.detail)}"><i></i><span>${mk.open?'NYSE open':'NYSE closed'}<b>${esc(mk.until)}</b></span></span>`; }
function renderShell(){ const page=document.body.dataset.page||'markets'; const C=(window.INKY&&INKY.contracts)||{};
  const top=$('#sp-top'); if(top){ top.innerHTML=`<div class="wrap"><a class="brand" href="/"><img src="/img/logo.svg?v=14" alt=""><span class="wm">Equo</span></a><nav class="nav">${navHtml(page)}</nav>
    <label class="search">${ic('search')}<input id="sp-q" placeholder="Search name, ticker or address" autocomplete="off"><kbd>/</kbd></label>
    <div class="topr">${clockHtml()}<span class="vsep"></span><span id="sp-wallet"></span><button type="button" class="burger" id="sp-burger" aria-label="Open menu">${ic('menu')}</button></div></div>`;
    $('#sp-more').onclick=e=>{ e.stopPropagation(); openMore(e.currentTarget); }; $('#sp-burger').onclick=openSheet;
    const q=$('#sp-q'); q.addEventListener('input',()=>searchMenu(q)); q.addEventListener('focus',()=>searchMenu(q)); addEventListener('keydown',e=>{ if(e.key==='/'&&!['INPUT','TEXTAREA'].includes(document.activeElement.tagName)){ e.preventDefault(); q.focus(); } }); }
  let tb=$('#sp-tabbar'); if(!tb){ tb=document.createElement('nav'); tb.id='sp-tabbar'; tb.className='tabbar'; document.body.appendChild(tb); }
  tb.innerHTML=TABS.map(k=>NAV.find(n=>n[0]===k)).map(n=>`<a href="${n[1]}" class="${page===n[0]?'on':''} ${n[0]==='launch'?'lnch':''}">${n[0]==='launch'?`<span class="lb">${ic('rocket')}</span>`:ic(NAV_IC[n[0]])}${n[2]}</a>`).join('');
  const ft=$('#sp-foot'); if(ft) ft.innerHTML=`<div class="wrap"><a class="brand" href="/"><img src="/img/logo.svg?v=14" alt=""><span class="wm">Equo</span></a><span>Ethereum</span>${C.factory?`<a href="${EXPLORER}/address/${C.factory}" target="_blank" rel="noopener" title="Factory">factory ${shortAddr(C.factory)}</a>`:''}${C.hook?`<a href="${EXPLORER}/address/${C.hook}" target="_blank" rel="noopener" title="Hook">hook ${shortAddr(C.hook)}</a>`:''}<span class="sp"></span><div class="fl"><a href="/docs/introduction">Docs</a><a href="/docs/fees">Fees</a><a href="/docs/security">Security</a><a href="https://x.com/equofun" target="_blank" rel="noopener">${ic('xlogo')} @equofun</a><span class="num" id="sp-ethpx"><img src="/img/eth.png" alt="" style="width:14px;height:14px;border-radius:50%;display:inline-block;vertical-align:-2px;margin-right:6px">${SP.prices[WETH]?stockPx(SP.prices[WETH]):''}</span></div></div>`;
  renderWalletBtn(); }
function searchMenu(q){ const v=q.value.trim().toLowerCase(); $$('.menu.srch').forEach(m=>m.remove()); if(!v) return;
  const hits=TOK.filter(x=>x.n.toLowerCase().includes(v)||x.t.toLowerCase().includes(v)||x.addr.includes(v)||(x.pair||'').toLowerCase().includes(v)).slice(0,8);
  const st=SP.stocks.filter(s=>s.symbol.toLowerCase().includes(v)||s.name.toLowerCase().includes(v)||(s.ticker||'').toLowerCase().includes(v)).slice(0,3);
  const m=document.createElement('div'); m.className='menu srch'; m.innerHTML=(hits.map(x=>`<button data-go="${tokenUrl(x)}"><img src="${SP.coinLogo(x)}" style="width:22px;height:22px;border-radius:50%"><span><b>${esc(x.t)}</b> <span class="muted">${esc(x.n)}</span></span><span class="num" style="margin-left:auto">${fmtUsd(x.mc)}</span></button>`).join('')+st.map(s=>`<button data-go="/?stock=${s.symbol}"><img src="${s.logo}" style="width:22px;height:22px;border-radius:50%;background:#fff"><span><b>${esc(s.ticker)}</b> <span class="muted">${esc(s.name)}</span></span></button>`).join(''))||'<div class="empty" style="padding:14px">No matches</div>';
  document.body.appendChild(m); const r=q.closest('.search').getBoundingClientRect(); m.style.top=(r.bottom+scrollY+6)+'px'; m.style.left=(r.left+scrollX)+'px'; m.style.minWidth=r.width+'px'; $$('[data-go]',m).forEach(b=>b.onclick=()=>SP.go(b.dataset.go));
  setTimeout(()=>document.addEventListener('click',function h(e){ if(!m.contains(e.target)&&e.target!==q){ m.remove(); document.removeEventListener('click',h); } }),0); }
function paintPrices(){ $$('[data-px]').forEach(el=>{ const v=SP.prices[el.dataset.px]; if(v) el.textContent=stockPx(v); }); const e=$('#sp-ethpx'); if(e&&SP.prices[WETH]) e.innerHTML='<img src="/img/eth.png" alt="" style="width:14px;height:14px;border-radius:50%;display:inline-block;vertical-align:-2px;margin-right:6px">'+stockPx(SP.prices[WETH]); }
async function loadPrices(){ const addrs=[WETH,...SP.stocks.map(s=>s.address.toLowerCase())]; await Promise.all(addrs.map(a=>SP.pairUsd(a).catch(()=>0))); if(SP.prices[WETH]) ETH=SP.prices[WETH]; paintPrices(); }

/* ---------- watchlist: per-browser list of coin addresses (localStorage; works without storage too) ---------- */
SP.watch={ _m:null,
  _load(){ if(this._m) return this._m; let a=[]; try{ a=JSON.parse(localStorage.getItem('sp-watch')||'[]'); }catch{} this._m=new Set(Array.isArray(a)?a.map(v=>String(v).toLowerCase()):[]); return this._m; },
  list(){ return [...this._load()]; }, has(a){ return this._load().has(String(a||'').toLowerCase()); },
  toggle(a){ a=String(a||'').toLowerCase(); const m=this._load(); const on=!m.has(a); if(on) m.add(a); else m.delete(a); try{ localStorage.setItem('sp-watch',JSON.stringify([...m])); }catch{} document.dispatchEvent(new CustomEvent('watch-change',{detail:{addr:a,on}})); return on; } };
SP.star=(a,cls='')=>`<button type="button" class="wstar ${cls} ${SP.watch.has(a)?'on':''}" data-watch="${String(a).toLowerCase()}" title="${SP.watch.has(a)?'Remove from watchlist':'Add to watchlist'}" aria-pressed="${SP.watch.has(a)}">${ic('star')}</button>`;
document.addEventListener('click',e=>{ const b=e.target.closest('[data-watch]'); if(!b) return; e.preventDefault(); e.stopPropagation(); const a=b.dataset.watch; const on=SP.watch.toggle(a);
  $$(`[data-watch="${a}"]`).forEach(x=>{ x.classList.toggle('on',on); x.setAttribute('aria-pressed',String(on)); x.title=on?'Remove from watchlist':'Add to watchlist'; }); const x=SP.token(a); SP.toast(on?`${x?'$'+x.t:'Coin'} added to your watchlist`:`${x?'$'+x.t:'Coin'} removed from your watchlist`,'info'); },true);

/* ---------- PnL from a wallet's trades in one coin: cash in vs cash out plus what is still held, in the pair asset ---------- */
SP.pnl=(trades,x,bal,units)=>{ let spent=0,recv=0,bought=0,sold=0; const k=units?1:1e18; (trades||[]).forEach(t=>{ const p=Number(t.pair)/k, c=Number(t.coin)/k; if(t.buy){ spent+=p; bought+=c; } else { recv+=p; sold+=c; } });
  const held=bal!=null?bal:Math.max(0,bought-sold); const hold=held*(x.pxPair||0); const pnl=recv+hold-spent; return {spent,recv,hold,held,pnl,pct:spent>0?pnl/spent*100:0,n:(trades||[]).length}; };

/* ---------- shareable PnL card (canvas, 1200x675) ---------- */
SP.pnlCard=async({x,pnl,wallet})=>{ const pu=x.pairUsd||0, up=pnl.pnl>=0; const W=1200,H=675; const cv=document.createElement('canvas'); cv.width=W; cv.height=H; const g=cv.getContext('2d');
  try{ await Promise.all(['700 64px "Space Grotesk"','600 20px "JetBrains Mono"','500 20px Inter'].map(f=>document.fonts.load(f))); }catch{}
  const img=src=>new Promise(r=>{ if(!src) return r(null); const i=new Image(); i.crossOrigin='anonymous'; i.onload=()=>r(i); i.onerror=()=>r(null); i.src=src; });
  const [logo,coin,pair]=await Promise.all([img('/img/logo.svg?v=14'),img(SP.coinLogo(x)),img(pairImg(x.pair))]);
  const C={bg:'#000',s:'#0d0d0f',line:'#1e1e23',fg:'#ededef',fg3:'#8e8e97',ac:'#3fbcff',res:up?'#2ebd85':'#f6465d'};
  g.fillStyle=C.bg; g.fillRect(0,0,W,H);
  g.strokeStyle='rgba(255,255,255,.035)'; g.lineWidth=1; for(let gx=0;gx<=W;gx+=60){ g.beginPath(); g.moveTo(gx+.5,0); g.lineTo(gx+.5,H); g.stroke(); } for(let gy=0;gy<=H;gy+=60){ g.beginPath(); g.moveTo(0,gy+.5); g.lineTo(W,gy+.5); g.stroke(); }
  // price line from the coin's trades, faint, behind everything
  try{ const tr=(await CHAIN.trades(x.addr)).slice().sort((a,b)=>a.ts-b.ts).map(t=>CHAIN.tradePrice(t)).filter(v=>v>0).slice(-80); if(tr.length>1){ const mn=Math.min(...tr), mx=Math.max(...tr), rg=(mx-mn)||mn||1; const X0=560,X1=W-40,Y0=170,Y1=520; g.beginPath(); tr.forEach((v,i)=>{ const px=X0+(X1-X0)*i/(tr.length-1), py=Y1-(v-mn)/rg*(Y1-Y0); i?g.lineTo(px,py):g.moveTo(px,py); }); g.strokeStyle=C.res; g.globalAlpha=.35; g.lineWidth=3; g.stroke(); g.lineTo(X1,Y1+60); g.lineTo(X0,Y1+60); g.closePath(); const gr=g.createLinearGradient(0,Y0,0,Y1+60); gr.addColorStop(0,up?'rgba(46,189,133,.25)':'rgba(246,70,93,.25)'); gr.addColorStop(1,'rgba(0,0,0,0)'); g.fillStyle=gr; g.globalAlpha=1; g.fill(); } }catch{}
  g.globalAlpha=1;
  // brand
  if(logo) g.drawImage(logo,64,56,44,44); g.font='700 30px "Space Grotesk"'; g.fillStyle=C.fg; g.textBaseline='middle'; g.fillText('Equo',122,79);
  g.font='500 18px "JetBrains Mono"'; g.fillStyle=C.fg3; g.textAlign='right'; g.fillText(new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}),W-64,79); g.textAlign='left';
  // coin
  const circ=(im,cx,cy,r,bg)=>{ g.save(); g.beginPath(); g.arc(cx,cy,r,0,Math.PI*2); g.closePath(); g.fillStyle=bg; g.fill(); g.clip(); if(im) g.drawImage(im,cx-r,cy-r,r*2,r*2); g.restore(); };
  circ(coin,100,200,36,C.s); circ(pair,124,224,15,'#fff'); g.lineWidth=4; g.strokeStyle=C.bg; g.beginPath(); g.arc(124,224,16,0,Math.PI*2); g.stroke();
  g.font='700 40px "Space Grotesk"'; g.fillStyle=C.fg; g.fillText('$'+x.t,156,190); g.font='500 20px "JetBrains Mono"'; g.fillStyle=C.fg3; g.fillText(`paired with ${x.pair}`,158,226);
  // result
  g.font='600 20px "JetBrains Mono"'; g.fillStyle=C.fg3; g.fillText('PNL',64,312);
  g.font='700 132px "Space Grotesk"'; g.fillStyle=C.res; g.textBaseline='alphabetic'; g.fillText((up?'+':'')+pnl.pct.toFixed(pnl.pct>=1000||pnl.pct<=-100?0:1)+'%',58,440);
  g.font='600 30px "JetBrains Mono"'; g.fillText((up?'+':'-')+fmtUsd(Math.abs(pnl.pnl*pu)).replace('-',''),64,494);
  // stats
  const box=(i,lab,val)=>{ const bx=64+i*250, by=548; g.fillStyle=C.s; g.strokeStyle=C.line; g.lineWidth=1.5; g.beginPath(); g.roundRect?g.roundRect(bx,by,230,74,12):g.rect(bx,by,230,74); g.fill(); g.stroke(); g.textBaseline='middle'; g.font='500 15px "JetBrains Mono"'; g.fillStyle=C.fg3; g.fillText(lab,bx+18,by+24); g.font='600 24px "JetBrains Mono"'; g.fillStyle=C.fg; g.fillText(val,bx+18,by+52); };
  box(0,'BOUGHT',fmtUsd(pnl.spent*pu)); box(1,'SOLD',fmtUsd(pnl.recv*pu)); box(2,'HOLDING',fmtUsd(pnl.hold*pu));
  g.textAlign='right'; g.textBaseline='middle'; g.font='500 18px "JetBrains Mono"'; g.fillStyle=C.fg3; g.fillText(wallet?shortAddr(cs(wallet)):'',W-64,572); g.fillStyle=C.ac; g.fillText(location.host,W-64,604); g.textAlign='left';
  let url=''; try{ url=cv.toDataURL('image/png'); }catch{}
  const text=`${up?'+':''}${pnl.pct.toFixed(1)}% on $${x.t} (paired with ${x.pair}) on Equo`; const link=SITE+tokenUrl(x);
  const ov=SP.dialog('Share PnL',`<div class="pnlimg">${url?`<img src="${url}" alt="PnL card">`:'<div class="empty">Could not draw the card in this browser.</div>'}</div><div class="pnlbtns"><button class="btn pri" data-pa="dl" ${url?'':'disabled'}>${ic('dl')}Download</button><button class="btn" data-pa="cp" ${url?'':'disabled'}>${ic('copy')}Copy image</button><a class="btn" target="_blank" rel="noopener" href="https://x.com/intent/tweet?text=${encodeURIComponent(text+' '+link)}">${ic('xlogo')}Post</a>${navigator.share?`<button class="btn" data-pa="sh" ${url?'':'disabled'}>${ic('share')}Share</button>`:''}</div><p class="hint" style="margin-top:10px">Bought and sold use your trades in this coin. Holding uses the price now.</p>`);
  ov.querySelector('.dlg').classList.add('wide');
  const blob=()=>new Promise(r=>cv.toBlob(r,'image/png'));
  $$('[data-pa]',ov).forEach(b=>b.onclick=async()=>{ const a=b.dataset.pa; try{
    if(a==='dl'){ const l=document.createElement('a'); l.href=url; l.download=`equo-${x.t.toLowerCase()}-pnl.png`; l.click(); }
    if(a==='cp'){ await navigator.clipboard.write([new ClipboardItem({'image/png':await blob()})]); SP.toast('Image copied'); }
    if(a==='sh'){ const f=new File([await blob()],`equo-${x.t.toLowerCase()}-pnl.png`,{type:'image/png'}); await navigator.share({files:[f],text,url:link}); }
  }catch(e){ if(!/abort/i.test(String(e))) SP.toast(a==='cp'?'Copy is not supported here; use Download':SP.errMsg(e),'err'); } }); };

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
  setInterval(()=>{ const el=$('#sp-clock'); if(el) el.outerHTML=clockHtml(); },30000);
}); });
SP.ready().then(()=>{ if(typeof window.SP_PAGE==='function') { try{ window.SP_PAGE(); }catch(e){ console.error('page init',e); SP.toast('Page failed to initialise: '+SP.errMsg(e),'err'); } } });
