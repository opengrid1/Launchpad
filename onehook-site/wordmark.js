// sticker wordmark: Titan One letters, magenta with dark outline and light edge, slight per-letter wave, ink drip on the last p
module.exports=function wordmark(w,opts={}){ const h=Math.round(w*0.34); const fs=Math.round(w*0.165); const rot='-4 3 -2 4 -3 2 -4 3'; const dy='0 -6 4 -5 3 -4 5 -3';
  const t=(extra)=>`<text x="${w*0.03}" y="${h*0.78}" font-family="'Titan One'" font-size="${fs}" letter-spacing="${-fs*0.01}" rotate="${rot}" ${extra}><tspan dy="${dy.split(' ').map(v=>v*fs/120).join(' ')}">inkypump</tspan></text>`;
  const sw=fs/120;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" overflow="visible">
  <defs><clipPath id="hi"><rect x="0" y="0" width="${w}" height="${h*0.46}"/></clipPath></defs>
  <g transform="rotate(-2 ${w/2} ${h/2})">
  ${t(`fill="${opts.edge||'#f3f5f9'}" stroke="${opts.edge||'#f3f5f9'}" stroke-width="${sw*30}" stroke-linejoin="round"`)}
  ${t(`fill="#14121a" stroke="#14121a" stroke-width="${sw*14}" stroke-linejoin="round"`)}
  ${t(`fill="#ff4fa3"`)}
  <g clip-path="url(#hi)">${t(`fill="#ff7cbb"`)}</g>
  <g transform="translate(${w*0.86} ${h*0.9}) scale(${fs/100})"><path fill="${opts.edge||'#f3f5f9'}" stroke="${opts.edge||'#f3f5f9'}" stroke-width="7" stroke-linejoin="round" d="M0 0c3 5 6 9 6 13a6 6 0 0 1-12 0c0-4 3-8 6-13z"/><path fill="#ff4fa3" stroke="#14121a" stroke-width="3" stroke-linejoin="round" d="M0 0c3 5 6 9 6 13a6 6 0 0 1-12 0c0-4 3-8 6-13z"/></g>
  </g></svg>`; };
