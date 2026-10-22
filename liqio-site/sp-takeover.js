/* Takeover page: every coin's creator status (active, open for takeover, running, ready, blocked), with a link to
   the coin's page where the creator card runs the actions. Uses SPC.status (sp-creator.js). */
window.SP_PAGE=function(){
  const pg=$('#pg-tko'); if(!pg) return;
  let filter='all', rows=[];
  const label={active:'Active',open:'Open',running:'Running',ready:'Ready',blocked:'Blocked'};
  const coinCell=x=>`<div class="coin"><span class="av2"><img class="lg" src="${SP.coinLogo(x)}" alt="" onerror="this.onerror=null;this.src='${DEF_LOGO}'"><img class="stb" src="${pairImg(x.pair)}" alt="" onerror="this.onerror=null;this.src='/img/t-default.png'"></span><div><b>$${esc(x.t)}</b><small>${esc(x.n)}</small></div></div>`;
  function paint(){ const l=rows.filter(r=>filter==='all'||(filter==='open'&&r.s.stage==='open')||(filter==='live'&&['running','ready','blocked'].includes(r.s.stage)));
    $('#tk-n').textContent=rows.length?`${rows.filter(r=>r.s.stage==='open').length} open · ${rows.filter(r=>['running','ready'].includes(r.s.stage)).length} running`:'';
    $('#tk-t tbody').innerHTML=l.length?l.map(r=>`<tr class="go" data-go="${tokenUrl(r.x)}"><td>${coinCell(r.x)}</td><td>${SPC.who(r.s.creator)}</td><td class="r num">${SPC.dur(r.s.idleFor)} ago</td><td><span class="st ${r.s.stage}">${label[r.s.stage]}</span></td><td class="r"><a class="btn sm" href="${tokenUrl(r.x)}">${r.s.stage==='open'?'Propose':r.s.stage==='ready'?'Execute':'View'}</a></td></tr>`).join('')
      :`<tr><td colspan="5"><div class="empty">${rows.length?'Nothing here right now':'No coins yet'}</div></td></tr>`;
    $$('#tk-t tr[data-go]').forEach(r=>r.onclick=e=>{ if(e.target.closest('a')) return; SP.go(r.dataset.go); }); }
  async function load(){ if(!window.CHAIN||!CHAIN.equo){ $('#tk-t tbody').innerHTML='<tr><td colspan="5"><div class="empty">Unavailable</div></td></tr>'; return; }
    const got=await Promise.all(TOK.map(x=>SPC.status(x.addr).then(s=>({x,s})).catch(()=>null)));
    const rank={ready:0,running:1,open:2,blocked:3,active:4};
    rows=got.filter(Boolean).sort((a,b)=>rank[a.s.stage]-rank[b.s.stage]||b.s.idleFor-a.s.idleFor); paint(); }
  $$('#tk-f button').forEach(b=>b.onclick=()=>{ filter=b.dataset.k; $$('#tk-f button').forEach(x=>x.classList.toggle('on',x===b)); paint(); });
  $('#tk-t tbody').innerHTML='<tr><td colspan="5"><div class="empty">Loading…</div></td></tr>';
  load(); SP.onUpdate(()=>load());
};
