/* Launch page: four steps (identity, fee and tokenomics, review, launch) beside a live preview card.
   The form collects everything a multichain launch needs: the fee (one for all chains or one per chain), how the
   creator's share of every fee is spent, launch protection, wallets, the chains, shared or per-chain supply, the
   opening market cap, the chain that pays and the dev buy. The launch itself goes out directly only where the live
   contracts can take it today (one chain, Ethereum, options they support); everything else waits for the multichain
   launch service and the new contracts. Uses the core.js globals ($, $$, esc, ic, SP, TOK, WETH, EXPLORER, SITE). */
let launchRepaint=null;
function launchInit(){
  const pg=$('#pg-launch'); if(!pg||launchRepaint) return;
  const g=id=>document.getElementById(id), cfg=window.INKY||{};
  const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v)), num=(id,d)=>{ const v=parseFloat(g(id).value); return isFinite(v)?v:d; };
  const pct=v=>(+v.toFixed(2)).toString()+'%', usd=v=>'$'+(v>=100?Math.round(v).toLocaleString('en-US'):v.toFixed(2));
  const CREATOR=0.6; // of what is left of each fee after the platform cut: creator 60%, platform 40%
  const FEES=[30,50,100,200,300,500];
  /* how the creator's share of every fee is spent; each preset adds up to 100 */
  const ALLOC=[['burn','Burn','Buys the coin back and burns it.','#f6465d'],['holders','Holder rewards','Paid to holders, pro rata, in the chain\'s coin.','#f2be54'],['hold','Buy and hold','Buys the coin and sends it to a treasury wallet.','#8c9eff'],['lp','Add to liquidity','Buys the coin and adds it to the pool, locked for good.','#2ebd85'],['creator','Creator','Paid to you, in the chain\'s coin.','#3fbcff'],['comm','Community wallet','Paid to a community wallet, in the chain\'s coin.','#c084fc']];
  const PRESETS={Balanced:{burn:25,holders:25,creator:50},'All burn':{burn:100},Liquidity:{lp:50,creator:50},Holders:{holders:50,creator:50},Creator:{creator:100}};
  const live=SP.chains.filter(c=>SP.chainDeployed(c.key)).map(c=>c.key);
  const S={step:1,max:1,logo:null,fee:100,perFee:false,feeBy:{},preset:'Creator',alloc:{creator:100},perSplit:false,splitBy:{},snipe:false,mw:false,
    chains:live.length?live:['eth'],shared:false,pay:(SP.chains.find(c=>c.main)||SP.chains[0]).key,capI:0,caps:[3000],busy:false,paused:false,launched:null};
  const ch=k=>SP.chain(k)||{}, evmChains=()=>S.chains.filter(k=>ch(k).evm!==false), hasSol=()=>S.chains.some(k=>ch(k).evm===false);
  const val=id=>g(id).value.trim(), link=v=>{ v=String(v||'').trim(); if(!v) return ''; if(!/^https?:\/\//i.test(v)) v='https://'+v; return v.slice(0,200); };
  const isEvm=a=>/^0x[0-9a-fA-F]{40}$/.test(a), isSol=a=>/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);
  const taken=()=>new Set(((window.CHAIN&&LIVE)?CHAIN.tokens():TOK).map(x=>String(x.t||'').toUpperCase()));
  const feeOf=k=>S.perFee&&S.feeBy[k]!=null?S.feeBy[k]:S.fee, allocOf=k=>S.perSplit&&S.splitBy[k]?PRESETS[S.splitBy[k]]:S.alloc;
  const youKeep=bps=>bps/100*CREATOR, pfKeep=bps=>bps/100*(1-CREATOR);

  /* ---------- 1. identity ---------- */
  function paintLogo(){ g('drop').classList.toggle('has',!!S.logo); g('drop-in').innerHTML=S.logo?`<img src="${S.logo}" alt="">`:esc((val('f-sym')||val('f-name')||'?')[0].toUpperCase()); }
  function loadLogo(file){ if(!file||!/^image\//.test(file.type||'')){ SP.toast('Choose an image file','err'); return; } if(file.size>4*1024*1024){ SP.toast('Image too big, 4 MB max','err'); return; }
    const img=new Image(), url=URL.createObjectURL(file);
    img.onload=()=>{ URL.revokeObjectURL(url); const s=Math.min(img.width,img.height); let best=null;
      outer: for(const size of [128,112,96,80,64]){ const c=document.createElement('canvas'); c.width=c.height=size; c.getContext('2d').drawImage(img,(img.width-s)/2,(img.height-s)/2,s,s,0,0,size,size);
        for(let q=0.8;q>=0.35;q-=0.15){ const d=c.toDataURL('image/webp',q); if(!best||d.length<best.length) best=d; if(d.length<=4200) break outer; } }
      if(!best||!best.startsWith('data:image/webp')){ SP.toast('Could not process this image','err'); return; }
      S.logo=best; paintLogo(); paint(); };
    img.onerror=()=>{ URL.revokeObjectURL(url); SP.toast('Could not read this image','err'); }; img.src=url; }
  function v1(show){ const n=val('f-name'), t=val('f-sym').toUpperCase(); let ok=true; const nm=g('name-msg'), sm=g('sym-msg');
    nm.textContent=''; sm.className='hint'; sm.textContent='';
    if(!n){ ok=false; if(show) nm.textContent='Give the coin a name'; } else if(new TextEncoder().encode(n).length>32){ ok=false; nm.textContent='32 bytes max'; }
    if(!t){ ok=false; if(show){ sm.className='err'; sm.textContent='Give it a ticker'; } }
    else if(!/^[A-Z0-9]{2,10}$/.test(t)){ ok=false; sm.className='err'; sm.textContent='2 to 10 letters or digits'; }
    else if(taken().has(t)){ ok=false; sm.className='err'; sm.textContent=t+' is already taken'; } else { sm.className='hint'; sm.style.color='var(--up)'; sm.textContent=t+' is free'; }
    return ok; }

  /* ---------- 2. fee and tokenomics ---------- */
  const feeBtn=(b,on,k)=>`<button type="button" data-f="${b}"${k?` data-k="${k}"`:''} class="${on?'on':''}">${b/100}%</button>`;
  function paintFee(){ g('fee-pills').innerHTML=FEES.map(b=>feeBtn(b,S.fee===b)).join('');
    g('keep-you').textContent=pct(youKeep(S.fee)); g('keep-pf').textContent=pct(pfKeep(S.fee));
    const box=g('perfee'); box.classList.toggle('hidden',!S.perFee); g('opt-perfee').querySelector('.sw').classList.toggle('on',S.perFee);
    if(S.perFee) box.innerHTML=S.chains.map(k=>`<div class="pcrow"><span class="cn"><img src="${ch(k).logo}" alt="">${esc(ch(k).name)}</span><div class="pills">${FEES.map(b=>feeBtn(b,feeOf(k)===b,k)).join('')}</div></div>`).join('')+`<p class="note">You keep ${pct(CREATOR*100)} of the fee on each chain; the platform keeps the rest.</p>`; }
  function allocTotal(a){ return ALLOC.reduce((s,[k])=>s+(+a[k]||0),0); }
  function paintSplit(){ g('tok-pre').innerHTML=Object.keys(PRESETS).concat('Custom').map(p=>`<button type="button" data-p="${p}" class="${S.preset===p?'on':''}">${p}</button>`).join('');
    const a=S.alloc; g('split').innerHTML=ALLOC.map(([k,n,d])=>`<div class="sl"><span><b>${n}</b><small>${d}</small></span><span class="pi"><input class="inp" data-a="${k}" type="number" min="0" max="100" step="1" value="${+a[k]||0}"><span class="muted">%</span></span></div>`).join('')
      +`<div class="sl"><span><b>Different split on each chain</b><small>Pick a preset per chain instead.</small></span><span class="pi" style="justify-content:flex-end"><button type="button" class="sw ${S.perSplit?'on':''}" role="switch" aria-checked="${S.perSplit}" data-sw="perSplit"></button></span></div>`
      +(S.perSplit?S.chains.map(k=>`<div class="pcrow"><span class="cn"><img src="${ch(k).logo}" alt="">${esc(ch(k).name)}</span><div class="pills">${Object.keys(PRESETS).map(p=>`<button type="button" data-sp="${p}" data-k="${k}" class="${(S.splitBy[k]||'')===p?'on':''}">${p}</button>`).join('')}</div></div>`).join(''):'')
      +(a.hold>0?`<div class="sl"><span><b>Treasury wallet</b><small>Where buy-and-hold coins go.</small></span><span></span></div><input class="inp" id="f-treas" placeholder="0x… treasury wallet" value="${esc(S.treas||'')}" autocomplete="off">`:'')
      +(a.comm>0?`<div class="sl" style="margin-top:8px"><span><b>Community wallet</b><small>Where the community share is paid.</small></span><span></span></div><input class="inp" id="f-comm" placeholder="0x… community wallet" value="${esc(S.comm||'')}" autocomplete="off">`:'');
    paintSplitTotals(); }
  function paintSplitTotals(){ const a=S.alloc, tot=allocTotal(a), fee=S.fee/100*CREATOR;
    g('split-you').textContent=`${pct(tot)} allocated · you receive ${pct(fee*(+a.creator||0)/100)} of every trade`;
    g('sbar').innerHTML=ALLOC.filter(([k])=>a[k]>0).map(([k,,,c])=>`<i style="width:${a[k]}%;background:${c}"></i>`).join('');
    g('slg').innerHTML=ALLOC.filter(([k])=>a[k]>0).map(([k,n,,c])=>`<span><i style="background:${c}"></i>${n} ${a[k]}%</span>`).join('');
    g('split-msg').textContent=Math.abs(tot-100)>0.001?`The split must add up to 100% (now ${pct(tot)})`:''; }
  const snipeMaxMin=()=>Math.floor(Math.min(...S.chains.filter(k=>ch(k).evm!==false).map(k=>7200*(ch(k).blockSec||12)/60)));
  function v2(){ let ok=true; const a=S.alloc;
    if(Math.abs(allocTotal(a)-100)>0.001) ok=false;
    if(a.burn>0&&a.burn<5){ g('split-msg').textContent='Burn: at least 5% when on'; ok=false; }
    if(a.hold>0&&!isEvm(S.treas||'')){ g('split-msg').textContent='Add a treasury wallet (0x…) for buy and hold'; ok=false; }
    if(a.comm>0&&!isEvm(S.comm||'')){ g('split-msg').textContent='Add a community wallet (0x…)'; ok=false; }
    const se=g('snipe-msg'); se.textContent=''; g('snipe-hint').textContent='';
    if(S.snipe){ const p=num('f-snipe',20), m=num('f-snipemin',10), mx=snipeMaxMin(), maxFee=Math.max(...S.chains.map(feeOf))/100;
      if(!(p>maxFee&&p<=30)) { se.textContent=`Starting fee: above ${maxFee}% and up to 30%`; ok=false; } else if(!(m>=1&&m<=mx)) { se.textContent=`Lasts: 1 to ${mx} minutes on these chains`; ok=false; }
      else g('snipe-hint').textContent=`${p}% falling to the normal fee over ${m} min. Up to ${mx} min on the chains picked (the fastest chain sets the limit).`; }
    const me=g('mw-msg'); me.textContent=''; g('mw-hint').textContent='';
    if(S.mw){ const p=num('f-mw',2), h=num('f-mwh',1); if(!(p>=0.5&&p<=20)) { me.textContent='Max per wallet: 0.5% to 20%'; ok=false; } else if(!(h>=0.25&&h<=720)) { me.textContent='For: 0.25 to 720 hours'; ok=false; } else g('mw-hint').textContent=`No wallet holds more than ${p}% of a chain's supply for the first ${h>=24?+(h/24).toFixed(1)+' days':h+' h'}.`; }
    const wm=g('w-msg'), fr=val('f-frecv'); wm.textContent='';
    if(fr&&!isEvm(fr)){ ok=false; wm.textContent='Fee receiver: a 0x… address'; }
    else if(hasSol()&&!isSol(val('f-sol'))){ ok=false; wm.textContent='Add your Solana wallet: Solana is one of the chains'; }
    return ok; }

  /* ---------- 3. review ---------- */
  function paintReview(){ const n=val('f-name'), t=val('f-sym').toUpperCase(); g('rv-sym').textContent='$'+(t||'TICKER'); g('rv-name').textContent=n||'Coin name';
    g('rv-art').textContent=S.logo?'Uploaded':'Monogram'; const L=[['Website','f-web'],['X','f-x'],['Telegram','f-tg']].filter(x=>val(x[1])).map(x=>x[0]); g('rv-links').textContent=L.length?L.join(', '):'None';
    const fees=[...new Set(S.chains.map(feeOf))]; g('rv-feel').textContent=S.perFee&&fees.length>1?'Per chain':'Every chain';
    g('rv-fee').textContent=fees.length>1?S.chains.map(k=>`${ch(k).code} ${feeOf(k)/100}%`).join(' · '):`${fees[0]/100}% · you keep ${pct(youKeep(fees[0]))}`;
    g('rv-tok').textContent=S.perSplit?'Per chain':ALLOC.filter(([k])=>S.alloc[k]>0).map(([k,nm])=>`${nm} ${S.alloc[k]}%`).join(' · ');
    g('chips').innerHTML=SP.chains.map(c=>`<button type="button" class="chip ${S.chains.includes(c.key)?'on':''}" data-ck="${c.key}" style="--cc:${c.color}"><i></i>${esc(c.name)}${SP.chainDeployed(c.key)?'':'<span class="soonb">Opens soon</span>'}</button>`).join('');
    const N=S.chains.length; g('ch-note').innerHTML=S.shared?`${N} ${N===1?'chain':'chains'}, <b>1B tokens in total</b>: ${fmtAmt(1e9/N)} on each. Chains cannot be added after launch.`:`${N} ${N===1?'chain':'chains'}, <b>1B tokens on each</b>. Chains cannot be added after launch.`;
    g('sw-shared').classList.toggle('on',S.shared); g('sw-shared').setAttribute('aria-checked',S.shared);
    g('split-note').textContent=S.shared?`On: 1B in total, ${fmtAmt(1e9/N)} on each chain. Same opening price either way.`:`Off: every chain has its own 1B (${N}B in total). Turn on to share 1B across the chains.`;
    g('cap-pills').innerHTML=S.caps.map((v,i)=>`<button type="button" data-cap="${i}" class="${i===S.capI?'on':''}">$${v>=1000?(v/1000)+'K':v}</button>`).join('');
    g('cap-note').textContent=`The price every chain opens at, set against the coin's 1B${S.shared?' total':''}.`;
    g('pay').innerHTML=S.chains.map(k=>`<button type="button" class="chip ${S.pay===k?'on':''}" data-pk="${k}" style="--cc:${ch(k).color}"><img src="${ch(k).logo}" alt="">${esc(ch(k).name)} <small>${esc(ch(k).native)}</small></button>`).join('');
    const pc=ch(S.pay), mn=minBuy(S.pay); g('dev-sym').textContent=pc.native; const di=g('f-dev'); di.min=String(mn);
    g('dev-note').innerHTML=`Bought on ${esc(pc.name)} only, the chain you pay on; the coins go to your wallet there. At least ${fmtNum(mn)} ${esc(pc.native)}: every pool opens with a first buy${N>1?`, and the other ${N-1} ${N-1===1?'chain is':'chains are'} seeded for you in the launch fee`:''}.`;
    g('addr-note').textContent=`${evmChains().length} EVM ${evmChains().length===1?'chain':'chains'}, one address${hasSol()?'; Solana gets its own':''}.`;
    g('ok1').innerHTML=ic('check')+'Included'; g('ok2').innerHTML=ic('check')+'Always'; }
  const fmtNum=v=>v>=1?(+v.toFixed(3)).toString():(+v.toPrecision(2)).toString();
  /** the smallest first buy on chain k, in its native coin */
  function minBuy(k){ if((ch(k).native||'ETH')==='ETH') return cfg.minFirstBuyEth||0.001; const u=CC&&CC[k]&&CC[k].nativeUsd; return u?(cfg.seedUsd||4)/u:0; }
  function v3(){ const mn=minBuy(S.pay), d=num('f-dev',0); const e=g('dev-msg'); e.textContent=''; if(!(d>=mn)){ e.textContent=`Dev buy: at least ${fmtNum(mn)} ${ch(S.pay).native}`; return false; } return true; }

  /* ---------- 4. launch: what it costs, chain by chain ---------- */
  let CC=null;
  function costs(){ const pu=CC&&CC[S.pay]&&CC[S.pay].nativeUsd; const rows=S.chains.map(k=>{ const q=CC&&CC[k]||{}; const gas=q.launchUsd||0; const buy=k===S.pay?num('f-dev',0)*(pu||0):(cfg.seedUsd||4); return {k,gas,buy,known:!!q.launchUsd||ch(k).evm===false}; });
    const tot=rows.reduce((s,r)=>s+r.gas+r.buy,0); return {rows,tot,native:pu?tot/pu:0,pu}; }
  function paintCost(){ const c=costs(), pc=ch(S.pay);
    g('cost').innerHTML=c.rows.map(r=>`<div class="row"><div class="t"><img src="${ch(r.k).logo}" alt="">${esc(ch(r.k).name)}<small>${r.k===S.pay?'Gas and your dev buy':'Gas and the opening seed buy'}</small></div><div class="v">${r.known?usd(r.gas+r.buy):'…'}</div></div>`).join('')
      +`<div class="row total"><div class="t">Total, paid on ${esc(pc.name)}</div><div class="v">${c.pu?`${fmtNum(c.native)} ${esc(pc.native)} · ${usd(c.tot)}`:'…'}</div></div>`;
    g('cost-note').innerHTML=`One payment on ${esc(pc.name)}. Your coin goes live on ${S.chains.length===1?esc(pc.name):`all ${S.chains.length} chains`} with the same ${evmChains().length>1?'address and ':''}opening price${S.chains.length>1?'; the other chains are launched for you within minutes':''}.`; }

  /* ---------- what the live contracts can take today ---------- */
  function blocker(){ const x=[];
    if(S.chains.some(k=>!SP.chainDeployed(k))) x.push(`${S.chains.filter(k=>!SP.chainDeployed(k)).map(k=>ch(k).name).join(', ')} ${S.chains.filter(k=>!SP.chainDeployed(k)).length===1?'opens':'open'} with multichain launches`);
    else if(S.chains.length>1) x.push('Multichain launches open with the launch service');
    if(S.shared&&S.chains.length>1) x.push('shared supply needs the new contracts');
    if(S.chains.some(k=>feeOf(k)>300)) x.push('a 5% fee needs the new contracts');
    const a=S.alloc; if(a.hold>0||a.lp>0||a.comm>0||S.perSplit) x.push('buy and hold, liquidity and community shares need the new contracts');
    if(val('f-frecv')||g('f-burnfees').checked) x.push('a separate fee receiver or burnt creator fees need the new contracts');
    return x; }

  /* ---------- steps and footer ---------- */
  const valid=[null,()=>v1(true),()=>v2(),()=>v3(),()=>true];
  function show(n){ S.step=n; S.max=Math.max(S.max,n); $$('#pg-launch .step').forEach(s=>s.classList.toggle('on',+s.dataset.step===n));
    $$('#tabs button').forEach(b=>{ const k=+b.dataset.s; b.classList.toggle('on',k===n); b.classList.toggle('done',k<n); });
    g('back').classList.toggle('hidden',n===1); paint(); window.scrollTo({top:Math.min(scrollY,g('wiz').offsetTop-90),behavior:'smooth'}); }
  function go(n){ if(S.launched) return; n=clamp(n,1,4); if(n<=S.step){ show(n); return; } for(let i=S.step;i<n;i++){ if(!valid[i]()){ if(i!==S.step) show(i); SP.toast('Fix the highlighted fields first','err'); return; } } show(n); }
  function paintFoot(){ const nx=g('next'), msg=g('foot-msg');
    if(S.step<4){ nx.disabled=false; nx.textContent='Next'; msg.textContent=S.step===3?'Next: the launch fee, chain by chain.':''; return; }
    const b=blocker(); msg.textContent='';
    if(S.busy){ nx.disabled=true; nx.textContent='Confirm in wallet…'; return; }
    if(b.length){ nx.disabled=true; nx.textContent=window.EQUO_PREVIEW?'Preview only':'Opens soon'; msg.textContent=b.join('; ')+'.'; return; }
    if(S.paused){ nx.disabled=true; nx.textContent='Launches paused'; return; }
    nx.disabled=false; nx.textContent=!SP.W.connected?'Connect a wallet':!SP.W.chainOk?'Switch to Ethereum':`Launch on ${ch(S.pay).name}`; }

  /* ---------- preview card ---------- */
  function paintPreview(){ const n=val('f-name'), t=val('f-sym').toUpperCase(), d=val('f-desc');
    g('pv-sym').textContent='$'+(t||'TICKER'); const fees=[...new Set(S.chains.map(feeOf))]; g('pv-fee').textContent=fees.length>1?fees.map(f=>f/100+'%').join('/'):fees[0]/100+'%';
    g('pv-im').innerHTML=S.logo?`<img src="${S.logo}" alt="">`:`<span>${esc((t||n||'?')[0].toUpperCase())}</span>`; g('pv-name').textContent=n||'Coin name'; g('pv-desc').textContent=d||'Your description shows here.';
    g('pv-dots').innerHTML=S.chains.map(k=>`<i style="background:${ch(k).color}" title="${esc(ch(k).name)}"></i>`).join(''); g('pv-ready').textContent=`READY FOR ${S.chains.length} ${S.chains.length===1?'CHAIN':'CHAINS'}`;
    g('lt-dots').innerHTML=S.chains.map(k=>`<span><i style="background:${ch(k).color}"></i>${esc(ch(k).name)}</span>`).join('');
    g('name-cnt').textContent=new TextEncoder().encode(n).length+'/32'; g('sym-cnt').textContent=t.length+'/10'; g('desc-cnt').textContent=d.length+'/280'; }
  function paint(){ paintLogo(); paintFee(); paintSplitTotals(); g('sol-row').classList.toggle('hidden',!hasSol()); g('evm-w').textContent=SP.W.connected?shortAddr(cs(SP.W.address)):'Connect a wallet';
    $$('#opt-snipe,#opt-mw').forEach(o=>o.querySelector('.sw').classList.toggle('on',!!S[o.id==='opt-snipe'?'snipe':'mw'])); g('opt-snipe').classList.toggle('on',S.snipe); g('opt-mw').classList.toggle('on',S.mw);
    if(S.step===2) v2(); if(S.step>=3) paintReview(); if(S.step===4) paintCost(); paintPreview(); paintFoot(); }

  /* ---------- launch (live contracts: one chain, Ethereum) ---------- */
  async function doLaunch(){ if(S.busy||blocker().length||S.paused) return;
    if(!SP.W.connected){ SP.W.connect(); return; } if(!SP.W.chainOk){ try{ await SP.W.switchChain(); }catch(e){ SP.toast(SP.errMsg(e),'err'); } return; }
    for(const i of [1,2,3]) if(!valid[i]()){ show(i); SP.toast('Fix the highlighted fields first','err'); return; }
    if(!LIVE||!window.CHAIN){ SP.toast('Launches open when the contracts are live','info'); return; }
    const name=val('f-name'), symbol=val('f-sym').toUpperCase(), meta={description:val('f-desc')}; if(S.logo) meta.image=S.logo; const w=link(val('f-web')), x=link(val('f-x')), tg=link(val('f-tg')); if(w) meta.website=w; if(x) meta.x=x; if(tg) meta.telegram=tg;
    // the live hook takes burn and holder shares out of the whole fee; scale the creator-share split to that
    const a=S.alloc, k=CREATOR, bb=Math.round((+a.burn||0)*k)*100, dv=Math.round((+a.holders||0)*k)*100, ethUsd=SP.prices[WETH]||ETH||0;
    const thr=bb&&ethUsd?BigInt(Math.max(1,Math.round(50/ethUsd*1e6)))*10n**12n:0n;
    const genes={feeMode:0,feeBps:S.fee,snipeBps:S.snipe?clamp(Math.round(num('f-snipe',20)*100),S.fee+1,3000):0,snipeBlocks:S.snipe?clamp(Math.round(num('f-snipemin',10)*60/12),5,7200):0,buybackShareBps:bb,buybackThreshold:thr,divShareBps:dv,maxWalletBps:S.mw?clamp(Math.round(num('f-mw',2)*100),50,2000):0,maxWalletSecs:S.mw?clamp(Math.round(num('f-mwh',1)*3600),600,2592000):0,evolution:{enabled:false}};
    S.busy=true; paintFoot();
    try{ const {rc,token}=await CHAIN.launch({name,symbol,metadataURI:JSON.stringify(meta),pair:WETH,minPairOut:0,capPreset:S.capI,genes},CHAIN.parseEther(num('f-dev',0).toFixed(18)));
      if(!token) throw new Error('Launched, but the coin address was not found in the receipt. Check your wallet activity.');
      S.launched={addr:String(token).toLowerCase(),name,symbol}; done(); SP.toast(name+' is live'); try{ await CHAIN.refresh(); if(typeof syncTok==='function') syncTok(); }catch{} }
    catch(e){ let m=SP.errMsg(e); if(/BadGenes|instincts/i.test(m)) m='The fee or options are out of bounds; adjust them and try again.'; if(/FirstBuyTooSmall/i.test(m)) m='The dev buy is below the minimum first buy.'; SP.toast(m,'err'); }
    finally{ S.busy=false; paintFoot(); } }
  function done(){ const L=S.launched; $$('#pg-launch .step').forEach(s=>s.classList.remove('on')); g('foot').classList.add('hidden'); $$('#tabs button').forEach(b=>{ b.classList.add('done'); b.classList.remove('on'); b.disabled=true; });
    const url=SITE+tokenUrl(L.addr); const d=g('done'); d.classList.remove('hidden');
    d.innerHTML=`<img src="${S.logo||DEF_LOGO}" alt=""><h2>$${esc(L.symbol)} is live</h2><p>${esc(L.name)} · <span class="mono">${shortAddr(cs(L.addr))}</span></p><div class="acts"><a class="btn pri" href="${tokenUrl(L.addr)}">Open coin page</a><a class="btn" target="_blank" rel="noopener" href="https://x.com/intent/tweet?text=${encodeURIComponent(`$${L.symbol} is live on Equo. ${url}`)}">Share on X</a><a class="btn" target="_blank" rel="noopener" href="${EXPLORER}/token/${L.addr}">Explorer</a></div>`; }

  /* ---------- wiring ---------- */
  g('tabs').onclick=e=>{ const b=e.target.closest('[data-s]'); if(b) go(+b.dataset.s); };
  g('next').onclick=()=>S.step<4?go(S.step+1):doLaunch(); g('back').onclick=()=>go(S.step-1);
  g('f-logo').addEventListener('change',e=>{ loadLogo(e.target.files[0]); e.target.value=''; });
  const dz=g('drop'); ['dragenter','dragover'].forEach(ev=>dz.addEventListener(ev,e=>{ e.preventDefault(); dz.classList.add('over'); })); ['dragleave','drop'].forEach(ev=>dz.addEventListener(ev,e=>{ e.preventDefault(); dz.classList.remove('over'); })); dz.addEventListener('drop',e=>loadLogo(e.dataTransfer.files[0]));
  g('f-sym').addEventListener('input',e=>{ e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,''); v1(false); paint(); });
  ['f-name','f-desc','f-web','f-x','f-tg','f-sol','f-frecv','f-snipe','f-snipemin','f-mw','f-mwh','f-dev'].forEach(id=>{ const el=g(id); if(el) el.addEventListener('input',()=>{ if(id==='f-name') v1(false); paint(); }); });
  g('f-burnfees').addEventListener('change',paint);
  pg.addEventListener('click',e=>{ const t=e.target;
    const f=t.closest('#fee-pills [data-f]'); if(f){ S.fee=+f.dataset.f; S.feeBy={}; paint(); return; }
    const pf=t.closest('#perfee [data-f]'); if(pf){ S.feeBy[pf.dataset.k]=+pf.dataset.f; paint(); return; }
    const sw=t.closest('[data-sw]'); if(sw){ const k=sw.dataset.sw; S[k]=!S[k]; if(k==='perSplit') paintSplit(); paint(); return; }
    const p=t.closest('#tok-pre [data-p]'); if(p){ S.preset=p.dataset.p; if(PRESETS[S.preset]) S.alloc={...PRESETS[S.preset]}; paintSplit(); paint(); return; }
    const sp=t.closest('[data-sp]'); if(sp){ S.splitBy[sp.dataset.k]=sp.dataset.sp; paintSplit(); paint(); return; }
    const ck=t.closest('#chips [data-ck]'); if(ck){ const k=ck.dataset.ck; if(S.chains.includes(k)){ if(S.chains.length===1){ SP.toast('A coin needs at least one chain','info'); return; } S.chains=S.chains.filter(x=>x!==k); } else S.chains=SP.chains.map(c=>c.key).filter(x=>x===k||S.chains.includes(x)); if(!S.chains.includes(S.pay)) S.pay=S.chains[0]; if(S.perSplit) paintSplit(); paint(); return; }
    const pk=t.closest('#pay [data-pk]'); if(pk){ S.pay=pk.dataset.pk; const d=g('f-dev'); if(num('f-dev',0)<minBuy(S.pay)) d.value=fmtNum(minBuy(S.pay)*2); paint(); return; }
    const cp=t.closest('#cap-pills [data-cap]'); if(cp){ S.capI=+cp.dataset.cap; paint(); return; } });
  g('split').addEventListener('input',e=>{ const a=e.target.closest('[data-a]'); if(a){ S.alloc[a.dataset.a]=clamp(Math.round(+a.value||0),0,100); S.preset='Custom'; $$('#tok-pre button').forEach(b=>b.classList.toggle('on',b.dataset.p==='Custom')); paintSplitTotals(); paintFoot(); }
    if(e.target.id==='f-treas') S.treas=e.target.value.trim(); if(e.target.id==='f-comm') S.comm=e.target.value.trim(); });
  g('split').addEventListener('change',e=>{ if(e.target.closest('[data-a]')) paintSplit(); });
  SP.onWallet(paint); SP.chainCosts().then(c=>{ CC=c; paint(); }).catch(()=>{});
  launchRepaint=()=>paint(); SP.onUpdate(launchRepaint);
  paintSplit(); show(1);
  if(LIVE&&window.CHAIN){ (CHAIN.equo?CHAIN.equo.capPresets():CHAIN.startCapUsd().then(v=>[v])).then(v=>{ v=(v||[]).filter(x=>x>0); if(v.length){ S.caps=v; S.capI=0; paint(); } }).catch(()=>{});
    CHAIN.launchesPaused().then(p=>{ S.paused=!!p; const el=g('paused'); el.classList.toggle('hidden',!p); if(p) el.innerHTML=ic('warn')+'<span>Launches are paused by the operator right now. You can prepare the coin; launching opens again when they resume.</span>'; paintFoot(); }).catch(()=>{}); }
}
window.SP_PAGE=function(){ if(!launchRepaint) launchInit(); else launchRepaint(); };
document.addEventListener('DOMContentLoaded',launchInit);
