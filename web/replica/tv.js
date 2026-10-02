/* TradingView Advanced Charts integration for the token page (library in ./charting_library) */
(function(){
  const RES={ '1':60,'3':180,'5':300,'15':900,'30':1800,'60':3600,'120':7200,'240':14400,'1D':86400,'1W':604800 };
  // deterministic synthetic market: a smooth path plus seeded noise, so every resolution agrees
  const seed=t=>{ let x=Math.sin(t*12.9898)*43758.5453; return x-Math.floor(x); };
  const ANCHOR=1790294400; // 2026-09-24, launch week
  const base=t=>{ const d=(t-ANCHOR)/86400; return 0.00122*Math.exp(0.18*Math.sin(d/2.3)+0.09*Math.sin(d*1.7+1)+0.05*Math.sin(d*5.1+2)-0.0008*(d*d)); };
  const px=t=>base(t)*(1+(seed(Math.floor(t/60))-0.5)*0.012);
  const ETHUSD=2431.18, SUPPLY=1e9; let unit='USD', mode='price';
  const factor=()=>(mode==='mcap'?SUPPLY:1)*(unit==='ETH'?1/ETHUSD:1);
  const SYM={ 'MOGCAT/ETH':{unit:'USD',mode:'price',scale:100000000}, 'MOGCAT/ETH·ETH':{unit:'ETH',mode:'price',scale:1000000000000}, 'MOGCAT MCAP':{unit:'USD',mode:'mcap',scale:100}, 'MOGCAT MCAP·ETH':{unit:'ETH',mode:'mcap',scale:100000} };
  let live=null; // {time, open, high, low, close} of the forming bar, kept in sync with app.js ticks
  function bar(t0,res){ const n=Math.min(24,Math.max(4,Math.floor(res/60))); let o=px(t0), c=px(t0+res-1), h=Math.max(o,c), l=Math.min(o,c); for(let i=1;i<n;i++){ const p=px(t0+Math.floor(res*i/n)); if(p>h) h=p; if(p<l) l=p; } const f=factor(); return {time:t0*1000,open:o*f,high:h*f,low:l*f,close:c*f,volume:Math.round((2e5+seed(t0)*9e5)*Math.sqrt(res/3600))}; }
  const datafeed={
    onReady(cb){ setTimeout(()=>cb({ supported_resolutions:['1','5','15','30','60','240','1D','1W'], supports_marks:false, supports_timescale_marks:false, supports_time:true, exchanges:[{value:'Inkypump',name:'Inkypump',desc:'Uniswap V4 on Ink'}], symbols_types:[{name:'crypto',value:'crypto'}] }),0); },
    searchSymbols(q,ex,type,cb){ cb([{symbol:'MOGCAT/ETH',full_name:'Inkypump:MOGCAT/ETH',description:'Mogcat',exchange:'Inkypump',ticker:'MOGCAT/ETH',type:'crypto'}]); },
    resolveSymbol(name,ok,err){ const k=SYM[name]?name:'MOGCAT/ETH'; unit=SYM[k].unit; mode=SYM[k].mode; setTimeout(()=>ok({ ticker:k, name:'MOGCAT/ETH', description:'MOGCAT/ETH', type:'crypto', session:'24x7', timezone:'Etc/UTC', exchange:'Inkypump', listed_exchange:'Inkypump', format:'price', minmov:1, pricescale:SYM[k].scale, has_intraday:true, intraday_multipliers:['1','5','15','30','60','240'], has_daily:true, has_weekly_and_monthly:true, supported_resolutions:['1','5','15','30','60','240','1D','1W'], volume_precision:0, data_status:'streaming', visible_plots_set:'ohlcv', currency_code:unit }),0); },
    getBars(info,res,params,ok,err){ const step=RES[res]||3600; const from=Math.max(1735689600,params.from), to=params.to; const bars=[]; for(let t=Math.floor(from/step)*step; t<to; t+=step){ if(t>=from) bars.push(bar(t,step)); } const now=Math.floor(Date.now()/1000); if(bars.length){ const last=bars[bars.length-1]; if(last.time/1000+step>now && live && live.time===last.time){ Object.assign(last,live); } } setTimeout(()=>ok(bars,{noData:bars.length===0}),0); },
    subscribeBars(info,res,cb,uid){ subs[uid]={res:RES[res]||3600,cb}; },
    getServerTime(cb){ cb(Math.floor(Date.now()/1000)); },
    unsubscribeBars(uid){ delete subs[uid]; },
  };
  const subs={};
  const SUB='₀₁₂₃₄₅₆₇₈₉';
  function fmtPrice(v){ if(v==null||isNaN(v)) return ''; const sign=v<0?'-':''; const a=Math.abs(v); if(a===0) return '0';
    if(a>=1000) return sign+a.toLocaleString('en-US',{maximumFractionDigits:2});
    if(a>=1) return sign+String(+a.toFixed(4));
    if(a>=0.001){ return sign+String(+a.toFixed(8)); }
    const e=Math.floor(Math.log10(a)); const zeros=-e-1; const digits=Math.round(a*Math.pow(10,-e+5)); let d=String(digits); if(d.length>6){ return sign+'0.0'+String(zeros-1).replace(/\d/g,c=>SUB[c])+d.slice(0,6); }
    return sign+'0.0'+String(zeros).replace(/\d/g,c=>SUB[c])+d.replace(/0+$/,''); }
  window.tvTick=function(raw){ const price=raw*factor(); const now=Math.floor(Date.now()/1000); Object.values(subs).forEach(s=>{ const t0=Math.floor(now/s.res)*s.res; const key=t0*1000; if(!s.last||s.last.time!==key){ const b=bar(t0,s.res); s.last={time:key,open:b.open,high:b.open,low:b.open,close:price,volume:Math.round(b.volume*0.2)}; } const L=s.last; L.close=price; L.high=Math.max(L.high,price); L.low=Math.min(L.low,price); L.volume+=Math.round(2000+Math.random()*4000); live={time:L.time,open:L.open,high:L.high,low:L.low,close:L.close}; s.cb({...L}); }); };
  window.initTV=function(container){
    const mobile=innerWidth<768; const lang=(typeof LANG!=='undefined'&&LANG!=='en')?(LANG==='zh'?'zh':'tr'):'en';
    const w=new TradingView.widget({ symbol:'MOGCAT/ETH', interval:'60', container, datafeed, library_path:'charting_library/', locale:lang, timezone:'Etc/UTC', theme:'dark', autosize:true, fullscreen:false, header_widget_buttons_mode:'fullsize',
      custom_css_url:'tv-theme.css', custom_font_family:"'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      loading_screen:{ backgroundColor:'#0e1117', foregroundColor:'#ff4fa3' },
      disabled_features:['use_localstorage_for_settings','header_symbol_search','symbol_search_hot_key','header_compare','display_market_status','popup_hints','header_saveload','header_quick_search','header_fullscreen_button','go_to_date'].concat(mobile?['left_toolbar','header_undo_redo','header_screenshot','header_settings']:[]),
      enabled_features:['side_toolbar_in_fullscreen_mode'],
      time_frames:[{text:'3m',resolution:'60',description:'3 months'},{text:'1m',resolution:'30',description:'1 month'},{text:'5d',resolution:'5',description:'5 days'},{text:'1d',resolution:'1',description:'1 day'}],
      overrides:{ 'paneProperties.background':'#0e1117','paneProperties.backgroundType':'solid','paneProperties.backgroundGradientStartColor':'#0e1117','paneProperties.backgroundGradientEndColor':'#0e1117','paneProperties.vertGridProperties.color':'#1e2430','paneProperties.horzGridProperties.color':'#1e2430','paneProperties.legendProperties.showSeriesTitle':true,'symbolWatermarkProperties.transparency':100,'scalesProperties.textColor':'#7c8498','scalesProperties.lineColor':'#1e2430','scalesProperties.backgroundColor':'#0e1117','mainSeriesProperties.candleStyle.upColor':'#089981','mainSeriesProperties.candleStyle.downColor':'#F23645','mainSeriesProperties.candleStyle.borderUpColor':'#089981','mainSeriesProperties.candleStyle.borderDownColor':'#F23645','mainSeriesProperties.candleStyle.wickUpColor':'#089981','mainSeriesProperties.candleStyle.wickDownColor':'#F23645' },
      studies_overrides:{ 'volume.volume.color.0':'#F23645','volume.volume.color.1':'#089981','volume.volume.transparency':65 },
      custom_formatters:{ priceFormatterFactory:()=>({ format:fmtPrice }) } });
    window.tvWidget=w; try{ price=px(Math.floor(Date.now()/1000)); }catch(e){}
    w.headerReady().then(()=>{ const group=(pairs,get,set)=>{ const b=w.createButton(); b.style.cursor='default'; b.style.padding='0 16px'; b.style.fontWeight='500'; b.style.whiteSpace='nowrap';
        b.innerHTML=pairs.map((p,i)=>(i?'<span style="color:#7c8498;padding:0 6px">/</span>':'')+`<span data-v="${p[0]}" style="cursor:pointer">${p[1]}</span>`).join('');
        const paint=()=>b.querySelectorAll('[data-v]').forEach(x=>{ x.style.color=x.dataset.v===get()?'#ff4fa3':'#f3f5f9'; }); paint();
        b.querySelectorAll('[data-v]').forEach(x=>x.onclick=()=>{ set(x.dataset.v); w.setSymbol((mode==='mcap'?'MOGCAT MCAP':'MOGCAT/ETH')+(unit==='ETH'?'·ETH':''), w.activeChart().resolution(), ()=>{}); paint(); }); return b; };
      group([['USD','USD'],['ETH','ETH']],()=>unit,v=>{unit=v;}); group([['mcap','MarketCap'],['price','Price']],()=>mode,v=>{mode=v;});
      const fs=w.createButton(); fs.setAttribute('title','Fullscreen mode'); fs.style.padding='0 10px'; fs.style.cursor='pointer'; fs.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2.5 6.5v-4h4M11.5 2.5h4v4M15.5 11.5v4h-4M6.5 15.5h-4v-4"/></svg>'; fs.onclick=()=>{ try{ w.startFullscreen(); }catch(e){} }; });
    return w; };
})();
