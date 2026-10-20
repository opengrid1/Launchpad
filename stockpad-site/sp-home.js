/* Markets page: stat strip, stock filter chips, coin cards or table, stock directory. */
window.SP_PAGE=function(){
  const pg=$('#pg-markets'); if(!pg) return;
  // the seg buttons carry icon placeholders in the markup
  $('#mk-view [data-v="grid"]').innerHTML=ic('grid'); $('#mk-view [data-v="list"]').innerHTML=ic('list');
  const params=new URLSearchParams(location.search); let stock=params.get('stock')||'', sort='trend', view=localStorage.getItem('sp:view')||'grid';
  const list=()=>TOK.filter(x=>!stock||x.pair===stock);
  function sorted(){ const l=list().slice(); const score=x=>(x.vol||0)*2+(x.mc||0)*0.1+Math.max(0,86400*3-(Math.floor(Date.now()/1000)-(x.createdAt||0)))*0.01;
    if(sort==='new') l.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)); else if(sort==='vol') l.sort((a,b)=>(b.vol||0)-(a.vol||0)); else if(sort==='mc') l.sort((a,b)=>(b.mc||0)-(a.mc||0)); else l.sort((a,b)=>score(b)-score(a)); return l; }
  function strip(){ const l=list(); const vol=l.reduce((s,x)=>s+(x.vol||0),0), fees=l.reduce((s,x)=>s+(x.vol||0)*(x.feeBps||100)/10000,0), holders=l.reduce((s,x)=>s+(x.h||0),0);
    $('#mk-strip').innerHTML=[['Coins',l.length.toLocaleString(),stock?'paired with '+stock:'across '+SP.stocks.length+' stocks and ETH'],['Volume 24h',fmtUsd(vol),'on Uniswap v4'],['Fees 24h',fmtUsd(fees),'paid in the paired asset'],['Holders',holders.toLocaleString(),'wallets with a balance']].map(s=>`<div class="stat"><small>${s[0]}</small><b>${s[1]}</b><i>${s[2]}</i></div>`).join(''); }
  function chips(){ const counts={}; TOK.forEach(x=>{ counts[x.pair]=(counts[x.pair]||0)+1; }); const syms=[...SP.stocks.map(s=>s.symbol),'ETH'].filter(s=>counts[s]);
    $('#mk-chips').innerHTML=`<button class="chip ${!stock?'on':''}" data-st="">All coins</button>`+syms.map(s=>`<button class="chip ${stock===s?'on':''}" data-st="${s}"><img src="${pairImg(s)}" alt="" onerror="this.onerror=null;this.src='/img/eth.png'">${s==='ETH'?'ETH':esc((SP.stockBySym(s)||{}).ticker||s)}<span class="num muted">${counts[s]}</span></button>`).join('');
    $$('#mk-chips [data-st]').forEach(b=>b.onclick=()=>{ stock=b.dataset.st; const u=new URL(location.href); if(stock) u.searchParams.set('stock',stock); else u.searchParams.delete('stock'); history.replaceState(null,'',u); render(); }); }
  const stockOf=x=>SP.stockBySym(x.pair);
  function card(x){ const st=stockOf(x); return `<a class="cc" href="${tokenUrl(x)}"><div class="hd"><img class="lg" src="${SP.coinLogo(x)}" alt="" onerror="this.onerror=null;this.src='${DEF_LOGO}'"><div class="nm"><b>${esc(x.n)} <span class="muted" style="font-weight:500">${esc(x.t)}</span></b><small><span class="pairchip"><img src="${pairImg(x.pair)}" alt="" onerror="this.onerror=null;this.src='/img/eth.png'">${st?esc(st.ticker)+' pair':'ETH pair'}</span>${x.rewards?'<span class="tag mint">rewards</span>':''}</small></div><div class="px"><b>$${fmtPrice(x.px)}</b>${SP.fmtPct(x.c24||0)}</div></div>
    <div class="kv4"><div><small>Market cap</small><b>${fmtUsd(x.mc)}</b></div><div><small>Volume 24h</small><b>${fmtUsd(x.vol)}</b></div><div><small>Liquidity</small><b>${fmtUsd(x.liq)}</b></div></div>
    <div class="ft"><span>${(x.feeBps/100).toFixed(x.feeBps%100?2:0)}% fee in ${esc(x.pair)} · ${x.h||0} holders</span><span class="num">${ageStr(x.age||'0s')}</span></div></a>`; }
  function rowHtml(x){ const st=stockOf(x); return `<tr class="go" data-go="${tokenUrl(x)}"><td><div class="coin"><img class="lg" src="${SP.coinLogo(x)}" alt="" onerror="this.onerror=null;this.src='${DEF_LOGO}'"><div><b>${esc(x.t)}</b><small>${esc(x.n)}</small></div></div></td><td><span class="pairchip"><img src="${pairImg(x.pair)}" alt="" onerror="this.onerror=null;this.src='/img/eth.png'">${esc(st?st.ticker:'ETH')}</span></td><td class="r num">$${fmtPrice(x.px)}<small>${fmtPrice(x.pxPair)} ${esc(x.pair)}</small></td><td class="r">${SP.fmtPct(x.c24||0)}</td><td class="r num">${fmtUsd(x.mc)}</td><td class="r num">${fmtUsd(x.vol)}</td><td class="r num">${fmtUsd(x.liq)}</td><td class="r num">${(x.feeBps/100).toFixed(2)}%</td><td class="r num">${x.h||0}</td><td class="r num">${esc(x.age||'')}</td></tr>`; }
  function render(){ strip(); chips(); const l=sorted(); const st=SP.stockBySym(stock);
    $('#mk-title').textContent=stock?(st?st.name+' coins':'ETH-paired coins'):'Markets'; $('#mk-sub').textContent=stock?(st?`Coins paired with ${st.symbol}. Every fee and trade settles in ${st.symbol}.`:'Coins paired with ETH.'):'Coins paired with real stocks on Ethereum. Fees settle in the stock.';
    const empty=`<div class="empty card" style="grid-column:1/-1"><b>No coins ${stock?'paired with '+esc(stock):''} yet</b>Be the first: launch one in a single transaction.<div style="margin-top:12px"><a class="btn pri" href="/launch${stock&&stock!=='ETH'?'?pair='+stock:''}">Launch a coin</a></div></div>`;
    $('#mk-cards').innerHTML=l.length?l.map(card).join(''):empty; $('#mk-table tbody').innerHTML=l.length?l.map(rowHtml).join(''):`<tr><td colspan="10">${empty}</td></tr>`;
    $$('#mk-table tr[data-go]').forEach(r=>r.onclick=()=>SP.go(r.dataset.go));
    $('#mk-grid').classList.toggle('on',view==='grid'); $('#mk-list').classList.toggle('on',view==='list'); $$('#mk-view button').forEach(b=>b.classList.toggle('on',b.dataset.v===view));
    $$('#mk-sort button').forEach(b=>b.classList.toggle('on',b.dataset.s===sort)); stocks(); }
  function stocks(){ const counts={}; TOK.forEach(x=>{ counts[x.pair]=(counts[x.pair]||0)+1; }); const mk=SP.market();
    $('#mk-stocks').innerHTML=SP.stocks.map(s=>{ const p=SP.prices[s.address.toLowerCase()]; return `<div class="sc"><img src="${s.logo}" alt="" onerror="this.onerror=null;this.src='/img/eth.png'"><div class="nm"><b>${esc(s.name)} <span class="muted" style="font-weight:500">${esc(s.ticker)}</span></b><small>${esc(s.symbol)} · ${counts[s.symbol]||0} ${counts[s.symbol]===1?'coin':'coins'}</small></div><div class="px"><b>${p?'$'+(p>=100?p.toFixed(0):p.toFixed(2)):'<span class="sk"></span>'}</b><small>${mk.open?'market open':'market closed'}</small></div><a class="btn sm" href="/launch?pair=${s.symbol}">Launch</a></div>`; }).join(''); }
  $$('#mk-sort button').forEach(b=>b.onclick=()=>{ sort=b.dataset.s; render(); });
  $$('#mk-view button').forEach(b=>b.onclick=()=>{ view=b.dataset.v; localStorage.setItem('sp:view',view); render(); });
  render(); SP.onUpdate(render);
};
