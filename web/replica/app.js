/* behaviour for the replica pages (works on the o1 markup) */
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const I={ // lucide icons
 x:'<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',check:'<path d="M20 6 9 17l-5-5"/>',search:'<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
 ext:'<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
 grid:'<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
 user:'<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
 trophy:'<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
 book:'<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
 plus:'<path d="M5 12h14"/><path d="M12 5v14"/>',code:'<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',shield:'<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
 logout:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',copy:'<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
 wallet:'<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
 rocket:'<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
 globe:'<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
 crosshair:'<circle cx="12" cy="12" r="10"/><path d="M22 12h-4"/><path d="M6 12H2"/><path d="M12 6V2"/><path d="M12 22v-4"/>',line:'<path d="M5 19 19 5"/><circle cx="5" cy="19" r="1.5"/><circle cx="19" cy="5" r="1.5"/>',fib:'<path d="M3 5h18"/><path d="M3 10h18"/><path d="M3 14h18"/><path d="M3 19h18"/>',
 shapes:'<path d="M8.3 10a.7.7 0 0 1-.626-1.079L11.4 3a.7.7 0 0 1 1.198-.043L16.3 8.9a.7.7 0 0 1-.572 1.1Z"/><rect x="3" y="14" width="7" height="7" rx="1"/><circle cx="17.5" cy="17.5" r="3.5"/>',text:'<path d="M12 4v16"/><path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2"/><path d="M9 20h6"/>',
 smile:'<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" x2="9.01" y1="9" y2="9"/><line x1="15" x2="15.01" y1="9" y2="9"/>',ruler:'<path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z"/><path d="m14.5 12.5 2-2"/><path d="m11.5 9.5 2-2"/><path d="m8.5 6.5 2-2"/><path d="m17.5 15.5 2-2"/>',
 zoom:'<circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="11" x2="11" y1="8" y2="14"/><line x1="8" x2="14" y1="11" y2="11"/>',magnet:'<path d="m6 15-4-4 6.75-6.77a7.79 7.79 0 0 1 11 11L13 22l-4-4 6.39-6.36a2.14 2.14 0 0 0-3-3L6 15"/><path d="m5 8 4 4"/><path d="m12 15 4 4"/>',
 lock:'<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',eye:'<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',trash:'<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
 candle:'<path d="M9 5v4"/><rect width="4" height="6" x="7" y="9" rx="1"/><path d="M9 15v2"/><path d="M17 3v2"/><rect width="4" height="8" x="15" y="5" rx="1"/><path d="M17 13v3"/><path d="M3 3v16a2 2 0 0 0 2 2h16"/>',ind:'<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="m19 9-5 5-4-4-3 3"/>',
 max:'<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',undo:'<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>',redo:'<path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"/>',
 settings:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
 camera:'<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',pen:'<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>',up:'<path d="m18 15-6-6-6 6"/>',
 terminal:'<path d="m7 11 2-2-2-2"/><path d="M11 13h4"/><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>',layers:'<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/>',chevr:'<path d="m9 18 6-6-6-6"/>',swap:'<path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/>',
 crown:'<path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z"/><path d="M5 21h14"/>',
 medal:'<path d="M7.21 15 2.66 7.14a2 2 0 0 1 .13-2.2L4.4 2.8A2 2 0 0 1 6 2h12a2 2 0 0 1 1.6.8l1.6 2.14a2 2 0 0 1 .14 2.2L16.79 15"/><path d="M11 12 5.12 2.2"/><path d="m13 12 5.88-9.8"/><path d="M8 7h8"/><circle cx="12" cy="17" r="5"/><path d="M12 18v-2h-.5"/>',
};
const ic=(n,cls='size-4')=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide ${cls}" aria-hidden="true">${I[n]}</svg>`;
const AVIMG=src=>`<img alt="" class="absolute inset-0 size-full rounded-md object-cover" src="${src}" loading="lazy" decoding="async">`;
function setAv(span,src,letter){ if(!span) return; span.style.background=''; const l=span.querySelector('span'); if(l&&letter) l.textContent=letter; span.querySelectorAll('img').forEach(i=>i.remove()); if(src) span.insertAdjacentHTML('beforeend',AVIMG(src)); }
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const page=location.pathname.split('/').pop()||'index.html';
const layer=()=>$('#layer')||document.body;

/* ---------- toasts ---------- */
function toast(msg,icon='check'){let w=$('.o-toasts'); if(!w){w=document.createElement('div'); w.className='o-toasts'; document.body.appendChild(w);} const t=document.createElement('div'); t.className='o-toast'; t.innerHTML=ic(icon)+'<span>'+esc(msg)+'</span>'; w.appendChild(t); setTimeout(()=>{t.classList.add('out'); setTimeout(()=>t.remove(),300);},2600);}
async function copyText(v,msg){try{await navigator.clipboard.writeText(v);}catch{} toast(msg||'Copied to clipboard');}

/* ---------- wallet state ---------- */
const W={get connected(){try{return localStorage.getItem('wallet')==='1';}catch{return false;}}, set(v){try{localStorage.setItem('wallet',v?'1':'0');}catch{} }};

/* ---------- generic overlay helpers ---------- */
let openEl=null;
function closeOv(ov){ if(!ov||ov.classList.contains('out')) return; ov.classList.add('out'); setTimeout(()=>ov.remove(),220); }
function closeAll(){ $$('.o-menu').forEach(e=>e.remove()); $$('.o-overlay,.o-sheet-ov,.o-drawer-ov').forEach(closeOv); $$('[aria-expanded="true"]').forEach(b=>{if(!b.closest('aside'))b.setAttribute('aria-expanded','false');}); }
document.addEventListener('click',e=>{ if(!e.target.closest('.o-menu') && !e.target.closest('[data-menu]')) $$('.o-menu').forEach(m=>m.remove()); });
document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeAll(); });
function menu(anchor,html,left,container){ $$('.o-menu').forEach(m=>m.remove()); const m=document.createElement('div'); m.className='o-menu'+(left?' left':''); m.innerHTML=html; if(container){ const cr=container.getBoundingClientRect(), ar=anchor.getBoundingClientRect(); container.style.position='relative'; m.style.top=(ar.bottom-cr.top+6)+'px'; m.style.left=(ar.left-cr.left)+'px'; m.style.right='auto'; container.appendChild(m); } else { anchor.parentElement.style.position='relative'; anchor.parentElement.appendChild(m); } anchor.setAttribute('aria-expanded','true'); return m; }
function dialog(html,cls='',top){ closeAll(); const ov=document.createElement('div'); ov.className='o-overlay'+(top?' top':''); ov.innerHTML='<div class="o-dialog '+cls+'" role="dialog">'+html+'</div>'; ov.addEventListener('click',e=>{if(e.target===ov) closeOv(ov);}); $$('.x',ov).forEach(x=>x.onclick=()=>closeOv(ov)); ov.remove=()=>closeOv(ov); layer().appendChild(ov); return ov; }
function sheet(html,cls=''){ closeAll(); const ov=document.createElement('div'); ov.className='o-sheet-ov'; ov.innerHTML='<div class="o-sheet '+cls+'"><div class="grab"></div><div class="sb">'+html+'</div></div>'; ov.addEventListener('click',e=>{if(e.target===ov) closeOv(ov);}); ov.remove=()=>closeOv(ov); layer().appendChild(ov); return ov; }
const dh=(t,p)=>`<div class="dh"><div><h3>${t}</h3>${p?'<p>'+p+'</p>':''}</div><button class="x" aria-label="Close">${ic('x')}</button></div>`;

/* ---------- product list (brand dropdown + drawer) ---------- */
const PRODUCTS=[['Launchpad','Memecoins that pay holders in stocks','rocket','index.html',true],['Leaderboard','Top 5 traders paid every 3 days','trophy','leaderboard.html'],['Docs','How launches, rewards and fees work','book','docs.html'],['Ink explorer','Verified contracts and transactions','terminal','https://explorer.inkonchain.com']];
const prodItems=cls=>PRODUCTS.map(p=>`<button class="${cls}${p[4]?' on':''}" data-go="${p[3]}"><span class="tile">${ic(p[2])}</span><span class="t"><b>${p[0]}${p[4]?'<span class="cur">Current</span>':''}</b><span>${p[1]}</span></span>${p[3].startsWith('http')?ic('chevr','ch'):''}</button>`).join('');
function openDrawer(){ closeAll(); const ov=document.createElement('div'); ov.className='o-drawer-ov'; ov.innerHTML=`<div class="o-drawer"><div class="dh"><b>Menu</b><button class="x" aria-label="Close">${ic('x')}</button></div><div class="db"><div class="h">Developers</div><button class="li" data-go="docs.html#integrate">${ic('code')}Developers</button><button class="li" data-go="docs.html#contracts">${ic('shield')}Contract addresses</button><div class="d"></div><div class="h">Products</div>${prodItems('pi')}</div></div>`; ov.addEventListener('click',e=>{ if(e.target===ov) closeOv(ov); }); ov.querySelector('.x').onclick=()=>closeOv(ov); ov.remove=()=>closeOv(ov); $$('[data-go]',ov).forEach(b=>b.onclick=()=>{ const g=b.dataset.go; g.startsWith('http')?window.open(g,'_blank'):location.href=g; }); layer().appendChild(ov); return ov; }

/* ---------- header ---------- */
function initHeader(){
  // navigation buttons
  $$('[data-href]').forEach(b=>b.addEventListener('click',e=>{e.preventDefault(); const h=b.dataset.href; if(h==='#search') return openSearch(); if(h.startsWith('#')){const t=$(h); if(t) t.scrollIntoView({behavior:'smooth'}); return;} location.href=h;}));
  // brand menu
  const brand=$('header button[aria-label="Launchpad"]'); if(brand){brand.dataset.menu='1'; brand.onclick=()=>{ if($('.o-menu')) return $$('.o-menu').forEach(m=>m.remove()); const m=menu(brand,prodItems('pi'),true); m.classList.add('prod'); wire(); }; }
  // developers menu
  const dev=$('header button[aria-label="Developers"]'); if(dev){dev.dataset.menu='1'; dev.onclick=()=>{ if($('.o-menu')) return $$('.o-menu').forEach(m=>m.remove()); menu(dev,`<div class="h">Developers</div><button class="i" data-go="docs.html#contracts">${ic('code')}Contract addresses</button><button class="i" data-go="docs.html#integrate">${ic('book')}Integrate the hook</button><button class="i" data-go="admin.html">${ic('shield')}Admin console</button>`); wire(); }; }
  // language
  const lang=$('header button[aria-label^="Language"]'); if(lang){ lang.dataset.menu='1'; lang.onclick=()=>{ const ch=lang.querySelector('svg.lucide-chevron-down'); if($('.o-menu')){ $$('.o-menu').forEach(m=>m.remove()); if(ch) ch.style.transform=''; return; } if(ch) ch.style.transform='rotate(180deg)'; const m=menu(lang,LANGS.map(([c,n])=>`<button class="i${c===LANG?' on':''}" data-lang="${c}" role="option">${n}${c===LANG?'<span class="r">'+ic('check')+'</span>':''}</button>`).join('')); m.classList.add('lang'); if(innerWidth<768){ const r=lang.getBoundingClientRect(); m.style.left=Math.min(r.left,innerWidth-187-8)+'px'; } $$('[data-lang]',m).forEach(b=>b.onclick=()=>{ setLang(b.dataset.lang); $$('.o-menu').forEach(x=>x.remove()); if(ch) ch.style.transform=''; }); }; document.addEventListener('click',e=>{ if(!$('.o-menu')){ const ch=lang.querySelector('svg.lucide-chevron-down'); if(ch) ch.style.transform=''; } }); }
  // search
  $$('header button[aria-label="Search"], header button.flex.h-9.w-full').forEach(b=>b.onclick=openSearch);
  addEventListener('keydown',e=>{ if(e.key==='/' && !['INPUT','TEXTAREA'].includes(document.activeElement.tagName)){e.preventDefault(); openSearch();}});
  // wallet
  renderWallet();
  // mobile hamburger
  const ham=$('header button[aria-label="Menu"], header button:has(.lucide-menu)'); if(ham) ham.onclick=openDrawer;
  function wire(){ $$('.o-menu [data-go]').forEach(b=>b.onclick=()=>{ const g=b.dataset.go; g.startsWith('http')?window.open(g,'_blank'):location.href=g; }); }
}
function renderWallet(){
  const pill=$('header .relative.flex.h-9.shrink-0.items-stretch'); if(!pill) return;
  const btn=pill.querySelector('button');
  if(W.connected){ btn.innerHTML=`<span class="o-wpill"><span class="dot"></span><span class="font-mono font-medium">${ME}</span></span>`; btn.dataset.menu='1'; btn.onclick=()=>{ if($('.o-menu')) return $$('.o-menu').forEach(m=>m.remove()); menu(btn,`<div class="h">${ME}</div><button class="i" data-act="copy">${ic('copy')}Copy address</button><button class="i" data-act="portfolio">${ic('user')}Profile</button><button class="i" data-act="explorer">${ic('globe')}View on explorer<span class="r">${ic('ext','size-3')}</span></button><div class="d"></div><button class="i" data-act="out">${ic('logout')}Disconnect</button>`); $$('.o-menu [data-act]').forEach(b=>b.onclick=()=>{const a=b.dataset.act; if(a==='copy') copyText(ME_FULL,'Address copied'); if(a==='portfolio') location.href='portfolio.html'; if(a==='explorer') window.open('https://explorer.inkonchain.com/address/'+ME_FULL,'_blank'); if(a==='out'){W.set(false); location.reload();} }); }; }
  else { btn.innerHTML='<span class="hidden sm:inline">Connect Wallet</span><span class="sm:hidden">Connect</span>'; btn.onclick=openConnect; }
  const chain=pill.querySelectorAll('button')[1]; if(chain) chain.onclick=()=>{ const ov=dialog(dh('Network','Tokens on this launchpad live on Ink')+`<div class="db"><button class="opt on"><span class="ic" style="overflow:hidden"><img src="img/ink.png" alt="Ink" style="width:100%;height:100%"></span><span>Ink<small>Chain 57073 · 1s blocks</small></span><span class="r">${ic('check')}</span></button></div>`); };
  $$('#cta').forEach(c=>{ if(W.connected){ c.textContent=(window.swapSide==='sell'?'Sell':'Buy')+' MOGCAT'; } else { c.textContent='Connect Wallet'; } });
  const pos=$('#pos'); if(pos) pos.classList.toggle('hidden',!W.connected);
}
function openConnect(){
  const wallets=[['MetaMask','#f6851b','M','Browser extension'],['Rabby','#8697ff','R','Browser extension'],['WalletConnect','#3b99fc','W','Scan with your phone'],['Coinbase Wallet','#1652f0','C','Browser extension']];
  const ov=dialog(dh('Connect wallet','Connect to Ink (chain 57073) to trade and claim rewards')+'<div class="db">'+wallets.map(w=>`<button class="opt" data-w="${w[0]}"><span class="ic" style="background:${w[1]}">${w[2]}</span><span>${w[0]}<small>${w[3]}</small></span></button>`).join('')+'</div><div class="foot">By connecting you agree to the <a href="docs.html#terms">terms</a>. Demo build: the connection is simulated.</div>');
  $$('[data-w]',ov).forEach(b=>b.onclick=()=>{ b.innerHTML=`<span class="ic" style="background:var(--color-bg-elevated)">…</span><span>Connecting to ${b.dataset.w}<small>Approve in your wallet</small></span>`; setTimeout(()=>{W.set(true); ov.remove(); renderWallet(); toast('Connected '+ME);},900); });
}
function openSearch(){
  const inner=`<div class="o-search">${ic('search')}<input id="sq" placeholder="Search by name, symbol, or address" autocomplete="off"><kbd>ESC</kbd></div><div class="db" id="sres" style="padding-top:8px"></div>`;
  const ov=innerWidth<768?sheet(inner,'search'):dialog(inner,'wide',true);
  const inp=$('#sq',ov), res=$('#sres',ov);
  const render=q=>{ q=q.trim().toLowerCase(); let list=TOK.filter(x=>!q||x.n.toLowerCase().includes(q)||x.t.toLowerCase().includes(q)||('0x7b26'.includes(q))); res.innerHTML=(q?'':'<div class="h" style="padding:6px 12px;font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--color-text-muted)">Trending</div>')+list.slice(0,8).map(x=>`<button class="opt" data-go="token.html"><span class="ic" style="background:var(--color-bg-input);overflow:hidden"><img src="${x.img}" alt="" style="width:100%;height:100%;object-fit:cover"></span><span>${esc(x.n)}<small>${x.t} · ETH · ${ageStr(x.age)}</small></span><span class="r">${fmtUsd(x.mc)}</span></button>`).join('')||'<p class="py-6 text-center text-sm text-text-muted">No tokens match.</p>'; $$('[data-go]',res).forEach(b=>b.onclick=()=>location.href=b.dataset.go); };
  inp.oninput=()=>render(inp.value); render(''); setTimeout(()=>inp.focus(),30);
}

/* ---------- history chips (sub bar) ---------- */
function initHistory(){
  const h=$('#hist'); if(!h) return; const tpl=$('[data-tpl="chip"]',h); tpl.remove();
  let hist; try{hist=JSON.parse(localStorage.getItem('hist')||'null');}catch{} if(!hist) hist=['MOGCAT','CPEPE','VHAIR'];
  if(page==='token.html'){ hist=['MOGCAT',...hist.filter(x=>x!=='MOGCAT')].slice(0,8); try{localStorage.setItem('hist',JSON.stringify(hist));}catch{} }
  hist.forEach(sym=>{ const x=TOK.find(t=>t.t===sym); if(!x) return; const c=tpl.cloneNode(true); c.removeAttribute('data-tpl'); setAv($('.bg-avatar-gradient',c),x.img,x.t[0]); $('.block.truncate',c).textContent=x.t; c.querySelectorAll('button')[0].onclick=()=>location.href='token.html'; const rm=c.querySelectorAll('button')[1]; if(rm){rm.setAttribute('aria-label','Remove '+x.t+' from history'); rm.onclick=e=>{e.stopPropagation(); c.remove(); hist=hist.filter(s=>s!==sym); try{localStorage.setItem('hist',JSON.stringify(hist));}catch{} };} h.appendChild(c); });
}

/* ---------- shared: copy buttons / toasts ---------- */
function initGeneric(){
  $$('[data-copy]').forEach(b=>b.addEventListener('click',()=>copyText(b.dataset.copy,b.dataset.toast||'Address copied')));
  $$('[data-toast]:not([data-copy])').forEach(b=>b.addEventListener('click',()=>toast(b.dataset.toast)));
  const w=$('#warn'); if(w){ const b=w.querySelector('button'), sp=w.querySelector('span.min-w-0'), ch=w.querySelector('svg.lucide-chevron-down'); b.onclick=()=>{ const o=b.getAttribute('aria-expanded')==='true'; b.setAttribute('aria-expanded',String(!o)); sp.classList.toggle('truncate',o); ch.style.transform=o?'':'rotate(180deg)'; }; }
  $$('span.cursor-help[title], span.cursor-help button[aria-label$="info"]').forEach(()=>{});
}

/* ======================= TOKEN PAGE ======================= */
const BASKET=['NVDAx','SPYx','TSLAx','MSTRx']; const SUP=1e9; let price=0.000927; window.swapSide='buy';
function initToken(){
  // basket tags (clone of the paired-asset tag)
  const tags=$('#tags'); const base=tags.children[0];
  BASKET.forEach(s=>{ const c=base.cloneNode(true); setAv($('.bg-avatar-gradient',c),STOCK_IMG(s),s[0]); c.title='Holders are paid in '+STOCK_NAME[s]+' ('+s+')'; const inner=c.querySelector('span.inline-flex'); inner.lastChild.textContent=s; tags.insertBefore(c,tags.lastElementChild); });
  const rb=$('#rewBasket'); if(rb) BASKET.forEach(s=>{ const c=base.cloneNode(true); setAv($('.bg-avatar-gradient',c),STOCK_IMG(s),s[0]); c.querySelector('span.inline-flex').lastChild.textContent=STOCK_NAME[s]+' · '+s; rb.appendChild(c); });
  // stats
  const st=$$('[data-stat]');
  const setStat=(i,v,s)=>{ const vv=st[i].querySelector('.text-\\[26px\\]'); if(vv) vv.textContent=v; const ss=st[i].querySelector('.font-mono'); if(ss&&s!=null) ss.textContent=s; };
  setStat(2,'$1.21M','497.7 ETH'); setStat(3,'$96.4K','39.6 ETH'); setStat(4,'1B'); setStat(5,'7.2K');
  const s4=st[4].querySelector('.font-mono'); if(s4) s4.remove();
  const s5=st[5].querySelector('.font-mono'); if(s5) s5.remove();
  const stMc=st[0].querySelector('.text-\\[26px\\]'), stMcE=st[0].querySelector('.font-mono'), stPx=st[1].querySelector('.text-\\[26px\\]'), stPxE=st[1].querySelector('.font-mono');
  st[5].querySelector('button')?.addEventListener('click',()=>showTab('hold'));
  // chart chrome + data
  initChart();
  // trades
  const tb=$('#tb'), tpl=$('[data-tpl="tx"]',tb); tpl.remove(); const mtb=$('#mtb'), mtpl=$('[data-tpl="mtx"]',mtb); mtpl.remove();
  const trades=[]; let now=Math.floor(Date.now()/1000);
  const mk=ts=>{const buy=rnd()<0.58; const eth=+(0.01+rnd()*rnd()*1.2).toFixed(3); const px=price*(1+(buy?1:-1)*rnd()*0.004); return {t:ts,buy,eth,usd:eth*ETH,amt:eth/(px/ETH),px,mk:hex(),tx:'0x'+Math.floor(rnd()*1e16).toString(16).padStart(16,'0')};};
  for(let i=0;i<40;i++) trades.unshift(mk(now-i*9-Math.floor(rnd()*6))); trades.sort((a,b)=>b.t-a.t);
  const agoTxt=x=>ago(Math.max(0,now-x.t))+' ago';
  function row(x){ const r=tpl.cloneNode(true); r.removeAttribute('data-tpl'); const td=r.children; const tm=td[0].querySelector('span'); tm.textContent=agoTxt(x); tm.dataset.ts=x.t; tm.title=new Date(x.t*1000).toLocaleString();
    const ty=td[1].querySelector('span'); ty.textContent=x.buy?'Buy':'Sell'; ty.className=x.buy?'inline-flex h-6 items-center rounded-md border px-2 text-[11px] font-semibold border-success/20 bg-success-soft text-success':'inline-flex h-6 items-center rounded-md border px-2 text-[11px] font-semibold border-error/20 bg-error/10 text-error';
    const c2=td[2].querySelectorAll('span.block'); c2[1].textContent=fmtPrice(x.px/ETH)+' ETH'; c2[2].textContent='approx $'+fmtPrice(x.px);
    td[3].querySelector('span.block span').textContent=fmtAmt(x.amt)+' MOGCAT';
    const c4=td[4].querySelectorAll('span.block'); c4[1].textContent=x.eth.toFixed(4)+' ETH'; c4[2].textContent='approx '+fmtUsd(x.usd);
    td[5].querySelector('span.block span').textContent=(x.eth*0.02).toFixed(5)+' ETH';
    const a=td[6].querySelector('a'); a.href='https://explorer.inkonchain.com/address/'+x.mk; a.querySelector('span').textContent=x.mk;
    td[7].querySelector('a').href='https://explorer.inkonchain.com/tx/'+x.tx; r.dataset.k=x.buy?'buy':'sell'; return r; }
  function mrow(x){ const r=mtpl.cloneNode(true); r.removeAttribute('data-tpl'); const f=k=>r.querySelector('[data-f="'+k+'"]'); const sd=f('side'); sd.textContent=x.buy?'Buy':'Sell'; sd.className='mr-1.5 '+(x.buy?'text-success':'text-error'); f('amt').textContent=fmtAmt(x.amt)+' MOGCAT'; f('time').textContent=agoTxt(x); f('time').dataset.ts=x.t; f('wallet').textContent=x.mk.slice(0,6)+'…'; r.querySelector('a').href='https://explorer.inkonchain.com/address/'+x.mk; f('px').textContent='$'+fmtPrice(x.px); f('fee').textContent='Fee '+(x.eth*0.02).toFixed(5)+' ETH'; f('usd').textContent='approx '+fmtUsd(x.usd); r.dataset.k=x.buy?'buy':'sell'; return r; }
  trades.forEach(x=>{tb.appendChild(row(x)); mtb.appendChild(mrow(x));});
  setInterval(()=>{now=Math.floor(Date.now()/1000); $$('[data-ts]').forEach(e=>e.textContent=ago(Math.max(0,now-+e.dataset.ts))+' ago');},1000);
  let filter='all'; const applyFilter=()=>{ $$('#tb tr,#mtb > div').forEach(r=>r.style.display=(filter==='all'||r.dataset.k===filter)?'':'none'); };
  const seg=$('#seg'); seg.addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b) return; $$('button',seg).forEach(x=>{ x.className=x.className.replace(' bg-accent text-accent-ink','').replace(' text-text-secondary hover:text-text-primary',''); x.className+= x===b?' bg-accent text-accent-ink':' text-text-secondary hover:text-text-primary'; }); filter=b.dataset.side; applyFilter(); });
  // normalise initial seg classes
  $$('button',seg).forEach((x,i)=>{ const base=x.className.replace(/ bg-accent text-accent-ink| text-text-secondary hover:text-text-primary/g,''); x.className=base+(i===0?' bg-accent text-accent-ink':' text-text-secondary hover:text-text-primary'); });
  $('#loadmore button').onclick=()=>{ const last=trades[trades.length-1]; for(let i=0;i<10;i++){ const x=mk(last.t-9*(i+1)-Math.floor(rnd()*6)); trades.push(x); tb.appendChild(row(x)); mtb.appendChild(mrow(x)); } applyFilter(); };
  // live ticks
  function tick(){ const tr=mk(Math.floor(Date.now()/1000)); const old=price; price=tr.px; trades.unshift(tr); const r=row(tr); r.classList.add('o-flash'); tb.insertBefore(r,tb.firstChild); mtb.insertBefore(mrow(tr),mtb.firstChild); if(tb.children.length>80) tb.lastElementChild.remove(); if(mtb.children.length>80) mtb.lastElementChild.remove(); applyFilter();
    stPx.textContent='$'+fmtPrice(price); stPxE.textContent=fmtPrice(price/ETH)+' ETH'; stMc.textContent=fmtUsd(price*SUP); stMcE.textContent=(price*SUP/ETH).toFixed(1)+' ETH';
    [stPx,stMc].forEach(e=>{e.classList.remove('stat-up','stat-dn'); void e.offsetWidth; e.classList.add(price>=old?'stat-up':'stat-dn'); setTimeout(()=>e.classList.remove('stat-up','stat-dn'),600);});
    chartTick(price); updSwap(); setTimeout(tick,1500+rnd()*3000); }
  stPx.textContent='$'+fmtPrice(price); stPxE.textContent=fmtPrice(price/ETH)+' ETH'; stMc.textContent=fmtUsd(price*SUP); stMcE.textContent=(price*SUP/ETH).toFixed(1)+' ETH';
  setTimeout(tick,1800);
  // tabs
  $$('#tabs [data-tab]').forEach(b=>b.onclick=()=>showTab(b.dataset.tab));
  fillHolders(); fillTop();
  // swap
  initSwap();
  // mobile buy/sell bar
  $$('#mbar [data-side]').forEach(b=>b.onclick=()=>openSwapSheet(b.dataset.side));
}
function showTab(k){ $$('#tabs [data-tab]').forEach(b=>{ const on=b.dataset.tab===k; b.className=b.className.replace(/ text-text-primary| text-text-muted hover:text-text-secondary/g,'')+(on?' text-text-primary':' text-text-muted hover:text-text-secondary'); });
  $$('#panes [data-pane]').forEach(p=>{ const on=p.dataset.pane===k; if(p.classList.contains('md:hidden')) p.classList.toggle('hidden-i',!on); else { p.classList.toggle('hidden',!on); if(on&&p.classList.contains('md:block')) p.classList.remove('hidden'); } });
  // the desktop tx table has md:block + hidden: handle explicitly
  $$('#panes [data-pane="tx"]').forEach(p=>{ if(p.classList.contains('md:block')){ p.classList.toggle('hidden-i',k!=='tx'); p.classList.add('hidden'); } });
  $('#seg').style.display=k==='tx'?'':'none'; $('#loadmore').style.display=k==='tx'?'':'none'; }
function tdiv(cls,inner){return `<td class="${cls}">${inner}</td>`;}
function cellR(main,sub){return `<span class="block min-w-0 text-right tabular-nums"><span class="block max-w-full truncate font-medium text-text-primary">${main}</span>${sub?`<span class="mt-0.5 block max-w-full truncate text-xs text-text-muted">${sub}</span>`:''}</span>`;}
const wlink=(a,full)=>`<a class="inline-flex min-w-0 items-center gap-1 transition-colors hover:text-accent text-text-primary" href="https://explorer.inkonchain.com/address/${full||a}" target="_blank" rel="noopener noreferrer"><span class="truncate">${a}</span>${ic('ext','lucide-external-link size-3 shrink-0')}</a>`;
const tagS=t=>`<span class="ml-1.5 inline-flex h-5 items-center rounded-full bg-bg-elevated px-2 text-[11px] font-semibold text-text-secondary">${t}</span>`;
function fillHolders(){ const H=[['0x3f1a…9c02',4.21,'Uniswap V4 pool'],['0x5DdD…4A0b',1.82,'creator'],['0x9a4e…11bd',1.44],['0xb77c…e2f0',1.20],['0x14d9…77a3',0.98],['0xe0c1…5b6f',0.91],['0x77a1…0e4b',0.80],['0xc2d8…9f31',0.72],['0x1b6e…aa07',0.61],['0x8f13…2c55',0.55]];
  $('#tb_hold').innerHTML=H.map((h,i)=>`<tr class="h-[4.5rem] text-text-primary">${tdiv('whitespace-nowrap px-4 py-3 align-middle','<span class="block text-text-muted">'+(i+1)+'</span>')}${tdiv('px-4 py-3 align-middle',wlink(h[0])+(h[2]?tagS(h[2]):''))}${tdiv('px-4 py-3 align-middle text-right tabular-nums',cellR(fmtAmt(h[1]/100*SUP)+' MOGCAT'))}${tdiv('px-4 py-3 align-middle text-right tabular-nums',cellR(h[1].toFixed(2)+'%'))}${tdiv('px-4 py-3 align-middle text-right tabular-nums',cellR(fmtUsd(h[1]/100*SUP*price),(h[1]/100*SUP*price/ETH).toFixed(3)+' ETH'))}${tdiv('px-4 py-3 align-middle text-right tabular-nums',cellR(h[2]==='Uniswap V4 pool'?'—':'$'+(h[1]*21).toFixed(2),h[2]==='Uniswap V4 pool'?'':'in stocks'))}${tdiv('px-4 py-3 align-middle text-right','<span class="block text-text-muted">'+(1+i)+'d</span>')}</tr>`).join(''); }
function fillTop(){ $('#tb_top').innerHTML=LB_PNL.slice(0,8).map((r,i)=>`<tr class="h-[4.5rem] text-text-primary">${tdiv('whitespace-nowrap px-4 py-3 align-middle',rank(i,true))}${tdiv('px-4 py-3 align-middle',wlink(r[0])+(r[2]?tagS('YOU'):''))}${tdiv('px-4 py-3 align-middle text-right tabular-nums','<span class="block font-medium text-success">+'+r[1].toFixed(2)+' ETH</span>')}${tdiv('px-4 py-3 align-middle text-right tabular-nums',cellR((r[1]*14).toFixed(1)+' ETH',fmtUsd(r[1]*14*ETH)))}${tdiv('px-4 py-3 align-middle text-right tabular-nums',cellR(String(40+i*17)))}${tdiv('px-4 py-3 align-middle text-right',cellR(i%3?'Yes':'No'))}</tr>`).join(''); }
function rank(i,small){ const n=i+1; if(i<3){ const col=['warning','text-secondary','burn'][i]; const icon=['crown','medal','medal'][i]; return `<span class="relative z-10 inline-flex shrink-0 items-center justify-center border font-mono font-bold tabular-nums ${small?'size-7 rounded-md':'size-8 rounded-lg'} border-${col}/50 bg-${col}/10 text-${col}">${ic(icon,'size-4')}<span class="absolute -bottom-1.5 -right-1.5 grid size-5 place-items-center rounded-full border bg-bg-card text-[11px] leading-none border-${col}/60 text-${col}">${n}</span></span>`; } return `<span class="relative z-10 inline-flex shrink-0 items-center justify-center border font-mono font-bold tabular-nums size-6 rounded-full text-[11px] border-border-default bg-bg-card text-text-muted">${n}</span>`; }

/* ---------- chart (TradingView-style chrome around lightweight-charts) ---------- */
let series, candles=[], vols=[], chart;
function initChart(){
  const tv=$('#tv'); if(!tv) return;
  tv.innerHTML=`<div class="tv"><div class="tb"><button class="b" id="tfBtn">1h</button><span class="sep"></span><button class="b" title="Candles">${ic('candle')}</button><span class="sep"></span><button class="b dim">${ic('ind')}Indicators</button><span class="sep"></span><button class="b on" data-ccy="USD">USD</button><span class="sl">/</span><button class="b dim" data-ccy="ETH">ETH</button><span class="sep"></span><button class="b dim" data-mode="mc">MarketCap</button><span class="sl">/</span><button class="b on" data-mode="px">Price</button><span class="sep hm"></span><button class="b hm" title="Fullscreen" id="fsBtn">${ic('max')}</button><button class="b dim hm" title="Undo">${ic('undo')}</button><button class="b dim hm" title="Redo">${ic('redo')}</button><span class="sp"></span><button class="b hm" title="Chart settings">${ic('settings')}</button><button class="b hm" title="Screenshot">${ic('camera')}</button></div>
  <div class="rail">${['crosshair','line','fib','shapes','pen','text','smile','ruler','zoom','magnet','lock','eye','trash'].map(n=>`<button title="${n}">${ic(n)}</button>`).join('')}</div>
  <div class="area"><div class="lg" id="lg"></div><div id="tvc"></div><div class="tvlogo"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M4 6h8v3H9v9H6V9H4zM13 6h3l2 6 2-6h3l-3.5 12h-3z"/></svg></div></div>
  <div class="bb"><button class="b" data-rng="3m">3m</button><button class="b" data-rng="1m">1m</button><button class="b" data-rng="5d">5d</button><button class="b on" data-rng="1d">1d</button><span class="sp"></span><span class="t" id="clock"></span><span class="sep"></span><button class="b">%</button><button class="b">log</button><button class="b on">auto</button></div></div>`;
  let t=Math.floor(Date.now()/3600)*3600-240*3600, p=0.000291; candles=[]; vols=[];
  for(let i=0;i<240;i++){const o=p; const drift=i<60?0.012:i<160?0.004:-0.002; const c=o*(1+drift+(rnd()-0.5)*0.05); const hh=Math.max(o,c)*(1+rnd()*0.02); const ll=Math.min(o,c)*(1-rnd()*0.02); candles.push({time:t,open:o,high:hh,low:ll,close:c}); vols.push({time:t,value:2000+rnd()*9000,color:c>=o?'rgba(47,211,107,.35)':'rgba(242,74,92,.35)'}); p=c; t+=3600;}
  price=candles[candles.length-1].close;
  const el=$('#tvc'); if(!window.LightweightCharts){ el.innerHTML='<div class="flex h-full items-center justify-center text-sm text-text-muted">Chart unavailable offline</div>'; legend(candles[candles.length-1]); return; }
  const cs=getComputedStyle(document.documentElement); const col={bg:cs.getPropertyValue('--color-bg-card').trim(),grid:cs.getPropertyValue('--color-border-default').trim(),tx:cs.getPropertyValue('--color-text-muted').trim()};
  chart=LightweightCharts.createChart(el,{layout:{attributionLogo:false,background:{color:col.bg},textColor:col.tx,fontFamily:'JetBrains Mono',fontSize:11},grid:{vertLines:{color:col.grid},horzLines:{color:col.grid}},rightPriceScale:{borderColor:col.grid},timeScale:{borderColor:col.grid,timeVisible:true},crosshair:{mode:0},localization:{priceFormatter:v=>fmtPrice(v)}});
  series=chart.addCandlestickSeries({upColor:'#2fd36b',downColor:'#f24a5c',borderVisible:false,wickUpColor:'#2fd36b',wickDownColor:'#f24a5c',priceFormat:{type:'custom',minMove:1e-9,formatter:v=>fmtPrice(v)}});
  series.priceScale().applyOptions({scaleMargins:{top:0.12,bottom:0.22}});
  const vs=chart.addHistogramSeries({priceFormat:{type:'volume'},priceScaleId:''}); vs.priceScale().applyOptions({scaleMargins:{top:0.82,bottom:0}});
  series.setData(candles); vs.setData(vols); chart.timeScale().scrollToPosition(3,false);
  new ResizeObserver(()=>chart.applyOptions({width:el.clientWidth,height:el.clientHeight})).observe(el);
  chart.subscribeCrosshairMove(e=>{const d=e.seriesData&&e.seriesData.get(series); legend(d||candles[candles.length-1]);});
  legend(candles[candles.length-1]);
  setInterval(()=>{const c=$('#clock'); if(c) c.textContent=new Date().toISOString().slice(11,19)+' UTC';},1000);
  const tfs=['1m','5m','15m','1h','4h','1D','1W']; $('#tfBtn').dataset.menu='1'; $('#tfBtn').onclick=e=>{ if($('.o-menu')) return $$('.o-menu').forEach(m=>m.remove()); menu(e.currentTarget,'<div class="h">Interval</div>'+tfs.map(x=>`<button class="i${x==='1h'?' on':''}" data-tf="${x}">${x}</button>`).join(''),true,$('#chartShell')); $$('.o-menu [data-tf]').forEach(b=>b.onclick=()=>{$('#tfBtn').textContent=b.dataset.tf; $$('.o-menu').forEach(m=>m.remove()); legend(candles[candles.length-1]);}); };
  $$('[data-rng]',tv).forEach(b=>b.onclick=()=>{ $$('[data-rng]',tv).forEach(x=>x.classList.remove('on')); b.classList.add('on'); const n={'3m':240,'1m':240,'5d':120,'1d':24}[b.dataset.rng]; chart.timeScale().setVisibleLogicalRange({from:candles.length-n,to:candles.length+3}); });
  $$('[data-ccy]',tv).forEach(b=>b.onclick=()=>{ $$('[data-ccy]',tv).forEach(x=>{x.classList.toggle('on',x===b); x.classList.toggle('dim',x!==b);}); window.chartCcy=b.dataset.ccy; chart.applyOptions({localization:{priceFormatter:v=>window.chartCcy==='ETH'?fmtPrice(v/ETH):fmtPrice(v)}}); legend(candles[candles.length-1]); });
  $$('[data-mode]',tv).forEach(b=>b.onclick=()=>{ $$('[data-mode]',tv).forEach(x=>{x.classList.toggle('on',x===b); x.classList.toggle('dim',x!==b);}); window.chartMode=b.dataset.mode; chart.applyOptions({localization:{priceFormatter:v=>window.chartMode==='mc'?fmtUsd(v*SUP):fmtPrice(v)}}); });
  $('#fsBtn').onclick=()=>{ const sh=$('#chartShell'); const fs=sh.dataset.fullscreen==='true'; sh.dataset.fullscreen=fs?'false':'true'; sh.style.cssText=fs?'':'position:fixed;inset:0;z-index:100;height:100dvh'; chart.applyOptions({width:el.clientWidth,height:el.clientHeight}); };
}
function legend(d){ const lg=$('#lg'); if(!lg||!d) return; const ch=(d.close-d.open)/d.open*100; const f=v=>window.chartCcy==='ETH'?fmtPrice(v/ETH):fmtPrice(v); const v=vols.find(x=>x.time===d.time); const cls=ch>=0?'u':'d';
  lg.innerHTML=`<span>MOGCAT/ETH · ${$('#tfBtn')?$('#tfBtn').textContent:'1h'} · Inkypump</span><span class="o">O</span><span class="${cls}">${f(d.open)}</span><span class="o">H</span><span class="${cls}">${f(d.high)}</span><span class="o">L</span><span class="${cls}">${f(d.low)}</span><span class="o">C</span><span class="${cls}">${f(d.close)}</span> <span class="${cls}">${(ch>=0?'+':'')+(d.close-d.open>=0?'':'')}${f(Math.abs(d.close-d.open))} (${ch>=0?'+':'−'}${Math.abs(ch).toFixed(2)}%)</span><span class="vol">Volume <b>${v?fmtAmt(v.value):'—'}</b></span><span class="col">${ic('up','size-3')}</span>`; }
function chartTick(px){ if(!series) return; const last=candles[candles.length-1]; last.close=px; last.high=Math.max(last.high,px); last.low=Math.min(last.low,px); series.update(last); legend(last); }

/* ---------- swap card ---------- */
function initSwap(){
  const amt=$('#amtIn'); if(!amt) return;
  amt.value='0.1'; window.balIn=0.842; window.balOut=2104320;
  $('#balIn').textContent='Balance: '+(W.connected?'0.842':'0'); $('#balOut').textContent='Balance: '+(W.connected?'2,104,320':'0');
  amt.addEventListener('input',updSwap);
  $$('[data-q]').forEach(b=>b.onclick=()=>{ if(!W.connected) return openConnect(); const max=window.swapSide==='buy'?0.842:2104320; const q=b.dataset.q; amt.value=q==='MAX'?String(max):String(+(max*parseInt(q)/100).toFixed(window.swapSide==='buy'?4:0)); updSwap(); });
  $('#flip').onclick=()=>{ window.swapSide=window.swapSide==='buy'?'sell':'buy'; const a=$('#assetIn'),b=$('#assetOut'); const av1=$('[data-av]',a), av2=$('[data-av]',b); const n1=$('.text-\\[16px\\]',a), n2=$('.text-\\[16px\\]',b);
    const i1=av1.querySelector('img'), i2=av2.querySelector('img'); const s1=i1?i1.src:'', s2=i2?i2.src:''; const l1=av1.querySelector('span').textContent, l2=av2.querySelector('span').textContent; setAv(av1,s2,l2); setAv(av2,s1,l1); const t1=n1.textContent; n1.textContent=n2.textContent; n2.textContent=t1;
    const bi=$('#balIn').textContent, bo=$('#balOut').textContent; $('#balIn').textContent=bo; $('#balOut').textContent=bi; amt.value=window.swapSide==='buy'?'0.1':'1000000'; renderWallet(); updSwap(); };
  $('#detBtn').onclick=()=>{ const o=$('#detBtn').getAttribute('aria-expanded')==='true'; $('#detBtn').setAttribute('aria-expanded',String(!o)); const b=$('#detBody'); b.classList.toggle('grid-rows-[0fr]',o); b.classList.toggle('opacity-0',o); b.classList.toggle('grid-rows-[1fr]',!o); b.classList.toggle('opacity-100',!o); const ch=$('#detBtn svg.lucide-chevron-down'); if(ch) ch.style.transform=o?'':'rotate(180deg)'; };
  const sa=$('#slipAuto'); if(sa) sa.onclick=()=>{ $('#slip').value='1'; toast('Slippage set to auto (1%)'); };
  $('#cta').onclick=()=>{ if(!W.connected) return openConnect(); const v=parseFloat(amt.value)||0; if(!v) return toast('Enter an amount','x'); toast((window.swapSide==='buy'?'Bought ':'Sold ')+$('#amtOut').value+(window.swapSide==='buy'?' MOGCAT':' ETH')+' · tx sent'); };
  updSwap();
}
function updSwap(){ const amt=$('#amtIn'); if(!amt) return; const v=parseFloat(String(amt.value).replace(/,/g,''))||0; const out=$('#amtOut');
  if(window.swapSide==='buy'){ const o=v*0.98/(price/ETH); out.value=v?Math.round(o).toLocaleString():''; $('#usdIn').textContent='$'+(v*ETH).toFixed(2); $('#usdOut').textContent='$'+(o*price).toFixed(2); $('#d_minr').textContent=Math.round(o*(1-parseFloat($('#slip').value||1)/100)).toLocaleString()+' MOGCAT'; $('#d_fee').textContent='2.00% · '+(v*0.02).toFixed(4)+' ETH'; }
  else { const o=v*price/ETH*0.98; out.value=v?o.toFixed(4):''; $('#usdIn').textContent='$'+(v*price).toFixed(2); $('#usdOut').textContent='$'+(o*ETH).toFixed(2); $('#d_minr').textContent=(o*(1-parseFloat($('#slip').value||1)/100)).toFixed(4)+' ETH'; $('#d_fee').textContent='2.00% · '+(o/0.98*0.02).toFixed(5)+' ETH'; }
  $('#d_impact').textContent=(0.1+v*(window.swapSide==='buy'?3.2:0.0000012)).toFixed(2)+'%'; }
function openSwapSheet(side){ const card=$('#swapcard').cloneNode(true); card.querySelectorAll('[id]').forEach(e=>e.id='m_'+e.id); const ov=sheet(''); ov.querySelector('.sb').appendChild(card); if(side!==window.swapSide) $('#flip').click();
  const amt=$('#m_amtIn',card), out=$('#m_amtOut',card); const sync=()=>{ $('#amtIn').value=amt.value; updSwap(); out.value=$('#amtOut').value; $('#m_usdIn',card).textContent=$('#usdIn').textContent; $('#m_usdOut',card).textContent=$('#usdOut').textContent; $('#m_d_minr',card).textContent=$('#d_minr').textContent; $('#m_d_fee',card).textContent=$('#d_fee').textContent; $('#m_cta',card).textContent=$('#cta').textContent; };
  amt.addEventListener('input',sync); $$('[data-q]',card).forEach(b=>b.onclick=()=>{ $(`#swapcard [data-q="${b.dataset.q}"]`).click(); amt.value=$('#amtIn').value; sync(); }); $('#m_flip',card).onclick=()=>{ $('#flip').click(); ov.remove(); openSwapSheet(window.swapSide); };
  $('#m_detBtn',card).onclick=()=>{ $('#detBtn').click(); const b=$('#m_detBody',card), o=$('#detBody').classList.contains('grid-rows-[1fr]'); b.classList.toggle('grid-rows-[0fr]',!o); b.classList.toggle('opacity-0',!o); b.classList.toggle('grid-rows-[1fr]',o); b.classList.toggle('opacity-100',o); };
  $('#m_cta',card).onclick=()=>{ $('#amtIn').value=amt.value; $('#cta').click(); if(W.connected) ov.remove(); }; sync(); }

/* ======================= HOME PAGE ======================= */
function initHome(){
  // "New" chips
  const nc=$('#newchips'); if(nc){ const tpl=$('[data-tpl="chip"]',nc); tpl.remove(); [...TOK].sort((a,b)=>ageMin(a.age)-ageMin(b.age)).slice(0,8).forEach(x=>{ const c=tpl.cloneNode(true); c.removeAttribute('data-tpl'); setAv($('.bg-avatar-gradient',c),x.img,x.t[0]); $('.block.truncate',c).textContent=x.t; c.querySelector('button').onclick=()=>location.href='token.html'; nc.appendChild(c); }); }
  // stock stack in the hero paragraph
  const stack=$('#stack'); if(stack){ const tpl=$('[data-tpl="stk"]',stack); tpl.remove(); STOCKS.slice(0,6).forEach(s=>{ const c=tpl.cloneNode(true); c.removeAttribute('data-tpl'); const av=$('[data-f="av"]',c); av.src=STOCK_IMG(s[0]); av.alt=s[1]; c.title=s[1]+' · '+s[0]; c.querySelector('span.block').setAttribute('aria-label',s[1]); stack.appendChild(c); }); }
  // trending
  const tr=$('#trend'); if(tr){ const a=$('[data-tpl="trendTop"]',tr), b=$('[data-tpl="trendPlain"]',tr); a.remove(); b.remove(); [...TOK].sort((x,y)=>y.vol-x.vol).slice(0,5).forEach((x,i)=>{ const c=(i<3?a:b).cloneNode(true); c.removeAttribute('data-tpl'); if(i<3){ const col=['warning','text-secondary','burn'][i]; const rk=c.querySelector('span[aria-label^="Rank"]'); rk.setAttribute('aria-label','Rank '+(i+1)); rk.className='relative z-10 inline-flex shrink-0 items-center justify-center border font-mono font-bold tabular-nums size-8 rounded-lg border-'+col+'/50 bg-'+col+'/10 text-'+col; rk.querySelector('svg').outerHTML=ic(i?'medal':'crown','size-4'); const n=rk.querySelector('span'); n.textContent=i+1; n.className='absolute -bottom-1.5 -right-1.5 grid size-5 place-items-center rounded-full border bg-bg-card text-[11px] leading-none border-'+col+'/60 text-'+col; } else c.querySelector('span[aria-label^="Rank"]').textContent=i+1;
    setAv($('.bg-avatar-gradient',c),x.img,x.t[0]); const names=c.querySelectorAll('.items-baseline span'); names[0].textContent=x.n; names[1].textContent=x.t; const meta=c.querySelector('.mt-1.flex'); meta.innerHTML='<span>ETH</span><span> · '+ageStr(x.age)+'</span>'; const rt=c.querySelector('.text-right'); rt.querySelector('.truncate.text-sm').textContent=fmtUsd(x.mc); rt.querySelector('.font-medium').textContent=fmtUsd(x.vol); c.onclick=()=>location.href='token.html'; tr.appendChild(c); }); }
  // feed
  const rows=$('#rows'); if(!rows) return; const tpl=$('[data-tpl="row"]',rows); tpl.remove(); const mr=$('#mrows'), mtpl=$('[data-tpl="mrow"]',mr); mtpl.remove();
  let fil='all', sortK='trend', shown=12;
  function render(){ let list=[...TOK]; if(fil==='new') list=list.filter(x=>ageMin(x.age)<=60); if(fil==='multi') list=list.filter(x=>x.basket.length>1);
    list.sort(sortK==='vol'?(a,b)=>b.vol-a.vol:sortK==='new'?(a,b)=>ageMin(a.age)-ageMin(b.age):sortK==='liq'?(a,b)=>b.liq-a.liq:(a,b)=>b.c1-a.c1);
    $$('#rows > .group, #mrows > div').forEach(e=>e.remove());
    list.slice(0,shown).forEach((x,i)=>{ const r=tpl.cloneNode(true); r.removeAttribute('data-tpl'); r.style.animationDelay=(i*30)+'ms'; setAv($('.bg-avatar-gradient',r),x.img,x.t[0]);
      const tk=r.children[0]; const n1=tk.querySelector('.items-center.gap-2'); n1.querySelector('span.truncate').textContent=x.t; const nb=n1.querySelector('button span'); nb.textContent=x.n; const n2=tk.querySelector('.mt-1'); const sp=n2.querySelectorAll(':scope > span'); sp[0].textContent='ETH'; sp[2].textContent=ageStr(x.age); const nt=$('[data-f="new"]',r); if(nt) nt.style.display=ageMin(x.age)<=60?'':'none';
      const cells=[...r.children].slice(1,7); const put=(c,a,b)=>{const d=c.querySelectorAll('div'); d[0].textContent=a; if(d[1]) d[1].textContent=b;};
      put(cells[0],fmtUsd(x.mc),(x.mc/ETH).toFixed(1)+' ETH'); put(cells[1],fmtUsd(x.liq),(x.liq/ETH).toFixed(2)+' ETH'); put(cells[2],fmtUsd(x.vol),(x.vol/ETH).toFixed(2)+' ETH'); put(cells[3],fmtUsd(x.rew24),x.basket.join(' · ')); cells[3].querySelector('div').classList.add('text-success'); put(cells[4],x.h.toLocaleString()); put(cells[5],'$'+fmtPrice(x.px),fmtPrice(x.px/ETH)+' ETH');
      r.onclick=()=>location.href='token.html'; r.querySelector('button.inline-flex.h-8').onclick=e=>{e.stopPropagation(); location.href='token.html';}; rows.appendChild(r);
      const m=mtpl.cloneNode(true); m.removeAttribute('data-tpl'); const f=k=>m.querySelector('[data-f="'+k+'"]'); setAv(f('av').parentElement,x.img,x.t[0]); f('sym').textContent=x.t; f('name').textContent=x.n; f('age').textContent=ageStr(x.age); f('vol').outerHTML=ageMin(x.age)<=60?'<span class="inline-flex items-center gap-1.5 h-5 shrink-0 rounded-full border-0 px-2 text-[11px] font-semibold leading-none bg-accent/10 text-accent">NEW</span>':''; f('mc').textContent=fmtUsd(x.mc); f('chg').innerHTML='<span class="text-text-muted">Liq </span><span class="text-text-primary">'+fmtUsd(x.liq)+'</span><span class="text-text-muted"> · Vol 24h </span><span class="text-text-primary">'+fmtUsd(x.vol)+'</span>'; f('chg').className='mt-1 text-xs tabular-nums whitespace-nowrap'; m.onclick=()=>location.href='token.html'; mr.appendChild(m); });
    const lm=$('#loadmore'); if(lm) lm.style.display=list.length>shown?'':'none'; }
  render();
  $$('[data-filter]').forEach(b=>b.onclick=()=>{ $$('[data-filter]').forEach(x=>{x.className=x.className.replace(/ text-text-primary| text-text-muted hover:text-text-secondary/g,'')+(x===b?' text-text-primary':' text-text-muted hover:text-text-secondary');}); fil=b.dataset.filter; shown=12; render(); });
  $$('[data-sort]').forEach(b=>b.onclick=()=>{ $$('[data-sort]').forEach(x=>{ x.className=x.className.replace(/ bg-accent text-accent-ink| text-text-secondary hover:text-text-primary/g,'')+(x===b?' bg-accent text-accent-ink':' text-text-secondary hover:text-text-primary'); }); sortK=b.dataset.sort; render(); });
  $$('[data-sort]').forEach((x,i)=>{ x.className=x.className.replace(/ bg-accent text-accent-ink| text-text-secondary hover:text-text-primary/g,'')+(i===0?' bg-accent text-accent-ink':' text-text-secondary hover:text-text-primary'); });
  $$('[data-dd="assets"]').forEach(b=>{ b.dataset.menu='1'; b.onclick=()=>{ if($('.o-menu')) return $$('.o-menu').forEach(m=>m.remove()); const opts=['All assets','ETH pairs','NVDAx baskets','SPYx baskets','TSLAx baskets','MSTRx baskets']; menu(b,'<div class="h">Paired / reward asset</div>'+opts.map((o,i)=>`<button class="i${i?'':' on'}" data-o="${o}">${o}</button>`).join('')); $$('.o-menu [data-o]').forEach(m=>m.onclick=()=>{ $$('[data-dd="assets"] span.truncate').forEach(s=>s.textContent=m.dataset.o); $$('.o-menu').forEach(x=>x.remove()); }); }; });
  const lm=$('#loadmore'); if(lm) lm.onclick=()=>{ shown+=12; render(); };
  // sticky filter bar: solid background once it sticks, and feed header offset below it (o1 does both in JS)
  const fb=$('#feed'), main=$('main'); const sync=()=>{ const stuck=fb.getBoundingClientRect().top<=main.getBoundingClientRect().top+1 && main.scrollTop>40; fb.style.backgroundColor=stuck?'var(--color-bg-card)':''; fb.style.borderBottom=stuck?'1px solid var(--color-border-default)':''; main.style.setProperty('--feed-sticky-top',fb.offsetHeight+'px'); }; main.addEventListener('scroll',sync,{passive:true}); addEventListener('resize',sync); sync();
}

/* ---------- boot ---------- */
document.addEventListener('DOMContentLoaded',()=>{ initHeader(); initHistory(); initGeneric(); if($('#tb')) initToken(); if($('#rows')) initHome(); });
