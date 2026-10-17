/* Wallet avatars: a deterministic OneHook mark per address. The "1" hook from the
   logo on a rounded tile whose gradient, tilt and accent are derived from the
   address, so every wallet gets its own tile while staying on brand. */
(function(){
  const GRAD=[['#5fc8ff','#2a9fe8'],['#7ad7ff','#1f7fd1'],['#4fd1c5','#2a8fe8'],['#8ab4ff','#3a6fe0'],['#5fe0ff','#2bb3c9'],['#62b5ff','#3446d8'],['#79e2d2','#2a9fe8'],['#a3c9ff','#2a7fe8']];
  const INK='#0e1117';
  function pick(addr){ const h=(addr||'0x0').toLowerCase().replace(/^0x/,'').padEnd(40,'0'); const b=i=>parseInt(h.slice(i*2,i*2+2),16)||0;
    return { g:b(0)%GRAD.length, tilt:(b(1)%9)-4, dots:b(2)%4, ring:b(3)%2, shine:b(4)%2 }; }
  function svg(addr,size){ const p=pick(addr); const [a,c]=GRAD[p.g]; const id='g'+(addr||'0').slice(2,10);
    const dots=[ '', `<circle cx="22" cy="24" r="4" fill="#fff" opacity=".55"/>`, `<circle cx="104" cy="28" r="5" fill="#fff" opacity=".5"/><circle cx="26" cy="100" r="3" fill="#fff" opacity=".45"/>`, `<circle cx="24" cy="104" r="4" fill="#fff" opacity=".5"/>` ][p.dots];
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="${size}" height="${size}" style="display:block">`
      +`<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${c}"/></linearGradient></defs>`
      +`<rect width="128" height="128" rx="32" fill="url(#${id})"/>`
      +(p.ring?`<rect x="6" y="6" width="116" height="116" rx="28" fill="none" stroke="#fff" stroke-opacity=".28" stroke-width="3"/>`:'')
      +(p.shine?`<path d="M18 40c6-16 20-26 40-28-14 6-24 16-30 32-3 6-11 4-10-4z" fill="#fff" opacity=".22"/>`:'')
      +dots
      +`<g transform="rotate(${p.tilt} 64 64)">`
      +`<path d="M51 50 L74 38 V91" fill="none" stroke="${INK}" stroke-opacity=".22" stroke-width="18" stroke-linecap="round" stroke-linejoin="round" transform="translate(0 3)"/>`
      +`<path d="M51 50 L74 38 V91" fill="none" stroke="#fff" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>`
      +`<path d="M53 91 H95" fill="none" stroke="#fff" stroke-width="14" stroke-linecap="round"/>`
      +`</g></svg>`; }
  window.walletAvatar=svg;
})();
