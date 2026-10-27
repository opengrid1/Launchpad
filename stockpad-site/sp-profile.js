/* Profile (Equo v2): a wallet's coins on every chain (balance per chain, value at each coin's price), the coins it
   created with the creator fees waiting on each chain, and its trades. Any wallet with ?a=0x…, else the connected one. */
window.SP_PAGE=function(){
  const pg=$('#pg-portfolio'); if(!pg||!window.V2) return;
  const isAddr=a=>/^0x[0-9a-fA-F]{40}$/.test(a);
  const ch=k=>SP.chain(k)||{name:k,native:'',logo:'',explorer:EXPLORER}, cimg=k=>`<img class="cimg" src="${ch(k).logo}" alt="" title="${esc(ch(k).name)}">`;
  const coinCell=x=>`<div class="coin"><img class="lg" src="${SP.coinLogo(x)}" alt="" onerror="this.onerror=null;this.src='${DEF_LOGO}'"><div><b>${esc(x.t)}</b><small>${esc(x.n)}</small></div></div>`;
  const T={hold:$('#pf-hold tbody'),made:$('#pf-made tbody'),act:$('#pf-act tbody')};
  let tab='hold', who=null, D=null;
  function target(){ const a=(new URLSearchParams(location.search).get('a')||'').trim(); if(a&&isAddr(a)) return a.toLowerCase(); return SP.W.connected?SP.W.address:null; }
  $$('#pf-tabs [data-t]').forEach(b=>b.onclick=()=>{ tab=b.dataset.t; $$('#pf-tabs [data-t]').forEach(x=>x.classList.toggle('on',x===b)); $$('#pg-portfolio .pane').forEach(p=>p.classList.toggle('on',p.dataset.p===tab)); });
  pg.addEventListener('click',e=>{ const r=e.target.closest('tr[data-go]'); if(r&&!e.target.closest('a,button')) SP.go(r.dataset.go); });
  const coinOf=id=>{ const j=(D.coins||[]).find(c=>c.id===id); if(!j) return null; const main=(j.chains.eth||Object.values(j.chains)[0]).token; return V2.coin(main)||{addr:main,n:j.name,t:j.symbol,img:'',px:j.price||0,mc:j.mc||0,vol:j.vol24||0,chains:Object.keys(j.chains),addrs:Object.fromEntries(Object.entries(j.chains).map(([k,v])=>[k,v.token]))}; };

  async function load(){ who=target();
    $('#pf-gate').classList.toggle('hidden',!!who); $('#pf-body').classList.toggle('hidden',!who); if(!who) return;
    const full=cs(who), mine=SP.W.connected&&SP.W.address===who;
    $('#pf-addr').textContent=shortAddr(full); $('#pf-addr').title=full; $('#pf-copy').innerHTML=ic('copy')+'Copy'; $('#pf-copy').onclick=()=>SP.copy(full,'Address copied');
    $('#pf-ext').innerHTML=ic('ext')+'Explorer'; $('#pf-ext').href=EXPLORER+'/address/'+who; $('#pf-tags').innerHTML=mine?'':'<span class="tag">View only</span>';
    try{ D=await V2.api('/api/wallet?wallet='+who); }catch(e){ D={coins:[],balances:[],created:[],trades:[]}; $('#pf-notice').innerHTML=`<div class="notice warn">${ic('warn')}<span>Could not load this wallet (${esc(SP.errMsg(e))}).</span></div>`; }
    paint(); fees(); }

  function holdings(){ const by={}; D.balances.forEach(b=>{ (by[b.coin]=by[b.coin]||{coin:b.coin,bal:0,chains:{}}); by[b.coin].bal+=Number(b.balance)/1e18; by[b.coin].chains[b.chain]=(by[b.coin].chains[b.chain]||0)+Number(b.balance)/1e18; });
    return Object.values(by).map(h=>({...h,x:coinOf(h.coin)})).filter(h=>h.x).sort((a,b)=>b.bal*(b.x.px||0)-a.bal*(a.x.px||0)); }
  let feeUsd=0;
  function paint(){ const H=holdings(), M=D.created.map(coinOf).filter(Boolean), A=D.trades;
    const val=H.reduce((s,h)=>s+h.bal*(h.x.px||0),0);
    $('#pf-strip').innerHTML=[['Holdings value',fmtUsd(val)],['Creator fees waiting',fmtUsd(feeUsd)],['Coins created',M.length],['Trades',A.length]].map(s=>`<div class="sbox"><span>${s[0]}</span><b>${s[1]}</b></div>`).join('');
    $('#pf-n-hold').textContent=H.length||''; $('#pf-n-made').textContent=M.length||''; $('#pf-n-act').textContent=A.length||'';
    T.hold.innerHTML=H.length?H.map(h=>`<tr class="go" data-go="${tokenUrl(h.x)}"><td>${coinCell(h.x)}</td><td>${Object.keys(h.chains).map(k=>`<span title="${esc(ch(k).name)}: ${fmtAmt(h.chains[k])}">${cimg(k)}</span>`).join('')}</td><td class="r num">${fmtAmt(h.bal)}<small> ${esc(h.x.t)}</small></td><td class="r num">${fmtUsd(h.bal*(h.x.px||0))}</td><td class="act"><a class="btn sm line" href="${tokenUrl(h.x)}">Trade</a></td></tr>`).join('')
      :`<tr><td colspan="5"><div class="empty"><b>No holdings</b>This wallet holds no Equo coins.</div></td></tr>`;
    T.made.innerHTML=M.length?M.map(x=>`<tr class="go" data-go="${tokenUrl(x)}"><td>${coinCell(x)}</td><td>${(x.chains||[]).map(cimg).join('')}</td><td class="r num">${fmtUsd(x.mc||0)}</td><td class="r num">${fmtUsd(x.vol||0)}</td><td class="r num" data-fee="${x.addr}">…</td><td class="act"><a class="btn sm line" href="${tokenUrl(x)}">Open</a></td></tr>`).join('')
      :`<tr><td colspan="6"><div class="empty"><b>No coins created</b><a href="/launch">Launch one</a> on every chain at once.</div></td></tr>`;
    T.act.innerHTML=A.length?A.map(t=>{ const x=coinOf(t.coin), c=ch(t.chain); if(!x) return ''; return `<tr class="go" data-go="${tokenUrl(x)}"><td>${ago(Math.max(0,Math.floor(Date.now()/1000)-t.ts))} ago</td><td class="side ${t.buy?'up':'dn'}">${t.buy?'Buy':'Sell'}</td><td>${coinCell(x)}</td><td>${cimg(t.chain)}${esc(c.short||c.name)}</td><td class="r num">${fmtAmt(Number(t.coin_amt)/1e18)}</td><td class="r num">${SP.fmtNative(Number(t.pair)/1e18,c.native)}</td><td class="r num">${t.valueUsd!=null?fmtUsd(t.valueUsd):'—'}</td><td class="act"><a class="tx" href="${c.explorer}/tx/${t.tx}" target="_blank" rel="noopener">${ic('ext')}</a></td></tr>`; }).join('')
      :`<tr><td colspan="8"><div class="empty"><b>No trades yet</b></div></td></tr>`; }
  // creator fees waiting: the hook's balance for the creator on every chain of every coin it made
  async function fees(){ const M=D.created.map(coinOf).filter(Boolean); if(!M.length) return; const usd=V2.nativeUsd(); let tot=0;
    await Promise.all(M.map(async x=>{ let s=0; await Promise.all((x.chains||[]).map(async k=>{ try{ const l=await V2.live(x,k); s+=Number(l.creatorOwed)/1e18*(usd[k]||0); }catch{} })); tot+=s; const el=$(`[data-fee="${x.addr}"]`); if(el) el.textContent=fmtUsd(s); }));
    feeUsd=tot; const b=$('#pf-strip .sbox:nth-child(2) b'); if(b) b.textContent=fmtUsd(tot); }
  $('#pf-connect').onclick=()=>SP.W.connect().catch(e=>SP.toast(SP.errMsg(e),'err'));
  load(); SP.onWallet(()=>{ if(!new URLSearchParams(location.search).get('a')) load(); });
};
