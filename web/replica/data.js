/* shared helpers for the mock */
const SUB='₀₁₂₃₄₅₆₇₈₉';
const ETH=2431.18, SUPPLY=1e9;
const fmtPrice=p=>{ if(p>=1) return p.toLocaleString('en-US',{maximumFractionDigits:2});
  const m=p.toFixed(14).match(/^0\.(0*)(\d+)/); const z=m[1].length; const d=(m[2].slice(0,3).replace(/0+$/,'')||'0');
  return z<3 ? '0.'+m[1]+d : '0.0'+[...String(z)].map(c=>SUB[+c]).join('')+d; };
const fmtUsd=v=>v>=1e9?'$'+(v/1e9).toFixed(2)+'B':v>=1e6?'$'+(v/1e6).toFixed(2)+'M':v>=1e3?'$'+(v/1e3).toFixed(1)+'K':'$'+v.toFixed(2);
const fmtAmt=v=>v>=1e6?(v/1e6).toFixed(2)+'M':v>=1e3?(v/1e3).toFixed(1)+'K':v.toFixed(0);
const ago=s=>s<60?s+'s':s<3600?Math.floor(s/60)+'m':s<86400?Math.floor(s/3600)+'h':Math.floor(s/86400)+'d';
const mmss=s=>String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');
const pct=v=>`<span class="${v>=0?'up':'dn'}">${v>=0?'+':''}${v.toFixed(1)}%</span>`;
let rnd=(()=>{let s=11;return()=>(s=(s*16807)%2147483647)/2147483647})();
const hex=()=>'0x'+[...Array(4)].map(()=>Math.floor(rnd()*16).toString(16)).join('')+'…'+[...Array(4)].map(()=>Math.floor(rnd()*16).toString(16)).join('');
const logo=(t,c,lg)=>`<div class="logo${lg?' lg':''}" style="--l:${c}">${t.slice(0,2)}</div>`;

/* weekly leaderboard (mock) */
const LB_POOL=1.86, LB_ENDS=1*86400+9*3600+12*60; const LB_TIER=[40,25,15,12,8];
const LB_PNL=[['0x5DdD…4A0b',2.41,'me'],['0x9a4e…11bd',1.88],['0x14d9…77a3',1.32],['0xb77c…e2f0',0.97],['0xe0c1…5b6f',0.81],['0x3f0a…c91d',0.66],['0x77a1…0e4b',0.52],['0xc2d8…9f31',0.44],['0x1b6e…aa07',0.39],['0x8f13…2c55',0.31]];
const LB_VOL=[['0x9a4e…11bd',412.5],['0x0d4c…7e19',388.0],['0x5DdD…4A0b',201.3,'me'],['0xe0c1…5b6f',176.9],['0x6a2f…31bb',150.2],['0x14d9…77a3',141.0],['0xb77c…e2f0',120.7],['0x4e90…d8c2',98.4],['0xaa31…60f7',77.1],['0x2c7f…b18e',64.3]];
const STOCKS=[['NVDAx','Nvidia','#76b900',60680],['SPYx','S&P 500','#1e6fff',195800],['QQQx','Nasdaq 100','#00a3e0',204400],['TSLAx','Tesla','#e82127',47700],['AAPLx','Apple','#a2aaad',58090],['MSTRx','Strategy','#f7931a',90150],['SPCXx','SpaceX','#8b949e',64120],['PLTRx','Palantir','#c9a227',55380],['NFLXx','Netflix','#e50914',33700]];
const BASKETS={MOGCAT:['NVDAx','SPYx','TSLAx','MSTRx'],CPEPE:['SPYx','AAPLx'],VHAIR:['NVDAx'],ROT:['PLTRx','MSTRx'],DEAD:['TSLAx'],GWEI:['QQQx','NVDAx','AAPLx'],MUMU:['NFLXx','TSLAx'],LOB:['MSTRx'],WEN:['SPCXx','NVDAx'],GRASS:['SPYx'],SIGMA:['PLTRx'],NORMIE:['SPYx','QQQx','NVDAx','TSLAx']};
const FEE={tax:2,creator:0.7,holders:0.5,platform:0.8};

/* the same token universe on every page */
const AUC=[
 {n:'Gorb',t:'GORB',c:'#8fd4ff',eth:8.2,bid:141,ends:134,dur:300},
 {n:'Fleek Dog',t:'FLEEK',c:'#c8a2ff',eth:3.9,bid:77,ends:261,dur:300},
 {n:'Nokia 3310',t:'NOKIA',c:'#9ee37d',eth:1.4,bid:38,ends:402,dur:600},
 {n:'Shitposter',t:'SHIT',c:'#ff9d7a',eth:0.6,bid:12,ends:598,dur:900},
];
const TOK=[
 {n:'Mogcat',t:'MOGCAT',c:'#f2a93b',mc:927500,age:'3h',c5:2.1,c1:-4.8,c24:18.4,vol:1210000,liq:96400,h:1204,tx:3520},
 {n:'Cold Pepe',t:'CPEPE',c:'#7fe3d1',mc:2410000,age:'1d',c5:0.4,c1:1.9,c24:-6.1,vol:3800000,liq:210000,h:4310,tx:9120},
 {n:'Vitalik Hair',t:'VHAIR',c:'#ffd166',mc:188400,age:'41m',c5:12.8,c1:40.1,c24:92.3,vol:640000,liq:42000,h:388,tx:1840},
 {n:'Brain Rot',t:'ROT',c:'#e07a9b',mc:76200,age:'12m',c5:4.0,c1:4.0,c24:4.0,vol:88000,liq:21000,h:141,tx:402},
 {n:'Eth Is Dead',t:'DEAD',c:'#a0a8bd',mc:51000,age:'27m',c5:-8.2,c1:-22.5,c24:-22.5,vol:122000,liq:16800,h:203,tx:610},
 {n:'Gas Enjoyer',t:'GWEI',c:'#8bd3a3',mc:912000,age:'9h',c5:0.2,c1:-1.1,c24:1.2,vol:410000,liq:88000,h:1890,tx:2210},
 {n:'Mumu',t:'MUMU',c:'#ffb3c6',mc:33800,age:'5m',c5:140,c1:140,c24:140,vol:61000,liq:12400,h:96,tx:310},
 {n:'Lobster',t:'LOB',c:'#ff7b6b',mc:1630000,age:'2d',c5:-0.6,c1:-1.9,c24:3.3,vol:980000,liq:154000,h:3120,tx:4400},
 {n:'Wen Lambo',t:'WEN',c:'#b8c6ff',mc:412000,age:'6h',c5:1.1,c1:9.4,c24:27.0,vol:530000,liq:61000,h:812,tx:1990},
 {n:'Touch Grass',t:'GRASS',c:'#a3e68a',mc:288000,age:'14h',c5:-2.4,c1:-7.0,c24:-12.6,vol:310000,liq:49000,h:702,tx:1230},
 {n:'Sigma',t:'SIGMA',c:'#d9b8ff',mc:142000,age:'1h',c5:6.7,c1:22.0,c24:22.0,vol:220000,liq:33000,h:255,tx:860},
 {n:'Normie',t:'NORMIE',c:'#ffe0a3',mc:3980000,age:'5d',c5:0.1,c1:0.8,c24:-2.2,vol:2100000,liq:390000,h:7820,tx:5120},
];
TOK.forEach(x=>{x.img=x.t==='MOGCAT'?'':'img/t-'+x.t+'.png'; x.px=x.mc/SUPPLY; x.basket=BASKETS[x.t]||['SPYx']; x.rew24=x.vol*0.005; x.cre24=x.vol*0.007;});
const stockChips=(b,sm)=>b.map(s=>{const st=STOCKS.find(x=>x[0]===s); return `<span class="sc${sm?' sm':''}" style="--c:${st[2]}">${s}</span>`;}).join('');

/* extra data for the replica */
const STOCK_COLOR=Object.fromEntries(STOCKS.map(s=>[s[0],s[2]]));
const STOCK_NAME=Object.fromEntries(STOCKS.map(s=>[s[0],s[1]]));
const ME='0x5DdD…4A0b', ME_FULL='0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b';
const ageStr=a=>a.endsWith('m')?a+' ago':a.endsWith('h')?a+' ago':a==='1d'?'yesterday':a+' ago';
const ageMin=a=>{const n=parseInt(a); return a.endsWith('m')?n:a.endsWith('h')?n*60:n*1440;};

const STOCK_IMG=s=>'img/s-'+s+'.png'; const INK_IMG='img/ink.png', ETH_IMG='img/eth.png';
