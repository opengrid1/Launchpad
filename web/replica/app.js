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
I.coins='<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><path d="m16.71 13.88.7.71-2.82 2.82"/>';
const DEF_LOGO='/img/t-default.png';
const AVIMG=src=>`<img alt="" class="absolute inset-0 size-full rounded-md object-cover" src="${src||DEF_LOGO}" onerror="this.onerror=null;this.src='${DEF_LOGO}'" loading="lazy" decoding="async">`;
function setAv(span,src,letter){ if(!span) return; span.style.background=''; const l=span.querySelector('span'); if(l&&letter) l.textContent=letter; span.querySelectorAll('img').forEach(i=>i.remove()); span.insertAdjacentHTML('beforeend',AVIMG(src)); }
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const layer=()=>$('#layer')||document.body;
const EXPLORER=(window.INKY&&INKY.explorer)||'https://explorer.inkonchain.com';
const SITE='https://inkypump.fun';
const go=u=>{ location.href=u; };
const errMsg=e=>{ const m=String(e&&(e.shortMessage||e.reason||e.message)||e); if(/user rejected|denied|rejected the request/i.test(m)) return 'Transaction cancelled'; if(/insufficient funds/i.test(m)) return 'Not enough ETH for this transaction'; if(/Connect your wallet/i.test(m)) return m; return m.length>140?m.slice(0,140)+'…':m; };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

/* ---------- toasts ---------- */
function toast(msg,icon='check'){let w=$('.o-toasts'); if(!w){w=document.createElement('div'); w.className='o-toasts'; document.body.appendChild(w);} const t=document.createElement('div'); t.className='o-toast'; t.innerHTML=ic(icon)+'<span>'+esc(msg)+'</span>'; w.appendChild(t); setTimeout(()=>{t.classList.add('out'); setTimeout(()=>t.remove(),300);},icon==='x'?4200:2600);}
async function copyText(v,msg){try{await navigator.clipboard.writeText(v);}catch{} toast(msg||'Copied to clipboard');}

/* ---------- wallet state ---------- */
/* Reown AppKit when the site has a project id (window.inkyWallet from wallet.js), a local demo switch otherwise. */
const DYN=()=>window.inkyWallet&&window.inkyWallet.ready?window.inkyWallet:null;
const DEMO_ADDR='0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b';
const W={get connected(){ const d=DYN(); if(d) return d.connected; try{return localStorage.getItem('wallet')==='1';}catch{return false;} }, set(v){try{localStorage.setItem('wallet',v?'1':'0');}catch{} },
  get address(){ const d=DYN(); return d&&d.address?d.address:(this.connected?DEMO_ADDR:null); }, get short(){ const a=this.address; return a?a.slice(0,6)+'…'+a.slice(-4):''; },
  get onInk(){ const d=DYN(); return !d||!d.chainId||d.chainId===57073; },
  disconnect(){ const d=DYN(); if(d) return d.logout(); W.set(false); } };
window.addEventListener('inky:wallet',()=>{ if(typeof renderWallet==='function') renderWallet(); document.dispatchEvent(new Event('wallet-change')); });
const isAdmin=()=>!!(W.connected&&W.address&&window.INKY&&INKY.admin&&W.address.toLowerCase()===INKY.admin.toLowerCase());

const emptyBox=(t,p,href,cta,sm)=>`<div class="o-empty${sm?' sm':''}"><div class="ic">${ic('rocket')}</div><h2>${t}</h2><p>${p}</p>${href?`<a class="o-btn" href="${href}">${cta}</a>`:''}</div>`;

/* ---------- generic overlay helpers ---------- */
function closeOv(ov){ if(!ov||ov.classList.contains('out')) return; ov.classList.add('out'); setTimeout(()=>ov.remove(),220); }
function closeAll(){ $$('.o-menu').forEach(e=>e.remove()); $$('.o-overlay,.o-sheet-ov,.o-drawer-ov').forEach(closeOv); $$('[aria-expanded="true"]').forEach(b=>{if(!b.closest('aside'))b.setAttribute('aria-expanded','false');}); }
document.addEventListener('click',e=>{ if(!e.target.closest('.o-menu') && !e.target.closest('[data-menu]')) $$('.o-menu').forEach(m=>m.remove()); });
document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeAll(); });
function menu(anchor,html,left,container){ $$('.o-menu').forEach(m=>m.remove()); const m=document.createElement('div'); m.className='o-menu'+(left?' left':''); m.innerHTML=html; if(container){ const cr=container.getBoundingClientRect(), ar=anchor.getBoundingClientRect(); container.style.position='relative'; m.style.top=(ar.bottom-cr.top+6)+'px'; m.style.left=(ar.left-cr.left)+'px'; m.style.right='auto'; container.appendChild(m); } else { anchor.parentElement.style.position='relative'; anchor.parentElement.appendChild(m); } anchor.setAttribute('aria-expanded','true'); return m; }
function dialog(html,cls='',top){ closeAll(); const ov=document.createElement('div'); ov.className='o-overlay'+(top?' top':''); ov.innerHTML='<div class="o-dialog '+cls+'" role="dialog">'+html+'</div>'; ov.addEventListener('click',e=>{if(e.target===ov) closeOv(ov);}); $$('.x',ov).forEach(x=>x.onclick=()=>closeOv(ov)); ov.remove=()=>closeOv(ov); layer().appendChild(ov); return ov; }
function sheet(html,cls=''){ closeAll(); const ov=document.createElement('div'); ov.className='o-sheet-ov'; ov.innerHTML='<div class="o-sheet '+cls+'"><div class="grab"></div><div class="sb">'+html+'</div></div>'; ov.addEventListener('click',e=>{if(e.target===ov) closeOv(ov);}); ov.remove=()=>closeOv(ov); layer().appendChild(ov); return ov; }
const dh=(t,p)=>`<div class="dh"><div><h3>${t}</h3>${p?'<p>'+p+'</p>':''}</div><button class="x" aria-label="Close">${ic('x')}</button></div>`;

/* ---------- product list (brand dropdown + drawer) ---------- */
const PRODUCTS=[['Launchpad','Memecoins that pay holders in stocks','rocket','/',true],['Leaderboard','Top 5 traders paid every 3 days','trophy','/leaderboard'],['Docs','How launches, rewards and fees work','book','/docs/introduction'],['Ink explorer','Verified contracts and transactions','terminal',EXPLORER]];
const prodItems=cls=>PRODUCTS.map(p=>`<button class="${cls}${p[4]?' on':''}" data-go="${p[3]}"><span class="tile">${ic(p[2])}</span><span class="t"><b>${p[0]}${p[4]?'<span class="cur">Current</span>':''}</b><span>${p[1]}</span></span>${p[3].startsWith('http')?ic('chevr','ch'):''}</button>`).join('');
function openDrawer(){ closeAll(); const ov=document.createElement('div'); ov.className='o-drawer-ov'; ov.innerHTML=`<div class="o-drawer"><div class="dh"><b>Menu</b><button class="x" aria-label="Close">${ic('x')}</button></div><div class="db"><div class="h">Developers</div><button class="li" data-go="/docs/direct-integration">${ic('code')}Developers</button><button class="li" data-go="/docs/production-contracts">${ic('shield')}Contract addresses</button><div class="d"></div><div class="h">Products</div>${prodItems('pi')}</div></div>`; ov.addEventListener('click',e=>{ if(e.target===ov) closeOv(ov); }); ov.querySelector('.x').onclick=()=>closeOv(ov); ov.remove=()=>closeOv(ov); $$('[data-go]',ov).forEach(b=>b.onclick=()=>{ const g=b.dataset.go; g.startsWith('http')?window.open(g,'_blank'):go(g); }); layer().appendChild(ov); return ov; }

/* ---------- header ---------- */
function initHeader(){
  $$('[data-href]').forEach(b=>b.addEventListener('click',e=>{e.preventDefault(); const h=b.dataset.href; if(h==='#search') return openSearch(); if(h.startsWith('#')){const t=$(h); if(t) t.scrollIntoView({behavior:'smooth'}); return;} go(h);}));
  const brand=$('header button[aria-label="Launchpad"]'); if(brand){brand.dataset.menu='1'; brand.onclick=()=>{ if($('.o-menu')) return $$('.o-menu').forEach(m=>m.remove()); const m=menu(brand,prodItems('pi'),true); m.classList.add('prod'); wire(); }; }
  const dev=$('header button[aria-label="Developers"]'); if(dev){dev.dataset.menu='1'; dev.onclick=()=>{ if($('.o-menu')) return $$('.o-menu').forEach(m=>m.remove()); menu(dev,`<div class="h">Developers</div><button class="i" data-go="/docs/production-contracts">${ic('code')}Contract addresses</button><button class="i" data-go="/docs/direct-integration">${ic('book')}Integrate the hook</button>`); wire(); }; }
  const lang=$('header button[aria-label^="Language"]'); if(lang){ lang.dataset.menu='1'; lang.onclick=()=>{ const ch=lang.querySelector('svg.lucide-chevron-down'); if($('.o-menu')){ $$('.o-menu').forEach(m=>m.remove()); if(ch) ch.style.transform=''; return; } if(ch) ch.style.transform='rotate(180deg)'; const m=menu(lang,LANGS.map(([c,n])=>`<button class="i${c===LANG?' on':''}" data-lang="${c}" role="option">${n}${c===LANG?'<span class="r">'+ic('check')+'</span>':''}</button>`).join('')); m.classList.add('lang'); if(innerWidth<768){ const r=lang.getBoundingClientRect(); m.style.left=Math.min(r.left,innerWidth-187-8)+'px'; } $$('[data-lang]',m).forEach(b=>b.onclick=()=>{ setLang(b.dataset.lang); $$('.o-menu').forEach(x=>x.remove()); if(ch) ch.style.transform=''; }); }; document.addEventListener('click',e=>{ if(!$('.o-menu')){ const ch=lang.querySelector('svg.lucide-chevron-down'); if(ch) ch.style.transform=''; } }); }
  $$('header button[aria-label="Search"], header button.flex.h-9.w-full').forEach(b=>b.onclick=openSearch);
  addEventListener('keydown',e=>{ if(e.key==='/' && !['INPUT','TEXTAREA'].includes(document.activeElement.tagName)){e.preventDefault(); openSearch();}});
  renderWallet();
  const ham=$('header button[aria-label="Menu"], header button:has(.lucide-menu)'); if(ham) ham.onclick=openDrawer;
  function wire(){ $$('.o-menu [data-go]').forEach(b=>b.onclick=()=>{ const g=b.dataset.go; g.startsWith('http')?window.open(g,'_blank'):go(g); }); }
}
function renderWallet(){
  const pill=$('header .relative.flex.h-9.shrink-0.items-stretch'); if(!pill) return;
  const btn=pill.querySelector('button');
  if(W.connected){ btn.innerHTML=`<span class="o-wpill"><span class="wav">${window.walletAvatar?walletAvatar(W.address,18):''}</span><span class="font-mono font-medium">${W.short}</span></span>`; btn.dataset.menu='1'; btn.onclick=()=>{ if($('.o-menu')) return $$('.o-menu').forEach(m=>m.remove()); menu(btn,`<div class="h wh"><span class="wav lg">${window.walletAvatar?walletAvatar(W.address,30):''}</span>${W.short}</div><button class="i" data-act="copy">${ic('copy')}Copy address</button><button class="i" data-act="portfolio">${ic('user')}Profile</button>${isAdmin()?`<button class="i" data-act="admin">${ic('shield')}Operator</button>`:''}<button class="i" data-act="explorer">${ic('globe')}View on explorer<span class="r">${ic('ext','size-3')}</span></button><div class="d"></div><button class="i" data-act="out">${ic('logout')}Disconnect</button>`); $$('.o-menu [data-act]').forEach(b=>b.onclick=()=>{const a=b.dataset.act; if(a==='copy') copyText(W.address,'Address copied'); if(a==='portfolio') go('/profile'); if(a==='admin') go('/admin'); if(a==='explorer') window.open(EXPLORER+'/address/'+W.address,'_blank'); if(a==='out'){W.disconnect(); if(!DYN()){ renderWallet(); document.dispatchEvent(new Event('wallet-change')); }} }); }; }
  else { btn.innerHTML='<span class="hidden sm:inline">Connect Wallet</span><span class="sm:hidden">Connect</span>'; btn.onclick=openConnect; }
  const chain=pill.querySelectorAll('button')[1]; if(chain) chain.onclick=()=>{ const d=DYN(); const wrong=d&&d.connected&&!W.onInk; const ov=dialog(dh('Network',wrong?'Your wallet is on another network':'Tokens on this launchpad live on Ink')+`<div class="db"><button class="opt on" id="swInk"><span class="ic" style="overflow:hidden"><img src="/img/ink.png" alt="Ink" style="width:100%;height:100%"></span><span>Ink<small>Chain 57073 · 1s blocks</small></span><span class="r">${wrong?'Switch':ic('check')}</span></button></div>`); if(wrong) $('#swInk',ov).onclick=async()=>{ try{ await d.switchToInk(); ov.remove(); }catch(e){ toast(errMsg(e),'x'); } }; };
  if(typeof swapCta==='function') swapCta();
  const pos=$('#pos'); if(pos) pos.classList.toggle('hidden',!W.connected);
}
function openConnect(){
  const d=DYN(); if(d){ d.open(); return; }
  if(window.INKY&&INKY.reownProjectId){ toast('Wallet is still loading, try again in a second'); return; }
  const wallets=[['MetaMask','#f6851b','M','Browser extension'],['Rabby','#8697ff','R','Browser extension'],['WalletConnect','#3b99fc','W','Scan with your phone'],['Coinbase Wallet','#1652f0','C','Browser extension']];
  const ov=dialog(dh('Connect wallet','Connect to Ink (chain 57073) to trade and claim rewards')+'<div class="db">'+wallets.map(w=>`<button class="opt" data-w="${w[0]}"><span class="ic" style="background:${w[1]}">${w[2]}</span><span>${w[0]}<small>${w[3]}</small></span></button>`).join('')+'</div><div class="foot">By connecting you agree to the <a href="/docs/introduction#terms">terms</a>. Demo build: the connection is simulated.</div>');
  $$('[data-w]',ov).forEach(b=>b.onclick=()=>{ b.innerHTML=`<span class="ic" style="background:var(--color-bg-elevated)">…</span><span>Connecting to ${b.dataset.w}<small>Approve in your wallet</small></span>`; setTimeout(()=>{W.set(true); ov.remove(); renderWallet(); document.dispatchEvent(new Event('wallet-change')); toast('Connected '+W.short);},900); });
}
function openSearch(){
  const inner=`<div class="o-search">${ic('search')}<input id="sq" placeholder="Search by name, symbol, or address" autocomplete="off"><kbd>ESC</kbd></div><div class="db" id="sres" style="padding-top:8px"></div>`;
  const ov=innerWidth<768?sheet(inner,'search'):dialog(inner,'wide',true);
  const inp=$('#sq',ov), res=$('#sres',ov);
  const render=q=>{ q=q.trim().toLowerCase(); if(!TOK.length){ res.innerHTML=emptyBox('No tokens yet','The first launch will show up here.','/launch','Launch a token',true); return; } let list=TOK.filter(x=>!q||x.n.toLowerCase().includes(q)||x.t.toLowerCase().includes(q)||x.addr.includes(q)); list=[...list].sort((a,b)=>b.vol-a.vol); res.innerHTML=(q?'':'<div class="h" style="padding:6px 12px;font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--color-text-muted)">Trending</div>')+list.slice(0,8).map(x=>`<button class="opt" data-go="${tokenUrl(x)}"><span class="ic" style="background:var(--color-bg-input);overflow:hidden"><img src="${x.img||DEF_LOGO}" alt="" style="width:100%;height:100%;object-fit:cover"></span><span>${esc(x.n)}<small>${esc(x.t)} · ${x.pair} · ${ageStr(x.age)}</small></span><span class="r">${fmtUsd(x.mc)}</span></button>`).join('')||'<p class="py-6 text-center text-sm text-text-muted">No tokens match.</p>'; $$('[data-go]',res).forEach(b=>b.onclick=()=>go(b.dataset.go)); };
  inp.oninput=()=>render(inp.value); render(''); setTimeout(()=>inp.focus(),30);
}

/* ---------- history chips (sub bar) ---------- */
const tokenFromUrl=()=>{ const m=location.pathname.match(/\/token\/(0x[0-9a-fA-F]{40})/)||location.search.match(/[?&]t=(0x[0-9a-fA-F]{40})/); return m?m[1].toLowerCase():null; };
function initHistory(){
  const h=$('#hist'); if(!h) return; const tpl=$('[data-tpl="chip"]',h); tpl.remove();
  let hist; try{hist=JSON.parse(localStorage.getItem('hist2')||'null');}catch{} if(!Array.isArray(hist)) hist=[];
  const cur=tokenFromUrl(); if(cur&&TOK.find(x=>x.addr===cur)){ hist=[cur,...hist.filter(x=>x!==cur)].slice(0,8); try{localStorage.setItem('hist2',JSON.stringify(hist));}catch{} }
  hist=hist.filter(a=>TOK.find(x=>x.addr===a));
  if(!hist.length){ const bar=h.closest('div.border-b')||h.parentElement; if(bar) bar.style.display='none'; return; }
  hist.forEach(a=>{ const x=TOK.find(t=>t.addr===a); const c=tpl.cloneNode(true); c.removeAttribute('data-tpl'); setAv($('.bg-avatar-gradient',c),x.img,x.t[0]); $('.block.truncate',c).textContent=x.t; c.querySelectorAll('button')[0].onclick=()=>go(tokenUrl(x)); const rm=c.querySelectorAll('button')[1]; if(rm){rm.setAttribute('aria-label','Remove '+x.t+' from history'); rm.onclick=e=>{e.stopPropagation(); c.remove(); hist=hist.filter(s=>s!==a); try{localStorage.setItem('hist2',JSON.stringify(hist));}catch{} };} h.appendChild(c); });
}

/* ---------- shared: copy buttons / toasts ---------- */
function initGeneric(){
  $$('[data-copy]').forEach(b=>b.addEventListener('click',()=>{ if(b.dataset.copy) copyText(b.dataset.copy,b.dataset.toast||'Address copied'); }));
  $$('[data-toast]:not([data-copy])').forEach(b=>b.addEventListener('click',()=>toast(b.dataset.toast)));
  const w=$('#warn'); if(w){ const b=w.querySelector('button'), sp=w.querySelector('span.min-w-0'), ch=w.querySelector('svg.lucide-chevron-down'); b.onclick=()=>{ const o=b.getAttribute('aria-expanded')==='true'; b.setAttribute('aria-expanded',String(!o)); sp.classList.toggle('truncate',o); ch.style.transform=o?'':'rotate(180deg)'; }; }
}

/* ======================= TOKEN PAGE ======================= */
let X=null, price=0; window.swapSide='buy';
const SUP=1e9;
const fmtDate=ts=>new Date(ts*1000).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
const inPair=(v,x)=>(x||X).pair==='ETH'?fmtEth(v):fmtAmt(v)+' '+(x||X).pair;
function initToken(){
  const addr=tokenFromUrl(); X=addr?TOK.find(x=>x.addr===addr)||(window.CHAIN&&CHAIN.token(addr)):null;
  if(!X){ const m=$('main'); m.innerHTML='<div class="mx-auto w-full max-w-[1600px] px-4 py-8 sm:px-8">'+(TOK.length||addr?emptyBox('Token not found','No token with that address was launched on Inkypump.','/','Back to the feed'):emptyBox('Coming soon','Inkypump is launching on Ink. Token pages open with the first launch.','/docs/introduction','How it works'))+'</div>'; $('#mbar')&&$('#mbar').remove(); return; }
  price=X.px; document.title=`${X.t} $${fmtPrice(X.px)} | Inkypump`;
  // hero
  setAv($('#hAv'),X.img,X.t[0]); $('#hName').textContent=X.n; $('#hSym').textContent=X.t; $$('.hAddrT').forEach(e=>e.textContent=shortAddr(X.addr)); $$('.hAddr').forEach(e=>e.dataset.copy=cs(X.addr)); $('#hShare').dataset.copy=SITE+tokenUrl(X);
  const tags=$('#tags'); const base=tags.children[0]; { const pa=$('.bg-avatar-gradient',base); setAv(pa,pairImg(X.pair),X.pair[0]); const inner=base.querySelector('span.inline-flex'); inner.lastChild.textContent=X.pair; base.title='Paired asset: '+X.pair+' on Uniswap V4'; }
  if(X.rewards){ (X.basket.length?X.basket:[X.pair]).forEach(s=>{ const c=base.cloneNode(true); setAv($('.bg-avatar-gradient',c),pairImg(s),s[0]); c.title='Holders are paid in '+(STOCK_NAME[s]||s)+' ('+s+')'; const inner=c.querySelector('span.inline-flex'); inner.lastChild.textContent=s; tags.insertBefore(c,tags.lastElementChild); }); }
  else { const c=base.cloneNode(true); c.querySelector('.bg-avatar-gradient').remove(); c.title='Holder rewards are off: the creator earns 1.2% of every trade'; const inner=c.querySelector('span.inline-flex'); inner.lastChild.textContent='No holder rewards'; tags.insertBefore(c,tags.lastElementChild); }
  const rb=$('#rewBasket'); if(rb){ (X.rewards?(X.basket.length?X.basket:[X.pair]):[]).forEach(s=>{ const c=base.cloneNode(true); setAv($('.bg-avatar-gradient',c),pairImg(s),s[0]); c.querySelector('span.inline-flex').lastChild.textContent=(STOCK_NAME[s]||s)+' · '+s; rb.appendChild(c); }); }
  // description + links under the hero
  const hero=$('#hName').closest('.flex.items-start'); if(hero&&(X.desc||X.links.web||X.links.x||X.links.tg)){ const lk=[['web',X.links.web,'globe'],['x',X.links.x,'ext'],['tg',X.links.tg,'ext']].filter(l=>l[1]&&/^https?:\/\//.test(l[1])).map(l=>`<a class="inline-flex items-center gap-1 text-text-muted hover:text-accent" href="${esc(l[1])}" target="_blank" rel="noopener noreferrer nofollow">${ic(l[2],'size-3.5')}${l[0]==='web'?'Website':l[0]==='x'?'X':'Telegram'}</a>`).join(''); hero.insertAdjacentHTML('afterend',`<div class="mt-3 max-w-[720px] text-[13px] leading-relaxed text-text-secondary">${esc(X.desc)}${lk?'<div class="mt-2 flex flex-wrap gap-4 text-xs font-medium">'+lk+'</div>':''}</div>`); }
  // stats
  const st=$$('[data-stat]');
  const s4=st[4].querySelector('.font-mono'); if(s4) s4.remove(); const s5=st[5].querySelector('.font-mono'); if(s5) s5.remove();
  st[5].querySelector('button')?.addEventListener('click',()=>showTab('hold'));
  paintStats();
  // info
  $('#infoCreator').href=EXPLORER+'/address/'+X.creator; $('#infoCreator span').textContent=shortAddr(X.creator); $('#infoCreatorCopy').dataset.copy=cs(X.creator);
  { const c=$('#infoCreated'); c.firstChild.textContent=fmtDate(X.createdAt); c.querySelector('span').textContent='('+ageStr(X.age)+')'; }
  paintInfo();
  // chart
  initChart();
  // trades
  tradesInit();
  // tabs
  $$('#tabs [data-tab]').forEach(b=>b.onclick=()=>showTab(b.dataset.tab));
  // swap
  initSwap();
  $$('#mbar [data-side]').forEach(b=>b.onclick=()=>openSwapSheet(b.dataset.side));
  $$('[data-sym]').forEach(e=>e.textContent=X.t); const ul=$('#uniLink'); if(ul) ul.href='https://app.uniswap.org/explore/tokens/ink/'+X.addr;
  // operator row (admin wallet only)
  adminBar(); document.addEventListener('wallet-change',adminBar);
  // live refresh
  if(LIVE) setTimeout(tick,6000);
}
/* per-token operator actions: shown under the swap card for the admin wallet only */
async function adminBar(){ $$('#admBar').forEach(e=>e.remove()); if(!X||!isAdmin()||!LIVE||!window.CHAIN) return; const wrap=$('#swapwrap'); if(!wrap) return;
  const owed=await CHAIN.platformOwed(X.addr).catch(()=>0); if(!isAdmin()) return; $$('#admBar').forEach(e=>e.remove());
  const b=document.createElement('div'); b.id='admBar'; b.className='mt-3 rounded-[16px] bg-bg-input px-4 py-3 text-[13px]';
  b.innerHTML=`<div class="flex items-center justify-between text-text-muted"><span class="font-medium">${ic('shield','size-3.5')} Operator</span><span class="font-mono text-xs">${X.hidden?'hidden from the feed':'listed'} · platform owed ${inPair(owed)}</span></div>
  <div class="mt-3 flex flex-wrap gap-1.5"><button class="adm-btn sm" data-adm="hide">${X.hidden?'Unhide':'Hide'}</button><button class="adm-btn sm" data-adm="meta">Metadata</button><button class="adm-btn sm" data-adm="push" ${owed>0?'':'disabled'}>Push platform fees</button><button class="adm-btn sm danger" data-adm="collect">Collect liquidity</button><a class="adm-btn sm" href="/admin">All tools</a></div>`;
  wrap.appendChild(b);
  const run=async(btn,fn,msg)=>{ const t=btn.textContent; btn.disabled=true; btn.textContent='Confirm…'; try{ await fn(); toast(msg); await tickNow(); adminBar(); }catch(e){ toast(errMsg(e),'x'); btn.disabled=false; btn.textContent=t; } };
  $('[data-adm="hide"]',b).onclick=e=>run(e.currentTarget,()=>CHAIN.setHidden(X.addr,!X.hidden),X.hidden?'Token visible again':'Token hidden');
  $('[data-adm="push"]',b).onclick=e=>run(e.currentTarget,()=>CHAIN.pushPlatformFees([X.addr]),'Platform fees pushed');
  $('[data-adm="meta"]',b).onclick=()=>{ const ov=dialog(dh('Metadata override · '+esc(X.t),'JSON with description, image, website, x, telegram. Empty restores the original.')+`<div class="db"><textarea class="adm-in" id="admMetaIn" style="height:150px;padding:10px 12px;font-size:12px">${esc(JSON.stringify({description:X.desc,image:X.img?'(unchanged)':'',website:X.links.web,x:X.links.x,telegram:X.links.tg},null,1))}</textarea><div class="mt-3 flex gap-2"><button class="adm-btn" id="admMetaGo">Save on-chain</button></div></div>`);
    $('#admMetaGo',ov).onclick=async()=>{ let v=$('#admMetaIn',ov).value.trim(); if(v){ try{ const j=JSON.parse(v); if(j.image==='(unchanged)') j.image=X.img; v=JSON.stringify(j); }catch{ return toast('Not valid JSON','x'); } } await run($('#admMetaGo',ov),()=>CHAIN.setMetadata(X.addr,v),'Metadata saved'); ov.remove(); location.reload(); }; };
  $('[data-adm="collect"]',b).onclick=()=>{ const ov=dialog(dh('Collect liquidity · '+esc(X.t),'Pulls part of the launch position (coins and '+X.pair+') out of the pool. Not reversible; it moves the price.')+`<div class="db"><input class="adm-in" id="admColBps" placeholder="share in bps · 10000 = all" inputmode="numeric"><input class="adm-in" id="admColTo" style="margin-top:8px" value="${esc(W.address)}"><div class="mt-3 flex gap-2"><button class="adm-btn danger" id="admColGo">Collect</button></div></div>`);
    $('#admColGo',ov).onclick=async()=>{ const bps=parseInt($('#admColBps',ov).value)||0, to=$('#admColTo',ov).value.trim(); if(bps<1||bps>10000) return toast('Share must be 1 to 10000 bps','x'); if(!CHAIN.isAddress(to)) return toast('Not a valid address','x'); if(!confirm(`Collect ${(bps/100).toFixed(2)}% of the ${X.t} position to ${to}? This cannot be undone.`)) return; await run($('#admColGo',ov),()=>CHAIN.collect(X.addr,bps,to),'Liquidity collected'); ov.remove(); }; };
}
function paintStats(){ const st=$$('[data-stat]'); const setStat=(i,v,s)=>{ const vv=st[i].querySelector('.text-\\[26px\\]'); if(vv) vv.textContent=v; const ss=st[i].querySelector('.font-mono'); if(ss&&s!=null) ss.textContent=s; };
  setStat(0,fmtUsd(X.mc),inPair(X.pxPair*SUP)); setStat(1,'$'+fmtPrice(X.px),fmtPrice(X.pxPair)+' '+X.pair); setStat(2,fmtUsd(X.vol),inPair(X.vol/X.pairUsd)); setStat(3,fmtUsd(X.liq),inPair(X.liqPair)); setStat(4,'1B'); setStat(5,X.h.toLocaleString()); }
function paintInfo(){ const pu=X.pairUsd; const cell=(k,usd,pair)=>{ const c=$(`[data-info="${k}"]`); if(!c) return; const d=c.querySelectorAll('div'); d[1].textContent=fmtUsd(usd); d[2].textContent=pair; };
  const feePair=X.feeUsd/pu; cell('vol',X.volAll,inPair(X.volAll/pu)); cell('cre',X.totalCreatorFees*pu,inPair(X.totalCreatorFees)); cell('hold',X.totalHolderRewards*pu,X.rewards?inPair(X.totalHolderRewards)+(X.basket.length?' → '+X.basket.join(', '):''):'off'); cell('proto',feePair*0.4*pu,inPair(feePair*0.4));
  const disc=$$('[data-disc]'); if(disc.length){ const tr=X._trades||[]; const dev=tr.find(t=>t.wallet===X.creator&&t.buy&&t.ts<=X.createdAt+2); disc[1].textContent='No tokens were sent directly to recipients or placed in a vesting vault at launch. The full fixed supply entered the pool'+(dev?'; the creator bought '+inPair(Number(dev.pair)/1e18)+' in the launch transaction.':'; there was no dev buy.');
    const paid=X.rewards?(X.basket.length?' (paid in '+X.basket.join(', ')+')':' (paid in '+X.pair+')'):''; disc[3].textContent=`The normal hook fee is 2.00%. Fees are always charged in ${X.pair}, the pool's paired asset. Buys use part of the ${X.pair} paid, and sells use part of the ${X.pair} received. It is split ${(X.creatorBps/100).toFixed(2)}% creator, ${(X.holderBps/100).toFixed(2)}% holders${paid} and 40.00% platform, of which an eighth funds the 3-day trader leaderboard.`; }
  const rw=(k,v,s)=>{ const c=$(`[data-rew="${k}"]`); if(!c) return; const d=c.querySelectorAll('div'); d[1].textContent=v; if(s!=null) d[2].textContent=s; };
  rw('all',fmtUsd(X.totalHolderRewards*pu),inPair(X.totalHolderRewards)); rw('day',fmtUsd(X.rew24),inPair(X.rew24/pu)); rw('rate',X.mc>0?fmtUsd(X.rew24/X.mc*1000):'$0.00');
  const rt=$('#rewText'); if(rt) rt.textContent=!X.rewards?'Holder rewards are off for this token. The creator chose to take the full 1.2% share of every trade; the 0.8% platform share is unchanged.':X.basket.length?`Every trade pays ${(X.holderBps*2/10000).toFixed(2)}% in ${X.pair} to holders, pro-rata to balance. On claim the ${X.pair} is swapped on Uniswap into ${X.basket.join(', ')} in equal shares and sent as wrapped stock tokens. Claim as ETH is always available.`:`Every trade pays ${(X.holderBps*2/10000).toFixed(2)}% in ${X.pair} to holders, pro-rata to balance. Rewards are claimed in ${X.pair}; claim as ETH is always available.`; }
function showTab(k){ $$('#tabs [data-tab]').forEach(b=>{ const on=b.dataset.tab===k; b.className=b.className.replace(/ text-text-primary| text-text-muted hover:text-text-secondary/g,'')+(on?' text-text-primary':' text-text-muted hover:text-text-secondary'); });
  $$('#panes [data-pane]').forEach(p=>{ const on=p.dataset.pane===k; if(p.classList.contains('md:hidden')) p.classList.toggle('hidden-i',!on); else { p.classList.toggle('hidden',!on); if(on&&p.classList.contains('md:block')) p.classList.remove('hidden'); } });
  $$('#panes [data-pane="tx"]').forEach(p=>{ if(p.classList.contains('md:block')){ p.classList.toggle('hidden-i',k!=='tx'); p.classList.add('hidden'); } });
  $('#seg').style.display=k==='tx'?'':'none'; $('#loadmore').style.display=k==='tx'?'':'none';
  if(k==='hold') fillHolders(); if(k==='top') fillTop(); if(k==='rew') fillRew(); }
function tdiv(cls,inner){return `<td class="${cls}">${inner}</td>`;}
function cellR(main,sub){return `<span class="block min-w-0 text-right tabular-nums"><span class="block max-w-full truncate font-medium text-text-primary">${main}</span>${sub?`<span class="mt-0.5 block max-w-full truncate text-xs text-text-muted">${sub}</span>`:''}</span>`;}
const wlink=(a,full)=>`<a class="inline-flex min-w-0 items-center gap-1 transition-colors hover:text-accent text-text-primary" href="${EXPLORER}/address/${full||a}" target="_blank" rel="noopener noreferrer"><span class="truncate">${a}</span>${ic('ext','lucide-external-link size-3 shrink-0')}</a>`;
const tagS=t=>`<span class="ml-1.5 inline-flex h-5 items-center rounded-full bg-bg-elevated px-2 text-[11px] font-semibold text-text-secondary">${t}</span>`;
const youTag=w=>W.connected&&W.address&&w===W.address.toLowerCase()?tagS('YOU'):'';
const emptyRow=(n,t)=>`<tr><td colspan="${n}" class="px-4 py-8 text-center text-sm text-text-muted">${t}</td></tr>`;
const PM=((window.INKY&&INKY.contracts&&INKY.contracts.poolManager)||'').toLowerCase();
let holdersLoaded=false, topLoaded=false;
async function fillHolders(){ const tb=$('#tb_hold'); if(!tb||holdersLoaded||!window.CHAIN) return; holdersLoaded=true; tb.innerHTML=emptyRow(6,'Loading holders…');
  let H=await CHAIN.holders(X.addr,50); if(!H.length){ tb.innerHTML=emptyRow(6,'No holders yet.'); holdersLoaded=false; return; }
  H=H.filter(h=>h.bal>=1e-6); const pend=await Promise.all(H.slice(0,25).map(h=>h.wallet===PM?0:CHAIN.pending(X.addr,h.wallet).then(v=>Number(v)/1e18).catch(()=>0)));
  tb.innerHTML=H.map((h,i)=>{ const tag=h.wallet===PM?'Uniswap V4 pool':h.wallet===X.creator?'creator':h.name?h.name:''; return `<tr class="h-[4.5rem] text-text-primary">${tdiv('whitespace-nowrap px-4 py-3 align-middle','<span class="block text-text-muted">'+(i+1)+'</span>')}${tdiv('px-4 py-3 align-middle',wlink(shortAddr(h.wallet),h.wallet)+(tag?tagS(esc(tag)):'')+youTag(h.wallet))}${tdiv('px-4 py-3 align-middle text-right tabular-nums',cellR(fmtAmt(h.bal)+' '+X.t))}${tdiv('px-4 py-3 align-middle text-right tabular-nums',cellR(h.share.toFixed(2)+'%'))}${tdiv('px-4 py-3 align-middle text-right tabular-nums',cellR(fmtUsd(h.bal*X.px),inPair(h.bal*X.pxPair)))}${tdiv('px-4 py-3 align-middle text-right tabular-nums',cellR(h.wallet===PM?'—':i<25?fmtUsd(pend[i]*X.pairUsd):'…',h.wallet===PM?'':i<25&&pend[i]>0?inPair(pend[i]):''))}</tr>`; }).join(''); }
async function fillTop(){ const tb=$('#tb_top'); if(!tb||topLoaded||!window.CHAIN) return; topLoaded=true; const T=await CHAIN.topTraders(X.addr);
  if(!T.length){ tb.innerHTML=emptyRow(6,'No trades yet.'); topLoaded=false; return; }
  tb.innerHTML=T.slice(0,25).map((r,i)=>`<tr class="h-[4.5rem] text-text-primary">${tdiv('whitespace-nowrap px-4 py-3 align-middle',rank(i,true))}${tdiv('px-4 py-3 align-middle',wlink(shortAddr(r.wallet),r.wallet)+(r.wallet===X.creator?tagS('creator'):'')+youTag(r.wallet))}${tdiv('px-4 py-3 align-middle text-right tabular-nums','<span class="block font-medium '+(r.pnl>=0?'text-success':'text-error')+'">'+(r.pnl>=0?'+':'-')+fmtUsd(Math.abs(r.pnl))+'</span>')}${tdiv('px-4 py-3 align-middle text-right tabular-nums',cellR(fmtUsd(r.volume),inPair(r.volume/X.pairUsd)))}${tdiv('px-4 py-3 align-middle text-right tabular-nums',cellR(String(r.trades)))}${tdiv('px-4 py-3 align-middle text-right',cellR(r.holding?'Yes':'No'))}</tr>`).join(''); }
async function fillRew(){ const c=$('[data-rew="you"]'); if(!c) return; const d=c.querySelectorAll('div'); if(!W.connected||!window.CHAIN){ d[1].textContent='—'; d[2].textContent='connect to see'; return; } try{ const p=Number(await CHAIN.pending(X.addr,W.address))/1e18; d[1].textContent=fmtUsd(p*X.pairUsd); d[2].textContent=inPair(p); }catch{ d[1].textContent='—'; } }
function rank(i,small){ const n=i+1; const col=i<3?['warning','text-secondary','burn'][i]:'text-muted'; const box=small?'size-7 rounded-md':'size-8 rounded-lg'; return `<span class="relative z-10 inline-flex shrink-0 items-center justify-center border font-mono font-bold tabular-nums ${box} border-${col}/50 bg-${col}/10 text-${col}">${ic('trophy','size-4')}<span class="absolute -bottom-1.5 -right-1.5 grid size-5 place-items-center rounded-full border bg-bg-card text-[11px] leading-none border-${col}/60 text-${col}">${n}</span></span>`; }

/* ---------- trades table ---------- */
let TR=[], trSeen=new Set(), filter='all', shownTr=40;
function tradeView(t){ const coin=Number(t.coin)/1e18, pair=Number(t.pair)/1e18; const pxPair=CHAIN.tradePrice(t); return {t:t.ts,buy:t.buy,pair,usd:pair*X.pairUsd,amt:coin,pxPair,px:pxPair*X.pairUsd,fee:Number(t.fee)/1e18,mk:t.wallet,tx:t.tx,k:t.tx+':'+t.index}; }
function tradesInit(){ const tb=$('#tb'), tpl=$('[data-tpl="tx"]',tb); tpl.remove(); const mtb=$('#mtb'), mtpl=$('[data-tpl="mtx"]',mtb); mtpl.remove(); window._tpl={tpl,mtpl};
  TR=(X._trades||[]).map(tradeView).reverse(); TR.forEach(x=>trSeen.add(x.k)); renderTrades();
  setInterval(()=>{ const now=Math.floor(Date.now()/1000); $$('[data-ts]').forEach(e=>e.textContent=ago(Math.max(0,now-+e.dataset.ts))+' ago'); },1000);
  const seg=$('#seg'); seg.addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b) return; $$('button',seg).forEach(x=>{ x.className=x.className.replace(' bg-accent text-accent-ink','').replace(' text-text-secondary hover:text-text-primary',''); x.className+= x===b?' bg-accent text-accent-ink':' text-text-secondary hover:text-text-primary'; }); filter=b.dataset.side; applyFilter(); });
  $$('button',seg).forEach((x,i)=>{ const base=x.className.replace(/ bg-accent text-accent-ink| text-text-secondary hover:text-text-primary/g,''); x.className=base+(i===0?' bg-accent text-accent-ink':' text-text-secondary hover:text-text-primary'); });
  $('#loadmore button').onclick=()=>{ shownTr+=40; renderTrades(); }; }
function applyFilter(){ $$('#tb tr,#mtb > div').forEach(r=>r.style.display=(filter==='all'||r.dataset.k===filter)?'':'none'); }
function renderTrades(){ const tb=$('#tb'), mtb=$('#mtb'); tb.innerHTML=''; mtb.innerHTML=''; if(!TR.length){ tb.innerHTML=emptyRow(8,'No trades yet. The first buy shows up here within seconds.'); mtb.innerHTML='<p class="py-6 text-center text-sm text-text-muted">No trades yet.</p>'; $('#loadmore').style.display='none'; return; }
  TR.slice(0,shownTr).forEach(x=>{ tb.appendChild(row(x)); mtb.appendChild(mrow(x)); }); applyFilter(); $('#loadmore').style.display=TR.length>shownTr?'':'none'; }
const agoTxt=x=>ago(Math.max(0,Math.floor(Date.now()/1000)-x.t))+' ago';
function row(x){ const r=window._tpl.tpl.cloneNode(true); r.removeAttribute('data-tpl'); const td=r.children; const tm=td[0].querySelector('span'); tm.textContent=agoTxt(x); tm.dataset.ts=x.t; tm.title=new Date(x.t*1000).toLocaleString();
  const ty=td[1].querySelector('span'); ty.textContent=x.buy?'Buy':'Sell'; ty.className=x.buy?'inline-flex h-6 items-center rounded-md border px-2 text-[11px] font-semibold border-success/20 bg-success-soft text-success':'inline-flex h-6 items-center rounded-md border px-2 text-[11px] font-semibold border-error/20 bg-error/10 text-error';
  const c2=td[2].querySelectorAll('span.block'); c2[1].textContent=fmtPrice(x.pxPair)+' '+X.pair; c2[2].textContent='approx $'+fmtPrice(x.px);
  td[3].querySelector('span.block span').textContent=fmtAmt(x.amt)+' '+X.t;
  const c4=td[4].querySelectorAll('span.block'); c4[1].textContent=inPair(x.pair); c4[2].textContent='approx '+fmtUsd(x.usd);
  td[5].querySelector('span.block span').textContent=inPair(x.fee);
  const a=td[6].querySelector('a'); a.href=EXPLORER+'/address/'+x.mk; a.querySelector('span').textContent=shortAddr(x.mk);
  td[7].querySelector('a').href=EXPLORER+'/tx/'+x.tx; r.dataset.k=x.buy?'buy':'sell'; return r; }
function mrow(x){ const r=window._tpl.mtpl.cloneNode(true); r.removeAttribute('data-tpl'); const f=k=>r.querySelector('[data-f="'+k+'"]'); const sd=f('side'); sd.textContent=x.buy?'Buy':'Sell'; sd.className='mr-1.5 '+(x.buy?'text-success':'text-error'); f('amt').textContent=fmtAmt(x.amt)+' '+X.t; f('time').textContent=agoTxt(x); f('time').dataset.ts=x.t; f('wallet').textContent=x.mk.slice(0,6)+'…'; r.querySelector('a').href=EXPLORER+'/address/'+x.mk; f('px').textContent='$'+fmtPrice(x.px); f('fee').textContent='Fee '+inPair(x.fee); f('usd').textContent='approx '+fmtUsd(x.usd); r.dataset.k=x.buy?'buy':'sell'; return r; }

/* ---------- live refresh ---------- */
let ticking=false;
async function tick(){ if(ticking||document.hidden){ setTimeout(tick,4000); return; } ticking=true;
  try{ const old=price; const nx=await CHAIN.refresh(X.addr); const trades=await CHAIN.trades(X.addr); nx._trades=trades; Object.assign(X,nx); price=X.px; const i=TOK.findIndex(t=>t.addr===X.addr); if(i>=0) TOK[i]=X;
    const fresh=trades.filter(t=>!trSeen.has(t.tx+':'+t.index)); if(fresh.length){ fresh.forEach(t=>trSeen.add(t.tx+':'+t.index)); const v=fresh.map(tradeView).reverse(); TR=[...v,...TR]; const tb=$('#tb'), mtb=$('#mtb'); if(TR.length===v.length) renderTrades(); else { v.slice().reverse().forEach(x=>{ const r=row(x); r.classList.add('o-flash'); tb.insertBefore(r,tb.firstChild); mtb.insertBefore(mrow(x),mtb.firstChild); }); applyFilter(); } holdersLoaded=false; topLoaded=false; }
    paintStats(); paintInfo(); document.title=`${X.t} $${fmtPrice(X.px)} | Inkypump`;
    const st=$$('[data-stat]'); [st[0],st[1]].forEach(s=>{ const e=s.querySelector('.text-\\[26px\\]'); if(!e||price===old) return; e.classList.remove('stat-up','stat-dn'); void e.offsetWidth; e.classList.add(price>=old?'stat-up':'stat-dn'); setTimeout(()=>e.classList.remove('stat-up','stat-dn'),600); });
    if(window.tvTick&&window.tvActive) tvTick(X.pxPair,fresh); if(fresh.length||price!==old){ updSwap(); } if(fresh.length) refreshPosition();
  }catch(e){ console.warn('refresh failed',e); } ticking=false; setTimeout(tick,6000); }

/* ---------- chart ---------- */
function initChart(){ const tv=$('#tv'); if(!tv) return; if(window.TradingView&&window.initTV){ window.tvActive=true; initTV('tv',X); return; } tv.innerHTML='<div class="flex h-full items-center justify-center text-sm text-text-muted">Chart unavailable</div>'; }

/* ---------- swap card ---------- */
let balEth=0, balCoin=0, quoteSeq=0, quoteOut=0n, quoting=false;
function swapCta(){ const c=$('#cta'); if(!c||!X) return; const v=parseFloat(String($('#amtIn').value).replace(/,/g,''))||0; let t, dis=false;
  if(!W.connected) t='Connect Wallet'; else if(!W.onInk) t='Switch to Ink'; else if(!v) { t=(window.swapSide==='buy'?'Buy ':'Sell ')+X.t; dis=true; } else if(window.swapSide==='buy'&&v>balEth) { t='Insufficient ETH'; dis=true; } else if(window.swapSide==='sell'&&v>balCoin*1.0000001) { t='Insufficient '+X.t; dis=true; } else if(quoting) { t='Fetching quote…'; dis=true; } else t=(window.swapSide==='buy'?'Buy ':'Sell ')+X.t;
  if(c.dataset.busy) return; c.textContent=t; c.disabled=dis&&W.connected; const m=$('#m_cta'); if(m){ m.textContent=t; m.disabled=c.disabled; } }
function initSwap(){
  const amt=$('#amtIn'); if(!amt) return; amt.value='';
  $$('[data-av]').forEach(a=>{ if(a.dataset.av==='out') setAv(a,X.img,X.t[0]); else setAv(a,ETH_IMG,'E'); });
  $$('#assetOut .text-\\[16px\\]').forEach(n=>n.textContent=X.t);
  amt.addEventListener('input',()=>updSwap());
  $$('[data-q]').forEach(b=>b.onclick=()=>{ if(!W.connected) return openConnect(); const max=window.swapSide==='buy'?Math.max(0,balEth-0.002):balCoin; const q=b.dataset.q; const v=q==='MAX'?max:max*parseInt(q)/100; amt.value=window.swapSide==='buy'?String(+v.toFixed(6)):String(Math.floor(v)); updSwap(); });
  $('#flip').onclick=()=>{ window.swapSide=window.swapSide==='buy'?'sell':'buy'; const a=$('#assetIn'),b=$('#assetOut'); const av1=$('[data-av]',a), av2=$('[data-av]',b); const n1=$('.text-\\[16px\\]',a), n2=$('.text-\\[16px\\]',b);
    if(window.swapSide==='sell'){ setAv(av1,X.img,X.t[0]); setAv(av2,ETH_IMG,'E'); n1.textContent=X.t; n2.textContent='ETH'; } else { setAv(av1,ETH_IMG,'E'); setAv(av2,X.img,X.t[0]); n1.textContent='ETH'; n2.textContent=X.t; }
    amt.value=''; $('#amtOut').value=''; paintBal(); renderWallet(); updSwap(); };
  $('#detBtn').onclick=()=>{ const o=$('#detBtn').getAttribute('aria-expanded')==='true'; $('#detBtn').setAttribute('aria-expanded',String(!o)); const b=$('#detBody'); b.classList.toggle('grid-rows-[0fr]',o); b.classList.toggle('opacity-0',o); b.classList.toggle('grid-rows-[1fr]',!o); b.classList.toggle('opacity-100',!o); const ch=$('#detBtn svg.lucide-chevron-down'); if(ch) ch.style.transform=o?'':'rotate(180deg)'; };
  const sa=$('#slipAuto'); if(sa) sa.onclick=()=>{ $('#slip').value='1'; toast('Slippage set to auto (1%)'); updSwap(); }; $('#slip').addEventListener('input',()=>updSwap());
  $('#cta').onclick=doSwap;
  $$('#posActs [data-claim]').forEach(b=>b.onclick=()=>doClaim(b.dataset.claim));
  if(/[?&]side=sell/.test(location.search)) $('#flip').click();
  paintBal(); refreshPosition(); updSwap(); document.addEventListener('wallet-change',()=>{ refreshPosition(); updSwap(); });
}
function paintBal(){ const bi=$('#balIn'), bo=$('#balOut'); if(!bi) return; const e='Balance: '+(W.connected?(+balEth.toFixed(5)).toString():'0'), c='Balance: '+(W.connected?fmtAmt(balCoin):'0'); if(window.swapSide==='buy'){ bi.textContent=e; bo.textContent=c; } else { bi.textContent=c; bo.textContent=e; } }
async function refreshPosition(){ const pos=$('#pos'); if(!pos) return; if(!W.connected||!LIVE||!window.CHAIN){ balEth=0; balCoin=0; paintBal(); pos.classList.add('hidden'); return; }
  try{ const u=W.address; const [eb,cb,pend,p]=await Promise.all([CHAIN.ethBalance(u),CHAIN.balance(X.addr,u),CHAIN.pending(X.addr,u),CHAIN.position(X.addr,u)]); balEth=Number(eb)/1e18; balCoin=Number(cb)/1e18; const pendV=Number(pend)/1e18; paintBal(); swapCta();
    pos.classList.remove('hidden'); $('#posBal').textContent=fmtAmt(balCoin)+' '+X.t; $('#posVal').textContent=fmtUsd(balCoin*X.px)+' · '+inPair(balCoin*X.pxPair);
    $('#posAvg').textContent=p.avg>0?'$'+fmtPrice(p.avg*X.pairUsd)+' · '+fmtPrice(p.avg)+' '+X.pair:'—';
    const pnl=$('#posPnl'); if(p.avg>0&&p.units>0){ const held=Math.min(p.units,balCoin); const u=(X.pxPair-p.avg)*held*X.pairUsd; const pc=(X.pxPair/p.avg-1)*100; pnl.textContent=(pc>=0?'+':'')+pc.toFixed(1)+'% · '+(u>=0?'+':'-')+fmtUsd(Math.abs(u)); pnl.className=pc>=0?'text-success':'text-error'; } else { pnl.textContent='—'; pnl.className='text-text-primary'; }
    $('#posPendL').textContent=X.rewards?'Rewards pending':'Holder rewards'; $('#posPend').textContent=X.rewards?fmtUsd(pendV*X.pairUsd)+' · '+inPair(pendV):'off';
    const acts=$('#posActs'); const bb=acts.querySelector('[data-claim="basket"]'), be=acts.querySelector('[data-claim="eth"]'); acts.style.display=X.rewards?'':'none';
    if(X.basket.length){ bb.textContent='Claim basket'; bb.dataset.claim='basket'; be.style.display=''; } else if(X.pair==='ETH'){ bb.textContent='Claim ETH'; bb.dataset.claim='pair'; be.style.display='none'; } else { bb.textContent='Claim '+X.pair; bb.dataset.claim='pair'; be.style.display=''; }
    bb.disabled=be.disabled=!(pendV>0);
  }catch(e){ console.warn('position',e); } }
async function updSwap(){ const amt=$('#amtIn'); if(!amt||!X) return; const v=parseFloat(String(amt.value).replace(/,/g,''))||0; const out=$('#amtOut'); const slip=Math.min(50,Math.max(0.01,parseFloat($('#slip').value)||1));
  if(!v){ out.value=''; $('#usdIn').textContent=''; $('#usdOut').textContent=''; $('#d_minr').textContent='—'; $('#d_fee').textContent='2.00%'; $('#d_impact').textContent='—'; quoteOut=0n; quoting=false; swapCta(); syncSheet(); return; }
  const seq=++quoteSeq; quoting=true; swapCta();
  try{ let o, spot; if(!LIVE||!window.CHAIN){ o=window.swapSide==='buy'?v*0.98/X.pxPair:v*X.pxPair*0.98; spot=o; }
    else if(window.swapSide==='buy'){ const wei=CHAIN.parseEther(v.toFixed(18)); quoteOut=await CHAIN.quoteBuyEth(X.addr,wei); o=Number(quoteOut)/1e18; spot=v*ETH/X.px*0.98; }
    else { const wei=CHAIN.parseEther(Math.min(v,balCoin||v).toFixed(18)); quoteOut=await CHAIN.quoteSellEth(X.addr,wei); o=Number(quoteOut)/1e18; spot=v*X.px/ETH*0.98; }
    if(seq!==quoteSeq) return; quoting=false;
    if(window.swapSide==='buy'){ out.value=o?Math.floor(o).toLocaleString():''; $('#usdIn').textContent='$'+(v*ETH).toFixed(2); $('#usdOut').textContent='$'+(o*X.px).toFixed(2); $('#d_minr').textContent=Math.floor(o*(1-slip/100)).toLocaleString()+' '+X.t; $('#d_fee').textContent='2.00% · '+(v*0.02).toFixed(5)+' ETH'; }
    else { out.value=o?(+o.toFixed(6)).toString():''; $('#usdIn').textContent='$'+(v*X.px).toFixed(2); $('#usdOut').textContent='$'+(o*ETH).toFixed(2); $('#d_minr').textContent=(o*(1-slip/100)).toFixed(6)+' ETH'; $('#d_fee').textContent='2.00% · '+(o/0.98*0.02).toFixed(5)+' ETH'; }
    const imp=spot>0?Math.max(0,(1-o/spot)*100):0; $('#d_impact').textContent=imp.toFixed(2)+'%'; $('#d_impact').className=$('#d_impact').className.replace(/ text-(warning|error)/g,'')+(imp>15?' text-error':imp>5?' text-warning':'');
  }catch(e){ if(seq!==quoteSeq) return; quoting=false; out.value=''; $('#d_impact').textContent='—'; console.warn('quote',e); }
  swapCta(); syncSheet(); }
async function doSwap(){ if(!W.connected) return openConnect(); if(!W.onInk){ try{ await DYN().switchToInk(); }catch(e){ toast(errMsg(e),'x'); } return; } const amt=$('#amtIn'); const v=parseFloat(String(amt.value).replace(/,/g,''))||0; if(!v) return toast('Enter an amount','x'); if(!LIVE||!window.CHAIN) return toast('Trading opens when the contracts are live');
  if(quoting||!(quoteOut>0n)) return toast('Fetching the quote, try again','x'); const slip=Math.min(50,Math.max(0.01,parseFloat($('#slip').value)||1)); const min=quoteOut-quoteOut*BigInt(Math.round(slip*100))/10000n;
  const c=$('#cta'); c.dataset.busy='1'; c.disabled=true; c.textContent='Confirm in wallet…'; const m=$('#m_cta'); if(m){ m.disabled=true; m.textContent='Confirm in wallet…'; }
  try{ let rc; if(window.swapSide==='buy') rc=await CHAIN.buy(X.addr,CHAIN.parseEther(v.toFixed(18)),min); else rc=await CHAIN.sell(X.addr,CHAIN.parseEther(Math.min(v,balCoin).toFixed(18)),min);
    toast((window.swapSide==='buy'?'Bought ':'Sold ')+X.t+' · confirmed'); amt.value=''; $('#amtOut').value=''; quoteOut=0n; delete c.dataset.busy; await tickNow(); }
  catch(e){ delete c.dataset.busy; toast(errMsg(e),'x'); }
  c.disabled=false; swapCta(); updSwap(); }
async function tickNow(){ try{ const nx=await CHAIN.refresh(X.addr); const trades=await CHAIN.trades(X.addr); nx._trades=trades; Object.assign(X,nx); price=X.px; const fresh=trades.filter(t=>!trSeen.has(t.tx+':'+t.index)); fresh.forEach(t=>trSeen.add(t.tx+':'+t.index)); if(fresh.length){ const v=fresh.map(tradeView).reverse(); TR=[...v,...TR]; renderTrades(); holdersLoaded=false; topLoaded=false; } paintStats(); paintInfo(); if(window.tvTick&&window.tvActive) tvTick(X.pxPair,fresh); }catch(e){} await refreshPosition(); }
async function doClaim(mode){ if(!W.connected) return openConnect(); const b=$(`#posActs [data-claim="${mode}"]`); const t=b?b.textContent:''; if(b){ b.disabled=true; b.textContent='Confirm…'; }
  try{ await CHAIN.claim(X.addr,mode); toast('Rewards claimed'+(mode==='basket'?' in '+X.basket.join(', '):mode==='eth'?' as ETH':' in '+X.pair)); await refreshPosition(); fillRew(); }catch(e){ toast(errMsg(e),'x'); } if(b){ b.textContent=t; b.disabled=false; } }
let sheetEl=null;
function syncSheet(){ const card=sheetEl; if(!card||!card.isConnected) return; $('#m_amtOut',card).value=$('#amtOut').value; $('#m_usdIn',card).textContent=$('#usdIn').textContent; $('#m_usdOut',card).textContent=$('#usdOut').textContent; $('#m_d_minr',card).textContent=$('#d_minr').textContent; $('#m_d_fee',card).textContent=$('#d_fee').textContent; $('#m_d_impact',card).textContent=$('#d_impact').textContent; $('#m_balIn',card).textContent=$('#balIn').textContent; $('#m_balOut',card).textContent=$('#balOut').textContent; const mc=$('#m_cta',card); mc.textContent=$('#cta').textContent; mc.disabled=$('#cta').disabled; }
function openSwapSheet(side){ if(side!==window.swapSide) $('#flip').click(); const card=$('#swapcard').cloneNode(true); card.querySelectorAll('[id]').forEach(e=>e.id='m_'+e.id); const ov=sheet(''); ov.querySelector('.sb').appendChild(card); sheetEl=card;
  const amt=$('#m_amtIn',card); amt.value=$('#amtIn').value; amt.addEventListener('input',()=>{ $('#amtIn').value=amt.value; updSwap(); }); $$('[data-q]',card).forEach(b=>b.onclick=()=>{ $(`#swapcard [data-q="${b.dataset.q}"]`).click(); amt.value=$('#amtIn').value; }); $('#m_flip',card).onclick=()=>{ ov.remove(); $('#flip').click(); openSwapSheet(window.swapSide); };
  $('#m_detBtn',card).onclick=()=>{ $('#detBtn').click(); const b=$('#m_detBody',card), o=$('#detBody').classList.contains('grid-rows-[1fr]'); b.classList.toggle('grid-rows-[0fr]',!o); b.classList.toggle('opacity-0',!o); b.classList.toggle('grid-rows-[1fr]',o); b.classList.toggle('opacity-100',o); };
  $$('#m_posActs [data-claim]',card).forEach(b=>b.onclick=()=>doClaim(b.dataset.claim));
  $('#m_cta',card).onclick=async()=>{ $('#amtIn').value=amt.value; await doSwap(); syncSheet(); }; syncSheet(); }

/* ======================= HOME PAGE ======================= */
function initHomeStats(){
  if(window.CHAIN&&LIVE){ CHAIN.allTrades().then(tr=>{ const set=(k,v)=>{ const c=$(`[data-home="${k}"] div.text-lg`); if(c) c.textContent=v; }; const all=TOK; const vis=new Set(TOK.map(x=>x.addr)); tr=tr.filter(t=>vis.has(t.token)); set('tokens',String(TOK.length)); set('traders',new Set(tr.map(t=>t.wallet)).size.toLocaleString()); set('volume',fmtUsd(all.reduce((s,x)=>s+x.volAll,0))); set('holders',fmtUsd(all.reduce((s,x)=>s+x.totalHolderRewards*x.pairUsd,0))); set('creators',fmtUsd(all.reduce((s,x)=>s+x.totalCreatorFees*x.pairUsd,0))); const ath=Math.max(0,...tr.map(t=>{ const x=CHAIN.token(t.token); return x?CHAIN.tradePrice(t)*x.pairUsd*SUPPLY:0; }),...all.map(x=>x.mc)); set('ath',fmtUsd(ath)); }).catch(()=>{}); }
}
function initHome(){
  initHomeStats();
  // "New" chips
  const nc=$('#newchips'); if(nc){ const tpl=$('[data-tpl="chip"]',nc); tpl.remove(); [...TOK].sort((a,b)=>b.createdAt-a.createdAt).slice(0,8).forEach(x=>{ const c=tpl.cloneNode(true); c.removeAttribute('data-tpl'); setAv($('.bg-avatar-gradient',c),x.img,x.t[0]); $('.block.truncate',c).textContent=x.t; c.querySelector('button').onclick=()=>go(tokenUrl(x)); nc.appendChild(c); }); if(!TOK.length){ const bar=nc.closest('div.border-b')||nc.parentElement; if(bar) bar.style.display='none'; } }
  // stock stack in the hero paragraph
  const stack=$('#stack'); if(stack){ const tpl=$('[data-tpl="stk"]',stack); tpl.remove(); STOCKS.slice(0,6).forEach(s=>{ const c=tpl.cloneNode(true); c.removeAttribute('data-tpl'); const av=$('[data-f="av"]',c); av.src=STOCK_IMG(s[0]); av.alt=s[1]; c.title=s[1]+' · '+s[0]; c.querySelector('span.block').setAttribute('aria-label',s[1]); stack.appendChild(c); }); }
  // trending
  const tr=$('#trend'); if(tr){ const a=$('[data-tpl="trendTop"]',tr), b=$('[data-tpl="trendPlain"]',tr); a.remove(); b.remove(); if(!TOK.length){ tr.insertAdjacentHTML('beforeend',emptyBox('Coming soon','Trending fills in after the first launches.',null,null,true)); } [...TOK].sort((x,y)=>(y.vol-x.vol)||(y.mc-x.mc)).slice(0,5).forEach((x,i)=>{ const c=(i<3?a:b).cloneNode(true); c.removeAttribute('data-tpl'); if(i<3){ const col=['warning','text-secondary','burn'][i]; const rk=c.querySelector('span[aria-label^="Rank"]'); rk.setAttribute('aria-label','Rank '+(i+1)); rk.className='relative z-10 inline-flex shrink-0 items-center justify-center border font-mono font-bold tabular-nums size-8 rounded-lg border-'+col+'/50 bg-'+col+'/10 text-'+col; rk.querySelector('svg').outerHTML=ic(i?'medal':'crown','size-4'); const n=rk.querySelector('span'); n.textContent=i+1; n.className='absolute -bottom-1.5 -right-1.5 grid size-5 place-items-center rounded-full border bg-bg-card text-[11px] leading-none border-'+col+'/60 text-'+col; } else c.querySelector('span[aria-label^="Rank"]').textContent=i+1;
    setAv($('.bg-avatar-gradient',c),x.img,x.t[0]); const names=c.querySelectorAll('.items-baseline span'); names[0].textContent=x.n; names[1].textContent=x.t; const meta=c.querySelector('.mt-1.flex'); meta.innerHTML='<span>'+x.pair+'</span><span> · '+ageStr(x.age)+'</span>'; const rt=c.querySelector('.text-right'); rt.querySelector('.truncate.text-sm').textContent=fmtUsd(x.mc); rt.querySelector('.font-medium').textContent=fmtUsd(x.vol); c.onclick=()=>go(tokenUrl(x)); tr.appendChild(c); }); }
  // feed
  const rows=$('#rows'); if(!rows) return; const tpl=$('[data-tpl="row"]',rows); tpl.remove(); const mr=$('#mrows'), mtpl=$('[data-tpl="mrow"]',mr); mtpl.remove();
  let fil='all', sortK='trend', shown=12, asset='all';
  function render(){ let list=[...TOK]; if(fil==='new') list=list.filter(x=>ageMin(x.age)<=60); if(fil==='multi') list=list.filter(x=>x.basket.length>1);
    if(asset==='ETH') list=list.filter(x=>x.pair==='ETH'); else if(asset!=='all') list=list.filter(x=>x.pair===asset||x.basket.includes(asset));
    list.sort(sortK==='vol'?(a,b)=>b.vol-a.vol:sortK==='new'?(a,b)=>b.createdAt-a.createdAt:sortK==='liq'?(a,b)=>b.liq-a.liq:(a,b)=>(b.vol-a.vol)||(b.c1-a.c1)||(b.createdAt-a.createdAt));
    $$('#rows > .group, #mrows > div').forEach(e=>e.remove());
    $$('.o-feed-empty').forEach(e=>e.remove()); if(!list.length){ const em=TOK.length?emptyBox('Nothing here','No token matches this filter yet.',null,null,true):PRE?emptyBox('Coming soon','Inkypump is launching on Ink. Launching, trading and holder rewards open the day the contracts go live.','/docs/introduction','How it works',true):emptyBox('Be the first','The contracts are live on Ink. The first launch shows up here within seconds.','/launch','Launch a token',true); rows.insertAdjacentHTML('beforeend','<div class="o-feed-empty">'+em+'</div>'); mr.insertAdjacentHTML('beforeend','<div class="o-feed-empty">'+em+'</div>'); }
    list.slice(0,shown).forEach((x,i)=>{ const r=tpl.cloneNode(true); r.removeAttribute('data-tpl'); r.style.animationDelay=(i*30)+'ms'; setAv($('.bg-avatar-gradient',r),x.img,x.t[0]);
      const tk=r.children[0]; const n1=tk.querySelector('.items-center.gap-2'); n1.querySelector('span.truncate').textContent=x.t; n1.querySelector('span.truncate').title=x.t; const nb=n1.querySelector('button span'); nb.textContent=x.n; nb.parentElement.title=x.n; nb.parentElement.onclick=e=>{ e.stopPropagation(); copyText(cs(x.addr),'Address copied'); }; const n2=tk.querySelector('.mt-1'); const sp=n2.querySelectorAll(':scope > span'); sp[0].textContent=x.pair; sp[2].textContent=ageStr(x.age); const nt=$('[data-f="new"]',r); if(nt) nt.style.display=ageMin(x.age)<=60?'':'none';
      const cells=[...r.children].slice(1,7); const put=(c,a,b)=>{const d=c.querySelectorAll('div'); d[0].textContent=a; if(d[1]) d[1].textContent=b;};
      put(cells[0],fmtUsd(x.mc),inPair(x.pxPair*SUPPLY,x)); put(cells[1],fmtUsd(x.liq),inPair(x.liqPair,x)); put(cells[2],fmtUsd(x.vol),inPair(x.vol/x.pairUsd,x)); put(cells[3],x.rewards?fmtUsd(x.rew24):'Off',x.rewards?(x.basket.join(' · ')||x.pair):'creator 1.2%'); cells[3].querySelector('div').classList.toggle('text-success',x.rewards); put(cells[4],x.h.toLocaleString()); put(cells[5],'$'+fmtPrice(x.px),fmtPrice(x.pxPair)+' '+x.pair);
      r.onclick=()=>go(tokenUrl(x)); const qb=r.querySelector('button.inline-flex.h-8'); if(qb) qb.onclick=e=>{e.stopPropagation(); go(tokenUrl(x));}; rows.appendChild(r);
      const m=mtpl.cloneNode(true); m.removeAttribute('data-tpl'); const f=k=>m.querySelector('[data-f="'+k+'"]'); setAv(f('av').parentElement,x.img,x.t[0]); f('sym').textContent=x.t; f('name').textContent=x.n; f('age').textContent=ageStr(x.age); f('age').previousElementSibling.previousElementSibling.textContent=x.pair; f('vol').outerHTML=ageMin(x.age)<=60?'<span class="inline-flex items-center gap-1.5 h-5 shrink-0 rounded-full border-0 px-2 text-[11px] font-semibold leading-none bg-accent/10 text-accent">NEW</span>':''; f('mc').textContent=fmtUsd(x.mc); f('chg').innerHTML='<span class="text-text-muted">Liq </span><span class="text-text-primary">'+fmtUsd(x.liq)+'</span><span class="text-text-muted"> · Vol 24h </span><span class="text-text-primary">'+fmtUsd(x.vol)+'</span>'; f('chg').className='mt-1 text-xs tabular-nums whitespace-nowrap'; m.onclick=()=>go(tokenUrl(x)); mr.appendChild(m); });
    const lm=$('#loadmore'); if(lm) lm.style.display=list.length>shown?'':'none'; }
  render();
  $$('[data-filter]').forEach(b=>b.onclick=()=>{ $$('[data-filter]').forEach(x=>{x.className=x.className.replace(/ text-text-primary| text-text-muted hover:text-text-secondary/g,'')+(x===b?' text-text-primary':' text-text-muted hover:text-text-secondary');}); fil=b.dataset.filter; shown=12; render(); });
  $$('[data-sort]').forEach(b=>b.onclick=()=>{ $$('[data-sort]').forEach(x=>{ x.className=x.className.replace(/ bg-accent text-accent-ink| text-text-secondary hover:text-text-primary/g,'')+(x===b?' bg-accent text-accent-ink':' text-text-secondary hover:text-text-primary'); }); sortK=b.dataset.sort; render(); });
  $$('[data-sort]').forEach((x,i)=>{ x.className=x.className.replace(/ bg-accent text-accent-ink| text-text-secondary hover:text-text-primary/g,'')+(i===0?' bg-accent text-accent-ink':' text-text-secondary hover:text-text-primary'); });
  $$('[data-dd="assets"]').forEach(b=>{ b.dataset.menu='1'; b.onclick=()=>{ if($('.o-menu')) return $$('.o-menu').forEach(m=>m.remove()); const opts=[['all','All assets'],['ETH','ETH pairs'],...STOCKS.map(s=>[s[0],s[0]+' pairs & baskets'])]; menu(b,'<div class="h">Paired / reward asset</div>'+opts.map(o=>`<button class="i${o[0]===asset?' on':''}" data-o="${o[0]}">${o[1]}</button>`).join('')); $$('.o-menu [data-o]').forEach(m=>m.onclick=()=>{ asset=m.dataset.o; $$('[data-dd="assets"] span.truncate').forEach(s=>s.textContent=m.textContent); $$('.o-menu').forEach(x=>x.remove()); shown=12; render(); }); }; });
  const lm=$('#loadmore'); if(lm) lm.onclick=()=>{ shown+=12; render(); };
  const fb=$('#feed'), main=$('main'); const sync=()=>{ const stuck=fb.getBoundingClientRect().top<=main.getBoundingClientRect().top+1 && main.scrollTop>40; fb.style.backgroundColor=stuck?'var(--color-bg-card)':''; fb.style.borderBottom=stuck?'1px solid var(--color-border-default)':''; main.style.setProperty('--feed-sticky-top',fb.offsetHeight+'px'); }; main.addEventListener('scroll',sync,{passive:true}); addEventListener('resize',sync); sync();
  window.homeRender=()=>{ syncTok(); render(); };
  if(LIVE&&window.CHAIN) setInterval(async()=>{ if(document.hidden) return; try{ await CHAIN.refresh(); syncTok(); render(); }catch{} },15000);
}
window.addEventListener('chain-update',()=>{ if(window.homeRender){ homeRender(); if($('#rows')) initHomeStats(); } if(X&&typeof tickNow==='function') tickNow(); });

/* ---------- boot ---------- */
function syncTok(){ if(!window.CHAIN) return; TOK=CHAIN.tokens().filter(x=>!x.hidden); }
const reveal=()=>{ const p=document.getElementById('prehide'); if(p) p.remove(); };
let chainError=null;
async function boot(){
  // paint the shell first; the markup carries no sample numbers, so the empty strip reads as a skeleton
  try{ initHeader(); }catch(e){ console.error(e); } reveal(); if(LIVE&&window.CHAIN&&CHAIN.ready&&!CHAIN.tokens().length){ const r=$('#rows')||$('#tb'); if(r) r.insertAdjacentHTML('beforeend','<div class="o-loading py-10 text-center text-sm text-text-muted">Loading from Ink…</div>'); }
  if(LIVE&&window.CHAIN&&CHAIN.ready){ try{ const t=await Promise.race([CHAIN.ready,sleep(30000).then(()=>null)]); if(!t) throw new Error('timeout'); ETH=await CHAIN.ethUsd(); syncTok(); const cur=tokenFromUrl(); if(cur&&CHAIN.token(cur)&&!CHAIN.stale){ const trades=await CHAIN.trades(cur); CHAIN.token(cur)._trades=trades; } }catch(e){ chainError=e; console.error('chain',e); } }
  $$('.o-loading').forEach(e=>e.remove());
  try{ initHistory(); initGeneric(); if($('#tb')) initToken(); if($('#rows')) initHome(); document.dispatchEvent(new Event('data-ready')); } finally { reveal(); document.documentElement.dataset.ready='1'; }
  if(chainError){ const m=$('main'); if(m) m.insertAdjacentHTML('afterbegin',`<div class="mx-auto mt-4 w-full max-w-[1600px] px-4 sm:px-8"><div class="flex items-center justify-between gap-3 rounded-2xl border border-warning/30 bg-warning-soft px-4 py-3 text-[13px] text-text-primary"><span>Could not reach Ink right now. Live data is paused.</span><button class="h-8 shrink-0 rounded-full bg-accent px-3 text-xs font-semibold text-accent-ink" onclick="location.reload()">Retry</button></div></div>`); }
}
document.addEventListener('DOMContentLoaded',boot);
setTimeout(reveal,15000);
