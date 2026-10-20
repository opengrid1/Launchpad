/* Launch page: 3-step wizard (pair, identity, fee and launch) with a live summary card. Uses the core.js globals ($, $$, esc, ic, SP, TOK, WETH, EXPLORER, SITE, DEF_LOGO).
   The wizard is built on DOMContentLoaded so the form is usable while the chain layer loads; SP_PAGE (called by core.js once chain data is in) repaints prices, coin counts and the symbol check. */
let launchRepaint=null;
function launchInit(){
  const pg=$('#pg-launch'); if(!pg||launchRepaint) return;
  const g=id=>document.getElementById(id);
  const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
  const num=(id,d)=>{ const v=parseFloat(g(id).value); return isFinite(v)?v:d; };
  const IMG_IC='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/></svg>';
  const ETH_PAIR={address:WETH,symbol:'ETH',ticker:'ETH',name:'Ether',logo:'/img/eth.png',eth:true};
  const PAIRS=[...SP.stocks.map(s=>({address:s.address.toLowerCase(),symbol:s.symbol,ticker:s.ticker||s.symbol,name:s.name,logo:s.logo,eth:false})),...((window.INKY&&INKY.stocksOnly)?[]:[ETH_PAIR])];
  const S={step:1,maxStep:1,pair:null,logo:null,feeBps:100,feeCustom:false,snipe:false,div:false,dev:false,capUsd:5000,paused:false,busy:false,launched:null};
  const taken=()=>new Set(((window.CHAIN&&LIVE)?CHAIN.tokens():TOK).map(x=>String(x.t||'').toUpperCase()));
  const ethPx=()=>SP.prices[WETH]||ETH||0;
  const pairPx=()=>S.pair?(SP.prices[S.pair.address]||0):0;
  const fmtPx=v=>v?'$'+(v>=100?v.toFixed(0):v>=1?v.toFixed(2):fmtPrice(v)):'';
  const fmtCap=v=>'$'+Math.round(v).toLocaleString('en-US');
  const feePct=()=>(S.feeBps/100).toFixed(S.feeBps%100?(S.feeBps%10?2:1):0)+'%';
  const fmtInPair=v=>{ if(!S.pair) return ''; if(S.pair.eth) return fmtEth(v); return (v>=100?v.toFixed(0):v>=1?v.toFixed(2):fmtPrice(v))+' '+S.pair.symbol; };
  const link=v=>{ v=String(v||'').trim(); if(!v) return ''; if(!/^https?:\/\//i.test(v)) v='https://'+v; return v.slice(0,200); };
  const fields={ name:()=>g('f-name').value.trim(), sym:()=>g('f-sym').value.trim().toUpperCase(), desc:()=>g('f-desc').value.trim().slice(0,280),
    snipePct:()=>num('f-snipe',30), snipeMin:()=>num('f-snipemin',30), divPct:()=>num('f-div',20), devEth:()=>num('f-dev',0) };

  /* ---------- derived numbers ---------- */
  function split(){ const dv=S.div?clamp(Math.round(fields.divPct()),10,50):0; const rest=100-dv, cr=Math.round(rest*0.6), pl=rest-cr; return {holders:dv,creator:cr,platform:pl}; }
  function devCoins(){ const eth=S.dev?clamp(fields.devEth(),0,0.5):0; const usd=eth*ethPx(); return usd>0?usd/(S.capUsd+usd)*SUPPLY:0; }
  function optList(){ const a=[]; if(S.snipe) a.push('Anti-snipe'); if(S.div) a.push('Holder rewards'); return a; }
  function snipeBlocks(){ return clamp(Math.round(fields.snipeMin()*60/12),5,7200); }

  /* ---------- step 1: pairs ---------- */
  function paintPairs(){ const counts={}; TOK.forEach(x=>{ counts[x.pair]=(counts[x.pair]||0)+1; }); const mk=SP.market(); g('mk-status').textContent=mk.label+' · '+mk.detail;
    g('pairs').innerHTML=PAIRS.map(p=>{ const px=SP.prices[p.address], n=counts[p.symbol]||0; return `<button type="button" class="pc${S.pair&&S.pair.address===p.address?' on':''}" data-p="${p.address}"><img src="${p.logo}" alt="" onerror="this.onerror=null;this.src='/img/eth.png'"><span class="nm"><b>${esc(p.ticker)} <span class="muted" style="font-weight:400">${esc(p.name)}</span></b><small>${esc(p.symbol)}</small></span><span class="ft"><span>${p.eth?'TRADES 24/7':`<i class="dot ${mk.open?'open':''}"></i>${mk.open?'NYSE OPEN':'NYSE CLOSED'}`}</span><span class="cnt">${n} ${n===1?'coin':'coins'}</span></span><span class="px" data-px="${p.address}">${px?fmtPx(px):'…'}</span><span class="tick">${ic('check')}</span></button>`; }).join('');
    $$('#pairs [data-p]').forEach(b=>b.onclick=()=>{ setPair(PAIRS.find(p=>p.address===b.dataset.p)); }); }
  function setPair(p){ S.pair=p||null; g('pair-err').textContent=''; $$('#pairs .pc').forEach(b=>b.classList.toggle('on',!!S.pair&&b.dataset.p===S.pair.address)); if(S.pair){ const u=new URL(location.href); u.searchParams.set('pair',S.pair.symbol); history.replaceState(null,'',u); SP.pairUsd(S.pair.address).then(()=>{ paintPairs(); sync(); }).catch(()=>{}); } sync(); }
  function preselect(){ const q=(new URLSearchParams(location.search).get('pair')||'').trim().toLowerCase(); if(!q) return; const p=PAIRS.find(x=>x.symbol.toLowerCase()===q||x.ticker.toLowerCase()===q||x.address===q); if(p) S.pair=p; }

  /* ---------- step 2: identity ---------- */
  function paintLogo(){ const d=g('drop'), inn=g('drop-in'); d.classList.toggle('has',!!S.logo); inn.innerHTML=S.logo?`<img src="${S.logo}" alt="">`:IMG_IC+'<span>Drop a logo or click to choose</span>'; }
  function loadLogo(file){ if(!file||!file.type||!file.type.startsWith('image/')){ SP.toast('Please choose an image file','err'); return; } if(file.size>4*1024*1024){ SP.toast('Logo too big, max 4 MB','err'); return; }
    const img=new Image(), url=URL.createObjectURL(file);
    img.onload=()=>{ URL.revokeObjectURL(url); const s=Math.min(img.width,img.height); let best=null;
      outer: for(const size of [128,112,96,80,64]){ const c=document.createElement('canvas'); c.width=c.height=size; const x=c.getContext('2d'); x.drawImage(img,(img.width-s)/2,(img.height-s)/2,s,s,0,0,size,size);
        for(let q=0.8;q>=0.35;q-=0.15){ const dd=c.toDataURL('image/webp',q); if(!best||dd.length<best.length) best=dd; if(dd.length<=4200) break outer; } }
      if(!best||!best.startsWith('data:image/webp')){ SP.toast('Could not process this image','err'); return; }
      S.logo=best; paintLogo(); sync(); SP.toast('Logo ready, '+(best.length/1024).toFixed(1)+' KB on-chain'+(best.length>4200?' (large; the launch may cost more gas)':'')); };
    img.onerror=()=>{ URL.revokeObjectURL(url); SP.toast('Could not read this image','err'); };
    img.src=url; }
  function symMsg(){ const t=fields.sym(), el=g('sym-msg'); el.className='hint'; if(!t){ el.textContent='2 to 10 characters, A-Z and 0-9.'; return true; }
    if(!/^[A-Z0-9]{2,10}$/.test(t)){ el.className='err'; el.textContent='Symbol: 2 to 10 characters, A-Z and 0-9 only'; return false; }
    if(taken().has(t)){ el.className='err'; el.textContent=t+' is already taken by another coin'; return false; }
    el.className='hint ok'; el.textContent=t+' is available'; return true; }
  function nameMsg(){ const n=fields.name(), el=g('name-msg'); el.textContent=!n?'':n.length>32?'Name: 32 characters max':''; return !!n&&n.length<=32; }

  /* ---------- step 3: fee and options ---------- */
  function readFee(){ if(S.feeCustom){ const v=num('f-fee',1); S.feeBps=clamp(Math.round(v*10),1,30)*10; } }
  function feeMsg(){ const el=g('fee-msg'); if(S.feeCustom){ const v=num('f-fee',NaN); if(!(v>=0.1&&v<=3)){ el.textContent='Fee: 0.1% to 3% in steps of 0.1'; return false; } } el.textContent=''; return true; }
  function snipeMsg(){ const el=g('snipe-msg'); if(!S.snipe){ el.textContent=''; return true; } const p=fields.snipePct(), m=fields.snipeMin(); let e='';
    if(!(p>=5&&p<=30)) e='Starting fee: 5% to 30%'; else if(p*100<=S.feeBps) e='Starting fee must be above the base fee'; else if(!(m>=1&&m<=1440)) e='Duration: 1 to 1440 minutes';
    el.textContent=e; g('snipe-hint').textContent=e?'':`Starts at ${p}% and reaches ${feePct()} after about ${snipeBlocks()} blocks (${m} min at 12 s per block).`; return !e; }
  function divMsg(){ const el=g('div-msg'); if(!S.div){ el.textContent=''; return true; } const v=fields.divPct(); const ok=v>=10&&v<=50&&Math.round(v)===v; el.textContent=ok?'':'Share: a whole number from 10% to 50%'; if(ok){ const sp=split(); g('div-hint').textContent=`${sp.holders}% of every fee to holders${S.pair?', paid in '+S.pair.symbol:''}; the rest splits ${sp.creator}% to you and ${sp.platform}% to the platform.`; } return ok; }
  function devMsg(){ const el=g('dev-msg'); if(!S.dev){ el.textContent=''; return true; } const v=fields.devEth(); const ok=v>=0&&v<=0.5; el.textContent=ok?'':'Dev buy: 0 to 0.5 ETH';
    if(ok){ const c=devCoins(); g('dev-hint').textContent=v>0?`About ${fmtAmt(c)} coins (${(c/SUPPLY*100).toFixed(2)}% of supply) for ${fmtUsd(v*ethPx())} at the ${fmtCap(S.capUsd)} opening cap.`:'Enter an amount of ETH.'; } return ok; }
  function paintReview(){ const sp=split(); const px=pairPx(); const inPair=S.pair?(px?fmtInPair(S.capUsd/px):'loading the '+S.pair.symbol+' price'):'';
    g('rv-split').textContent=`${feePct()} per swap: ${sp.holders?sp.holders+'% holders, ':''}${sp.creator}% creator, ${sp.platform}% platform`;
    g('rv-bar').innerHTML=(sp.holders?`<i class="h" style="width:${sp.holders}%"></i>`:'')+`<i class="c" style="width:${sp.creator}%"></i><i class="p" style="width:${sp.platform}%"></i>`;
    g('rv-legend').innerHTML=(sp.holders?`<span><i style="background:var(--amber)"></i>Holders ${sp.holders}%</span>`:'')+`<span><i style="background:var(--mint)"></i>Creator ${sp.creator}%</span><span><i style="background:var(--fg-3)"></i>Platform ${sp.platform}%</span>`+(S.pair?`<span>paid in ${esc(S.pair.symbol)}</span>`:'');
    g('rv-cap').textContent=fmtCap(S.capUsd)+(inPair?' · '+inPair:''); }

  /* ---------- summary card ---------- */
  function sync(){ readFee(); const n=fields.name(), t=fields.sym(), sp=split(); const letter=(t||n||'?')[0].toUpperCase();
    g('sm-step').textContent=S.launched?'Launched':'Step '+S.step+' of 3';
    g('sm-logo').innerHTML=S.logo?`<img src="${S.logo}" alt="">`:esc(letter); g('sm-name').textContent=n||'Your coin'; g('sm-sym').textContent=t||'SYMBOL';
    g('sm-pair').innerHTML=S.pair?`<img src="${S.pair.logo}" alt="" onerror="this.onerror=null;this.src='/img/eth.png'">${esc(S.pair.symbol)}${!S.pair.eth?' <span class="muted">'+esc(S.pair.ticker)+'</span>':''}`:'Not picked';
    g('sm-fee').textContent=feePct()+(S.snipe?' · anti-snipe':''); const opts=optList(); g('sm-opts').textContent=opts.length?opts.join(', '):'None';
    const px=pairPx(); g('sm-cap').textContent=fmtCap(S.capUsd)+(S.pair&&px?' · '+fmtInPair(S.capUsd/px):'');
    const dv=S.dev?clamp(fields.devEth(),0,0.5):0; g('sm-dev').textContent=dv>0?`${dv} ETH · ${fmtAmt(devCoins())} coins`:'None';
    g('sm-cr').textContent=`${sp.creator}% of every fee`; g('sm-note').textContent=(S.pair?`Fees and holder rewards are paid in ${S.pair.symbol}. `:'')+'Liquidity cannot be withdrawn. Everything here is fixed at launch.';
    if(S.snipe) snipeMsg(); if(S.div) divMsg(); if(S.dev) devMsg(); paintReview(); }

  /* ---------- steps ---------- */
  function validate(n){ if(n===1){ const ok=!!S.pair; g('pair-err').textContent=ok?'':'Pick a stock or ETH to continue'; return ok; }
    if(n===2){ const a=nameMsg(), b=symMsg()&&!!fields.sym(); if(!fields.sym()){ const el=g('sym-msg'); el.className='err'; el.textContent='Symbol is required'; } if(!fields.name()) g('name-msg').textContent='Name is required'; return a&&b; }
    if(n===3){ const a=feeMsg(), b=snipeMsg(), c=divMsg(), d=devMsg(); return a&&b&&c&&d; } return true; }
  function show(n){ S.step=n; S.maxStep=Math.max(S.maxStep,n); $$('#pg-launch .pane').forEach(p=>p.classList.toggle('on',+p.dataset.pane===n));
    $$('#steps button').forEach(b=>{ const k=+b.dataset.step; b.classList.toggle('on',k===n); b.classList.toggle('done',k<n); b.querySelector('.n').innerHTML=k<n?ic('check'):String(k); });
    sync(); if(n===3) paintCta(); const y=g('steps').getBoundingClientRect().top+scrollY-70; if(scrollY>y) scrollTo({top:Math.max(0,y),behavior:'smooth'}); }
  function go(n){ n=clamp(n,1,3); if(S.launched) return; if(n<=S.step){ show(n); return; } for(let i=S.step;i<n;i++){ if(!validate(i)){ if(i!==S.step) show(i); SP.toast('Fix the highlighted fields first','err'); return; } } show(n); }

  /* ---------- launch ---------- */
  const cta=g('cta');
  function paintCta(){ if(S.busy){ cta.disabled=true; cta.textContent='Confirm in wallet…'; return; } cta.disabled=S.paused; cta.textContent=S.paused?'Launches paused':!SP.W.connected?'Connect wallet':!SP.W.chainOk?'Switch to Ethereum':'Launch coin'; }
  function launchErr(e){ let m=SP.errMsg(e); if(/instincts|evolution|BadGenes/i.test(m)) m='The fee or options are out of bounds; adjust them and try again.'; return m; }
  async function doLaunch(){ if(S.busy||S.paused) return;
    if(!SP.W.connected){ SP.W.connect(); return; }
    if(!SP.W.chainOk){ try{ await SP.W.switchChain(); }catch(e){ SP.toast(SP.errMsg(e),'err'); } return; }
    for(const i of [1,2,3]) if(!validate(i)){ show(i); SP.toast('Fix the highlighted fields first','err'); return; }
    if(!LIVE||!window.CHAIN){ SP.toast('Launches open when the contracts are live','info'); return; }
    const name=fields.name(), symbol=fields.sym(); const meta={description:fields.desc()}; if(S.logo) meta.image=S.logo; const w=link(g('f-web').value), x=link(g('f-x').value), tg=link(g('f-tg').value); if(w) meta.website=w; if(x) meta.x=x; if(tg) meta.telegram=tg;
    const devEth=S.dev?clamp(fields.devEth(),0,0.5):0; const devWei=devEth>0?CHAIN.parseEther(devEth.toFixed(18)):0n;
    const genes={ feeMode:0, feeBps:S.feeBps, snipeBps:S.snipe?clamp(Math.round(fields.snipePct()*100),S.feeBps+1,3000):0, snipeBlocks:S.snipe?snipeBlocks():0, buybackShareBps:0, buybackThreshold:0n, divShareBps:S.div?clamp(Math.round(fields.divPct()),10,50)*100:0, maxWalletBps:0, maxWalletSecs:0, evolution:{enabled:false} };
    S.busy=true; paintCta();
    try{ const {rc,token}=await CHAIN.launch({name,symbol,metadataURI:JSON.stringify(meta),pair:S.pair.address,minPairOut:0,genes},devWei);
      if(!token) throw new Error('Launched, but the coin address was not found in the receipt. Check your wallet activity.');
      S.launched={addr:String(token).toLowerCase(),block:rc&&rc.blockNumber?Number(rc.blockNumber):0,name,symbol}; showDone(); SP.toast(name+' is live on Ethereum');
      try{ await CHAIN.refresh(); if(typeof syncTok==='function') syncTok(); }catch{} }
    catch(e){ SP.toast(launchErr(e),'err'); }
    finally{ S.busy=false; paintCta(); } }
  function showDone(){ const L=S.launched; $$('#pg-launch .pane').forEach(p=>p.classList.remove('on')); $$('#steps button').forEach(b=>{ b.classList.add('done'); b.classList.remove('on'); b.querySelector('.n').innerHTML=ic('check'); b.disabled=true; });
    const dn=g('done'); dn.classList.remove('hidden'); g('dn-block').textContent=L.block?'Block #'+L.block.toLocaleString('en-US'):'Mined'; g('dn-logo').src=S.logo||DEF_LOGO; g('dn-name').textContent=L.name+' · '+L.symbol; g('dn-sub').textContent=`Paired with ${S.pair.symbol}. Trading is open on Uniswap v4; fees settle in ${S.pair.symbol}.`;
    g('dn-addr').textContent=cs(L.addr); g('dn-copy').innerHTML=ic('copy'); g('dn-copy').onclick=()=>SP.copy(cs(L.addr),'Address copied');
    g('dn-pair').innerHTML=`<img src="${S.pair.logo}" alt="" style="width:14px;height:14px;border-radius:50%;background:#fff;display:inline-block;vertical-align:-2px;margin-right:6px" onerror="this.onerror=null;this.src='/img/eth.png'">${esc(S.pair.symbol)}`; const sp=split(); g('dn-fee').textContent=`${feePct()} · ${sp.creator}% to you`;
    g('dn-open').href=tokenUrl(L.addr); g('dn-scan').href=EXPLORER+'/token/'+L.addr;
    const url=SITE+tokenUrl(L.addr); g('dn-x').href='https://x.com/intent/tweet?text='+encodeURIComponent(`$${L.symbol} is live on StockPad, paired with ${S.pair.symbol}. Fees settle in ${S.pair.symbol}, liquidity cannot be withdrawn. ${url}`);
    sync(); scrollTo({top:0,behavior:'smooth'}); }

  /* ---------- wiring ---------- */
  preselect(); paintPairs(); paintLogo();
  $$('#steps button').forEach(b=>b.onclick=()=>go(+b.dataset.step));
  $$('#pg-launch [data-next]').forEach(b=>b.onclick=()=>go(S.step+1)); $$('#pg-launch [data-back]').forEach(b=>b.onclick=()=>go(S.step-1));
  g('f-logo').addEventListener('change',e=>{ loadLogo(e.target.files[0]); e.target.value=''; });
  const dz=g('drop'); ['dragenter','dragover'].forEach(ev=>dz.addEventListener(ev,e=>{ e.preventDefault(); dz.classList.add('over'); })); ['dragleave','drop'].forEach(ev=>dz.addEventListener(ev,e=>{ e.preventDefault(); dz.classList.remove('over'); })); dz.addEventListener('drop',e=>loadLogo(e.dataTransfer.files[0]));
  g('f-name').addEventListener('input',()=>{ nameMsg(); sync(); });
  g('f-sym').addEventListener('input',e=>{ const p=e.target.selectionStart; e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,''); try{ e.target.setSelectionRange(p,p); }catch{} symMsg(); sync(); });
  g('f-desc').addEventListener('input',e=>{ g('desc-cnt').textContent=e.target.value.length+' / 280'; });
  $$('#fee-seg button').forEach(b=>b.onclick=()=>{ $$('#fee-seg button').forEach(x=>x.classList.toggle('on',x===b)); S.feeCustom=b.dataset.fee==='custom'; g('fee-custom').classList.toggle('hidden',!S.feeCustom); if(!S.feeCustom) S.feeBps=+b.dataset.fee; else g('f-fee').value=(S.feeBps/100).toString(); feeMsg(); sync(); });
  g('f-fee').addEventListener('input',()=>{ feeMsg(); sync(); });
  $$('#pg-launch [data-sw]').forEach(h=>h.addEventListener('click',e=>{ if(e.target.closest('input')) return; const k=h.dataset.sw, on=!S[k]; S[k]=on; const sw=g('sw-'+k); sw.classList.toggle('on',on); sw.setAttribute('aria-checked',String(on)); g('opt-'+k).classList.toggle('on',on); if(on){ const f=g('opt-'+k).querySelector('input'); if(f) setTimeout(()=>f.focus(),0); } sync(); }));
  ['f-snipe','f-snipemin','f-div','f-dev'].forEach(id=>g(id).addEventListener('input',sync));
  cta.onclick=doLaunch; SP.onWallet(paintCta);
  launchRepaint=()=>{ paintPairs(); if(fields.sym()) symMsg(); sync(); paintCta(); }; SP.onUpdate(launchRepaint);
  sync(); paintCta();
  if(LIVE&&window.CHAIN){ CHAIN.startCapUsd().then(v=>{ if(v>0){ S.capUsd=v; sync(); } }).catch(()=>{});
    CHAIN.launchesPaused().then(p=>{ S.paused=!!p; const el=g('paused'); el.classList.toggle('hidden',!p); if(p) el.innerHTML=ic('warn')+'<span>Launches are paused by the operator right now. You can prepare the coin; the Launch button opens again when launches resume.</span>'; paintCta(); }).catch(()=>{});
    if(S.pair) SP.pairUsd(S.pair.address).then(()=>{ paintPairs(); sync(); }).catch(()=>{}); }
}
window.SP_PAGE=function(){ if(!launchRepaint) launchInit(); else launchRepaint(); };
document.addEventListener('DOMContentLoaded',launchInit);
