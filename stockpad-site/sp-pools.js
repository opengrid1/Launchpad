/* Pools page: every coin's Uniswap v4 pool with liquidity, 24h volume and fees, trades and age, with links to Uniswap and Etherscan. */
window.SP_PAGE=function(){
  const pg=$('#pg-pools'); if(!pg) return;
  let sort='liq', q='';
  const fee=x=>(x.feeBps||100)/100;
  const match=x=>{ if(!q) return true; const v=q.toLowerCase(); const st=SP.stockBySym(x.pair); return x.n.toLowerCase().includes(v)||x.t.toLowerCase().includes(v)||(x.pair||'').toLowerCase().includes(v)||(st&&(st.ticker||'').toLowerCase().includes(v))||x.addr.includes(v); };
  function render(){ const all=TOK; const liq=all.reduce((s,x)=>s+(x.liq||0),0), vol=all.reduce((s,x)=>s+(x.vol||0),0), fees=all.reduce((s,x)=>s+(x.vol||0)*fee(x)/100,0);
    $('#pl-kpis').innerHTML=[['Pools',all.length.toLocaleString()],['Liquidity',fmtUsd(liq)],['Volume 24h',fmtUsd(vol)],['Fees 24h',fmtUsd(fees)]].map(k=>`<div class="sbox panel"><span class="lab">${k[0]}</span><b>${k[1]}</b></div>`).join('');
    const l=all.filter(match).slice().sort((a,b)=>sort==='vol'?(b.vol||0)-(a.vol||0):sort==='new'?(b.createdAt||0)-(a.createdAt||0):(b.liq||0)-(a.liq||0));
    $('#pl-t tbody').innerHTML=l.length?l.map(x=>{ const st=SP.stockBySym(x.pair); return `<tr class="go" data-go="${tokenUrl(x)}"><td><div class="pp"><span class="ic2"><img src="${SP.coinLogo(x)}" alt="" onerror="this.onerror=null;this.src='${DEF_LOGO}'"><img src="${pairImg(x.pair)}" alt="" onerror="this.onerror=null;this.src='/img/eth.png'"></span><div><b>${esc(x.t)} / ${esc(st?st.ticker:'ETH')}</b><small>${esc(x.n)} · ${esc(x.pair)}</small></div></div></td><td class="r num">${fee(x).toFixed(fee(x)%1?(fee(x)*10%1?2:1):0)}%</td><td class="r num">${fmtUsd(x.liq||0)}<small>${SP.fmtPair(x.liqPair||0,x)}</small></td><td class="r num">${fmtUsd(x.vol||0)}</td><td class="r num hm">${fmtUsd((x.vol||0)*fee(x)/100)}</td><td class="r num hm">${(x.trades||0).toLocaleString()}</td><td class="r num hm">${ageStr(x.age||'0s')}</td><td class="lk">${x.poolId?`<a href="https://app.uniswap.org/explore/pools/ethereum/${x.poolId}" target="_blank" rel="noopener">Uniswap${ic('ext')}</a>`:''}<a href="${EXPLORER}/token/${x.addr}" target="_blank" rel="noopener">Etherscan${ic('ext')}</a></td></tr>`; }).join('')
      :`<tr><td colspan="8"><div class="empty">${q?'No pools match':'No pools yet'}</div></td></tr>`;
    $$('#pl-t tr[data-go]').forEach(r=>r.onclick=e=>{ if(e.target.closest('a')) return; SP.go(r.dataset.go); }); }
  $$('#pl-sort button').forEach(b=>b.onclick=()=>{ sort=b.dataset.k; $$('#pl-sort button').forEach(x=>x.classList.toggle('on',x===b)); render(); });
  let t; $('#pl-q').addEventListener('input',e=>{ clearTimeout(t); t=setTimeout(()=>{ q=e.target.value.trim(); render(); },120); });
  render(); SP.onUpdate(render);
};
