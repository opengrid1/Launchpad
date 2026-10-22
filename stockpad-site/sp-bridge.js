/* Bridge page: move a coin between chains. LayerZero burns it on the source chain and mints it on the destination.
   The contracts for HyperEVM and BNB Chain are not deployed yet, so the form quotes and explains but cannot send. */
window.SP_PAGE=function(){
  const pg=$('#pg-bridge'); if(!pg) return;
  const g=id=>document.getElementById(id);
  const CH=SP.chains, BPS=((window.INKY&&INKY.bridgeFeeBps)||20)/10000, FAST=((window.INKY&&INKY.fastFeeBps)||20)/10000, RELAY=0.001;
  const coins=()=>((window.CHAIN&&LIVE)?CHAIN.tokens():TOK).filter(x=>!x.hidden);
  const S={from:(CH.find(c=>c.main)||CH[0]).key, to:(CH.find(c=>!c.main)||CH[1]).key, speed:'std', coin:null};
  const amt=()=>{ const v=parseFloat(String(g('br-amt').value).replace(/,/g,'')); return isFinite(v)&&v>0?v:0; };
  const fee=()=>BPS+(S.speed==='fast'?FAST+RELAY:0);
  const eta=()=>S.speed==='fast'?'~10 seconds':'~1–2 minutes';
  const live=()=>SP.chainDeployed(S.from)&&SP.chainDeployed(S.to);

  function chainBtn(el,k){ const c=SP.chain(k); el.innerHTML=`<img src="${c.logo}" alt="">${esc(c.name)}${ic('down')}`; }
  function coinBtn(){ const x=S.coin; const h=x?`<img src="${SP.coinLogo(x)}" alt="" onerror="this.onerror=null;this.src='${DEF_LOGO}'"><span>${esc(x.t)}</span>`:'<span>Select coin</span>'; g('br-coin').innerHTML=h+ic('down'); g('br-coin2').innerHTML=x?`<img src="${SP.coinLogo(x)}" alt="" onerror="this.onerror=null;this.src='${DEF_LOGO}'"><span>${esc(x.t)}</span>`:''; }
  function pickChain(btn,side){ const m=SP.menu(btn,CH.map(c=>`<button data-k="${c.key}" class="${S[side]===c.key?'on':''}"><img src="${c.logo}" alt="" style="width:20px;height:20px;border-radius:50%">${esc(c.name)}<span style="margin-left:auto">${c.live?'<span class="liveb">Live</span>':'<span class="soonb">Soon</span>'}</span></button>`).join(''));
    $$('[data-k]',m).forEach(b=>b.onclick=()=>{ m.remove(); const k=b.dataset.k, other=side==='from'?'to':'from'; if(S[other]===k) S[other]=S[side]; S[side]=k; paint(); }); }
  function pickCoin(btn){ const l=coins(); if(!l.length){ SP.toast('No coins yet','info'); return; }
    const m=SP.menu(btn,`<div class="mh">Your coins</div>`+l.slice(0,40).map(x=>`<button data-a="${x.addr}"><img src="${SP.coinLogo(x)}" alt="" style="width:22px;height:22px;border-radius:50%;object-fit:cover" onerror="this.onerror=null;this.src='${DEF_LOGO}'"><span>${esc(x.t)} <span class="muted">${esc(x.n)}</span></span><span style="margin-left:auto">${SP.chainStack(SP.coinChains(x),14)}</span></button>`).join(''));
    $$('[data-a]',m).forEach(b=>b.onclick=()=>{ m.remove(); S.coin=l.find(x=>x.addr===b.dataset.a)||null; paint(); }); }

  function paint(){ const f=SP.chain(S.from), t=SP.chain(S.to);
    chainBtn(g('br-from'),S.from); chainBtn(g('br-to'),S.to); coinBtn();
    $$('#br-speed button').forEach(b=>b.classList.toggle('on',b.dataset.s===S.speed));
    const v=amt(), out=v*(1-fee()), px=S.coin&&S.coin.px||0;
    const o=g('br-out'); o.textContent=v?fmtAmt(out):'0'; o.classList.toggle('dim',!v);
    g('br-usd').textContent=v&&px?fmtUsd(v*px):''; g('br-out-usd').textContent=v&&px?fmtUsd(out*px):'';
    g('br-route').innerHTML=`<span class="end"><img src="${f.logo}" alt="">${esc(f.short)}</span><span class="wire"><span class="lz">LayerZero</span><i></i><i></i><span class="eta">${eta()}</span></span><span class="end"><img src="${t.logo}" alt="">${esc(t.short)}</span>`;
    const rows=[['Bridge fee',`0.2%${v?' · '+fmtAmt(v*BPS):''}`]];
    if(S.speed==='fast') rows.push(['Fast lane',`0.2% + relayer ~0.1%${v?' · '+fmtAmt(v*(FAST+RELAY)):''}`]);
    rows.push(['Network fee',`paid in ${esc(f.native)} on ${esc(f.name)}`],['Arrives',eta()],['Verified by','2 of 4 verifiers']);
    g('br-det').innerHTML=rows.map(r=>`<div class="kv"><span>${r[0]}</span><b>${r[1]}</b></div>`).join('');
    const cta=g('br-cta'); cta.disabled=true;
    cta.textContent=!live()?(window.EQUO_PREVIEW?'Preview: bridging opens with multichain launches':`Bridging to ${(!SP.chainDeployed(t.key)?t:f).name} opens soon`):!S.coin?'Select a coin':!v?'Enter an amount':!SP.W.connected?'Connect a wallet':'Bridge '+S.coin.t;
    if(live()&&S.coin&&v&&!SP.W.connected){ cta.disabled=false; cta.onclick=()=>SP.W.connect(); }
    const soon=CH.filter(c=>!SP.chainDeployed(c.key)).map(c=>c.name);
    g('br-note').innerHTML=`${ic('info')}<span>${soon.length?`${soon.length>2?'The other '+soon.length+' chains':esc(soon.join(' and '))} ${soon.length===1?'opens':'open'} with multichain launches. Coins launched on several chains will move here in one step; coins launched on Ethereum alone can be bridged once their other chains are added.`:'Every transfer is verified by 2 of 4 independent verifiers before it lands.'}</span>`;
    supply(); }

  function supply(){ const x=S.coin, on=x?SP.coinChains(x):[];
    g('br-sup-h').textContent=x?`${x.t} supply by chain`:'Supply by chain';
    const per=1e9, tot=per*Math.max(1,on.length);
    g('br-sup').innerHTML=CH.map(c=>{ const has=on.includes(c.key), v=has?per:0, pct=x?v/tot*100:0;
      return `<div class="sr"><img src="${c.logo}" alt=""><span class="nm">${esc(c.name)}</span><span class="v">${x?(has?fmtAmt(v):'not on this chain'):'—'}</span><span class="bar"><i style="width:${pct.toFixed(1)}%;background:${c.color}"></i></span></div>`; }).join('');
    g('br-sup-hint').textContent=x?'Bridging moves coins between chains; the total never changes.':'Pick a coin to see where its supply sits.'; }

  function fees(){ g('br-fees').innerHTML=[['Standard transfer','0.2%'],['Fast lane','+0.2% + relayer'],['Relayer price','max 10%'],['No relayer fills','standard route, fee back']].map(r=>`<div class="kv"><span>${r[0]}</span><b>${r[1]}</b></div>`).join(''); }

  g('br-eyebrow').innerHTML=`${SP.chainStack(CH.map(c=>c.key),20)}<span>${CH.length} chains with stocks</span>`;
  $$('#br-speed button')[1].innerHTML=`${ic('flame')}Fast`;
  g('br-flip').innerHTML=ic('swap');
  g('br-from').onclick=e=>{ e.stopPropagation(); pickChain(e.currentTarget,'from'); };
  g('br-to').onclick=e=>{ e.stopPropagation(); pickChain(e.currentTarget,'to'); };
  g('br-coin').onclick=e=>{ e.stopPropagation(); pickCoin(e.currentTarget); };
  g('br-flip').onclick=()=>{ [S.from,S.to]=[S.to,S.from]; paint(); };
  $$('#br-speed button').forEach(b=>b.onclick=()=>{ S.speed=b.dataset.s; paint(); });
  g('br-amt').addEventListener('input',paint);
  g('br-max').onclick=()=>{ if(!SP.W.connected) return SP.W.connect(); SP.toast('Balances load once bridging opens','info'); };
  const q=new URLSearchParams(location.search).get('coin'); const pre=()=>{ if(q&&!S.coin){ S.coin=coins().find(x=>x.addr===q.toLowerCase())||null; } paint(); };
  fees(); pre(); SP.onUpdate(pre); SP.onWallet(paint);
};
