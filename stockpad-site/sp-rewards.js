/* Rewards page: cashback and referral rewards (Equo hook), holder rewards and creator fees across every coin,
   and what buybacks have burned. Everything is read from chain; claims are transactions from the connected wallet. */
window.SP_PAGE=function(){
  const pg=$('#pg-rewards'); if(!pg) return;
  const g=id=>document.getElementById(id);
  const DEAD='0x000000000000000000000000000000000000dead';
  let P=null, R=null, seq=0, busy=false;
  const EQ=()=>window.CHAIN&&CHAIN.equo;
  const usdOf=(pair,amt)=>{ const p=String(pair).toLowerCase(); return amt*(SP.prices[p]||0); };
  const owedUsd=()=>R?R.owed.reduce((s,o)=>s+usdOf(o.pair,o.amount),0):0;
  const owedTxt=()=>R&&R.owed.length?R.owed.map(o=>`${fmtAmt(o.amount)} ${esc(o.symbol)}`).join(' · '):'nothing yet';
  g('rw-h-hold').innerHTML=ic('coins')+'Holder rewards'; g('rw-h-cre').innerHTML=ic('rocket')+'Creator fees'; g('rw-h-ref').innerHTML=ic('link')+'Refer traders'; g('rw-h-cb').innerHTML=ic('gift')+'Cashback'; g('rw-h-burn').innerHTML=ic('flame')+'Buyback burns';
  const coinCell=x=>`<div class="coin"><span class="av2"><img class="lg" src="${SP.coinLogo(x)}" alt="" onerror="this.onerror=null;this.src='${DEF_LOGO}'"><img class="stb" src="${pairImg(x.pair)}" alt="" onerror="this.onerror=null;this.src='/img/eth.png'"></span><div><b>$${esc(x.t)}</b><small>${esc(x.n)}</small></div></div>`;
  const gate=(t,s)=>`<div class="gate"><b>${t}</b>${s}<div><button class="btn pri" data-connect>Connect wallet</button></div></div>`;

  /* ---------- KPIs ---------- */
  function kpis(){ const c=SP.W.connected; const rw=P?P.holdings.reduce((s,h)=>s+(h.pendUsd||0),0):0, cf=P?P.created.reduce((s,c)=>s+c.fees*(c.x.pairUsd||0),0):0;
    const nr=P?P.holdings.filter(h=>h.pend>0).length:0, nc=P?P.created.filter(c=>c.fees>0).length:0;
    const K=[['Holder rewards',c?(P?fmtUsd(rw):'…'):'—',c&&P?(nr?`claimable from ${nr} ${nr===1?'coin':'coins'}`:'nothing to claim'):'connect to see',''],['Creator fees',c?(P?fmtUsd(cf):'…'):'—',c&&P?(P.created.length?`${nc} of ${P.created.length} ${P.created.length===1?'coin':'coins'} with fees`:'no coins created'):'connect to see',''],['Referral earnings',c?(R?fmtUsd(R.hist?R.hist.referral._usd||0:0):'…'):'—',c&&R?`${R.hist?R.hist.traders:0} ${R.hist&&R.hist.traders===1?'trader':'traders'} referred`:'connect to see',''],['Cashback',c?(R?fmtUsd(R.hist?R.hist.cashback._usd||0:0):'…'):'—',c&&R?`${fmtUsd(owedUsd())} claimable with referrals`:'connect to see','']];
    g('rw-kpis').innerHTML=K.map(k=>`<div class="sbox panel"><span class="lab">${k[0]}${k[3]?'<span class="soon">Soon</span>':''}</span><b class="${k[3]?'muted':''}">${k[1]}</b><i>${k[2]}</i></div>`).join(''); }

  /* ---------- holder rewards, creator fees ---------- */
  function claims(){ const c=SP.W.connected;
    if(!c){ g('rw-hold').innerHTML=gate('Connect to see your rewards','Coins with holder rewards pay part of every fee to holders. Claim them here.'); g('rw-cre').innerHTML='<div class="empty" style="padding:24px">Connect to see fees from coins you launched.</div>'; g('rw-claimall').innerHTML=''; wire(); return; }
    if(!P){ g('rw-hold').innerHTML='<div class="empty" style="padding:24px">Loading…</div>'; g('rw-cre').innerHTML='<div class="empty" style="padding:24px">Loading…</div>'; return; }
    const H=P.holdings.filter(h=>h.x.rewards||h.pend>0).sort((a,b)=>b.pendUsd-a.pendUsd);
    g('rw-hold').innerHTML=H.length?`<div style="overflow-x:auto"><table class="tb"><thead><tr><th>Coin</th><th class="r">Holding</th><th class="r">Claimable</th><th></th></tr></thead><tbody>${H.map(h=>`<tr class="go" data-go="${tokenUrl(h.x)}"><td>${coinCell(h.x)}</td><td class="r num">${fmtAmt(h.bal)}<small>${fmtUsd(h.bal*(h.x.px||0))}</small></td><td class="r num">${h.pend>0?`<span class="up">${fmtUsd(h.pendUsd)}</span><small>${SP.fmtPair(h.pend,h.x)}</small>`:'<span class="muted">—</span>'}</td><td class="act">${h.pend>0?`<button class="btn sm" data-claim="${h.x.addr}">Claim</button>`:''}</td></tr>`).join('')}</tbody></table></div>`
      :`<div class="empty" style="padding:28px 16px"><b>No holder rewards yet</b>Hold a coin with the Holder rewards badge and part of every fee comes to you.<div style="margin-top:12px"><a class="btn" href="/">Browse coins</a></div></div>`;
    const n=H.filter(h=>h.pend>0).length; g('rw-claimall').innerHTML=n>1?`<button class="btn sm pri" id="rw-all">Claim all (${n})</button>`:'';
    const C=P.created.slice().sort((a,b)=>b.fees*(b.x.pairUsd||0)-a.fees*(a.x.pairUsd||0));
    g('rw-cre').innerHTML=C.length?`<div style="overflow-x:auto"><table class="tb"><thead><tr><th>Coin</th><th class="r">Volume 24h</th><th class="r">Claimable</th><th></th></tr></thead><tbody>${C.map(c=>`<tr class="go" data-go="${tokenUrl(c.x)}"><td>${coinCell(c.x)}</td><td class="r num">${fmtUsd(c.x.vol||0)}</td><td class="r num">${c.fees>0?`<span class="up">${fmtUsd(c.fees*(c.x.pairUsd||0))}</span><small>${SP.fmtPair(c.fees,c.x)}</small>`:'<span class="muted">—</span>'}</td><td class="act">${c.fees>0?`<button class="btn sm" data-pay="${c.x.addr}">Claim</button>`:''}</td></tr>`).join('')}</tbody></table></div>`
      :`<div class="empty" style="padding:28px 16px"><b>No coins launched</b>Coins you launch pay you a share of every fee.<div style="margin-top:12px"><a class="btn pri" href="/launch">Launch a coin</a></div></div>`;
    wire(); }
  function wire(){ $$('#pg-rewards [data-connect]').forEach(b=>b.onclick=()=>SP.W.connect());
    $$('#pg-rewards tr[data-go]').forEach(r=>r.onclick=e=>{ if(e.target.closest('button,a')) return; SP.go(r.dataset.go); });
    $$('#pg-rewards [data-claim]').forEach(b=>b.onclick=()=>tx(b,()=>CHAIN.claim(b.dataset.claim),'Rewards claimed'));
    $$('#pg-rewards [data-pay]').forEach(b=>b.onclick=()=>tx(b,()=>CHAIN.payCreator(b.dataset.pay),'Creator fees claimed'));
    const all=g('rw-all'); if(all) all.onclick=()=>claimAll(all); }
  async function tx(btn,fn,msg){ if(busy) return SP.toast('A transaction is already in progress','info'); if(!SP.W.chainOk){ SP.W.switchChain().catch(()=>{}); return; } const t=btn.innerHTML; busy=true; btn.disabled=true; btn.textContent='Confirm…';
    try{ await fn(); SP.toast(msg); load(); loadRewards(); }catch(e){ SP.toast(SP.errMsg(e),'err'); }finally{ busy=false; btn.disabled=false; btn.innerHTML=t; } }
  async function claimAll(btn){ if(busy) return; const l=P.holdings.filter(h=>h.pend>0); busy=true; btn.disabled=true; let done=0;
    try{ for(let i=0;i<l.length;i++){ btn.textContent=`Claiming ${i+1} of ${l.length}…`; try{ await CHAIN.claim(l[i].x.addr); done++; }catch(e){ const m=SP.errMsg(e); SP.toast(`$${l[i].x.t}: ${m}`,'err'); if(m==='Transaction cancelled') break; } } }
    finally{ busy=false; } if(done) SP.toast(done===l.length?'All rewards claimed':`${done} of ${l.length} claimed`,'info'); load(); }

  /* ---------- referral and cashback (Equo hook: a share of the platform's part of every fee) ---------- */
  function soon(){ const a=SP.W.connected?SP.W.address:''; const sp=R&&R.split;
    // effective share of a coin's fee when it has no buyback or holder pots: platform part is 40% of the fee
    const pct=b=>sp?((0.4*b/100)).toFixed(0)+'%':'…';
    g('rw-ref-rate').textContent=sp?`up to ${pct(sp.referralBps)} of fees`:''; g('rw-cb-rate').textContent=sp?`up to ${pct(sp.cashbackBps)} of fees`:'';
    const link=a?SP.refLink(a):'';
    g('rw-ref').innerHTML=`<p>Share your link. Every trader who comes through it is yours for life: part of every fee they pay goes to you, on every coin.</p><div class="lnk ${a?'on':''}"><span>${a?esc(link.replace(/^https?:\/\//,'')):'Connect a wallet to get your link'}</span>${a?`<button class="btn sm" id="rw-copy">${ic('copy')}Copy</button><a class="btn sm" target="_blank" rel="noopener" href="https://x.com/intent/tweet?text=${encodeURIComponent('Launch and trade coins on eight chains at once on Equo '+link)}">${ic('xlogo')}</a>`:''}</div>
      <div class="mini"><div class="sbox"><span class="lab">Traders</span><b>${R&&R.hist?R.hist.traders:'—'}</b></div><div class="sbox"><span class="lab">Earned</span><b>${R&&R.hist?fmtUsd(R.hist.referral._usd||0):'—'}</b></div><div class="sbox"><span class="lab">Your referrer</span><b style="font-size:12px">${R&&R.myRef?shortAddr(cs(R.myRef)):'none'}</b></div></div>`;
    g('rw-cb').innerHTML=`<p>Part of the fee on every buy and sell comes back to you, in the coin's pair. Referral rewards land in the same balance.</p>
      <div class="mini"><div class="sbox"><span class="lab">Cashback earned</span><b>${R&&R.hist?fmtUsd(R.hist.cashback._usd||0):'—'}</b></div><div class="sbox" style="grid-column:span 2"><span class="lab">Claimable</span><b style="font-size:12.5px">${a?(R?owedTxt():'…'):'—'}</b></div></div>
      ${a?`<div class="claimrow"><div><b>${R?fmtUsd(owedUsd()):'…'}</b><small>cashback and referral, claimable now</small></div><button class="btn pri" id="rw-claimrw" ${R&&R.owed.length?'':'disabled'}>Claim</button></div>`:`<div style="margin-top:14px"><button class="btn pri" data-connect>Connect wallet</button></div>`}`;
    const cp=g('rw-copy'); if(cp) cp.onclick=()=>SP.copy(link,'Referral link copied');
    const cl=g('rw-claimrw'); if(cl) cl.onclick=()=>tx(cl,()=>EQ().claimRewards(R.owed.map(o=>o.pair)),'Rewards claimed');
    $$('#pg-rewards [data-connect]').forEach(b=>b.onclick=()=>SP.W.connect()); }
  async function loadRewards(){ const w=SP.W.connected?SP.W.address:null; if(!w||!EQ()){ R=null; soon(); kpis(); return; }
    try{ const [split,owed,myRef]=await Promise.all([EQ().split(),EQ().rewards(w),EQ().referrerOf(w).catch(()=>'')]); R={split,owed,myRef:myRef&&!/^0x0+$/.test(myRef)?myRef:'',hist:R&&R.hist}; soon(); kpis();
      R.hist=await EQ().history(w).catch(()=>({cashback:{},referral:{},traders:0})); soon(); kpis(); }
    catch(e){ console.warn('rewards',e); } }

  /* ---------- burns ---------- */
  const BURN={};
  async function burned(x){ if(BURN[x.addr]&&Date.now()-BURN[x.addr].at<60000) return BURN[x.addr].v; let v=0; try{ const H=await CHAIN.holders(x.addr,50); const d=(H||[]).find(h=>String(h.wallet).toLowerCase()===DEAD); v=d?+d.bal:0; }catch{} BURN[x.addr]={v,at:Date.now()}; return v; }
  async function burns(){ const L=TOK.filter(x=>(x.genes||{}).buybackShareBps>0); const tb=$('#rw-burns tbody');
    g('rw-burn-wrap').classList.toggle('hidden',!L.length); if(!L.length){ g('rw-burn-empty').innerHTML=`<div class="empty" style="padding:28px 16px"><b>No buyback coins yet</b>Turn on Buyback and burn when you launch. Part of every fee then buys the coin back and burns it.<div style="margin-top:12px"><a class="btn" href="/launch">Launch a coin</a></div></div>`; g('rw-burn-t').innerHTML=''; return; } g('rw-burn-empty').innerHTML='';
    const R=await Promise.all(L.map(async x=>({x,b:await burned(x)}))); R.sort((a,b)=>b.b*(b.x.px||0)-a.b*(a.x.px||0)); const tot=R.reduce((s,r)=>s+r.b*(r.x.px||0),0);
    g('rw-burn-t').innerHTML=`<span>value burned</span><b>${fmtUsd(tot)}</b>`;
    tb.innerHTML=R.map(r=>{ const x=r.x; return `<tr class="go" data-go="${tokenUrl(x)}"><td>${coinCell(x)}</td><td class="r num">${(x.genes.buybackShareBps/100).toFixed(0)}% of fee</td><td class="r num">${fmtAmt(r.b)}<small>${esc(x.t)}</small></td><td class="r num hm">${(r.b/SUPPLY*100).toFixed(3)}%</td><td class="r num">${fmtUsd(r.b*(x.px||0))}</td><td class="r num hm">${fmtUsd((x.buybackPot||0)*(x.pairUsd||0))}<small>${SP.fmtPair(x.buybackPot||0,x)}</small></td></tr>`; }).join('');
    $$('#rw-burns tr[data-go]').forEach(r=>r.onclick=()=>SP.go(r.dataset.go)); }

  /* ---------- load ---------- */
  async function load(){ const w=SP.W.connected?SP.W.address:null; const my=++seq; if(!w){ P=null; kpis(); claims(); return; }
    kpis(); claims(); try{ const r=await CHAIN.profile(w); if(my!==seq) return; P={holdings:(r.holdings||[]).filter(h=>h.x),created:(r.created||[]).filter(c=>c.x)}; }catch(e){ if(my!==seq) return; P={holdings:[],created:[]}; SP.toast('Could not load rewards: '+SP.errMsg(e),'err'); }
    kpis(); claims(); }
  if(EQ()) EQ().split().then(sp=>{ R=R||{owed:[],split:sp}; R.split=sp; soon(); }).catch(()=>{});
  soon(); load(); burns(); loadRewards();
  SP.onWallet(()=>{ P=null; R=null; soon(); load(); loadRewards(); }); SP.onUpdate(()=>{ if(!busy){ load(); loadRewards(); } burns(); });
};
