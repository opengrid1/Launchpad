/* Token page chart, drawn on a canvas of our own (no charting library).
   Candles come from the ledger's Trade events through chain.js (pair units per coin) and are shown in USD or in the
   paired asset, as market cap or price. A coin on several chains has a pool on each: "All chains" draws them merged,
   "Compare" draws a line per chain in its colour, or one chain alone. Across chains it is USD only, since each chain
   can pair with its own coin. Drag to pan, wheel or pinch to zoom, double click to fit.
   Keeps the initTV / tvTick API sp-token.js calls. */
(function(){
  const RES=[60,300,900,1800,3600,14400,86400,604800];
  const RANGES=[['1H',3600],['6H',21600],['1D',86400],['1W',604800],['1M',2592000],['All',0]];
  const RNAME={'1H':'Past hour','6H':'Past 6 hours','1D':'Past day','1W':'Past week','1M':'Past month','All':'All time'};
  let X=null, el=null, cv=null, ctx=null, dot=null, W=0, H=0, dpr=1, bgc='rgb(10,10,11)';
  let rng='All', kind='line', mode='mcap', unit='USD', pick='all'; // pick: 'all' merged, 'cmp' a line per chain, or a chain key
  let S={}, vol=[], dom=null, view=null, step=900, hover=null, reveal=1, gen=0, raf=0, G=null;
  const chains=()=>(typeof SP!=='undefined'&&SP.coinChains&&X)?SP.coinChains(X):['eth'];
  const multi=()=>chains().length>1;
  const chainOf=k=>(typeof SP!=='undefined'&&SP.chain&&SP.chain(k))||{name:k,color:'#8e8e97',logo:''};
  const pairUsdFor=k=>(X&&X.byChain&&X.byChain[k]&&X.byChain[k].pairUsd)||(X?X.pairUsd:1);
  const factor=k=>(mode==='mcap'?SUPPLY*chains().length:1)*(unit==='USD'?pairUsdFor(k):1);
  const keys=()=>!multi()?[chains()[0]]:pick==='all'?['merged']:pick==='cmp'?chains():[pick];
  const livePx=k=>{ if(k!=='merged'&&multi()&&X.byChain&&X.byChain[k]&&X.byChain[k].px) return X.byChain[k].px/pairUsdFor(k); return X.pxPair; };
  const css=(v,d)=>getComputedStyle(document.documentElement).getPropertyValue(v).trim()||d;
  const esc2=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const rgba=(h,a)=>{ let m=/^#?([0-9a-f]{6})$/i.exec(h||''); if(m){ const n=parseInt(m[1],16); return `rgba(${n>>16&255},${n>>8&255},${n&255},${a})`; }
    m=/rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(h||''); return m?`rgba(${m[1]},${m[2]},${m[3]},${a})`:`rgba(63,188,255,${a})`; };
  const now=()=>Math.floor(Date.now()/1000);
  const pinned=()=>view&&dom&&view.b>=dom.t1-1;
  const zoomed=()=>view&&dom&&(view.a>dom.t0+1||view.b<dom.t1-1);

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
  const usd=v=>!(v>0)?'$0':v>=1e4?'$'+num(v):v>=1?'$'+v.toLocaleString('en-US',{maximumFractionDigits:v>=100?0:2}):'<$1';

  /* ---------- markup ---------- */
  const seg=(id,opts,cur)=>`<div class="eqc-seg" id="${id}">${opts.map(o=>`<button data-v="${o[0]}" class="${o[0]===cur?'on':''}" ${o[2]?`aria-label="${o[2]}" title="${o[2]}"`:''}>${o[1]}</button>`).join('')}</div>`;
  const svg=d=>`<svg viewBox="0 0 16 16" aria-hidden="true">${d}</svg>`;
  const IC={ line:svg('<path d="M1.5 11.5c2-1 2.6-5 4.6-5s2 3 4 3 2.4-5 4.4-6"/>'), candle:svg('<path d="M4.5 1.5v13M11.5 1.5v12"/><rect x="2.5" y="4.5" width="4" height="6" rx="1"/><rect x="9.5" y="3" width="4" height="7" rx="1"/>'),
    full:svg('<path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"/>'), shrink:svg('<path d="M6 2v4H2M14 6h-4V2M10 14v-4h4M2 10h4v4"/>'),
    plus:svg('<path d="M8 3v10M3 8h10"/>'), minus:svg('<path d="M3 8h10"/>'), fit:svg('<path d="M2 8h12M4.5 5.5 2 8l2.5 2.5M11.5 5.5 14 8l-2.5 2.5"/>') };
  function markup(){ const pair=X?X.pair:'ETH';
    return `<div class="eqc-top"><div class="eqc-leg" id="eqc-leg"></div>
        <div class="eqc-r">${seg('eqc-mode',[['mcap','MCap'],['price','Price']],mode)}${seg('eqc-unit',[['USD','USD'],['PAIR',esc2(pair)]],unit)}${seg('eqc-kind',[['line',IC.line,'Line'],['candle',IC.candle,'Candles']],kind)}<button class="eqc-ib" id="eqc-full" aria-label="Full screen" title="Full screen">${IC.full}</button></div></div>
      <div class="eqc-box"><canvas id="eqc-cv"></canvas><span class="eqc-dot" id="eqc-dot" hidden></span><div class="eqc-no" id="eqc-no" hidden></div></div>
      <div class="eqc-bot"><div class="eqc-l"><div class="eqc-rg" id="eqc-rg">${RANGES.map(r=>`<button data-v="${r[0]}" class="${r[0]===rng?'on':''}">${r[0]}</button>`).join('')}</div>
        <div class="eqc-zm" id="eqc-zm"><button data-z="out" aria-label="Zoom out" title="Zoom out">${IC.minus}</button><button data-z="in" aria-label="Zoom in" title="Zoom in">${IC.plus}</button><button data-z="fit" aria-label="Fit" title="Fit (double click)">${IC.fit}</button></div></div>
        ${multi()?`<div class="eqc-ch" id="eqc-ch"><button data-v="all" class="tx ${pick==='all'?'on':''}">All chains</button><button data-v="cmp" class="tx ${pick==='cmp'?'on':''}">Compare</button>${chains().map(k=>{ const c=chainOf(k); return `<button data-v="${k}" class="lg ${pick===k?'on':''}" style="--c:${c.color}" title="${esc2(c.name)}" aria-label="${esc2(c.name)}">${c.logo?`<img src="${c.logo}" alt="">`:esc2(c.code||k)}</button>`; }).join('')}</div>`:''}</div>`; }
  const paintOn=(sel,v)=>el.querySelectorAll(sel+' [data-v]').forEach(b=>b.classList.toggle('on',b.dataset.v===v));

  /* ---------- zoom and pan: the view is a window of time inside the range loaded ---------- */
  const minSpan=()=>Math.min(dom.t1-dom.t0,step*10);
  function setView(a,b){ const full=dom.t1-dom.t0; let s=Math.max(minSpan(),Math.min(full,b-a)); if(a<dom.t0){ a=dom.t0; } if(a+s>dom.t1){ a=dom.t1-s; } view={a,b:a+s};
    el.classList.toggle('zoomed',zoomed()); ask(); }
  function zoomAt(k,t){ if(!view) return; t=t==null?(view.a+view.b)/2:t; setView(t-(t-view.a)*k,t+(view.b-t)*k); }
  const tAt=x=>G?view.a+(x-6)/(G.pw-14)*(view.b-view.a):0;

  function wire(){
    const on=(sel,fn)=>el.querySelectorAll(sel+' [data-v]').forEach(b=>b.onclick=()=>fn(b.dataset.v));
    on('#eqc-rg',v=>{ rng=v; paintOn('#eqc-rg',v); load(true); });
    on('#eqc-kind',v=>{ kind=v; paintOn('#eqc-kind',v); load(true,true); });
    on('#eqc-mode',v=>{ mode=v; paintOn('#eqc-mode',v); load(true,true); });
    on('#eqc-unit',v=>{ if(v==='PAIR'&&multi()&&(pick==='all'||pick==='cmp')){ if(typeof SP!=='undefined'&&SP.toast) SP.toast('Pick one chain to see the price in '+X.pair,'info'); return; } unit=v; paintOn('#eqc-unit',v); load(true,true); });
    on('#eqc-ch',v=>{ pick=v; if((v==='all'||v==='cmp')&&unit==='PAIR'){ unit='USD'; paintOn('#eqc-unit',unit); } paintOn('#eqc-ch',v); load(true,true); });
    el.querySelectorAll('#eqc-zm [data-z]').forEach(b=>b.onclick=()=>{ const z=b.dataset.z; if(z==='fit') setView(dom.t0,dom.t1); else zoomAt(z==='in'?0.6:1/0.6,pinned()?view.b:null); });
    const fb=el.querySelector('#eqc-full'); fb.onclick=()=>full(!el.classList.contains('full'));
    document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&el.classList.contains('full')) full(false); });
    // pointers: a mouse drags to pan and hovers to read; one finger reads, two fingers pinch and pan
    const pts=new Map(); let drag=null, pinch=null;
    const pos=e=>{ const r=cv.getBoundingClientRect(); return {x:e.clientX-r.left,y:e.clientY-r.top}; };
    cv.addEventListener('pointerdown',e=>{ if(!view) return; const p=pos(e); pts.set(e.pointerId,p); try{ cv.setPointerCapture(e.pointerId); }catch(_){}
      if(pts.size===2){ const [a,b]=[...pts.values()]; pinch={d:Math.hypot(a.x-b.x,a.y-b.y)||1,m:tAt((a.x+b.x)/2),v:{...view}}; hover=null; drag=null; }
      else if(e.pointerType==='mouse'&&e.button===0){ drag={x:p.x,v:{...view},moved:false}; }
      else if(e.pointerType!=='mouse'){ hover=p; ask(); } });
    cv.addEventListener('pointermove',e=>{ const p=pos(e); if(pts.has(e.pointerId)) pts.set(e.pointerId,p);
      if(pinch&&pts.size===2){ const [a,b]=[...pts.values()], d=Math.hypot(a.x-b.x,a.y-b.y)||1, k=pinch.d/d, s=(pinch.v.b-pinch.v.a)*k, mx=(a.x+b.x)/2, f=(mx-6)/(G.pw-14);
        setView(pinch.m-f*s,pinch.m-f*s+s); return; }
      if(drag){ const dx=p.x-drag.x; if(Math.abs(dx)>3) drag.moved=true; if(drag.moved){ const s=drag.v.b-drag.v.a, sh=-dx/(G.pw-14)*s; el.classList.add('grab'); hover=null; setView(drag.v.a+sh,drag.v.b+sh); return; } }
      if(e.pointerType==='mouse'||pts.has(e.pointerId)){ hover=p; ask(); } });
    const up=e=>{ pts.delete(e.pointerId); if(pts.size<2) pinch=null; if(drag){ drag=null; el.classList.remove('grab'); } if(e.pointerType!=='mouse'){ hover=null; ask(); } };
    cv.addEventListener('pointerup',up); cv.addEventListener('pointercancel',up);
    cv.addEventListener('pointerleave',e=>{ if(e.pointerType==='mouse'&&!drag){ hover=null; ask(); } });
    cv.addEventListener('wheel',e=>{ if(!view||!G) return; e.preventDefault(); const p=pos(e); if(Math.abs(e.deltaX)>Math.abs(e.deltaY)){ const s=view.b-view.a, sh=e.deltaX/(G.pw-14)*s; setView(view.a+sh,view.b+sh); return; }
      zoomAt(Math.exp(e.deltaY*0.0016),Math.min(view.b,tAt(p.x))); },{passive:false});
    cv.addEventListener('dblclick',()=>{ if(dom) setView(dom.t0,dom.t1); });
    new ResizeObserver(()=>{ size(); draw(); }).observe(cv.parentNode); }
  function full(on){ el.classList.toggle('full',on); document.documentElement.classList.toggle('eqc-lock',on);
    const fb=el.querySelector('#eqc-full'); fb.innerHTML=on?IC.shrink:IC.full; fb.title=fb.ariaLabel=on?'Exit full screen':'Full screen'; requestAnimationFrame(()=>{ size(); draw(); }); }

  /* ---------- data ---------- */
  const dedupe=rows=>{ const m=new Map(); (rows||[]).forEach(b=>{ if(b&&b.time) m.set(b.time,b); }); return [...m.values()].sort((a,b)=>a.time-b.time); };
  function span(){ const t1=now(), born=X.createdAt||0, r=RANGES.find(x=>x[0]===rng)[1]; let t0=r?t1-r:(born||t1-86400);
    if(born&&born>t0) t0=born; if(t1-t0<600) t0=t1-600; return [t0,t1]; }
  // keep: hold the zoomed window (same range, other view of it)
  async function load(anim,keep){ if(!X||!window.CHAIN) return; const my=++gen; const [t0,t1]=span(), old=keep&&zoomed()?{...view}:null, wasPinned=pinned();
    step=RES.find(s=>(t1-t0)/s<=240)||86400; const ks=keys(), merged=ks.length>1;
    const fetchK=k=>CHAIN.bars(X.addr,step,t0-step,t1+step,(multi()&&k!=='merged')?k:undefined).catch(e=>{ console.warn('bars',e); return []; });
    const got=await Promise.all(ks.map(fetchK)), vb=merged?await fetchK('merged'):null;
    if(my!==gen) return; S={};
    ks.forEach((k,i)=>{ const f=factor(k), rows=dedupe(got[i]).filter(b=>b.time+step>=t0);
      const bars=rows.map(b=>({t:Math.max(b.time,t0),o:b.open*f,h:Math.max(b.high,b.open,b.close)*f,l:Math.min(b.low,b.open,b.close)*f,c:b.close*f,v:b.volume*(pairUsdFor(k)||1)}));
      // the line runs edge to edge: from the first bar's open at the left, to the live price now;
      // between trades the price holds: a gap keeps the last close flat until the bar before the next trade
      const live=livePx(k)*f, pts=[]; bars.forEach(b=>{ const L=pts[pts.length-1]; if(L&&b.t-L.t>step*1.5) pts.push({t:b.t-step,v:L.v}); pts.push({t:b.t,v:b.c,real:1}); });
      if(!pts.length) pts.push({t:t0,v:live}); else if(pts[0].t>t0) pts.unshift({t:t0,v:bars[0].o});
      if(live>0&&pts[pts.length-1].t<t1){ const L=pts[pts.length-1]; if(t1-L.t>step*1.5) pts.push({t:t1-step,v:L.v}); pts.push({t:t1,v:live}); }
      S[k]={bars,pts,live,color:ks.length>1?chainOf(k).color:null}; });
    vol=(merged?dedupe(vb).map(b=>({t:b.time,o:b.open,c:b.close,v:b.volume*(pairUsdFor('merged')||1)})):S[ks[0]].bars).filter(b=>b.t>=t0-step);
    dom={t0,t1}; view=old?{a:Math.max(t0,old.a),b:wasPinned?t1:Math.min(t1,old.b)}:{a:t0,b:t1}; el.classList.toggle('zoomed',zoomed());
    const no=el.querySelector('#eqc-no'); no.hidden=ks.some(k=>S[k].bars.length); no.textContent=`No trades ${rng==='All'?'yet':'in the '+RNAME[rng].toLowerCase().replace('past ','last ')}`;
    if(anim){ const a0=performance.now(); const tick=t=>{ reveal=Math.min(1,(t-a0)/650); reveal=1-Math.pow(1-reveal,3); draw(); if(reveal<1) requestAnimationFrame(tick); }; reveal=0; requestAnimationFrame(tick); } else { reveal=1; draw(); } }

  /* ---------- drawing ---------- */
  function size(){ const b=cv.parentNode.getBoundingClientRect(); dpr=Math.min(2,devicePixelRatio||1); W=Math.max(10,b.width); H=Math.max(10,b.height);
    cv.width=Math.round(W*dpr); cv.height=Math.round(H*dpr); cv.style.width=W+'px'; cv.style.height=H+'px'; }
  const ask=()=>{ if(raf) return; raf=requestAnimationFrame(()=>{ raf=0; draw(); }); };
  // a smooth line through the points that never overshoots them (monotone cubic)
  function curve(P){ const n=P.length; if(!n) return; ctx.moveTo(P[0][0],P[0][1]); if(n===1) return;
    const d=[],m=[]; for(let i=0;i<n-1;i++) d[i]=(P[i+1][1]-P[i][1])/((P[i+1][0]-P[i][0])||1);
    m[0]=d[0]; m[n-1]=d[n-2]; for(let i=1;i<n-1;i++) m[i]=d[i-1]*d[i]<=0?0:(d[i-1]+d[i])/2;
    for(let i=0;i<n-1;i++){ if(d[i]===0){ m[i]=m[i+1]=0; continue; } const a=m[i]/d[i], b=m[i+1]/d[i], s=a*a+b*b; if(s>9){ const t=3/Math.sqrt(s); m[i]=t*a*d[i]; m[i+1]=t*b*d[i]; } }
    for(let i=0;i<n-1;i++){ const dx=(P[i+1][0]-P[i][0])/3; ctx.bezierCurveTo(P[i][0]+dx,P[i][1]+m[i]*dx,P[i+1][0]-dx,P[i+1][1]-m[i+1]*dx,P[i+1][0],P[i+1][1]); } }
  function interp(pts,t){ if(!pts.length) return null; if(t<=pts[0].t) return pts[0].v; for(let i=1;i<pts.length;i++) if(pts[i].t>=t){ const a=pts[i-1], b=pts[i]; return a.v+(b.v-a.v)*((t-a.t)/((b.t-a.t)||1)); } return pts[pts.length-1].v; }
  function ticks(lo,hi,n){ const r=hi-lo; if(!(r>0)) return [lo]; const raw=r/n, p=Math.pow(10,Math.floor(Math.log10(raw))), f=raw/p, st=(f<1.5?1:f<3?2:f<7?5:10)*p; const out=[]; for(let v=Math.ceil(lo/st)*st;v<=hi+st*1e-9;v+=st) out.push(v); return out; }
  function tlabel(t,full){ const d=new Date(t*1000), s=view.b-view.a;
    if(full) return d.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
    return s<=2*86400?d.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'}):s<=10*86400?d.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric'}):d.toLocaleDateString(undefined,{month:'short',day:'numeric'}); }
  function round(x,y,w,h,r){ ctx.beginPath(); if(ctx.roundRect) ctx.roundRect(x,y,w,h,r); else ctx.rect(x,y,w,h); }
  function pill(txt,x,y,bg,fg,font){ ctx.font=`600 11px ${font}`; const w=ctx.measureText(txt).width+12; ctx.fillStyle=bg; round(x,y-10,w,20,6); ctx.fill(); ctx.fillStyle=fg; ctx.textAlign='left'; ctx.textBaseline='middle'; ctx.fillText(txt,x+6,y+.5); return w; }

  function draw(){ if(!ctx||!dom||!view||!W) return; const ks=keys(); ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,W,H);
    const font=getComputedStyle(document.body).fontFamily, fg3=css('--fg-3','#8e8e97'), lineC=css('--line','#1e1e23'), up=css('--up','#2ebd85'), dn=css('--dn','#f6465d');
    const {a:va,b:vb}=view, vs=(vb-va)||1, T=14, B=26, single=ks.length===1&&kind==='line';
    // what is in view: points (with the value at each edge) and bars
    const inV=ks.map(k=>{ const s=S[k]; return { k, pts:s.pts.filter(p=>p.t>=va&&p.t<=vb).concat([{t:va,v:interp(s.pts,va)},{t:vb,v:interp(s.pts,vb)}]).filter(p=>p.v>0), bars:s.bars.filter(b=>b.t+step>=va&&b.t<=vb) }; });
    let lo=Infinity, hi=-Infinity; inV.forEach(s=>{ (kind==='candle'?s.bars.flatMap(b=>[b.l,b.h]):s.pts.map(p=>p.v)).forEach(v=>{ if(v>0){ lo=Math.min(lo,v); hi=Math.max(hi,v); } }); if(kind==='candle'&&pinned()&&S[s.k].live>0){ lo=Math.min(lo,S[s.k].live); hi=Math.max(hi,S[s.k].live); } });
    if(!isFinite(lo)){ lo=0; hi=1; } if(hi-lo<hi*1e-6){ const c=hi||1; lo=c*0.95; hi=c*1.05; } const rg=hi-lo; lo-=rg*0.32; hi+=rg*0.16;
    // the scale on the right is as wide as its longest label
    const gl=ticks(lo+(hi-lo)*0.2,hi,4), lastV=ks.map(k=>S[k].live||0);
    ctx.font=`600 11px ${font}`; const R=Math.ceil(Math.max(44,...gl.map(v=>ctx.measureText(axis(v)).width),...lastV.map(v=>ctx.measureText(axis(v)).width))+20);
    const pw=W-R, ph=H-T-B, vh=ph*0.15; G={pw,ph,T,B,R};
    const xs=t=>(t-va)/vs*(pw-14)+6, ys=v=>T+(1-(v-lo)/(hi-lo))*ph, vAt=y=>lo+(1-(y-T)/ph)*(hi-lo);
    // the range opens at `base`; above it is green, below it red
    const s0=S[ks[0]], base=kind==='candle'?((inV[0].bars[0]||{}).o||interp(s0.pts,va)):interp(s0.pts,va), endV=pinned()&&s0.live>0?s0.live:interp(s0.pts,vb);
    const chg=base>0&&endV>0?endV/base-1:0, yb=ys(base);
    const col=k=>S[k].color||(chg>=0?up:dn);

    // price guides on the right, time along the bottom
    const tags=pinned()?ks.map(k=>{ const s=S[k], v=s.live>0?s.live:s.pts[s.pts.length-1].v; return {k,v,y:ys(v),c:ks.length>1&&kind==='line'?col(k):(v>=base?up:dn)}; }).filter(t=>t.v>0&&t.y>T-4&&t.y<T+ph+4).sort((a,b)=>a.y-b.y):[];
    for(let i=1;i<tags.length;i++) if(tags[i].y-tags[i-1].y<22) tags[i].y=tags[i-1].y+22;
    ctx.font=`500 11px ${font}`; ctx.textBaseline='middle'; ctx.fillStyle=fg3; ctx.strokeStyle=lineC; ctx.lineWidth=1; ctx.setLineDash([2,5]);
    gl.forEach(v=>{ const y=Math.round(ys(v))+.5; if(y<T+4||y>T+ph-vh) return; ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(pw,y); ctx.stroke();
      if(!tags.some(t=>Math.abs(t.y-y)<16)&&!(hover&&hover.x<=pw&&Math.abs(hover.y-y)<16)){ ctx.textAlign='left'; ctx.fillText(axis(v),pw+8,y); } });
    ctx.setLineDash([]); ctx.textAlign='center'; ctx.textBaseline='alphabetic'; const nt=Math.max(3,Math.min(6,Math.floor(pw/130)));
    for(let i=1;i<nt;i++){ const t=va+vs*i/nt; if(hover&&hover.x<=pw&&Math.abs(xs(t)-hover.x)<110) continue; ctx.fillText(tlabel(t),xs(t),H-8); }

    ctx.save(); ctx.beginPath(); ctx.rect(0,0,Math.min(pw,6+(pw-6)*reveal+1),T+ph); ctx.clip();
    // volume, faint at the foot
    const bw=Math.max(1.5,Math.min(16,(pw-14)*step/vs*0.62)); const vin=vol.filter(b=>b.t+step>=va&&b.t<=vb), vmax=Math.max(0,...vin.map(b=>b.v));
    if(vmax>0) vin.forEach(b=>{ const h=Math.max(1.5,b.v/vmax*vh), x=xs(b.t+step/2); ctx.fillStyle=rgba(b.c>=b.o?up:dn,.2); round(x-bw/2,T+ph-h,bw,h,Math.min(2,bw/2)); ctx.fill(); });
    if(kind==='candle'){
      // the opening level, faint
      ctx.strokeStyle=rgba(fg3,.35); ctx.setLineDash([1,4]); ctx.beginPath(); ctx.moveTo(0,Math.round(yb)+.5); ctx.lineTo(pw,Math.round(yb)+.5); ctx.stroke(); ctx.setLineDash([]);
      inV.forEach(s=>s.bars.forEach(b=>{ const x=xs(b.t+step/2), c=b.c>=b.o?up:dn, xr=Math.round(x)+.5; ctx.strokeStyle=c; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(xr,ys(b.h)); ctx.lineTo(xr,ys(b.l)); ctx.stroke();
        const y1=ys(Math.max(b.o,b.c)), y2=ys(Math.min(b.o,b.c)); ctx.fillStyle=c; round(x-bw/2,y1,bw,Math.max(1.5,y2-y1),Math.min(2,bw/4)); ctx.fill(); })); }
    else if(single){ const P=s0.pts.map(p=>[xs(p.t),ys(p.v)]);
      // area between the line and the opening level, green above and red below, fading toward the level
      const band=(top,c,a1,a2)=>{ ctx.save(); ctx.beginPath(); top?ctx.rect(0,0,pw,yb):ctx.rect(0,yb,pw,H); ctx.clip();
        const g=ctx.createLinearGradient(0,top?T:yb,0,top?yb:T+ph); g.addColorStop(0,rgba(c,a1)); g.addColorStop(1,rgba(c,a2));
        ctx.beginPath(); curve(P); ctx.lineTo(P[P.length-1][0],yb); ctx.lineTo(P[0][0],yb); ctx.closePath(); ctx.fillStyle=g; ctx.fill();
        ctx.beginPath(); curve(P); ctx.strokeStyle=c; ctx.lineWidth=2.2; ctx.lineJoin='round'; ctx.lineCap='round'; ctx.shadowColor=rgba(c,.6); ctx.shadowBlur=14; ctx.stroke(); ctx.restore(); };
      band(true,up,.30,.02); band(false,dn,.02,.26);
      ctx.strokeStyle=rgba(fg3,.4); ctx.setLineDash([1,4]); ctx.beginPath(); ctx.moveTo(0,Math.round(yb)+.5); ctx.lineTo(pw,Math.round(yb)+.5); ctx.stroke(); ctx.setLineDash([]); }
    else ks.forEach(k=>{ const P=S[k].pts.map(p=>[xs(p.t),ys(p.v)]), c=col(k); ctx.beginPath(); curve(P); ctx.strokeStyle=c; ctx.lineWidth=1.8; ctx.lineJoin='round'; ctx.lineCap='round'; ctx.shadowColor=rgba(c,.5); ctx.shadowBlur=8; ctx.stroke(); ctx.shadowBlur=0; });
    ctx.restore();

    // highest and lowest in view, marked on the line
    if(single&&reveal>=1){ const real=s0.pts.filter(p=>p.t>=va&&p.t<=vb); if(real.length>2){ let mx=real[0], mn=real[0]; real.forEach(p=>{ if(p.v>mx.v) mx=p; if(p.v<mn.v) mn=p; });
      if(mx.v>mn.v*1.002) [[mx,'High',-1],[mn,'Low',1]].forEach(([p,lb,d])=>{ const x=xs(p.t), y=ys(p.v), txt=`${lb} ${axis(p.v)}`; ctx.font=`600 10.5px ${font}`; const w=ctx.measureText(txt).width+12, lx=Math.max(2,Math.min(pw-w-2,x-w/2)), ly=y+d*16;
        ctx.strokeStyle=rgba(fg3,.5); ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(x,y+d*4); ctx.lineTo(x,ly-d*8); ctx.stroke();
        ctx.fillStyle='rgba(30,30,35,.92)'; round(lx,ly-9,w,18,5); ctx.fill(); ctx.fillStyle=css('--fg-2','#b4b4bb'); ctx.textAlign='left'; ctx.textBaseline='middle'; ctx.fillText(txt,lx+6,ly+.5); }); } }

    // cursor: snap to the nearest point; what lies after it dims
    let at=null; if(hover&&hover.x<=pw&&reveal>=1){ const t=tAt(hover.x); at={t,vals:{}}; let sx=null;
      inV.forEach(s=>{ const arr=kind==='candle'?s.bars.map(b=>({t:b.t+step/2,v:b.c,b})):S[s.k].pts.filter(p=>p.t>=va&&p.t<=vb); if(!arr.length) return; let best=arr[0]; arr.forEach(p=>{ if(Math.abs(p.t-t)<Math.abs(best.t-t)) best=p; }); at.vals[s.k]=best; if(ks.length===1) sx=xs(best.t); });
      const x=sx!=null?sx:hover.x; at.x=x;
      if(kind==='line'){ ctx.fillStyle=rgba(bgc,.62); ctx.fillRect(x+1,0,pw-x,T+ph); }
      else { ctx.fillStyle='rgba(255,255,255,.04)'; ctx.fillRect(x-bw/2-3,T,bw+6,ph); }
      ctx.strokeStyle='rgba(180,180,187,.4)'; ctx.lineWidth=1; ctx.setLineDash([3,3]); ctx.beginPath(); ctx.moveTo(Math.round(x)+.5,T); ctx.lineTo(Math.round(x)+.5,T+ph); ctx.stroke();
      const hy=Math.max(T,Math.min(T+ph,hover.y)); ctx.beginPath(); ctx.moveTo(0,Math.round(hy)+.5); ctx.lineTo(pw,Math.round(hy)+.5); ctx.stroke(); ctx.setLineDash([]);
      pill(axis(vAt(hy)),pw+2,hy,'#2c2c33','#ededef',font);
      if(kind==='line') inV.forEach(s=>{ const p=at.vals[s.k]; if(!p) return; const c=ks.length>1?col(s.k):(p.v>=base?up:dn); ctx.beginPath(); ctx.arc(xs(p.t),ys(p.v),5,0,7); ctx.fillStyle=c; ctx.shadowColor=rgba(c,.8); ctx.shadowBlur=10; ctx.fill(); ctx.shadowBlur=0; ctx.lineWidth=2.5; ctx.strokeStyle='#0a0a0b'; ctx.stroke(); });
      const tt=sx!=null?at.vals[ks[0]].t:t, lab=tlabel(Math.min(dom.t1,tt),true); ctx.font=`500 11px ${font}`; const lw=ctx.measureText(lab).width+14, lx=Math.max(0,Math.min(pw-lw,x-lw/2));
      ctx.fillStyle='#2c2c33'; round(lx,H-B+3,lw,20,6); ctx.fill(); ctx.fillStyle='#ededef'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(lab,lx+lw/2,H-B+13.5);
      const vb2=vin.reduce((b,v)=>Math.abs(v.t+step/2-tt)<Math.abs((b?b.t+step/2:Infinity)-tt)?v:b,null); at.vol=vb2&&Math.abs(vb2.t+step/2-tt)<step?vb2.v:0; }
    G.vsum=vin.reduce((s,b)=>s+(b.v||0),0);

    // last value: a dotted level and a tag on the scale (nudged apart when several)
    tags.forEach(t=>{ if(ks.length===1){ const yl=Math.round(ys(t.v))+.5; ctx.strokeStyle=rgba(t.c,.45); ctx.setLineDash([1,3]); ctx.beginPath(); ctx.moveTo(at?at.x:0,yl); ctx.lineTo(pw,yl); ctx.stroke(); ctx.setLineDash([]); }
      if(!(hover&&hover.x<=pw&&Math.abs(hover.y-t.y)<20)) pill(axis(t.v),pw+2,t.y,t.c,'#06100c',font); });
    // the live point breathes (line view, one series, latest in view)
    if(single&&reveal>=1&&pinned()&&!at){ const p=s0.pts[s0.pts.length-1]; dot.hidden=false; dot.style.left=xs(p.t)+'px'; dot.style.top=ys(p.v)+'px'; dot.style.setProperty('--c',p.v>=base?up:dn); } else dot.hidden=true;
    legend(at,base,endV); }

  /* ---------- legend: big value (under the cursor, or the latest) and the change since the view opens ---------- */
  function legend(at,base,endV){ const lg=el.querySelector('#eqc-leg'); if(!lg) return; const ks=keys(), what=mode==='mcap'?'Market cap':'Price';
    const when=zoomed()?`${tlabel(view.a,true)} – ${pinned()?'now':tlabel(view.b,true)}`:RNAME[rng];
    if(ks.length===1){ const p=at&&at.vals[ks[0]], v=p?(p.b?p.b.c:p.v):endV, c=base>0&&v>0?v/base-1:0;
      const nm=ks[0]==='merged'?'All chains':multi()?chainOf(ks[0]).name:'';
      const sub=p?`${p.b?`O <b>${axis(p.b.o)}</b> H <b>${axis(p.b.h)}</b> L <b>${axis(p.b.l)}</b> C <b>${axis(p.b.c)}</b> · `:''}Vol <b>${usd(at.vol)}</b>`:`Volume <b>${usd(G.vsum)}</b>`;
      lg.innerHTML=`<span class="t">${what}${nm?' · '+esc2(nm):''}</span><span class="v"><b>${money(v)}</b><em class="${c>=0?'up':'dn'}">${c>=0?'▲':'▼'} ${Math.abs(c*100).toFixed(2)}%</em><small>${p?esc2(tlabel(Math.min(dom.t1,p.t),true)):esc2(when)}</small></span><span class="ohlc">${sub}</span>`; return; }
    lg.innerHTML=`<span class="t">${what} by chain · ${at?esc2(tlabel(Math.min(dom.t1,at.t),true)):esc2(when)}</span><span class="ls">${ks.map(k=>{ const s=S[k]; if(!s) return ''; const p=at&&at.vals[k], v=p?p.v:(pinned()&&s.live>0?s.live:interp(s.pts,view.b)); return `<span style="--c:${chainOf(k).color}"><i></i>${esc2(chainOf(k).short||chainOf(k).name)}<b>${money(v)}</b></span>`; }).join('')}</span>`; }

  /* ---------- live: called after every refresh with the latest pair price and the trades since the last call ---------- */
  window.tvTick=function(pxPair,newTrades){ if(!X||!dom) return; if(newTrades&&newTrades.length){ load(false,true); return; }
    const t1=now(), wasPinned=pinned(); dom.t1=t1; if(wasPinned) view.b=t1;
    keys().forEach(k=>{ const s=S[k]; if(!s) return; const v=livePx(k)*factor(k); if(!(v>0)) return; s.live=v;
      const L=s.pts[s.pts.length-1]; if(L&&s.pts.length>1&&!L.real&&L.t>=t1-step){ L.t=t1; L.v=v; } else s.pts.push({t:t1,v}); });
    draw(); };

  window.initTV=function(container,x){ X=x; el=typeof container==='string'?document.getElementById(container):container;
    el.classList.add('eqc'); el.innerHTML=markup(); cv=el.querySelector('#eqc-cv'); dot=el.querySelector('#eqc-dot'); ctx=cv.getContext('2d');
    const pn=el.closest('.panel'); const bg=pn&&getComputedStyle(pn).backgroundColor; if(bg&&!/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) bgc=bg;
    if(multi()) pick='all'; wire(); size(); load(true); return true; };
})();
