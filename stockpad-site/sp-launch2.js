/* Launch page (Equo v2): the coin's name, ticker, logo and links, its fee (1% to 5%), the chains it launches on,
   the chain the creator's wallet pays on and an optional first buy there. The launch service signs the snapshot;
   the creator's wallet launches its own chain (paying the launch fee and the first buy); the service launches the
   others. Then the page waits for the coin to appear and opens it. */
window.SP_PAGE=function(){
  const pg=$('#pg-launch'); if(!pg||!window.V2) return;
  const g=id=>document.getElementById(id), val=id=>g(id).value.trim();
  // every chain a coin can launch on: the EVM chains, and Solana when the site has it (Equo launches that leg)
  const ALL=[...V2.chains, SP.chain('sol')].filter(Boolean);
  const S={ logo:'', fee:100, chains:V2.chains.map(c=>c.key), home:V2.chains.some(c=>c.key==='base')?'base':V2.chains[0].key, quote:null, gas:{}, busy:false };
  const ch=k=>SP.chain(k)||{name:k,native:'',logo:''};
  // HyperEVM launches go in its once-a-minute large blocks, which a wallet cannot pick, and Solana's leg is made by
  // Equo's service: Equo sends those legs
  const canHome=k=>k!=='hyper'&&k!=='sol';
  const solOk=v=>/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);

  /* ---------- logo: a square crop, stored with the coin's details (not on chain) ---------- */
  // also picks up a file chosen before this script ran (the input exists from the first paint)
  const takeLogo=()=>{ const f=g('f-logo').files&&g('f-logo').files[0]; if(!f) return; if(!/^image\//.test(f.type||'')) return SP.toast('Choose an image file','err'); if(f.size>8*1024*1024) return SP.toast('Image too big, 8 MB max','err');
    const img=new Image(), url=URL.createObjectURL(f);
    img.onload=()=>{ URL.revokeObjectURL(url); const s=Math.min(img.width,img.height); let best='';
      for(const size of [256,200,160]){ const c=document.createElement('canvas'); c.width=c.height=size; c.getContext('2d').drawImage(img,(img.width-s)/2,(img.height-s)/2,s,s,0,0,size,size);
        let d=c.toDataURL('image/webp',0.85); if(!d.startsWith('data:image/webp')) d=c.toDataURL('image/jpeg',0.85);
        if(!best||d.length<best.length) best=d; if(d.length<=150000) break; }
      if(!best.startsWith('data:image/')) return SP.toast('Could not process this image','err');
      S.logo=best; g('drop-in').outerHTML=`<img id="drop-in" src="${best}" alt="">`; preview(); };
    img.onerror=()=>{ URL.revokeObjectURL(url); SP.toast('Could not read this image','err'); }; img.src=url; };
  g('f-logo').onchange=takeLogo; takeLogo();

  /* ---------- fee and chains ---------- */
  function fees(){ g('f-fee').innerHTML=[100,200,300,400,500].map(b=>`<button type="button" data-f="${b}" class="${S.fee===b?'on':''}">${b/100}%</button>`).join('');
    $$('#f-fee [data-f]').forEach(b=>b.onclick=()=>{ S.fee=+b.dataset.f; fees(); preview(); });
    const f=S.fee/100, pf=Math.max(f*0.2,0.2), pot=0.1;
    g('fee-split').textContent=`Of ${f}%: the platform ${(+pf.toFixed(2))}%, the last-buyer pot ${pot}%, you ${(+(f-pf-pot).toFixed(2))}% of every trade, in each chain's native coin.`; }
  function chains(){ g('f-chains').innerHTML=ALL.map(c=>`<button type="button" data-k="${c.key}" class="${S.chains.includes(c.key)?'on':''}" style="--cc:${c.color}"><img src="${c.logo}" alt="">${esc(c.name)}</button>`).join('');
    $$('#f-chains [data-k]').forEach(b=>b.onclick=()=>{ const k=b.dataset.k; if(S.chains.includes(k)){ if(S.chains.length===1) return; S.chains=S.chains.filter(x=>x!==k); } else S.chains=ALL.map(c=>c.key).filter(x=>x===k||S.chains.includes(x));
      if(!S.chains.includes(S.home)||!canHome(S.home)) S.home=S.chains.find(canHome)||S.chains[0]; chains(); homes(); solRow(); cost(); preview(); }); }
  /* the creator's Solana wallet: it receives the creator's fees and the coin's first coins on Solana */
  function solRow(){ const on=S.chains.includes('sol'); g('sol-row').classList.toggle('hidden',!on); btn(); }
  g('sol-use').onclick=async()=>{ try{ const a=window.SOLW?await SOLW.connect():''; if(a){ g('f-solw').value=a; btn(); } }catch(e){ SP.toast(SP.errMsg(e),'err'); } };
  g('f-solw').addEventListener('input',btn);
  function homes(){ const opts=S.chains.filter(canHome); g('f-home').innerHTML=opts.map(k=>`<option value="${k}" ${k===S.home?'selected':''}>${esc(ch(k).name)} (${esc(ch(k).native)})</option>`).join('');
    if(!opts.length){ g('home-hint').innerHTML='<span class="err">Pick at least one chain besides HyperEVM to launch from.</span>'; return; }
    g('dev-sym').textContent='in '+ch(S.home).native;
    g('home-hint').textContent=`Your wallet launches on ${ch(S.home).name}: the launch fee and your first buy are paid in ${ch(S.home).native} there.${S.chains.includes('hyper')?' HyperEVM is always launched by Equo.':''}`; }
  g('f-home').onchange=e=>{ S.home=e.target.value; homes(); cost(); };

  /* ---------- cost ---------- */
  let costSeq=0;
  async function cost(){ const seq=++costSeq, home=S.home, nat=ch(home).native;
    g('c-home-n').textContent=ch(home).name; g('c-fee').textContent='…'; g('c-gas').textContent='…';
    try{ const [q,gp]=await Promise.all([V2.feeQuote(S.chains,home),gasPrice(home)]); if(seq!==costSeq) return;
      const usd=(q.nativeUsd||{})[home]||0; S.feeUsd=S.chains.length>1?q.usd:0; S.feeNative=usd?S.feeUsd/usd:0; S.gasNative=gp*((ch(home).launchGas)||7700000)/1e18; S.usd=usd; paintCost(); }
    catch(e){ if(seq===costSeq){ g('c-fee').textContent='—'; g('go-msg').innerHTML=`<span class="err">${esc(SP.errMsg(e))}</span>`; } } }
  async function gasPrice(k){ if(S.gas[k]&&Date.now()-S.gas[k].at<30000) return S.gas[k].v;
    const r=await fetch(ch(k).rpc,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_gasPrice',params:[]})}); const v=parseInt((await r.json()).result,16)||0; S.gas[k]={v,at:Date.now()}; return v; }
  const devVal=()=>{ const v=parseFloat(val('f-dev').replace(/,/g,'')); return isFinite(v)&&v>0?v:0; };
  function paintCost(){ const nat=ch(S.home).native, u=S.usd||0, f=(v)=>SP.fmtNative(v,nat)+(u?` · ${fmtUsd(v*u)}`:'');
    g('c-fee').textContent=S.feeNative!=null?f(S.feeNative):'…'; g('c-dev').textContent=devVal()?f(devVal()):'—'; g('c-gas').textContent=S.gasNative!=null?f(S.gasNative):'…';
    g('c-tot').textContent=S.feeNative!=null&&S.gasNative!=null?f(S.feeNative+devVal()+S.gasNative):'…'; btn(); }
  g('f-dev').addEventListener('input',paintCost);

  /* ---------- preview and button ---------- */
  function preview(){ g('pv-n').textContent=val('f-name')||'Your coin'; g('pv-t').textContent='$'+(val('f-sym').toUpperCase()||'TICKER'); g('pv-fee').textContent=S.fee/100+'%';
    g('pv-sup').textContent=`${S.chains.length}B (1B per chain)`; if(S.logo) g('pv-img').src=S.logo;
    g('legs').innerHTML=S.chains.map(k=>`<span data-leg="${k}"><img src="${ch(k).logo}" alt="">${esc(ch(k).name)}</span>`).join(''); btn(); }
  ['f-name','f-sym'].forEach(id=>g(id).addEventListener('input',preview));
  function problem(){ if(!val('f-name')) return 'Give the coin a name'; const t=val('f-sym').toUpperCase(); if(!t) return 'Give the coin a ticker'; if(!/^[A-Z0-9$._-]+$/.test(t)) return 'The ticker takes letters and digits';
    if(!S.chains.some(canHome)) return 'Pick a chain to launch from';
    if(S.chains.includes('sol')&&!solOk(val('f-solw'))) return 'Add your Solana wallet for Solana';
    return ''; }
  function btn(){ if(S.busy) return; const b=g('go'); if(!SP.W.connected){ b.textContent='Connect a wallet'; b.disabled=false; return; } const p=problem(); b.textContent=p||`Launch on ${S.chains.length} chain${S.chains.length>1?'s':''}`; b.disabled=!!p; }
  SP.onWallet(btn);
  function step(s,state){ const el=$(`#steps [data-s="${s}"]`); if(!el) return; $$('#steps div').forEach(d=>d.classList.remove('on')); el.classList.add(state==='ok'?'ok':'on'); if(state==='ok') el.classList.remove('on'); }

  g('go').onclick=async()=>{ if(!SP.W.connected) return SP.W.connect().catch(e=>SP.toast(SP.errMsg(e),'err')); const p=problem(); if(p) return SP.toast(p,'err'); if(S.busy) return;
    S.busy=true; const b=g('go'); b.disabled=true; g('go-msg').textContent='';
    const meta={ description:val('f-desc'), image:S.logo, website:val('f-web'), x:val('f-x'), telegram:val('f-tg') };
    const devWei=devVal()?CHAIN.parseEther(devVal().toFixed(18)).toString():'0';
    try{
      const q=await V2.launch({ name:val('f-name'), symbol:val('f-sym').toUpperCase(), feeBps:S.fee, chains:S.chains, home:S.home, meta, devBuyWei:devWei, solWallet:S.chains.includes('sol')?val('f-solw'):undefined },(s,info)=>{
        if(s==='quote'){ step('quote'); b.textContent='Preparing…'; }
        if(s==='wallet'){ b.textContent='Confirm in your wallet…'; }
        if(s==='sent'){ step('quote','ok'); step('home'); b.textContent=`Launching on ${ch(S.home).name}…`; }
        if(s==='home'){ step('home','ok'); step('others'); b.textContent='Launching the other chains…'; const el=$(`[data-leg="${S.home}"]`); if(el) el.classList.add('ok'); }
        if(s==='others'){ const bad=Object.entries(info.sent||{}).filter(([,v])=>v&&v.error); if(bad.length) g('go-msg').innerHTML=`<span class="err">Not sent yet on ${bad.map(([k])=>esc(ch(k).name)).join(', ')}; Equo retries when you open the coin.</span>`; } });
      // wait for every chain, then for the coin to be indexed
      const main=q.coins.eth||q.coins[S.chains.find(k=>k!=='sol')];
      // the Solana leg takes a few rounds of the service's work: ask for another while it is not live
      let nextRound=Date.now()+8000;
      for(let i=0;i<120;i++){ try{ const st=await V2.launchStatus(q); Object.entries(st).forEach(([k,v])=>{ const el=$(`[data-leg="${k}"]`); if(el&&v.launched) el.classList.add('ok'); });
          if(Object.values(st).every(v=>v.launched)) break;
          if(st.sol&&!st.sol.launched&&Date.now()>nextRound){ nextRound=Date.now()+60000; V2.complete(q).then(()=>{ nextRound=Date.now()+3000; }).catch(()=>{ nextRound=Date.now()+10000; }); } }catch{}
        await new Promise(r=>setTimeout(r,5000)); }
      step('others','ok'); step('done'); b.textContent='Opening your coin…';
      for(let i=0;i<30;i++){ try{ fetch('/api/tick').catch(()=>{}); await V2.detail(main); break; }catch{ await new Promise(r=>setTimeout(r,4000)); } }
      SP.go('/token/'+main.toLowerCase());
    }catch(e){ S.busy=false; b.disabled=false; btn(); g('go-msg').innerHTML=`<span class="err">${esc(SP.errMsg(e))}</span>`; $$('#steps div').forEach(d=>d.classList.remove('on')); }
  };

  fees(); chains(); homes(); solRow(); preview(); cost(); setInterval(()=>{ if(!S.busy&&document.visibilityState!=='hidden') cost(); },30000);
};
