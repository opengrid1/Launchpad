/* Rewards page: what you can claim now and the four ways to earn (holder rewards, creator fees, referrals, cashback),
   each with its own card, and what buybacks have burned. Everything is read from chain; claims are transactions from
   the connected wallet. */
window.SP_PAGE=function(){
  const pg=$('#pg-rewards'); if(!pg) return;
  const g=id=>document.getElementById(id);
  const DEAD='0x000000000000000000000000000000000000dead';
  let P=null, R=null, seq=0, busy=false;
  const EQ=()=>window.CHAIN&&CHAIN.equo;
  const usdOf=(pair,amt)=>{ const p=String(pair).toLowerCase(); return amt*(SP.prices[p]||0); };
  const owedUsd=()=>R?R.owed.reduce((s,o)=>s+usdOf(o.pair,o.amount),0):0;
  const owedTxt=()=>R&&R.owed.length?R.owed.map(o=>`${fmtAmt(o.amount)} ${esc(o.symbol)}`).join(' · '):'nothing yet';
  const WAYS={ hold:['coins','Holder rewards','var(--amber)'], cre:['rocket','Creator fees','var(--ac)'], ref:['link','Referrals','#8c9eff'], cb:['gift','Cashback','var(--up)'] };
  const head=k=>`<span class="ib" style="--c:${WAYS[k][2]}">${ic(WAYS[k][0])}</span>${WAYS[k][1]}`;
  g('rw-pill').innerHTML=ic('star')+'Earn on every chain';
  g('rw-h-hold').innerHTML=head('hold'); g('rw-h-cre').innerHTML=head('cre'); g('rw-h-ref').innerHTML=head('ref').replace('Referrals','Refer traders'); g('rw-h-cb').innerHTML=head('cb');
  g('rw-h-burn').innerHTML=`<span class="ib" style="--c:var(--dn)">${ic('flame')}</span>Buyback burns`;
  const logo=x=>`<img class="lg" src="${SP.coinLogo(x)}" alt="" onerror="this.onerror=null;this.src='${DEF_LOGO}'">`;
  const who=x=>`<span class="who">${logo(x)}<span><b>${esc(x.n)}</b><small>$${esc(x.t)} ${SP.chainStack(SP.coinChains(x),14)}</small></span></span>`;
  const gate=(k,t,s,btn)=>`<div class="gate"><span class="ib" style="--c:${WAYS[k][2]}">${ic(WAYS[k][0])}</span><b>${t}</b>${s}<div>${btn||'<button class="btn pri" data-connect>Connect wallet</button>'}</div></div>`;
  const pct=b=>R&&R.split?(0.4*b/100).toFixed(0)+'%':'…';

  /* ---------- the hero: claimable now, and the four ways to earn ---------- */
  function hero(){ const c=SP.W.connected;
    const hold=P?P.holdings.reduce((s,h)=>s+(h.pendUsd||0),0):0, cre=P?P.created.reduce((s,c)=>s+c.fees*(c.x.pairUsd||0),0):0, rw=owedUsd();
    const ready=c&&P, total=hold+cre+rw;
    g('rw-tot').innerHTML=c?`<span class="l">Claimable now</span><b>${ready?fmtUsd(total):'…'}</b><small>${ready?(total>0?'Holder rewards, creator fees, cashback and referrals together. Claim each below.':'Nothing to claim yet. Hold, launch, refer or trade and it adds up here.'):'Reading your rewards on every chain…'}</small>`
      :`<span class="l">Your rewards</span><b>$0.00</b><small>Connect a wallet to see what you can claim across every coin and every chain.</small><button class="btn pri" data-connect>Connect wallet</button>`;
    const sp=R&&R.split;
    const W=[['hold','Hold coins with the Holder rewards badge','up to 50% of fees',c&&P?hold:null,'#hold'],['cre','Launch a coin and earn from every trade','up to 60% of fees',c&&P?cre:null,'#cre'],
      ['ref','Bring traders with your link, for life',sp?`up to ${pct(sp.referralBps)} of fees`:'a share of fees',c&&R&&R.hist?R.hist.referral._usd||0:null,'#ref'],['cb','Part of every fee comes back on your trades',sp?`up to ${pct(sp.cashbackBps)} of fees`:'a share of fees',c&&R&&R.hist?R.hist.cashback._usd||0:null,'#cb']];
    g('rw-ways').innerHTML=W.map(w=>`<a class="way" href="${w[4]}"><span class="ib" style="--c:${WAYS[w[0]][2]}">${ic(WAYS[w[0]][0])}</span><span class="n"><b>${WAYS[w[0]][1]}</b><small>${w[1]} · ${w[2]}</small></span><span class="v"><b class="${w[3]>0?'on':''}">${w[3]==null?'—':fmtUsd(w[3])}</b><small>${w[0]==='ref'||w[0]==='cb'?'earned':'claimable'}</small></span></a>`).join('');
    wire(); }

  /* ---------- holder rewards, creator fees ---------- */
  function claims(){ const c=SP.W.connected;
    if(!c){ g('rw-hold').innerHTML=gate('hold','Connect to see your holder rewards','Coins with holder rewards pay part of every fee to the people holding them.'); g('rw-cre').innerHTML=gate('cre','Connect to see your creator fees','Coins you launch pay you a share of every fee, on every chain they live on.'); g('rw-claimall').innerHTML=''; wire(); return; }
    if(!P){ g('rw-hold').innerHTML='<div class="empty">Loading…</div>'; g('rw-cre').innerHTML='<div class="empty">Loading…</div>'; return; }
    const H=P.holdings.filter(h=>h.x.rewards||h.pend>0).sort((a,b)=>b.pendUsd-a.pendUsd);
    g('rw-hold').innerHTML=H.length?`<div class="rows">${H.map(h=>`<div class="rr" data-go="${tokenUrl(h.x)}">${who(h.x)}<span class="m hm"><b>${fmtUsd(h.bal*(h.x.px||0))}</b><small>${fmtAmt(h.bal)} held</small></span><span class="m"><b class="${h.pend>0?'up':'z'}">${h.pend>0?fmtUsd(h.pendUsd):'$0.00'}</b><small>${h.pend>0?SP.fmtPair(h.pend,h.x):'claimable'}</small></span><span class="a">${h.pend>0?`<button class="btn sm pri" data-claim="${h.x.addr}">Claim</button>`:''}</span></div>`).join('')}</div>`
      :gate('hold','No holder rewards yet','Hold a coin with the Holder rewards badge and part of every fee comes to you.','<a class="btn" href="/markets">Browse coins</a>');
    const n=H.filter(h=>h.pend>0).length; g('rw-claimall').innerHTML=n>1?`<button class="btn sm pri" id="rw-all">Claim all (${n})</button>`:'';
    const C=P.created.slice().sort((a,b)=>b.fees*(b.x.pairUsd||0)-a.fees*(a.x.pairUsd||0));
    g('rw-cre').innerHTML=C.length?`<div class="rows">${C.map(c=>`<div class="rr" data-go="${tokenUrl(c.x)}">${who(c.x)}<span class="m hm"><b>${fmtUsd(c.x.vol||0)}</b><small>volume 24h</small></span><span class="m"><b class="${c.fees>0?'up':'z'}">${c.fees>0?fmtUsd(c.fees*(c.x.pairUsd||0)):'$0.00'}</b><small>${c.fees>0?SP.fmtPair(c.fees,c.x):'claimable'}</small></span><span class="a">${c.fees>0?`<button class="btn sm pri" data-pay="${c.x.addr}">Claim</button>`:''}</span></div>`).join('')}</div>`
      :gate('cre','No coins launched yet','Coins you launch pay you a share of every fee, on every chain they live on.','<a class="btn pri" href="/launch">Launch a coin</a>');
    wire(); }
  function wire(){ $$('#pg-rewards [data-connect]').forEach(b=>b.onclick=()=>SP.W.connect());
    $$('#pg-rewards .rr[data-go],#pg-rewards .brow[data-go]').forEach(r=>r.onclick=e=>{ if(e.target.closest('button,a')) return; SP.go(r.dataset.go); });
    $$('#pg-rewards [data-claim]').forEach(b=>b.onclick=()=>tx(b,()=>CHAIN.claim(b.dataset.claim),'Rewards claimed'));
    $$('#pg-rewards [data-pay]').forEach(b=>b.onclick=()=>tx(b,()=>CHAIN.payCreator(b.dataset.pay),'Creator fees claimed'));
    const all=g('rw-all'); if(all) all.onclick=()=>claimAll(all); }
  async function tx(btn,fn,msg){ if(busy) return SP.toast('A transaction is already in progress','info'); if(!SP.W.chainOk){ SP.W.switchChain().catch(()=>{}); return; } const t=btn.innerHTML; busy=true; btn.disabled=true; btn.textContent='Confirm…';
    try{ await fn(); SP.toast(msg); load(); loadRewards(); }catch(e){ SP.toast(SP.errMsg(e),'err'); }finally{ busy=false; btn.disabled=false; btn.innerHTML=t; } }
  async function claimAll(btn){ if(busy) return; const l=P.holdings.filter(h=>h.pend>0); busy=true; btn.disabled=true; let done=0;
    try{ for(let i=0;i<l.length;i++){ btn.textContent=`Claiming ${i+1} of ${l.length}…`; try{ await CHAIN.claim(l[i].x.addr); done++; }catch(e){ const m=SP.errMsg(e); SP.toast(`$${l[i].x.t}: ${m}`,'err'); if(m==='Transaction cancelled') break; } } }
    finally{ busy=false; } if(done) SP.toast(done===l.length?'All rewards claimed':`${done} of ${l.length} claimed`,'info'); load(); }

  /* ---------- referral and cashback (Equo hook: a share of the platform's part of every fee) ---------- */
  function refcb(){ const a=SP.W.connected?SP.W.address:''; const sp=R&&R.split;
    g('rw-ref-rate').textContent=sp?`up to ${pct(sp.referralBps)} of fees`:''; g('rw-cb-rate').textContent=sp?`up to ${pct(sp.cashbackBps)} of fees`:'';
    const link=a?SP.refLink(a):'';
    g('rw-ref').innerHTML=`<p>Share your link. Every trader who comes through it is yours for life: part of every fee they pay goes to you, on every coin and every chain.</p><div class="lnk ${a?'on':''}"><span>${a?esc(link.replace(/^https?:\/\//,'')):'Connect a wallet to get your link'}</span>${a?`<button class="btn sm" id="rw-copy">${ic('copy')}Copy</button><a class="btn sm" target="_blank" rel="noopener" aria-label="Share on X" href="https://x.com/intent/tweet?text=${encodeURIComponent('One launch, every chain. Trade coins on up to nine chains at once on Equo '+link)}">${ic('xlogo')}</a>`:''}</div>
      <div class="mini"><div><span>Traders</span><b>${R&&R.hist?R.hist.traders:'—'}</b></div><div><span>Earned</span><b>${R&&R.hist?fmtUsd(R.hist.referral._usd||0):'—'}</b></div><div><span>Your referrer</span><b>${R&&R.myRef?shortAddr(cs(R.myRef)):'none'}</b></div></div>`;
    g('rw-cb').innerHTML=`<p>Part of the fee on every buy and sell comes back to you, in the coin's pair. Referral rewards land in the same balance.</p>
      <div class="mini"><div><span>Cashback earned</span><b>${R&&R.hist?fmtUsd(R.hist.cashback._usd||0):'—'}</b></div><div style="grid-column:span 2"><span>Claimable</span><b>${a?(R?owedTxt():'…'):'—'}</b></div></div>
      ${a?`<div class="claimrow"><div><b>${R?fmtUsd(owedUsd()):'…'}</b><small>cashback and referrals, claimable now</small></div><button class="btn pri" id="rw-claimrw" ${R&&R.owed.length?'':'disabled'}>Claim</button></div>`:`<div style="margin-top:14px"><button class="btn pri" data-connect>Connect wallet</button></div>`}`;
    const cp=g('rw-copy'); if(cp) cp.onclick=()=>SP.copy(link,'Referral link copied');
    const cl=g('rw-claimrw'); if(cl) cl.onclick=()=>tx(cl,()=>EQ().claimRewards(R.owed.map(o=>o.pair)),'Rewards claimed');
    wire(); }
  async function loadRewards(){ const w=SP.W.connected?SP.W.address:null; if(!w||!EQ()){ R=R&&R.split?{owed:[],split:R.split}:null; refcb(); hero(); return; }
    try{ const [split,owed,myRef]=await Promise.all([EQ().split(),EQ().rewards(w),EQ().referrerOf(w).catch(()=>'')]); R={split,owed,myRef:myRef&&!/^0x0+$/.test(myRef)?myRef:'',hist:R&&R.hist}; refcb(); hero();
      R.hist=await EQ().history(w).catch(()=>({cashback:{},referral:{},traders:0})); refcb(); hero(); }
    catch(e){ console.warn('rewards',e); } }

  /* ---------- burns ---------- */
  const BURN={};
  async function burned(x){ if(BURN[x.addr]&&Date.now()-BURN[x.addr].at<60000) return BURN[x.addr].v; let v=0; try{ const H=await CHAIN.holders(x.addr,50); const d=(H||[]).find(h=>String(h.wallet).toLowerCase()===DEAD); v=d?+d.bal:0; }catch{} BURN[x.addr]={v,at:Date.now()}; return v; }
  async function burns(){ const L=TOK.filter(x=>(x.genes||{}).buybackShareBps>0), box=g('rw-burns');
    if(!L.length){ box.innerHTML=`<div class="empty"><b>No buyback coins yet</b>Turn on Buyback and burn when you launch. Part of every fee then buys the coin back and burns it.<div style="margin-top:12px"><a class="btn" href="/launch">Launch a coin</a></div></div>`; g('rw-burn-t').innerHTML=''; return; }
    const B=await Promise.all(L.map(async x=>({x,b:await burned(x)}))); B.sort((a,b)=>b.b*(b.x.px||0)-a.b*(a.x.px||0)); const tot=B.reduce((s,r)=>s+r.b*(r.x.px||0),0);
    g('rw-burn-t').innerHTML=`<span>value burned</span><b>${fmtUsd(tot)}</b>`;
    box.innerHTML=B.map(r=>{ const x=r.x, sup=SUPPLY*SP.coinChains(x).length, pc=r.b/sup*100; return `<div class="brow" data-go="${tokenUrl(x)}">${who(x)}<span class="hm"><span class="bbar"><i style="width:${Math.min(100,Math.max(pc?1.5:0,pc*4)).toFixed(1)}%"></i></span><span class="bpc">${pc.toFixed(3)}% of supply · ${(x.genes.buybackShareBps/100).toFixed(0)}% of every fee</span></span><span class="m" style="text-align:right"><b style="font:700 15px var(--tight)">${fmtUsd(r.b*(x.px||0))}</b><small style="font-size:11.5px;color:var(--fg-3)">${fmtAmt(r.b)} burned</small></span><span class="m hm" style="text-align:right"><b style="font:700 15px var(--tight)">${fmtUsd((x.buybackPot||0)*(x.pairUsd||0))}</b><small style="font-size:11.5px;color:var(--fg-3)">in the pot</small></span></div>`; }).join('');
    wire(); }

  /* ---------- load ---------- */
  async function load(){ const w=SP.W.connected?SP.W.address:null; const my=++seq; if(!w){ P=null; hero(); claims(); return; }
    hero(); claims(); try{ const r=await CHAIN.profile(w); if(my!==seq) return; P={holdings:(r.holdings||[]).filter(h=>h.x),created:(r.created||[]).filter(c=>c.x)}; }catch(e){ if(my!==seq) return; P={holdings:[],created:[]}; SP.toast('Could not load rewards: '+SP.errMsg(e),'err'); }
    hero(); claims(); }
  if(EQ()) EQ().split().then(sp=>{ R=R||{owed:[],split:sp}; R.split=sp; refcb(); hero(); }).catch(()=>{});
  refcb(); load(); burns(); loadRewards();
  if(location.hash==='#burns') setTimeout(()=>g('burns').scrollIntoView({behavior:'smooth'}),400);
  SP.onWallet(()=>{ P=null; R=null; refcb(); load(); loadRewards(); }); SP.onUpdate(()=>{ if(!busy){ load(); loadRewards(); } burns(); });
};
