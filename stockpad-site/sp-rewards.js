/* Rewards page, for Equo v2/v3 coins: the Last-Buyer Pot on each coin's EVM chains (live amounts, timers and
   last buyers, read from each chain's hook) and, for the connected wallet, the creator fees waiting on the coins
   it launched. Pot prizes go straight to the winner's wallet; creator fees go to the creator when anyone sends them. */
window.SP_PAGE=function(){
  const pg=$('#pg-rewards'); if(!pg||!window.V2) return;
  const g=id=>document.getElementById(id);
  const WAYS={ pot:['star','Last-Buyer Pot','var(--amber)'], cre:['rocket','Creator fees','var(--ac)'], how:['clock','How the pot works','var(--amber)'], sh:['shield','Crash shield','var(--dn)'] };
  const head=k=>`<span class="ib" style="--c:${WAYS[k][2]}">${ic(WAYS[k][0])}</span>${WAYS[k][1]}`;
  g('rw-pill').innerHTML=ic('star')+'Earn on every chain';
  g('rw-h-pot').innerHTML=head('pot'); g('rw-h-cre').innerHTML=head('cre'); g('rw-h-how').innerHTML=head('how'); g('rw-h-sh').innerHTML=head('sh');
  const logo=x=>`<img class="lg" src="${SP.coinLogo(x)}" alt="" onerror="this.onerror=null;this.src='${DEF_LOGO}'">`;
  const ch=k=>SP.chain(k)||{name:k,native:''};
  const usd=(k,wei)=>Number(wei||0n)/1e18*((V2.nativeUsd()||{})[k]||0);
  const who=(x,k)=>`<span class="who">${logo(x)}<span><b>${esc(x.n)}</b><small>$${esc(x.t)} · <img class="cimg" src="${ch(k).logo}" alt="" style="width:14px;height:14px;border-radius:50%">${esc(ch(k).name)}</small></span></span>`;
  const coins=()=>V2.coins().filter(x=>!x.hidden).sort((a,b)=>(b.mc||0)-(a.mc||0)).slice(0,25);
  const evm=x=>x.chains.filter(k=>k!=='sol');
  const fmtLeft=s=>{ s=Math.max(0,Math.floor(s)); return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`; };
  let POTS=null, busy=false;

  g('rw-how').innerHTML=`<ol>
    <li>0.1% of every trade on a chain goes into that chain's pot.</li>
    <li>A buy of $50 or more makes you the last buyer and starts a 20 minute timer.</li>
    <li>Every new $50+ buy takes the spot and restarts the timer.</li>
    <li>When the timer runs out, the last buyer gets 80% of the pot, sent straight to their wallet. The other 20% starts the next round.</li>
    <li>Sell before the timer ends and you give up your spot.</li></ol>
    <p style="margin-top:10px">Every coin has its own pot on each of its EVM chains. Solana's pool has no pot.</p>`;
  g('rw-sh').innerHTML=`<p>If a coin falls 20% or more within 10 minutes, its shield turns on: sells pay up to 5% extra, all of it into the pot, and buys pay up to half the fee less. It fades back to normal over 30 minutes.</p>`;

  /* ---------- live pots ---------- */
  async function loadPots(){
    const L=[];
    await Promise.all(coins().flatMap(x=>evm(x).map(async k=>{ try{ const lv=await V2.live(x,k); if(lv&&lv.pot) L.push({x,k,p:lv.pot}); }catch{} })));
    POTS=L; paintPots(); hero(); }
  function paintPots(){
    const box=g('rw-pots');
    if(!POTS){ box.innerHTML='<div class="empty">Reading every chain\'s pot…</div>'; return; }
    const now=Date.now()/1000, L=POTS.slice().sort((a,b)=>usd(b.k,b.p.amount)-usd(a.k,a.p.amount));
    const tot=L.reduce((s,r)=>s+usd(r.k,r.p.amount),0);
    g('rw-pot-t').textContent=`${fmtUsd(tot)} in ${L.filter(r=>r.p.amount>0n).length} pots`;
    if(!L.length){ box.innerHTML='<div class="empty"><b>No pots yet</b>Pots fill as coins trade.</div>'; return; }
    box.innerHTML=`<div class="rows">${L.map(r=>{ const p=r.p, live=p.lastBuyer&&!/^0x0+$/.test(p.lastBuyer)&&p.deadline>now, due=p.lastBuyer&&!/^0x0+$/.test(p.lastBuyer)&&p.deadline&&p.deadline<=now&&p.amount>0n;
      const st=live?`<b class="live">${fmtLeft(p.deadline-now)}</b><small>${shortAddr(cs(p.lastBuyer))} leads</small>`:due?`<b class="up">Ended</b><small>${shortAddr(cs(p.lastBuyer))} won</small>`:`<b class="z">Waiting</b><small>buy ${fmtUsd(usd(r.k,p.minBuy))}+ to start</small>`;
      return `<div class="rr" data-go="${tokenUrl(r.x)}">${who(r.x,r.k)}<span class="m hm"><b>${fmtUsd(usd(r.k,p.amount))}</b><small>round ${p.round}</small></span><span class="m">${st}</span><span class="a">${due?`<button class="btn sm pri" data-settle="${r.x.addr}|${r.k}">Send prize</button>`:''}</span></div>`; }).join('')}</div>`;
    box.querySelectorAll('[data-settle]').forEach(b=>b.onclick=e=>{ e.stopPropagation(); const [a,k]=b.dataset.settle.split('|'); const x=V2.coin(a); send(b,()=>V2.settle(x,k),'Prize sent'); });
  }

  /* ---------- creator fees ---------- */
  let CRE=null;
  async function loadCre(){
    const me=SP.W.connected?String(SP.W.address).toLowerCase():'';
    if(!me){ CRE=null; paintCre(); hero(); return; }
    const mine=V2.coins().filter(x=>x.creator===me);
    const L=[];
    await Promise.all(mine.flatMap(x=>evm(x).map(async k=>{ try{ const lv=await V2.live(x,k); L.push({x,k,owed:lv.creatorOwed||0n}); }catch{} })));
    CRE=L; paintCre(); hero(); }
  function paintCre(){
    const box=g('rw-cre');
    if(!SP.W.connected){ box.innerHTML=`<div class="gate"><span class="ib" style="--c:var(--ac)">${ic('rocket')}</span><b>Connect to see your creator fees</b>Coins you launch pay you a share of every trade, on every chain they live on.<div><button class="btn pri" data-connect>Connect wallet</button></div></div>`; return; }
    if(!CRE){ box.innerHTML='<div class="empty">Loading…</div>'; return; }
    if(!CRE.length){ box.innerHTML=`<div class="empty"><b>No coins launched from this wallet</b>Launch one and your share of every fee builds up here.<div style="margin-top:12px"><a class="btn" href="/launch">Launch a coin</a></div></div>`; return; }
    const L=CRE.slice().sort((a,b)=>usd(b.k,b.owed)-usd(a.k,a.owed));
    box.innerHTML=`<div class="rows">${L.map(r=>`<div class="rr" data-go="${tokenUrl(r.x)}">${who(r.x,r.k)}<span class="m hm"><b class="${r.owed>0n?'up':'z'}">${fmtUsd(usd(r.k,r.owed))}</b><small>${fmtAmt(Number(r.owed)/1e18)} ${esc(ch(r.k).native)}</small></span><span class="m"></span><span class="a">${r.owed>0n?`<button class="btn sm pri" data-pay="${r.x.addr}|${r.k}">Send to me</button>`:''}</span></div>`).join('')}</div>
      <p class="rbody" style="margin:0;padding:4px 18px 16px;color:var(--fg-3);font-size:12.5px">Creator fees on Solana go to the Solana wallet given at launch; send them from the coin page.</p>`;
    box.querySelectorAll('[data-pay]').forEach(b=>b.onclick=e=>{ e.stopPropagation(); const [a,k]=b.dataset.pay.split('|'); send(b,()=>V2.payCreator(V2.coin(a),k),'Creator fees sent'); });
  }

  /* ---------- the hero ---------- */
  function hero(){
    const c=SP.W.connected, me=c?String(SP.W.address).toLowerCase():'';
    const owed=CRE?CRE.reduce((s,r)=>s+usd(r.k,r.owed),0):0;
    const leading=POTS&&me?POTS.filter(r=>r.p.lastBuyer===me&&r.p.deadline>Date.now()/1000):[];
    g('rw-tot').innerHTML=c
      ?`<span class="l">Waiting for you</span><b>${CRE?fmtUsd(owed):'…'}</b><small>${CRE&&owed>0?'Creator fees on your coins. Send them below.':'Creator fees on your coins show here.'}${leading.length?` You lead ${leading.length} pot${leading.length>1?'s':''} right now.`:''} Pot prizes need no claim: they go straight to the winner's wallet.</small>`
      :`<span class="l">Your rewards</span><b>$0.00</b><small>Connect a wallet to see creator fees on your coins and the pots you lead.</small><button class="btn pri" data-connect>Connect wallet</button>`;
    const potTot=POTS?POTS.reduce((s,r)=>s+usd(r.k,r.p.amount),0):null;
    const W=[['pot','Buy $50+ and be the last buyer when the 20 minute timer ends','80% of the pot',potTot!=null?fmtUsd(potTot):'…','in pots now','#pots'],
      ['cre','Launch a coin and earn from every trade on every chain','your share of the fee',c&&CRE?fmtUsd(owed):'—','waiting','#cre'],
      ['sh','Sells pay extra into the pot after a 20% crash','up to 5%','','','#shield']];
    g('rw-ways').innerHTML=W.map(w=>`<a class="way" href="${w[5]}"><span class="ib" style="--c:${WAYS[w[0]][2]}">${ic(WAYS[w[0]][0])}</span><span class="n"><b>${WAYS[w[0]][1]}</b><small>${w[1]} · ${w[2]}</small></span><span class="v"><b>${w[3]}</b><small>${w[4]}</small></span></a>`).join('');
    wire(); }

  /* ---------- shared ---------- */
  async function send(btn,fn,ok){ if(busy) return; busy=true; const t=btn.textContent; btn.disabled=true; btn.textContent='Confirm in wallet…';
    try{ await fn(); SP.toast(ok,'ok'); await Promise.all([loadPots(),loadCre()]); }catch(e){ SP.toast(SP.errMsg(e),'err'); }finally{ busy=false; btn.disabled=false; btn.textContent=t; } }
  function wire(){ pg.querySelectorAll('[data-connect]').forEach(b=>b.onclick=()=>SP.W.connect().catch(e=>SP.toast(SP.errMsg(e),'err'))); pg.querySelectorAll('[data-go]').forEach(r=>r.onclick=()=>SP.go(r.dataset.go)); }

  paintPots(); paintCre(); hero();
  const start=()=>{ loadPots(); loadCre(); };
  if(V2.loaded()) start(); else addEventListener('chain-update',function once(){ removeEventListener('chain-update',once); start(); });
  setInterval(()=>{ if(document.visibilityState!=='hidden'&&!busy) paintPots(); },1000);
  setInterval(()=>{ if(document.visibilityState!=='hidden'&&!busy) loadPots(); },30000);
  SP.onWallet(()=>{ CRE=null; paintCre(); hero(); loadCre(); });
};
