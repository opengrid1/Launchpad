/* Token page chart, drawn on a canvas of our own (no charting library).
   Candles come from the ledger's Trade events through chain.js (pair units per coin) and are shown in USD or in the
   paired asset, as market cap or price. A coin on several chains has a pool on each: "All chains" draws them merged,
   "Compare" draws a line per chain in its colour, or one chain alone. Across chains it is USD only, since each chain
   can pair with its own coin. Keeps the initTV / tvTick API sp-token.js calls. */
(function(){
  const RES=[60,300,900,1800,3600,14400,86400,604800];
  const RANGES=[['1H',3600],['6H',21600],['1D',86400],['1W',604800],['1M',2592000],['All',0]];
  const RNAME={'1H':'Past hour','6H':'Past 6 hours','1D':'Past day','1W':'Past week','1M':'Past month','All':'All time'};
  let X=null, el=null, cv=null, ctx=null, dot=null, W=0, H=0, dpr=1;
  let rng='1D', kind='line', mode='mcap', unit='USD', pick='all'; // pick: 'all' merged, 'cmp' a line per chain, or a chain key
  let S={}, vol=[], dom=null, step=900, hover=null, reveal=1, gen=0, raf=0;
  const chains=()=>(typeof SP!=='undefined'&&SP.coinChains&&X)?SP.coinChains(X):['eth'];
  const multi=()=>chains().length>1;
  const chainOf=k=>(typeof SP!=='undefined'&&SP.chain&&SP.chain(k))||{name:k,color:'#8e8e97',logo:''};
  const pairUsdFor=k=>(X&&X.byChain&&X.byChain[k]&&X.byChain[k].pairUsd)||(X?X.pairUsd:1);
  const factor=k=>(mode==='mcap'?SUPPLY*chains().length:1)*(unit==='USD'?pairUsdFor(k):1);
  const keys=()=>!multi()?[chains()[0]]:pick==='all'?['merged']:pick==='cmp'?chains():[pick];
  const livePx=k=>{ if(k!=='merged'&&multi()&&X.byChain&&X.byChain[k]&&X.byChain[k].px) return X.byChain[k].px/pairUsdFor(k); return X.pxPair; };
  const css=(v,d)=>getComputedStyle(document.documentElement).getPropertyValue(v).trim()||d;
  const esc2=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const rgba=(h,a)=>{ const m=/^#?([0-9a-f]{6})$/i.exec(h||''); if(!m) return `rgba(63,188,255,${a})`; const n=parseInt(m[1],16); return `rgba(${n>>16&255},${n>>8&255},${n&255},${a})`; };
  const now=()=>Math.floor(Date.now()/1000);

  /* ---------- number formats ---------- */
  const SUBS='₀₁₂₃₄₅₆₇₈₉';
  function num(v){ if(v==null||isNaN(v)) return ''; const a=Math.abs(v), s=v<0?'-':''; if(a===0) return '0';
    if(a>=1e9) return s+(a/1e9).toFixed(2)+'B'; if(a>=1e6) return s+(a/1e6).toFixed(2)+'M'; if(a>=1e4) return s+(a/1e3).toFixed(1)+'K';
    if(a>=1) return s+a.toLocaleString('en-US',{maximumFractionDigits:a>=1000?0:a>=100?2:4});
    if(a>=0.001) return s+String(+a.toPrecision(4));
    // 0.0₅1234: the count of zeros after the point as a subscript
    const z=-Math.floor(Math.log10(a))-1; const d=String(Math.round(a*Math.pow(10,z+4))).slice(0,4).replace(/0+$/,'');
    return s+'0.0'+String(z).replace(/\d/g,c=>SUBS[c])+d; }
  const money=v=>unit==='USD'?'$'+num(v):num(v)+' '+(X?X.pair:'ETH');
  const axis=v=>(unit==='USD'?'$':'')+num(v);

  /* ---------- markup ---------- */
  const seg=(id,opts,cur)=>`<div class="eqc-seg" id="${id}">${opts.map(o=>`<button data-v="${o[0]}" class="${o[0]===cur?'on':''}" ${o[2]?`aria-label="${o[2]}" title="${o[2]}"`:''}>${o[1]}</button>`).join('')}</div>`;
  const IC_LINE='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 11.5c2-1 2.6-5 4.6-5s2 3 4 3 2.4-5 4.4-6"/></svg>';
  const IC_CNDL='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 1.5v13M11.5 1.5v12"/><rect x="2.5" y="4.5" width="4" height="6" rx="1"/><rect x="9.5" y="3" width="4" height="7" rx="1"/></svg>';
  function markup(){ const pair=X?X.pair:'ETH';
    return `<div class="eqc-top"><div class="eqc-leg" id="eqc-leg"></div>
        <div class="eqc-r">${seg('eqc-mode',[['mcap','MCap'],['price','Price']],mode)}${seg('eqc-unit',[['USD','USD'],['PAIR',esc2(pair)]],unit)}${seg('eqc-kind',[['line',IC_LINE,'Line'],['candle',IC_CNDL,'Candles']],kind)}</div></div>
      <div class="eqc-box"><canvas id="eqc-cv"></canvas><span class="eqc-dot" id="eqc-dot" hidden></span><div class="eqc-no" id="eqc-no" hidden></div></div>
      <div class="eqc-bot"><div class="eqc-rg" id="eqc-rg">${RANGES.map(r=>`<button data-v="${r[0]}" class="${r[0]===rng?'on':''}">${r[0]}</button>`).join('')}</div>
        ${multi()?`<div class="eqc-ch" id="eqc-ch"><button data-v="all" class="tx ${pick==='all'?'on':''}">All chains</button><button data-v="cmp" class="tx ${pick==='cmp'?'on':''}">Compare</button>${chains().map(k=>{ const c=chainOf(k); return `<button data-v="${k}" class="lg ${pick===k?'on':''}" style="--c:${c.color}" title="${esc2(c.name)}" aria-label="${esc2(c.name)}">${c.logo?`<img src="${c.logo}" alt="">`:esc2(c.code||k)}</button>`; }).join('')}</div>`:''}</div>`; }
  const paintOn=(sel,v)=>el.querySelectorAll(sel+' [data-v]').forEach(b=>b.classList.toggle('on',b.dataset.v===v));
  function wire(){
    const on=(sel,fn)=>el.querySelectorAll(sel+' [data-v]').forEach(b=>b.onclick=()=>fn(b.dataset.v));
    on('#eqc-rg',v=>{ rng=v; paintOn('#eqc-rg',v); load(true); });
    on('#eqc-kind',v=>{ kind=v; paintOn('#eqc-kind',v); load(true); });
    on('#eqc-mode',v=>{ mode=v; paintOn('#eqc-mode',v); load(true); });
    on('#eqc-unit',v=>{ if(v==='PAIR'&&multi()&&(pick==='all'||pick==='cmp')){ if(typeof SP!=='undefined'&&SP.toast) SP.toast('Pick one chain to see the price in '+X.pair,'info'); return; } unit=v; paintOn('#eqc-unit',v); load(true); });
    on('#eqc-ch',v=>{ pick=v; if((v==='all'||v==='cmp')&&unit==='PAIR'){ unit='USD'; paintOn('#eqc-unit',unit); } paintOn('#eqc-ch',v); load(true); });
    cv.addEventListener('pointermove',e=>{ const r=cv.getBoundingClientRect(); hover={x:e.clientX-r.left,y:e.clientY-r.top}; ask(); });
    cv.addEventListener('pointerdown',e=>{ if(e.pointerType!=='mouse'){ const r=cv.getBoundingClientRect(); hover={x:e.clientX-r.left,y:e.clientY-r.top}; ask(); } });
    const off=()=>{ hover=null; ask(); }; cv.addEventListener('pointerleave',off); cv.addEventListener('pointerup',e=>{ if(e.pointerType!=='mouse') off(); }); cv.addEventListener('pointercancel',off);
    new ResizeObserver(()=>{ size(); draw(); }).observe(cv.parentNode); }

  /* ---------- data ---------- */
  const dedupe=rows=>{ const m=new Map(); (rows||[]).forEach(b=>{ if(b&&b.time) m.set(b.time,b); }); return [...m.values()].sort((a,b)=>a.time-b.time); };
  function span(){ const t1=now(), born=X.createdAt||0, r=RANGES.find(x=>x[0]===rng)[1]; let t0=r?t1-r:(born||t1-86400);
    if(born&&born>t0) t0=born; if(t1-t0<600) t0=t1-600; return [t0,t1]; }
  async function load(anim){ if(!X||!window.CHAIN) return; const my=++gen; const [t0,t1]=span();
    step=RES.find(s=>(t1-t0)/s<=240)||86400; const ks=keys(), merged=ks.length>1;
    const fetchK=k=>CHAIN.bars(X.addr,step,t0-step,t1+step,(multi()&&k!=='merged')?k:undefined).catch(e=>{ console.warn('bars',e); return []; });
    const got=await Promise.all(ks.map(fetchK)), vb=merged?await fetchK('merged'):null;
    if(my!==gen) return; S={};
    ks.forEach((k,i)=>{ const f=factor(k), rows=dedupe(got[i]).filter(b=>b.time+step>=t0);
      const bars=rows.map(b=>({t:Math.max(b.time,t0),o:b.open*f,h:b.high*f,l:b.low*f,c:b.close*f,v:b.volume*(pairUsdFor(k)||1)}));
      // the line runs edge to edge: from the first bar's open at the left, to the live price now
      // between trades the price holds: a gap keeps the last close flat until the bar before the next trade
      const live=livePx(k)*f, pts=[]; bars.forEach(b=>{ const L=pts[pts.length-1]; if(L&&b.t-L.t>step*1.5) pts.push({t:b.t-step,v:L.v}); pts.push({t:b.t,v:b.c}); });
      if(!pts.length) pts.push({t:t0,v:live}); else if(pts[0].t>t0) pts.unshift({t:t0,v:bars[0].o});
      if(live>0&&pts[pts.length-1].t<t1){ const L=pts[pts.length-1]; if(t1-L.t>step*1.5) pts.push({t:t1-step,v:L.v}); pts.push({t:t1,v:live}); }
      S[k]={bars,pts,live,color:k==='merged'||!multi()||ks.length===1?null:chainOf(k).color}; });
    vol=(merged?dedupe(vb).map(b=>({t:b.time,o:b.open,c:b.close,v:b.volume*(pairUsdFor('merged')||1)})):S[ks[0]].bars).filter(b=>b.t>=t0-step);
    dom={t0,t1}; el.querySelector('#eqc-no').hidden=ks.some(k=>S[k].bars.length);
    el.querySelector('#eqc-no').textContent=`No trades ${rng==='All'?'yet':'in the '+RNAME[rng].toLowerCase().replace('past ','last ')}`;
    if(anim){ const a0=performance.now(); const tick=t=>{ reveal=Math.min(1,(t-a0)/650); reveal=1-Math.pow(1-reveal,3); draw(); if(reveal<1) requestAnimationFrame(tick); }; reveal=0; requestAnimationFrame(tick); } else { reveal=1; draw(); } }

  /* ---------- drawing ---------- */
  function size(){ const b=cv.parentNode.getBoundingClientRect(); dpr=Math.min(2,devicePixelRatio||1); W=Math.max(10,b.width); H=Math.max(10,b.height);
    cv.width=Math.round(W*dpr); cv.height=Math.round(H*dpr); cv.style.width=W+'px'; cv.style.height=H+'px'; }
  const ask=()=>{ if(raf) return; raf=requestAnimationFrame(()=>{ raf=0; draw(); }); };
  // a smooth line through the points that never overshoots them (monotone cubic)
  function curve(P,move=true){ const n=P.length; if(!n) return; if(move) ctx.moveTo(P[0][0],P[0][1]); else ctx.lineTo(P[0][0],P[0][1]); if(n===1) return;
    const d=[],m=[]; for(let i=0;i<n-1;i++) d[i]=(P[i+1][1]-P[i][1])/((P[i+1][0]-P[i][0])||1);
    m[0]=d[0]; m[n-1]=d[n-2]; for(let i=1;i<n-1;i++) m[i]=d[i-1]*d[i]<=0?0:(d[i-1]+d[i])/2;
    for(let i=0;i<n-1;i++){ if(d[i]===0){ m[i]=m[i+1]=0; continue; } const a=m[i]/d[i], b=m[i+1]/d[i], s=a*a+b*b; if(s>9){ const t=3/Math.sqrt(s); m[i]=t*a*d[i]; m[i+1]=t*b*d[i]; } }
    for(let i=0;i<n-1;i++){ const dx=(P[i+1][0]-P[i][0])/3; ctx.bezierCurveTo(P[i][0]+dx,P[i][1]+m[i]*dx,P[i+1][0]-dx,P[i+1][1]-m[i+1]*dx,P[i+1][0],P[i+1][1]); } }
  function ticks(lo,hi,n){ const r=hi-lo; if(!(r>0)) return [lo]; const raw=r/n, p=Math.pow(10,Math.floor(Math.log10(raw))), f=raw/p, st=(f<1.5?1:f<3?2:f<7?5:10)*p; const out=[]; for(let v=Math.ceil(lo/st)*st;v<=hi+st*1e-9;v+=st) out.push(v); return out; }
  function tlabel(t,full){ const d=new Date(t*1000), s=dom.t1-dom.t0;
    if(full) return d.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
    return s<=2*86400?d.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'}):d.toLocaleDateString(undefined,{month:'short',day:'numeric'}); }
  function draw(){ if(!ctx||!dom||!W) return; const ks=keys(); ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,W,H);
    const font=getComputedStyle(document.body).fontFamily, fg3=css('--fg-3','#8e8e97'), lineC=css('--line','#1e1e23'), up=css('--up','#2ebd85'), dn=css('--dn','#f6465d');
    const T=12, B=26; let R=0;
    // y range over what is drawn, with room above and below
    let lo=Infinity, hi=-Infinity; ks.forEach(k=>{ const s=S[k]; (kind==='candle'?s.bars.map(b=>[b.l,b.h]).flat():s.pts.map(p=>p.v)).forEach(v=>{ if(v>0){ lo=Math.min(lo,v); hi=Math.max(hi,v); } }); if(kind==='candle'&&s.live>0){ lo=Math.min(lo,s.live); hi=Math.max(hi,s.live); } });
    if(!isFinite(lo)){ lo=0; hi=1; } if(hi-lo<hi*1e-6){ const c=hi||1; lo=c*0.95; hi=c*1.05; } const pad=(hi-lo)*0.14; lo-=pad*0.6+(hi-lo)*0.18; hi+=pad;
    // the scale on the right is as wide as its longest label
    const gl=ticks(lo+(hi-lo)*0.18,hi,4), lastV=ks.map(k=>S[k].live||0);
    ctx.font=`600 11px ${font}`; R=Math.ceil(Math.max(44,...gl.map(v=>ctx.measureText(axis(v)).width),...lastV.map(v=>ctx.measureText(axis(v)).width))+20);
    const pw=W-R, ph=H-T-B, vh=ph*0.16;
    const xs=t=>(t-dom.t0)/((dom.t1-dom.t0)||1)*(pw-14)+6, ys=v=>T+(1-(v-lo)/(hi-lo))*ph;
    const main=ks.length===1?S[ks[0]]:null, chg=main&&main.pts.length>1?main.pts[main.pts.length-1].v/main.pts[0].v-1:0;
    const col=k=>S[k].color||(chg>=0?up:dn);
    // price guides on the right, time along the bottom
    ctx.font=`500 11px ${font}`; ctx.textBaseline='middle'; ctx.fillStyle=fg3; ctx.strokeStyle=lineC; ctx.lineWidth=1; ctx.setLineDash([2,4]);
    const tags=ks.map(k=>{ const s=S[k], v=kind==='candle'?(s.live||(s.bars.length?s.bars[s.bars.length-1].c:0)):s.pts[s.pts.length-1].v; return {k,v,y:ys(v),c:kind==='candle'?(chg>=0?up:dn):col(k)}; }).filter(t=>t.v>0).sort((a,b)=>a.y-b.y);
    for(let i=1;i<tags.length;i++) if(tags[i].y-tags[i-1].y<18) tags[i].y=tags[i-1].y+18;
    gl.forEach(v=>{ const y=Math.round(ys(v))+.5; if(y<T+6||y>T+ph-4) return; const near=tags.some(t=>Math.abs(t.y-y)<16); ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(pw,y); ctx.stroke(); if(!near){ ctx.textAlign='left'; ctx.fillText(axis(v),pw+8,y); } });
    ctx.setLineDash([]); ctx.textAlign='center'; ctx.textBaseline='alphabetic'; const nt=Math.max(3,Math.min(5,Math.floor(pw/120)));
    for(let i=1;i<nt;i++){ const t=dom.t0+(dom.t1-dom.t0)*i/nt; if(hover&&hover.x<=pw&&Math.abs(xs(t)-hover.x)<110) continue; ctx.fillText(tlabel(t),xs(t),H-8); }
    ctx.save(); ctx.beginPath(); ctx.rect(0,0,6+(pw-6)*reveal+1,H); ctx.clip();
    // volume, faint at the foot
    const bw=Math.max(1.5,Math.min(14,(pw-14)*step/((dom.t1-dom.t0)||1)*0.62)); const vmax=Math.max(...vol.map(b=>b.v),0);
    if(vmax>0) vol.forEach(b=>{ const h=Math.max(1.5,b.v/vmax*vh), x=xs(b.t+step/2); ctx.fillStyle=rgba(b.c>=b.o?up:dn,.22); round(x-bw/2,T+ph-h,bw,h,Math.min(2,bw/2)); ctx.fill(); });
    if(kind==='candle') ks.forEach(k=>S[k].bars.forEach(b=>{ const x=xs(b.t+step/2), c=b.c>=b.o?up:dn; ctx.strokeStyle=c; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(Math.round(x)+.5,ys(b.h)); ctx.lineTo(Math.round(x)+.5,ys(b.l)); ctx.stroke();
      const y1=ys(Math.max(b.o,b.c)), y2=ys(Math.min(b.o,b.c)); ctx.fillStyle=c; round(x-bw/2,y1,bw,Math.max(1.5,y2-y1),Math.min(1.5,bw/3)); ctx.fill(); }));
    else ks.forEach(k=>{ const s=S[k], P=s.pts.map(p=>[xs(p.t),ys(p.v)]), c=col(k);
      if(ks.length===1){ const g=ctx.createLinearGradient(0,T,0,T+ph); g.addColorStop(0,rgba(c,.26)); g.addColorStop(.7,rgba(c,.04)); g.addColorStop(1,rgba(c,0));
        ctx.beginPath(); curve(P); ctx.lineTo(P[P.length-1][0],T+ph); ctx.lineTo(P[0][0],T+ph); ctx.closePath(); ctx.fillStyle=g; ctx.fill(); }
      ctx.beginPath(); curve(P); ctx.strokeStyle=c; ctx.lineWidth=ks.length===1?2.2:1.8; ctx.lineJoin='round'; ctx.lineCap='round'; ctx.shadowColor=rgba(c,.55); ctx.shadowBlur=ks.length===1?12:6; ctx.stroke(); ctx.shadowBlur=0; });
    ctx.restore();
    // last value: a dotted level and a tag on the scale (nudged apart when several)
    tags.forEach(t=>{ const yl=ys(t.v); if(ks.length===1){ ctx.strokeStyle=rgba(t.c,.5); ctx.setLineDash([1,3]); ctx.beginPath(); ctx.moveTo(0,Math.round(yl)+.5); ctx.lineTo(pw,Math.round(yl)+.5); ctx.stroke(); ctx.setLineDash([]); }
      const txt=axis(t.v); ctx.font=`600 11px ${font}`; const tw=ctx.measureText(txt).width+12; ctx.fillStyle=t.c; round(pw+2,t.y-10,Math.min(R-2,tw),20,6); ctx.fill(); ctx.fillStyle='#06100c'; ctx.textAlign='left'; ctx.textBaseline='middle'; ctx.fillText(txt,pw+8,t.y+.5); });
    // the live point breathes (line view, one series)
    if(kind==='line'&&ks.length===1&&reveal>=1){ const p=main.pts[main.pts.length-1]; dot.hidden=!!hover; dot.style.left=xs(p.t)+'px'; dot.style.top=ys(p.v)+'px'; dot.style.setProperty('--c',col(ks[0])); } else dot.hidden=true;
    // cursor: snap to the nearest point of each series
    let at=null; if(hover&&hover.x<=pw){ const t=dom.t0+(hover.x-6)/(pw-14)*(dom.t1-dom.t0); at={t,vals:{}}; let sx=null;
      ks.forEach(k=>{ const s=S[k], arr=kind==='candle'?s.bars.map(b=>({t:b.t+step/2,v:b.c,b})):s.pts; if(!arr.length) return; let best=arr[0]; arr.forEach(p=>{ if(Math.abs(p.t-t)<Math.abs(best.t-t)) best=p; }); at.vals[k]=best; if(ks.length===1) sx=xs(best.t); });
      const x=sx!=null?sx:hover.x; ctx.strokeStyle='rgba(180,180,187,.35)'; ctx.setLineDash([3,3]); ctx.beginPath(); ctx.moveTo(Math.round(x)+.5,T); ctx.lineTo(Math.round(x)+.5,T+ph); ctx.stroke(); ctx.setLineDash([]);
      if(kind==='line') ks.forEach(k=>{ const p=at.vals[k]; if(!p) return; const c=col(k); ctx.beginPath(); ctx.arc(xs(p.t),ys(p.v),4.5,0,7); ctx.fillStyle=c; ctx.fill(); ctx.lineWidth=2.5; ctx.strokeStyle='#0a0a0b'; ctx.stroke(); });
      const tt=sx!=null?at.vals[ks[0]].t:t, lab=tlabel(Math.min(dom.t1,tt),true); ctx.font=`500 11px ${font}`; const lw=ctx.measureText(lab).width+14, lx=Math.max(0,Math.min(pw-lw,x-lw/2));
      ctx.fillStyle='#1e1e23'; round(lx,H-B+3,lw,20,6); ctx.fill(); ctx.fillStyle='#ededef'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(lab,lx+lw/2,H-B+13.5); at.x=x; }
    legend(at,chg); }
  function round(x,y,w,h,r){ ctx.beginPath(); if(ctx.roundRect) ctx.roundRect(x,y,w,h,r); else ctx.rect(x,y,w,h); }

  /* ---------- legend: big value (under the cursor, or the latest) and the change over the range ---------- */
  function legend(at,chg){ const lg=el.querySelector('#eqc-leg'); if(!lg) return; const ks=keys(), what=mode==='mcap'?'Market cap':'Price';
    if(ks.length===1){ const s=S[ks[0]]; if(!s) return; const p=at&&at.vals[ks[0]], v=p?(p.b?p.b.c:p.v):(s.live>0?s.live:s.pts[s.pts.length-1].v), base=s.pts[0].v, c=base>0?v/base-1:chg;
      const nm=ks[0]==='merged'?'All chains':multi()?chainOf(ks[0]).name:'';
      const ohlc=p&&p.b?`<span class="ohlc">O <b>${axis(p.b.o)}</b> H <b>${axis(p.b.h)}</b> L <b>${axis(p.b.l)}</b> C <b>${axis(p.b.c)}</b></span>`:'';
      lg.innerHTML=`<span class="t">${what}${nm?' · '+esc2(nm):''}</span><span class="v"><b>${money(v)}</b><em class="${c>=0?'up':'dn'}">${c>=0?'▲':'▼'} ${Math.abs(c*100).toFixed(2)}%</em><small>${p?esc2(tlabel(Math.min(dom.t1,p.t),true)):RNAME[rng]}</small></span>${ohlc}`; return; }
    lg.innerHTML=`<span class="t">${what} by chain${at?' · '+esc2(tlabel(Math.min(dom.t1,at.t),true)):''}</span><span class="ls">${ks.map(k=>{ const s=S[k]; if(!s) return ''; const p=at&&at.vals[k], v=p?p.v:s.pts[s.pts.length-1].v; return `<span style="--c:${chainOf(k).color}"><i></i>${esc2(chainOf(k).short||chainOf(k).name)}<b>${money(v)}</b></span>`; }).join('')}</span>`; }

  /* ---------- live: called after every refresh with the latest pair price and the trades since the last call ---------- */
  window.tvTick=function(pxPair,newTrades){ if(!X||!dom) return; if(newTrades&&newTrades.length){ load(false); return; }
    const t1=now(); dom.t1=t1; keys().forEach(k=>{ const s=S[k]; if(!s) return; const v=livePx(k)*factor(k); if(!(v>0)) return; s.live=v;
      const L=s.pts[s.pts.length-1]; if(L&&s.pts.length>1&&L.t>=t1-step&&!s.bars.some(b=>b.t===L.t)){ L.t=t1; L.v=v; } else s.pts.push({t:t1,v}); });
    draw(); };

  window.initTV=function(container,x){ X=x; el=typeof container==='string'?document.getElementById(container):container;
    el.classList.add('eqc'); el.innerHTML=markup(); cv=el.querySelector('#eqc-cv'); dot=el.querySelector('#eqc-dot'); ctx=cv.getContext('2d');
    if(multi()) pick='all'; wire(); size(); load(true); return true; };
})();
