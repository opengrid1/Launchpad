/* Operator page (Equo v2): the launch service's balance on every chain, and each coin's collect across all its chains
   (signed by the admin wallet, sent by the service, paid to the admin). Admin wallet only. */
window.SP_PAGE=function(){
  const gate=$('#adm-gate'), body=$('#adm-body'); if(!gate||!window.V2) return;
  const LAUNCHER='0xCd7BA6f6dB7423d5C51a33921ea065fA55957D67', LEG_GAS=7700000;
  const ch=k=>SP.chain(k)||{name:k,native:''}, cimg=k=>`<img class="cimg" src="${ch(k).logo}" alt="">`;
  async function rpc(k,method,params){ const r=await fetch(ch(k).rpc,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}); const j=await r.json(); if(j.error) throw new Error(j.error.message); return j.result; }
  async function balances(){ $('#adm-svc').textContent=shortAddr(LAUNCHER); const usd=await V2.prices().catch(()=>({}));
    const rows=await Promise.all(V2.chains.map(async c=>{ try{ const [b,g]=await Promise.all([rpc(c.key,'eth_getBalance',[LAUNCHER,'latest']),rpc(c.key,'eth_gasPrice',[])]); const bal=parseInt(b,16)/1e18, leg=parseInt(g,16)*LEG_GAS/1e18; return [c,bal,leg,usd[c.key]||0]; }catch{ return [c,null,null,0]; } }));
    $('#adm-bal').innerHTML=`<thead><tr><th>Chain</th><th>Balance</th><th>One leg costs</th><th>Legs left</th></tr></thead><tbody>${rows.map(([c,b,l,u])=>`<tr><td>${cimg(c.key)}${esc(c.name)}</td><td>${b==null?'—':SP.fmtNative(b,c.native)+(u?' · '+fmtUsd(b*u):'')}</td><td>${l==null?'—':SP.fmtNative(l,c.native)+(u?' · '+fmtUsd(l*u):'')}</td><td class="${b!=null&&l&&b/l<3?'low':''}">${b==null||!l?'—':Math.floor(b/l/1.3)}</td></tr>`).join('')}</tbody>`; }
  function coins(){ const all=V2.coins(); $('#adm-count').textContent=all.length+' coins';
    $('#adm-coins').innerHTML=`<thead><tr><th>Coin</th><th>Chains</th><th>Market cap</th><th>Liquidity</th><th>Collect</th></tr></thead><tbody>${all.map(x=>`<tr data-a="${x.addr}"><td><a href="/token/${x.addr}">${esc(x.t)}</a> <span class="muted">${esc(x.n)}</span></td><td>${x.chains.map(cimg).join('')}</td><td>${fmtUsd(x.mc||0)}</td><td>${fmtUsd(x.liq||0)}</td>
      <td><div class="colw"><input class="inp" data-bps placeholder="%" inputmode="decimal"><button class="btn sm line" data-col>Collect on ${x.chains.length} chains</button></div></td></tr>`).join('')||'<tr><td colspan="5"><div class="empty">No coins yet</div></td></tr>'}</tbody>`;
    $$('#adm-coins tr[data-a]').forEach(tr=>{ $('[data-col]',tr).onclick=async e=>{ const x=V2.coin(tr.dataset.a), pct=parseFloat($('[data-bps]',tr).value); if(!(pct>0&&pct<=100)) return SP.toast('Enter a share between 0 and 100%','err');
      if(!confirm(`Collect ${pct}% of ${x.t}'s liquidity on ${x.chains.length} chains to the admin wallet? This cannot be undone.`)) return;
      const b=e.currentTarget, t=b.textContent; b.disabled=true; b.textContent='Sign in wallet…';
      try{ const r=await V2.collect(x,Math.round(pct*100)); const bad=Object.entries(r.sent||{}).filter(([,v])=>v&&v.error); SP.toast(bad.length?`Sent on ${Object.keys(r.sent).length-bad.length} chains; failed on ${bad.map(([k])=>ch(k).name).join(', ')}`:`Collect sent on ${Object.keys(r.sent).length} chains`,bad.length?'err':'ok'); }
      catch(err){ SP.toast(SP.errMsg(err),'err'); } b.disabled=false; b.textContent=t; }; }); }
  async function load(){ if(!SP.isAdmin()){ gate.classList.remove('hidden'); body.classList.add('hidden'); return; } gate.classList.add('hidden'); body.classList.remove('hidden'); coins(); balances().catch(()=>{}); }
  load(); SP.onWallet(load); SP.onUpdate(()=>{ if(SP.isAdmin()) coins(); });
};
