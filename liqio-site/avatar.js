/* Wallet avatars: a deterministic Liqio orb per address. A glass sphere, like the Liqio mark, filled with
   liquid: the colour pair, the fill level, the wave shape and the highlight come from the address, so every
   wallet gets its own orb while staying on brand. */
(function(){
  // [glass tint, liquid light, liquid deep]
  const PAL=[
    ['#dff7f0','#33e5c2','#0e9a7c'], ['#dcefff','#4fa8ff','#1f5fd6'], ['#e9e3ff','#9b7dff','#5b3fd1'], ['#ffe6e0','#ff8a6a','#d6452a'],
    ['#fff1d6','#ffbe4a','#d98a0c'], ['#eafbd9','#9be34a','#5aa31c'], ['#ffe3ef','#ff7cb6','#d4367d'], ['#e2f6ff','#5fd0ff','#1b8fc9'],
    ['#e8f0e6','#6fc48e','#2e8550'], ['#f3e6ff','#c98bff','#8a3fe0'], ['#ffece0','#ffa36a','#e06a1c'], ['#e4f0f4','#7fb8c9','#2f6f86'],
  ];
  function pick(addr){ const h=(addr||'0x0').toLowerCase().replace(/^0x/,'').padEnd(40,'0'); const b=i=>parseInt(h.slice(i*2,i*2+2),16)||0;
    return { p:b(0)%PAL.length, level:38+(b(1)%40), amp:5+(b(2)%7), phase:(b(3)%360), shine:b(4)%3, bubbles:b(5)%3 }; }
  function wave(level,amp,phase,ampScale,yShift){ const y=128-level*1.28+yShift; let d=`M-10 ${y.toFixed(1)}`; for(let x=-10;x<=138;x+=4){ const t=(x/128)*Math.PI*2+phase*Math.PI/180; const yy=y+Math.sin(t*1.5)*amp*ampScale+Math.sin(t*0.6+1)*amp*0.4*ampScale; d+=` L${x} ${yy.toFixed(1)}`; } return d+' L138 140 L-10 140 Z'; }
  function svg(addr,size){ const p=pick(addr); const [tint,light,deep]=PAL[p.p]; const id='av'+(addr||'0').slice(2,10);
    const bubbles=[ '', `<circle cx="46" cy="92" r="4" fill="#fff" opacity=".45"/><circle cx="58" cy="104" r="2.5" fill="#fff" opacity=".4"/>`, `<circle cx="84" cy="98" r="3.5" fill="#fff" opacity=".45"/>` ][p.bubbles];
    const shine=[ `<ellipse cx="44" cy="38" rx="18" ry="11" transform="rotate(-30 44 38)" fill="#fff" opacity=".55"/>`, `<ellipse cx="40" cy="42" rx="14" ry="8" transform="rotate(-35 40 42)" fill="#fff" opacity=".5"/><circle cx="90" cy="34" r="4" fill="#fff" opacity=".45"/>`, `<path d="M30 52c2-16 14-28 30-32-10 7-18 18-22 32-2 5-9 5-8 0z" fill="#fff" opacity=".5"/>` ][p.shine];
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="${size}" height="${size}" style="display:block">`
      +`<defs><clipPath id="${id}c"><circle cx="64" cy="64" r="60"/></clipPath>`
      +`<radialGradient id="${id}g" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="${tint}"/><stop offset="1" stop-color="${light}" stop-opacity=".6"/></radialGradient>`
      +`<linearGradient id="${id}l" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${light}"/><stop offset="1" stop-color="${deep}"/></linearGradient></defs>`
      +`<circle cx="64" cy="64" r="60" fill="url(#${id}g)"/>`
      +`<g clip-path="url(#${id}c)">`
      +`<path d="${wave(p.level,p.amp,p.phase+70,0.8,6)}" fill="${light}" opacity=".45"/>`
      +`<path d="${wave(p.level,p.amp,p.phase,1,0)}" fill="url(#${id}l)"/>`
      +bubbles
      +`</g>`
      +`<circle cx="64" cy="64" r="60" fill="none" stroke="${deep}" stroke-opacity=".25" stroke-width="2"/>`
      +`<circle cx="64" cy="64" r="55" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="2"/>`
      +shine
      +`</svg>`; }
  window.walletAvatar=svg;
})();
