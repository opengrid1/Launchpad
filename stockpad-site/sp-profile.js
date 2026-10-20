/* Portfolio page: holdings, holder rewards, creator fees and trade history for the connected wallet,
   or for any wallet read-only via /profile?a=0x... Uses CHAIN.profile(wallet) for everything. */
window.SP_PAGE=function(){
  const pg=$('#pg-portfolio'); if(!pg) return;
  /* locals (not part of the documented core.js API) */
  const EXP=(window.INKY&&INKY.explorer)||'https://etherscan.io';
  const LOGO_FALLBACK='/img/t-default.png';
  const nowS=()=>Math.floor(Date.now()/1000);
  const isAddr=a=>window.CHAIN&&CHAIN.isAddress?CHAIN.isAddress(a):/^0x[0-9a-fA-F]{40}$/.test(a||'');

  const gate=$('#pf-gate'), body=$('#pf-body');
  const T={hold:$('#pf-hold tbody'),made:$('#pf-made tbody'),act:$('#pf-act tbody')};
  const COLS={hold:6,made:6,act:7};
  let seq=0, P=null, who=null, readOnly=false, busy=false, inflight=false, tab='hold';
  $('#pf-gate .ico').innerHTML=ic('wallet'); $('#pf-copy').innerHTML=ic('copy')+'Copy'; $('#pf-ext').innerHTML=ic('ext')+'Etherscan';
  $('#pf-connect').onclick=()=>SP.W.connect();

  /* which wallet to show: ?a= wins, otherwise the connected one */
  function target(){ const a=(new URLSearchParams(location.search).get('a')||'').trim(); if(a&&isAddr(a)) return a.toLowerCase(); return SP.W.connected?SP.W.address:null; }

  const cell=(html,cls)=>`<td class="${cls||''}">${html}</td>`;
  const msgRow=(k,html)=>`<tr><td colspan="${COLS[k]}"><div class="empty">${html}</div></td></tr>`;
  const coinCell=x=>`<div class="coin"><img class="lg" src="${SP.coinLogo(x)}" alt="" onerror="this.onerror=null;this.src='${LOGO_FALLBACK}'"><div><b>${esc(x.t)}</b><small>${esc(x.n)}</small></div></div>`;
  const pairCell=x=>{ const st=SP.stockBySym(x.pair); return `<span class="pairchip"><img src="${pairImg(x.pair)}" alt="" onerror="this.onerror=null;this.src='/img/eth.png'">${esc(st?st.ticker:'ETH')}</span>`; };
  const timeCell=ts=>`<span class="num" title="${esc(new Date(ts*1000).toLocaleString())}">${ago(Math.max(0,nowS()-ts))} ago</span>`;

  function setTab(t){ tab=t; $$('#pf-tabs button').forEach(b=>b.classList.toggle('on',b.dataset.t===t)); $$('#pg-portfolio .pane').forEach(p=>p.classList.toggle('on',p.dataset.p===t)); }
  $$('#pf-tabs button').forEach(b=>b.onclick=()=>setTab(b.dataset.t));

  function header(){
    $('#pf-av').innerHTML=SP.avatar(who,56);
    const full=cs(who); $('#pf-addr').textContent=shortAddr(full); $('#pf-addr').title=full;
    $('#pf-copy').onclick=()=>SP.copy(full,'Address copied'); $('#pf-ext').href=EXP+'/address/'+who;
    const tags=[]; if(readOnly) tags.push('<span class="badge">View only</span>'); if(!readOnly&&SP.isAdmin()) tags.push('<span class="badge acl">Operator</span>'); if(P&&P.created.length) tags.push(`<span class="badge">Creator of ${P.created.length===1?esc(P.created[0].x.t):P.created.length+' coins'}</span>`);
    $('#pf-tags').innerHTML=tags.join('');
    const acts=[]; const claimable=P?P.holdings.filter(h=>h.pend>0):[];
    if(!readOnly&&claimable.length) acts.push(`<button class="btn pri" id="pf-claimall">${ic('coins')}<span>Claim all rewards</span></button>`);
    if(readOnly&&SP.W.connected) acts.push(`<a class="btn ghost" href="/profile">${ic('user')}<span>Your portfolio</span></a>`);
    if(!readOnly) acts.push(`<button class="btn ghost" id="pf-out">${ic('logout')}<span>Disconnect</span></button>`);
    $('#pf-acts').innerHTML=acts.join('');
    const out=$('#pf-out'); if(out) out.onclick=()=>SP.W.disconnect();
    const all=$('#pf-claimall'); if(all) all.onclick=()=>claimAll(all);
  }

  function strip(vals){ const [hv,rw,cf,nc]=vals||['…','…','…','…'];
    const n=P?P.holdings.filter(h=>h.pend>0).length:0, nf=P?P.created.filter(c=>c.fees>0).length:0;
    $('#pf-strip').innerHTML=[
      ['Holdings value',hv,P?(n=>n+(n===1?' coin held':' coins held'))(P.holdings.filter(h=>h.bal>0).length):'loading'],
      ['Holder rewards claimable',rw,P?(n?'across '+n+(n===1?' coin':' coins')+', paid in the pair asset':'nothing pending'):'loading',P&&n?'up':''],
      ['Creator fees claimable',cf,P?(nf?'from '+nf+(nf===1?' coin':' coins'):P.created.length?'nothing pending':'no coins created'):'loading',P&&nf?'up':''],
      ['Coins created',nc,P?'by this wallet':'loading'],
    ].map(s=>`<div class="sbox lg"><span class="lab">${s[0]}</span><b class="${s[3]||''}">${s[1]}</b><i>${esc(s[2])}</i></div>`).join(''); }

  function loadingState(){ strip(null); Object.keys(T).forEach(k=>{ T[k].innerHTML=msgRow(k,'Loading…'); $('#pf-n-'+k).textContent=''; }); $('#pf-notice').innerHTML=''; }

  function render(){
    const H=P.holdings.slice().sort((a,b)=>(b.bal*b.x.px+b.pendUsd)-(a.bal*a.x.px+a.pendUsd));
    const C=P.created.slice().sort((a,b)=>(b.x.mc||0)-(a.x.mc||0));
    const A=P.trades.filter(t=>SP.token(t.token)).sort((a,b)=>(b.ts-a.ts)||((b.index||0)-(a.index||0)));
    const hv=H.reduce((s,h)=>s+h.bal*(h.x.px||0),0), rw=H.reduce((s,h)=>s+(h.pendUsd||0),0), cf=C.reduce((s,c)=>s+c.fees*(c.x.pairUsd||0),0);
    strip([fmtUsd(hv),fmtUsd(rw),fmtUsd(cf),String(C.length)]);
    $('#pf-n-hold').textContent=H.length||''; $('#pf-n-made').textContent=C.length||''; $('#pf-n-act').textContent=A.length||'';
    // holdings
    T.hold.innerHTML=H.length?H.map(h=>{ const x=h.x; return `<tr class="go" data-go="${tokenUrl(x)}">${cell(coinCell(x))}${cell(pairCell(x))}${cell(fmtAmt(h.bal)+`<small>${esc(x.t)}</small>`,'r num')}${cell(fmtUsd(h.bal*(x.px||0))+`<small>${SP.fmtPair(h.bal*(x.pxPair||0),x)}</small>`,'r num')}${cell(h.pend>0?`<span class="up">${fmtUsd(h.pendUsd)}</span><small>${SP.fmtPair(h.pend,x)}</small>`:`<span class="muted">—</span>`,'r num')}${cell(!readOnly&&h.pend>0?`<button class="btn sm" data-claim="${x.addr}">Claim</button>`:'','act')}</tr>`; }).join('')
      :msgRow('hold',`<b>No holdings</b>${readOnly?'This wallet holds no StockPad coins.':'Coins you buy show up here with their pending rewards.'}${readOnly?'':'<div style="margin-top:12px"><a class="btn" href="/">Browse markets</a></div>'}`);
    // created
    T.made.innerHTML=C.length?C.map(c=>{ const x=c.x; return `<tr class="go" data-go="${tokenUrl(x)}">${cell(coinCell(x))}${cell(pairCell(x))}${cell(fmtUsd(x.mc||0),'r num')}${cell(fmtUsd(x.vol||0),'r num')}${cell(c.fees>0?`<span class="up">${fmtUsd(c.fees*(x.pairUsd||0))}</span><small>${SP.fmtPair(c.fees,x)}</small>`:`<span class="muted">—</span>`,'r num')}${cell(!readOnly&&c.fees>0?`<button class="btn sm" data-pay="${x.addr}">Claim</button>`:'','act')}</tr>`; }).join('')
      :msgRow('made',`<b>No coins created</b>${readOnly?'This wallet has not launched a coin.':'Launch a coin and its creator fees are tracked here.'}${readOnly?'':'<div style="margin-top:12px"><a class="btn pri" href="/launch">Launch a coin</a></div>'}`);
    // activity
    T.act.innerHTML=A.length?A.map(t=>{ const x=SP.token(t.token); const coin=Number(t.coin)/1e18, pair=Number(t.pair)/1e18, usd=pair*(x.pairUsd||0);
      return `<tr class="go" data-go="${tokenUrl(x)}">${cell(timeCell(t.ts))}${cell(`<span class="side ${t.buy?'up':'dn'}">${t.buy?'Buy':'Sell'}</span>`)}${cell(coinCell(x))}${cell(fmtAmt(coin)+' '+esc(x.t),'r num')}${cell(SP.fmtPair(pair,x),'r num')}${cell(fmtUsd(usd),'r num')}${cell(t.tx?`<a class="tx" href="${EXP}/tx/${t.tx}" target="_blank" rel="noopener noreferrer" title="View transaction">${ic('ext')}</a>`:'','act')}</tr>`; }).join('')
      :msgRow('act',`<b>No trades yet</b>${readOnly?'This wallet has not traded a StockPad coin.':'Your buys and sells across coins are listed here.'}`);
    $$('#pg-portfolio tr[data-go]').forEach(r=>r.onclick=e=>{ if(e.target.closest('button,a')) return; SP.go(r.dataset.go); });
    $$('#pg-portfolio [data-claim]').forEach(b=>b.onclick=e=>{ e.stopPropagation(); claimOne(b,b.dataset.claim); });
    $$('#pg-portfolio [data-pay]').forEach(b=>b.onclick=e=>{ e.stopPropagation(); payOne(b,b.dataset.pay); });
    header();
  }

  /* ---------- transactions ---------- */
  function canSend(){ if(busy){ SP.toast('A transaction is already in progress','info'); return false; } if(!SP.W.connected){ SP.W.connect(); return false; } if(!SP.W.chainOk){ SP.toast('Switch to Ethereum to claim','err'); SP.W.switchChain().catch(()=>{}); return false; } return true; }
  async function runTx(btn,fn,okMsg){ const old=btn.innerHTML; btn.disabled=true; btn.innerHTML='<span>Confirm in wallet…</span>'; busy=true;
    try{ await fn(); SP.toast(okMsg); return true; }catch(e){ SP.toast(SP.errMsg(e),'err'); return false; }finally{ busy=false; btn.disabled=false; btn.innerHTML=old; } }
  async function claimOne(btn,addr){ if(!canSend()) return; const h=P.holdings.find(h=>h.x.addr===addr); const x=h?h.x:SP.token(addr);
    const ok=await runTx(btn,()=>CHAIN.claim(addr),`Claimed ${h?SP.fmtPair(h.pend,x):'rewards'} from ${x?x.t:'coin'}`); if(ok) load(false); }
  async function payOne(btn,addr){ if(!canSend()) return; const c=P.created.find(c=>c.x.addr===addr); const x=c?c.x:SP.token(addr);
    const ok=await runTx(btn,()=>CHAIN.payCreator(addr),`Creator fees paid: ${c?SP.fmtPair(c.fees,x):''} from ${x?x.t:'coin'}`); if(ok) load(false); }
  async function claimAll(btn){ if(!canSend()) return; const list=P.holdings.filter(h=>h.pend>0); if(!list.length) return;
    const old=btn.innerHTML; btn.disabled=true; busy=true; let done=0;
    try{ for(let i=0;i<list.length;i++){ const h=list[i], x=h.x; btn.innerHTML=`<span>Claiming ${i+1} of ${list.length}…</span>`;
        try{ await CHAIN.claim(x.addr); done++; SP.toast(`Claimed ${SP.fmtPair(h.pend,x)} from ${x.t}`); }
        catch(e){ const m=SP.errMsg(e); SP.toast(`${x.t}: ${m}`,'err'); if(m==='Transaction cancelled') break; } } }
    finally{ busy=false; btn.disabled=false; btn.innerHTML=old; }
    if(done) SP.toast(done===list.length?'All rewards claimed':`${done} of ${list.length} claimed`,'info');
    load(false); }

  /* ---------- load ---------- */
  async function load(showLoading=true){
    const w=target(); const my=++seq;
    if(!w){ who=null; P=null; gate.classList.remove('hidden'); body.classList.add('hidden'); return; }
    const changed=w!==who; who=w; readOnly=!(SP.W.connected&&SP.W.address===w);
    gate.classList.add('hidden'); body.classList.remove('hidden');
    if(changed){ P=null; header(); }
    if(showLoading||changed) loadingState();
    if(!LIVE||!window.CHAIN){ $('#pf-notice').innerHTML=`<div class="notice warn viewonly">${ic('warn')}<span>On-chain data is not available right now.</span></div>`; P={trades:[],holdings:[],created:[]}; render(); return; }
    let r; inflight=true; try{ r=await CHAIN.profile(w); }catch(e){ if(my!==seq) return; $('#pf-notice').innerHTML=`<div class="notice warn viewonly">${ic('warn')}<span>Could not load this portfolio (${esc(SP.errMsg(e))}). <a href="#" id="pf-retry" style="color:var(--fg);text-decoration:underline">Retry</a></span></div>`; $('#pf-retry').onclick=ev=>{ ev.preventDefault(); load(true); }; if(!P){ P={trades:[],holdings:[],created:[]}; render(); } return; }finally{ if(my===seq) inflight=false; }
    if(my!==seq) return; $('#pf-notice').innerHTML='';
    P={trades:r.trades||[],holdings:(r.holdings||[]).filter(h=>h.x),created:(r.created||[]).filter(c=>c.x)}; render();
  }

  load(true);
  SP.onWallet(()=>load(true));
  SP.onUpdate(()=>{ if(!busy&&!inflight&&who) load(false); });
};
