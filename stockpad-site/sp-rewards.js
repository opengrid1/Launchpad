/* Rewards page: holder rewards and creator fees claimable across every coin (on chain, today), what buybacks have burned
   (on chain, today), and the referral and cashback programmes that arrive with the next contract update (shown as Soon). */
window.SP_PAGE=function(){
  const pg=$('#pg-rewards'); if(!pg) return;
  const g=id=>document.getElementById(id);
  const DEAD='0x000000000000000000000000000000000000dead';
  let P=null, seq=0, busy=false;
  g('rw-h-hold').innerHTML=ic('coins')+'Holder rewards'; g('rw-h-cre').innerHTML=ic('rocket')+'Creator fees'; g('rw-h-ref').innerHTML=ic('link')+'Refer traders'; g('rw-h-cb').innerHTML=ic('gift')+'Cashback'; g('rw-h-burn').innerHTML=ic('flame')+'Buyback burns';
  const coinCell=x=>`<div class="coin"><span class="av2"><img class="lg" src="${SP.coinLogo(x)}" alt="" onerror="this.onerror=null;this.src='${DEF_LOGO}'"><img class="stb" src="${pairImg(x.pair)}" alt="" onerror="this.onerror=null;this.src='/img/eth.png'"></span><div><b>$${esc(x.t)}</b><small>${esc(x.n)}</small></div></div>`;
  const gate=(t,s)=>`<div class="gate"><b>${t}</b>${s}<div><button class="btn pri" data-connect>Connect wallet</button></div></div>`;

  /* ---------- KPIs ---------- */
  function kpis(){ const c=SP.W.connected; const rw=P?P.holdings.reduce((s,h)=>s+(h.pendUsd||0),0):0, cf=P?P.created.reduce((s,c)=>s+c.fees*(c.x.pairUsd||0),0):0;
    const nr=P?P.holdings.filter(h=>h.pend>0).length:0, nc=P?P.created.filter(c=>c.fees>0).length:0;
    const K=[['Holder rewards',c?(P?fmtUsd(rw):'…'):'—',c&&P?(nr?`claimable from ${nr} ${nr===1?'coin':'coins'}`:'nothing to claim'):'connect to see',''],['Creator fees',c?(P?fmtUsd(cf):'…'):'—',c&&P?(P.created.length?`${nc} of ${P.created.length} ${P.created.length===1?'coin':'coins'} with fees`:'no coins created'):'connect to see',''],['Referral earnings','—','next contract update','soon'],['Cashback','—','next contract update','soon']];
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
    try{ await fn(); SP.toast(msg); load(); }catch(e){ SP.toast(SP.errMsg(e),'err'); }finally{ busy=false; btn.disabled=false; btn.innerHTML=t; } }
  async function claimAll(btn){ if(busy) return; const l=P.holdings.filter(h=>h.pend>0); busy=true; btn.disabled=true; let done=0;
    try{ for(let i=0;i<l.length;i++){ btn.textContent=`Claiming ${i+1} of ${l.length}…`; try{ await CHAIN.claim(l[i].x.addr); done++; }catch(e){ const m=SP.errMsg(e); SP.toast(`$${l[i].x.t}: ${m}`,'err'); if(m==='Transaction cancelled') break; } } }
    finally{ busy=false; } if(done) SP.toast(done===l.length?'All rewards claimed':`${done} of ${l.length} claimed`,'info'); load(); }

  /* ---------- referral and cashback (next contract update) ---------- */
  function soon(){ const a=SP.W.connected?SP.W.address:'';
    g('rw-ref').innerHTML=`<p>Share your link. When a trader you bring buys or sells, part of their fee goes to you.</p><div class="lnk"><span>${a?esc(location.host+'/?ref='+shortAddr(cs(a))):'Connect a wallet to get your link'}</span><button class="btn sm" disabled>${ic('copy')}Copy</button></div><div class="mini"><div class="sbox"><span class="lab">Traders</span><b>—</b></div><div class="sbox"><span class="lab">Volume</span><b>—</b></div><div class="sbox"><span class="lab">Earned</span><b>—</b></div></div><p class="hint" style="margin-top:12px">Comes with the next contract update.</p>`;
    g('rw-cb').innerHTML=`<p>Part of the fee on every buy and sell comes back to you.</p><div class="steps"><div><em>1</em><span>Trade any coin on Equo.</span></div><div><em>2</em><span>Cashback adds up with each trade, paid in the coin's pair.</span></div><div><em>3</em><span>Claim it here whenever you want.</span></div></div><p class="hint" style="margin-top:12px">Comes with the next contract update.</p>`; }

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
  soon(); load(); burns();
  SP.onWallet(()=>{ P=null; soon(); load(); }); SP.onUpdate(()=>{ if(!busy) load(); burns(); });
};
