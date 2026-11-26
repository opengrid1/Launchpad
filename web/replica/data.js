/* shared helpers + the token universe (filled from Ink by chain.js when the site is live) */
const SUB='₀₁₂₃₄₅₆₇₈₉';
let ETH=2700, SUPPLY=1e9;
const fmtPrice=p=>{ if(!(p>0)) return '0'; if(p>=1) return p.toLocaleString('en-US',{maximumFractionDigits:p>=1000?2:4});
  const m=p.toFixed(18).match(/^0\.(0*)(\d+)/); const z=m[1].length; const d=(m[2].slice(0,3).replace(/0+$/,'')||'0');
  return z<3 ? '0.'+m[1]+d : '0.0'+[...String(z)].map(c=>SUB[+c]).join('')+d; };
const fmtUsd=v=>{ const s=v<0?'-':''; v=Math.abs(v); return s+(v>=1e9?'$'+(v/1e9).toFixed(2)+'B':v>=1e6?'$'+(v/1e6).toFixed(2)+'M':v>=1e3?'$'+(v/1e3).toFixed(1)+'K':v>=0.01||v===0?'$'+v.toFixed(2):'<$0.01'); };
const fmtAmt=v=>v>=1e9?(v/1e9).toFixed(2)+'B':v>=1e6?(v/1e6).toFixed(2)+'M':v>=1e3?(v/1e3).toFixed(1)+'K':v>=1?v.toFixed(v<10?2:0):v>0?v.toPrecision(2):'0';
const fmtEth=(v,d)=>{ if(!(v>0)) return '0 ETH'; if(v>=100) return v.toFixed(1)+' ETH'; if(v>=1) return v.toFixed(d||3)+' ETH'; if(v>=0.001) return v.toFixed(d||4)+' ETH'; return fmtPrice(v)+' ETH'; };
const ago=s=>s<60?s+'s':s<3600?Math.floor(s/60)+'m':s<86400?Math.floor(s/3600)+'h':Math.floor(s/86400)+'d';
const mmss=s=>String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');
const pct=v=>`<span class="${v>=0?'up':'dn'}">${v>=0?'+':''}${v.toFixed(1)}%</span>`;
const shortAddr=a=>a?a.slice(0,6)+'…'+a.slice(-4):'';
const cs=a=>{ try{ return window.CHAIN&&CHAIN.checksum?CHAIN.checksum(a):a; }catch{ return a; } };

/* leaderboard payout tiers (bps of each board's half) */
const LB_TIER=[40,25,15,12,8];
const STOCKS=[['NVDAx','Nvidia','#76b900'],['SPYx','S&P 500','#1e6fff'],['QQQx','Nasdaq 100','#00a3e0'],['TSLAx','Tesla','#e82127'],['AAPLx','Apple','#a2aaad'],['MSTRx','Strategy','#f7931a'],['SPCXx','SpaceX','#8b949e'],['PLTRx','Palantir','#c9a227'],['NFLXx','Netflix','#e50914']];
const STOCK_COLOR=Object.fromEntries(STOCKS.map(s=>[s[0],s[2]]));
const STOCK_NAME=Object.fromEntries(STOCKS.map(s=>[s[0],s[1]]));
const STOCK_ADDR=Object.fromEntries(((window.INKY&&INKY.stocks)||[]).map(s=>[s.symbol,s.address]));
const FEE={tax:2,creator:0.7,holders:0.5,platform:0.8};

/* the same token universe on every page; chain.js fills it before the pages initialise */
let TOK=[];
const ageStr=a=>a.endsWith('s')?'just now':a==='1d'?'yesterday':a+' ago';
const ageMin=a=>{const n=parseInt(a); return a.endsWith('s')?0:a.endsWith('m')?n:a.endsWith('h')?n*60:n*1440;};
const STOCK_IMG=s=>'/img/s-'+s+'.png'; const INK_IMG='/img/ink.png', ETH_IMG='/img/eth.png';
const pairImg=p=>p==='ETH'?ETH_IMG:STOCK_IMG(p);
const tokenUrl=x=>'/token/'+(x.addr||x);

const PRE=!!(window.INKY&&window.INKY.prelaunch);
const LIVE=!!(window.INKY&&window.INKY.live&&!PRE);
