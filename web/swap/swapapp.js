/* Inkypump Swap pages: token picker, swap / liquidity / stake forms. Live data arrives with the AMM contracts
   (window.INKY.swap.live); until then the forms are fully interactive and the actions say so. */
(function(){
  window.PROFILE_URL='/liquidity';
  const SW=(window.INKY&&INKY.swap)||{}; const SWLIVE=!!SW.live;
  const STOCK_LIST=((window.INKY&&INKY.stocks)||[]).map(s=>({sym:s.symbol,name:(STOCK_NAME[s.symbol]||s.symbol)+' · wrapped xStock',addr:s.address,img:STOCK_IMG(s.symbol),px:0}));
  const TOKENS=[{sym:'ETH',name:'Ether',addr:'ETH',img:ETH_IMG,px:ETH},{sym:'INKY',name:'Inkypump.fun',addr:'0x5E6B13743aC666A68aA5c06bDa61C79e9612A7CE',img:'/img/pfp.png',px:0},{sym:'INU',name:'Ink Inu',addr:'0xB1BF86d693c986956cF91000F49901f3F12274AA',img:'/img/t-default.png',px:0},...STOCK_LIST];
  const byAddr=a=>TOKENS.find(t=>t.addr.toLowerCase()===String(a).toLowerCase())||TOKENS.find(t=>t.sym===a);
  const sel={in:TOKENS[0],out:TOKENS[1],a:TOKENS[1],b:TOKENS[0]};
  const num=v=>parseFloat(String(v||'').replace(/,/g,''))||0;
  const g=id=>document.getElementById(id);

  function paintAsset(side){ const t=sel[side]; const av=document.querySelector(`[data-av="${side}"]`); if(av){ const img=av.querySelector('img'); if(img) img.src=t.img; } const s=document.querySelector(`[data-sym="${side}"]`); if(s) s.textContent=t.sym; }
  function picker(side,other){ const ov=dialog(dh('Select a token','Tokens on Ink with a pool on Inkypump Swap')+`<div class="o-search">${ic('search')}<input id="tq" placeholder="Search name, symbol or address" autocomplete="off"><kbd>ESC</kbd></div><div class="db" id="tlist" style="padding-top:8px"></div>`,'wide',true);
    const list=g('tlist'), inp=g('tq');
    const render=q=>{ q=(q||'').trim().toLowerCase(); const items=TOKENS.filter(t=>!q||t.sym.toLowerCase().includes(q)||t.name.toLowerCase().includes(q)||t.addr.toLowerCase()===q);
      list.innerHTML=items.map(t=>`<button class="sw-tok${sel[side]===t?' on':''}" data-t="${t.addr}"><img src="${t.img}" alt="" onerror="this.src='/img/t-default.png'"><span class="t"><b>${esc(t.sym)}</b><span>${esc(t.name)}</span></span><span class="r">${SWLIVE?'':t.sym==='ETH'||t.sym==='INKY'?'first pool':'at launch'}</span></button>`).join('')||'<p class="py-6 text-center text-sm text-text-muted">No token matches.</p>';
      list.querySelectorAll('[data-t]').forEach(b=>b.onclick=()=>{ const t=byAddr(b.dataset.t); if(other&&sel[other]===t){ sel[other]=sel[side]; paintAsset(other); } sel[side]=t; paintAsset(side); ov.remove(); refresh(); }); };
    inp.oninput=()=>render(inp.value); render(''); setTimeout(()=>inp.focus(),30); }
  document.querySelectorAll('.sw-asset[data-side]').forEach(b=>b.onclick=()=>picker(b.dataset.side,{in:'out',out:'in',a:'b',b:'a'}[b.dataset.side]));

  // header search opens the picker for the pay side on the swap page, or goes to pools elsewhere
  window.openSearch=()=>{ if(g('swapPage')) picker('in','out'); else go('/pools'); };

  /* ---------- swap ---------- */
  function setCta(id,txt,dis){ const c=g(id); if(!c) return; c.textContent=txt; c.disabled=!!dis; }
  function refresh(){
    if(g('swapPage')){ const v=num(g('amtIn').value); g('rate').textContent=`1 ${sel.in.sym} = — ${sel.out.sym}`; g('usdIn').textContent=v&&sel.in.px?'$'+(v*sel.in.px).toFixed(2):''; g('amtOut').value=''; g('usdOut').textContent=''; g('d_minr').textContent='—'; g('d_route').textContent=sel.in.sym==='ETH'||sel.out.sym==='ETH'?`${sel.in.sym} → ${sel.out.sym}`:`${sel.in.sym} → ETH → ${sel.out.sym}`; g('d_impact').textContent='—';
      if(!W.connected) setCta('cta','Connect Wallet'); else if(!SWLIVE) setCta('cta','Swaps open with the AMM',true); else if(!v) setCta('cta','Enter an amount',true); else setCta('cta',`Swap ${sel.in.sym} for ${sel.out.sym}`); }
    if(g('liqPage')){ g('liqPool').textContent=`${sel.a.sym} / ${sel.b.sym}`; if(!W.connected){ setCta('liqCta','Connect Wallet'); setCta('rmCta','Connect Wallet'); } else if(!SWLIVE){ setCta('liqCta','Pools open with the AMM',true); setCta('rmCta','Pools open with the AMM',true); } else { setCta('liqCta','Add liquidity',!(num(g('liqA').value)&&num(g('liqB').value))); setCta('rmCta','Remove liquidity',!num(g('rmRange').value)); } }
    if(g('stakePage')){ if(!W.connected) setCta('skCta','Connect Wallet'); else if(!SWLIVE) setCta('skCta','Staking opens with the AMM',true); else setCta('skCta',g('skTabs').querySelector('.text-text-primary').dataset.stab==='stake'?'Stake INKY':'Unstake INKY',!num(g('skAmt').value)); }
  }
  document.addEventListener('wallet-change',refresh);
  if(g('swapPage')){
    g('amtIn').addEventListener('input',refresh);
    g('flip').onclick=()=>{ const t=sel.in; sel.in=sel.out; sel.out=t; paintAsset('in'); paintAsset('out'); g('amtIn').value=''; refresh(); };
    g('detBtn').onclick=()=>{ const o=g('detBtn').getAttribute('aria-expanded')==='true'; g('detBtn').setAttribute('aria-expanded',String(!o)); g('detBody').classList.toggle('open',!o); };
    g('slipAuto').onclick=()=>{ g('slip').value='0.5'; g('slipLabel').textContent='Auto'; toast('Slippage set to auto (0.5%)'); }; g('slip').addEventListener('input',()=>{ g('slipLabel').textContent=(parseFloat(g('slip').value)||0.5)+'%'; });
    g('swSettings').onclick=()=>{ g('slip').focus(); g('slip').select(); };
    document.querySelectorAll('#swapPage [data-q]').forEach(b=>b.onclick=()=>{ if(!W.connected) return openConnect(); toast('Balances load when the AMM is live'); });
    g('cta').onclick=()=>{ if(!W.connected) return openConnect(); toast('Swaps open with the AMM'); };
  }
  if(g('liqPage')){
    ['liqA','liqB'].forEach(id=>g(id).addEventListener('input',refresh));
    document.querySelectorAll('#liqTabs [data-ltab]').forEach(b=>b.onclick=()=>{ document.querySelectorAll('#liqTabs [data-ltab]').forEach(x=>{ x.className='text-lg font-bold '+(x===b?'text-text-primary':'text-text-muted hover:text-text-secondary'); }); document.querySelectorAll('[data-lpane]').forEach(p=>p.classList.toggle('hidden',p.dataset.lpane!==b.dataset.ltab)); });
    const rm=v=>{ g('rmRange').value=v; g('rmPct').textContent=v+'%'; refresh(); }; g('rmRange').addEventListener('input',()=>rm(g('rmRange').value)); document.querySelectorAll('[data-rm]').forEach(b=>b.onclick=()=>rm(b.dataset.rm));
    document.querySelectorAll('#liqPage [data-q]').forEach(b=>b.onclick=()=>{ if(!W.connected) return openConnect(); toast('Balances load when the AMM is live'); });
    g('liqCta').onclick=()=>{ if(!W.connected) return openConnect(); }; g('rmCta').onclick=()=>{ if(!W.connected) return openConnect(); };
    const pos=g('myPos'); const paintPos=()=>{ pos.innerHTML=W.connected?`<div class="sw-empty">${ic('coins')}<p>No LP positions yet. Pools open with the AMM.</p></div>`:`<div class="sw-empty">${ic('wallet')}<p>Connect a wallet to see your LP positions and the fees they have earned.</p></div>`; }; paintPos(); document.addEventListener('wallet-change',paintPos);
  }
  if(g('stakePage')){
    g('skAmt').addEventListener('input',refresh);
    document.querySelectorAll('#skTabs [data-stab]').forEach(b=>b.onclick=()=>{ document.querySelectorAll('#skTabs [data-stab]').forEach(x=>{ x.className='text-lg font-bold '+(x===b?'text-text-primary':'text-text-muted hover:text-text-secondary'); }); g('skLabel').textContent=b.dataset.stab==='stake'?'Amount to stake':'Amount to unstake'; refresh(); });
    document.querySelectorAll('#stakePage [data-q]').forEach(b=>b.onclick=()=>{ if(!W.connected) return openConnect(); toast('Balances load when the AMM is live'); });
    g('skCta').onclick=()=>{ if(!W.connected) return openConnect(); };
  }
  // pools table
  if(g('poolsPage')){
    const rows=g('poolRows'), mob=g('poolMob');
    const empty=(t,p)=>`<div class="o-empty sm"><div class="ic">${ic('rocket')}</div><h2>${t}</h2><p>${p}</p><a class="o-btn" href="https://www.inkypump.fun" target="_blank" rel="noopener noreferrer">Trade on the launchpad</a></div>`;
    const draw=tab=>{ rows.innerHTML=''; mob.innerHTML=''; const em=tab==='mine'?(W.connected?empty('No positions yet','Your LP positions show up here once you add liquidity.'):empty('Connect your wallet','See the pools you are in and the fees they have earned.')):empty('Pools open with the AMM','The first pool will be INKY/ETH. Every launchpad coin can list the moment its creator adds liquidity.');
      rows.innerHTML=`<tr class="sw-pools-empty"><td colspan="6">${em}</td></tr>`; mob.innerHTML='<div class="o-feed-empty">'+em+'</div>'; };
    let tab='all'; document.querySelectorAll('#ptabs [data-ptab]').forEach(b=>b.onclick=()=>{ tab=b.dataset.ptab; document.querySelectorAll('#ptabs [data-ptab]').forEach(x=>{ x.className=x.className.replace(/ text-text-primary| text-text-muted hover:text-text-secondary/g,'')+(x===b?' text-text-primary':' text-text-muted hover:text-text-secondary'); }); draw(tab); }); draw(tab); document.addEventListener('wallet-change',()=>draw(tab));
  }
  document.addEventListener('data-ready',refresh); refresh();
})();
