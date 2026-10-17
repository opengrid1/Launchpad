/* Wallet avatars: a deterministic Inky per address (colour, eyes, mouth, accessory, background). */
(function(){
  const BODY=['#ff4fa3','#4f9bff','#3ddc97','#ffa94d','#b07cff','#2ee6d6','#ff6b6b','#ffd84f'];
  const LIGHT=['#ff7cbb','#7fb8ff','#7ee9b9','#ffc180','#cba6ff','#7af0e6','#ff9c9c','#ffe68a'];
  const BG=['#2a1420','#13223a','#0f2a21','#2c1d0f','#1e1433','#0f2a2a','#2b1515','#2b260f'];
  function pick(addr){ const h=(addr||'0x0').toLowerCase().replace(/^0x/,'').padEnd(40,'0'); const b=i=>parseInt(h.slice(i*2,i*2+2),16)||0;
    return { c:b(0)%BODY.length, bg:b(1)%BG.length, eyes:b(2)%4, mouth:b(3)%4, acc:b(4)%6, tilt:(b(5)%11)-5, shine:b(6)%2 }; }
  function svg(addr,size){ const p=pick(addr); const c=BODY[p.c], l=LIGHT[p.c], bg=BG[p.bg]; const ink='#14121a';
    const eyes=[ // round / happy / wink / wide
      `<circle cx="52" cy="56" r="7.5" fill="${ink}"/><circle cx="76" cy="55" r="5.5" fill="${ink}"/><circle cx="54.5" cy="53.5" r="2.4" fill="#fff"/><circle cx="77.8" cy="53" r="1.7" fill="#fff"/>`,
      `<path d="M45 57c3-6 11-6 14 0M70 56c2.5-5 9.5-5 12 0" fill="none" stroke="${ink}" stroke-width="3.5" stroke-linecap="round"/>`,
      `<circle cx="52" cy="56" r="7.5" fill="${ink}"/><circle cx="54.5" cy="53.5" r="2.4" fill="#fff"/><path d="M70 56h12" fill="none" stroke="${ink}" stroke-width="3.5" stroke-linecap="round"/>`,
      `<circle cx="52" cy="56" r="9" fill="${ink}"/><circle cx="76" cy="55" r="7" fill="${ink}"/><circle cx="55" cy="52.5" r="3" fill="#fff"/><circle cx="78.5" cy="52" r="2.2" fill="#fff"/>`][p.eyes];
    const mouth=[ `<path d="M60 68c3 2.5 7 2.5 10-.5" fill="none" stroke="${ink}" stroke-width="3" stroke-linecap="round"/>`,
      `<path d="M58 67c2 3 4 3 6 0 2 3 4 3 6 0" fill="none" stroke="${ink}" stroke-width="3" stroke-linecap="round"/>`,
      `<ellipse cx="65" cy="69" rx="4" ry="3" fill="${ink}"/>`,
      `<path d="M58 69h12" fill="none" stroke="${ink}" stroke-width="3" stroke-linecap="round"/>`][p.mouth];
    const acc=[ '',
      `<path d="M44 26l6 8 8-12 8 12 8-12 8 12 6-8-4 16H48z" fill="#ffd84f" stroke="${ink}" stroke-width="3" stroke-linejoin="round"/>`,
      `<path d="M38 60h52" stroke="${ink}" stroke-width="12" stroke-linecap="round"/><path d="M38 60h52" stroke="${c}" stroke-width="6" stroke-linecap="round"/><rect x="40" y="48" width="22" height="16" rx="5" fill="${ink}"/><rect x="66" y="48" width="22" height="16" rx="5" fill="${ink}"/>`,
      `<path d="M36 36c8-20 48-20 56 0H36z" fill="${l}" stroke="${ink}" stroke-width="3" stroke-linejoin="round"/><path d="M34 36h60" stroke="${ink}" stroke-width="4" stroke-linecap="round"/>`,
      `<path d="M92 22l-14 10 14 10-4-10z" fill="#ff4fa3" stroke="${ink}" stroke-width="3" stroke-linejoin="round"/><path d="M78 32l-14 10 4-10-4-10z" fill="#ff4fa3" stroke="${ink}" stroke-width="3" stroke-linejoin="round"/>`,
      `<path d="M40 44c4-4 10-4 14 0M74 44c4-4 10-4 14 0" fill="none" stroke="${ink}" stroke-width="3.5" stroke-linecap="round"/>`][p.acc];
    const tent=`<path d="M41 78c-2 8-9 10-7 20"/><path d="M52 82c-1 9-5 13-2 24"/><path d="M65 84c1 10-2 12 0 21"/><path d="M78 82c2 8 7 10 7 19"/><path d="M88 76c4 6 11 8 12 15"/>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="${size}" height="${size}" style="display:block"><rect width="128" height="128" fill="${bg}"/><g transform="rotate(${p.tilt} 64 64) translate(0 -4)">`
      +`<g fill="none" stroke="${ink}" stroke-width="13" stroke-linecap="round" stroke-linejoin="round">${tent}</g>`
      +`<path fill="${ink}" d="M64 15c-24 0-36 18-35 44 0 9 2 15 4 19 4 6 12 8 31 8s27-2 31-8c3-5 5-11 5-19 1-26-12-44-36-44z"/>`
      +`<g fill="none" stroke="${c}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">${tent}</g>`
      +`<path fill="${c}" d="M64 20c-21 0-31 16-30 39 0 8 1.5 13 3.5 16 3.5 5 10 6.5 26.5 6.5S87 80 90.5 75c2.5-4 3.5-9 3.5-16 1-23-9-39-30-39z"/>`
      +(p.shine?`<path fill="${l}" d="M50 34c4-7 12-10 20-8-9 2-15 8-17 17-1 5-5 5-6 1-1-3 1-7 3-10z"/>`:'')
      +(p.acc===2?'':eyes)+mouth+acc+`</g></svg>`; }
  window.walletAvatar=svg;
})();
