/* Calls page: post a call on a coin (bull or bear, up to 280 characters) and see how each call did since it was posted.
   Calls are stored by the Liqio server (INKY.api). Until that server is live the composer stays disabled and the feed shows
   an example card, clearly labelled. Trending uses on-chain data and works today. */
window.SP_PAGE=function(){
  const pg=$('#pg-calls'); if(!pg) return;
  const API=(window.INKY&&INKY.api)||'';
  const S={coin:null,side:'bull',sort:'new',calls:[]};
  const g=id=>document.getElementById(id);
  const now=()=>Math.floor(Date.now()/1000);
  const mult=(a,b)=>a>0&&b>0?b/a:0;
  const multTxt=m=>m>=10?m.toFixed(0)+'x':m>=1?m.toFixed(2).replace(/0$/,'')+'x':'-'+((1-m)*100).toFixed(0)+'%';

  /* ---------- composer ---------- */
  $$('#cl-side button').forEach(b=>{ b.innerHTML=b.dataset.s==='bull'?ic('bull')+'Bull':ic('bear')+'Bear'; b.onclick=()=>{ S.side=b.dataset.s; $$('#cl-side button').forEach(x=>x.classList.toggle('on',x===b)); }; });
  function me(){ g('cl-me').innerHTML=SP.W.connected?SP.avatar(SP.W.address,36):ic('user'); }
  function pickHtml(){ const x=S.coin; g('cl-pick').innerHTML=x?`<img src="${SP.coinLogo(x)}" alt="" onerror="this.onerror=null;this.src='${DEF_LOGO}'"><span>$${esc(x.t)}</span>${ic('down')}`:`<span class="ph0"></span><span>Pick a coin</span>${ic('down')}`; }
  function setCoin(x){ S.coin=x||null; pickHtml(); canPost(); }
  g('cl-pick').onclick=e=>{ const l=TOK.slice().sort((a,b)=>(b.vol||0)-(a.vol||0)).slice(0,40);
    const m=SP.menu(e.currentTarget,l.length?l.map(x=>`<button data-c="${x.addr}"><img src="${SP.coinLogo(x)}" style="width:22px;height:22px;border-radius:50%" alt=""><span><b>$${esc(x.t)}</b> <span class="muted">${esc(x.n)}</span></span><span class="num muted" style="margin-left:auto">${fmtUsd(x.mc)}</span></button>`).join(''):'<div class="empty" style="padding:14px">No coins yet</div>');
    $$('[data-c]',m).forEach(b=>b.onclick=()=>{ m.remove(); setCoin(SP.token(b.dataset.c)); g('cl-text').focus(); }); };
  g('cl-text').addEventListener('input',e=>{ g('cl-cnt').textContent=e.target.value.length+' / 280'; canPost(); });
  function canPost(){ const ok=!!API&&SP.W.connected&&!!S.coin&&g('cl-text').value.trim().length>0; g('cl-post').disabled=!ok; }
  function note(){ const n=g('cl-note');
    if(!API){ n.innerHTML=`${ic('info')}<span>Posting opens when the calls server goes live.</span>`; n.classList.remove('hidden'); return; }
    if(!SP.W.connected){ n.innerHTML=`${ic('wallet')}<span>Connect a wallet to post. Your call is signed by your wallet, no transaction.</span>`; n.classList.remove('hidden'); return; }
    n.classList.add('hidden'); }
  g('cl-post').onclick=async()=>{ if(!API) return; SP.toast('Posting is not connected yet','info'); };

  /* ---------- feed ---------- */
  function callCard(c,example){ const x=c.x||SP.token(c.token); if(!x) return ''; const m=mult(c.mcAt,x.mc); const up=m>=1;
    return `<article class="call ${example?'':'panel'}"><div class="chd"><span class="w"><span class="av">${SP.avatar(c.wallet,20)}</span>${example?`<a>${shortAddr(c.wallet)}</a>`:`<a href="/profile?a=${c.wallet}">${shortAddr(cs(c.wallet))}</a>`}</span><span>${ago(Math.max(0,now()-c.ts))} ago</span><span class="sd ${c.side}">${ic(c.side)}${c.side==='bull'?'Bull':'Bear'}</span></div>
      <p class="ct">${esc(c.text)}</p>
      <a class="cc" ${example?'':`href="${tokenUrl(x)}"`}><span class="av2"><img class="lg" src="${SP.coinLogo(x)}" alt="" onerror="this.onerror=null;this.src='${DEF_LOGO}'">${x.pair?`<img class="stb" src="${pairImg(x.pair)}" alt="" onerror="this.onerror=null;this.src='/img/t-default.png'">`:''}</span><span style="min-width:0"><b>$${esc(x.t)} <span class="muted" style="font-weight:400">${esc(x.n)}</span></b><small>Called at ${fmtUsd(c.mcAt)} · now ${fmtUsd(x.mc)}</small></span><span class="x"><b class="${up?'up':'dn'}">${m?multTxt(m):'—'}</b><small>since call</small></span></a>
      <div class="cf"><button type="button" ${example?'disabled':''}>${ic('star')}${c.likes||0}</button><button type="button" ${example?'disabled':''}>${ic('share')}Share</button></div></article>`; }
  function example(){ const x={t:'COIN',n:'Your coin',mc:100000,pair:'',img:''};
    return `<div class="ex"><span class="exl">Example</span>${callCard({wallet:'0x0000…0000',ts:now()-7200,side:'bull',text:'Volume picking up into the open. Holding through earnings.',mcAt:40000,likes:12,x},true)}</div>`; }
  function render(){ let l=S.calls.slice(); if(S.sort==='watch') l=l.filter(c=>SP.watch.has(c.token)); if(S.sort==='top') l.sort((a,b)=>mult(b.mcAt,(SP.token(b.token)||{}).mc)-mult(a.mcAt,(SP.token(a.token)||{}).mc)); else l.sort((a,b)=>b.ts-a.ts);
    g('cl-feed').innerHTML=l.length?l.map(c=>callCard(c)).join(''):`<div class="panel"><div class="emp"><b>${S.sort==='watch'?'No calls on your watchlist':'No calls yet'}</b>${API?'Be the first to call a coin.':'Calls show up here with how each coin did since it was called.'}</div></div>${API?'':example()}`; }
  $$('#cl-sort button').forEach(b=>b.onclick=()=>{ S.sort=b.dataset.k; $$('#cl-sort button').forEach(x=>x.classList.toggle('on',x===b)); render(); });
  async function load(){ if(!API) return render(); try{ const r=await fetch(API.replace(/\/$/,'')+'/calls',{headers:{accept:'application/json'}}); if(!r.ok) throw new Error('HTTP '+r.status); const j=await r.json(); S.calls=(Array.isArray(j)?j:j.calls||[]).filter(c=>SP.token(c.token)); }catch(e){ console.warn('calls',e); } render(); }

  /* ---------- side ---------- */
  function trending(){ const l=TOK.slice().sort((a,b)=>(b.vol||0)-(a.vol||0)).slice(0,6);
    g('cl-trend').innerHTML=l.length?l.map((x,i)=>`<a class="tr" href="${tokenUrl(x)}"><span class="i">${i+1}</span><div class="coin"><span class="av2"><img class="lg" src="${SP.coinLogo(x)}" alt="" onerror="this.onerror=null;this.src='${DEF_LOGO}'"><img class="stb" src="${pairImg(x.pair)}" alt="" onerror="this.onerror=null;this.src='/img/t-default.png'"></span><div style="min-width:0"><b>$${esc(x.t)}</b><small>${fmtUsd(x.mc)} mcap</small></div></div><span class="v">${fmtUsd(x.vol)}<small>${SP.fmtPct(x.c24||0)}</small></span><button type="button" class="btn sm line" data-callc="${x.addr}">Call</button></a>`).join(''):'<div class="empty" style="padding:24px">No coins yet</div>';
    $$('[data-callc]').forEach(b=>b.onclick=e=>{ e.preventDefault(); e.stopPropagation(); setCoin(SP.token(b.dataset.callc)); g('cl-text').focus(); scrollTo({top:0,behavior:'smooth'}); }); }
  g('cl-callers').innerHTML=`<b>Ranked by average return since each call.</b> Fills in once calls are live.<div class="rk">${[1,2,3].map(i=>`<div><i>${i}</i><span style="max-width:${[70,55,40][i-1]}%"></span><em></em></div>`).join('')}</div>`;

  const pre=new URLSearchParams(location.search).get('coin'); if(pre) setCoin(SP.token(pre));
  me(); pickHtml(); note(); canPost(); trending(); load();
  SP.onWallet(()=>{ me(); note(); canPost(); }); SP.onUpdate(()=>{ trending(); render(); });
};
