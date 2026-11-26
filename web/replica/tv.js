/* TradingView Advanced Charts integration for the token page (library in /charting_library).
   Candles come from the ledger's Trade events through chain.js; prices are pair units per coin,
   shown in USD or in the paired asset, as price or as market cap. */
(function(){
  const RES={ '1':60,'3':180,'5':300,'15':900,'30':1800,'60':3600,'120':7200,'240':14400,'1D':86400,'1W':604800 };
  let X=null; // the token shown (from app.js)
  let unit='USD', mode='price';
  const pairSym=()=>X?X.pair:'ETH';
  const factor=()=>(mode==='mcap'?SUPPLY:1)*(unit==='USD'?(X?X.pairUsd:1):1);
  const symName=()=>X?`${X.t}/${X.pair}`:'TOKEN/ETH';
  const scaleFor=(u,m)=>{ const p=(X?X.pxPair:1e-9)*(m==='mcap'?SUPPLY:1)*(u==='USD'?(X?X.pairUsd:1):1); if(!(p>0)) return 100; const digits=Math.max(2,Math.ceil(-Math.log10(p))+3); return Math.pow(10,Math.min(16,digits)); };
  const subs={};
  const datafeed={
    onReady(cb){ setTimeout(()=>cb({ supported_resolutions:['1','5','15','30','60','240','1D','1W'], supports_marks:false, supports_timescale_marks:false, supports_time:true, exchanges:[{value:'Inkypump',name:'Inkypump',desc:'Uniswap V4 on Ink'}], symbols_types:[{name:'crypto',value:'crypto'}] }),0); },
    searchSymbols(q,ex,type,cb){ cb([{symbol:symName(),full_name:'Inkypump:'+symName(),description:X?X.n:'',exchange:'Inkypump',ticker:symName(),type:'crypto'}]); },
    resolveSymbol(name,ok){ const m=/·MCAP/.test(name)?'mcap':'price', u=/·PAIR/.test(name)?'PAIR':'USD'; unit=u; mode=m;
      setTimeout(()=>ok({ ticker:name, name:symName(), description:(m==='mcap'?X.t+' market cap':symName())+(u==='PAIR'?' in '+pairSym():''), type:'crypto', session:'24x7', timezone:'Etc/UTC', exchange:'Inkypump', listed_exchange:'Inkypump', format:'price', minmov:1, pricescale:scaleFor(u,m), has_intraday:true, intraday_multipliers:['1','5','15','30','60','240'], has_daily:true, has_weekly_and_monthly:true, supported_resolutions:['1','5','15','30','60','240','1D','1W'], volume_precision:4, data_status:'streaming', visible_plots_set:'ohlcv', currency_code:u==='USD'?'USD':pairSym() }),0); },
    async getBars(info,res,params,ok,err){ try{ const step=RES[res]||3600; if(!X||!window.CHAIN){ ok([],{noData:true}); return; }
      const bars=await CHAIN.bars(X.addr,step,params.from,params.to); const f=factor();
      if(!bars.length){ ok([],{noData:true}); return; }
      ok(bars.map(b=>({time:b.time*1000,open:b.open*f,high:b.high*f,low:b.low*f,close:b.close*f,volume:b.volume*(X.pairUsd||1)})),{noData:false}); }catch(e){ err(String(e)); } },
    subscribeBars(info,res,cb,uid){ subs[uid]={res:RES[res]||3600,cb}; },
    getServerTime(cb){ cb(Math.floor(Date.now()/1000)); },
    unsubscribeBars(uid){ delete subs[uid]; },
  };
  const SUBS='₀₁₂₃₄₅₆₇₈₉';
  function fmtPrice(v){ if(v==null||isNaN(v)) return ''; const sign=v<0?'-':''; const a=Math.abs(v); if(a===0) return '0';
    if(a>=1000) return sign+a.toLocaleString('en-US',{maximumFractionDigits:2});
    if(a>=1) return sign+String(+a.toFixed(4));
    if(a>=0.001){ return sign+String(+a.toFixed(8)); }
    const e=Math.floor(Math.log10(a)); const zeros=-e-1; const digits=Math.round(a*Math.pow(10,-e+5)); let d=String(digits); if(d.length>6){ return sign+'0.0'+String(zeros-1).replace(/\d/g,c=>SUBS[c])+d.slice(0,6); }
    return sign+'0.0'+String(zeros).replace(/\d/g,c=>SUBS[c])+d.replace(/0+$/,''); }
  // called by app.js after every refresh with the latest pair price per coin and the trades that landed since the last call
  window.tvTick=function(pxPair,newTrades){ if(!X) return; const now=Math.floor(Date.now()/1000); const f=factor();
    Object.values(subs).forEach(s=>{ const t0=Math.floor(now/s.res)*s.res; const key=t0*1000; const price=pxPair*f;
      if(!s.last||s.last.time!==key){ s.last={time:key,open:s.prevClose||price,high:price,low:price,close:price,volume:0}; }
      const L=s.last; (newTrades||[]).forEach(t=>{ const p=CHAIN.tradePrice(t)*f; if(p>0&&t.ts>=t0){ L.high=Math.max(L.high,p); L.low=Math.min(L.low,p); L.volume+=Number(t.pair)/1e18*(X.pairUsd||1); } });
      L.close=price; L.high=Math.max(L.high,price); L.low=Math.min(L.low,price); s.prevClose=price; s.cb({...L}); }); };
  window.initTV=function(container,x){
    X=x; const mobile=innerWidth<768; const lang=(typeof LANG!=='undefined'&&LANG!=='en')?(LANG==='zh'?'zh':'tr'):'en';
    const w=new TradingView.widget({ symbol:symName(), interval:'5', container, datafeed, library_path:'/charting_library/', locale:lang, timezone:'Etc/UTC', theme:'dark', autosize:true, fullscreen:false, header_widget_buttons_mode:'fullsize',
      custom_css_url:'tv-theme.css', custom_font_family:"'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      loading_screen:{ backgroundColor:'#0e1117', foregroundColor:'#ff4fa3' },
      disabled_features:['use_localstorage_for_settings','header_symbol_search','symbol_search_hot_key','header_compare','display_market_status','popup_hints','header_saveload','header_quick_search','header_fullscreen_button','go_to_date'].concat(mobile?['left_toolbar','header_undo_redo','header_screenshot','header_settings']:[]),
      enabled_features:['side_toolbar_in_fullscreen_mode'],
      time_frames:[{text:'3m',resolution:'60',description:'3 months'},{text:'1m',resolution:'30',description:'1 month'},{text:'5d',resolution:'5',description:'5 days'},{text:'1d',resolution:'1',description:'1 day'}],
      overrides:{ 'paneProperties.background':'#0e1117','paneProperties.backgroundType':'solid','paneProperties.backgroundGradientStartColor':'#0e1117','paneProperties.backgroundGradientEndColor':'#0e1117','paneProperties.vertGridProperties.color':'#1e2430','paneProperties.horzGridProperties.color':'#1e2430','paneProperties.legendProperties.showSeriesTitle':true,'symbolWatermarkProperties.transparency':100,'scalesProperties.textColor':'#7c8498','scalesProperties.lineColor':'#1e2430','scalesProperties.backgroundColor':'#0e1117','mainSeriesProperties.candleStyle.upColor':'#089981','mainSeriesProperties.candleStyle.downColor':'#F23645','mainSeriesProperties.candleStyle.borderUpColor':'#089981','mainSeriesProperties.candleStyle.borderDownColor':'#F23645','mainSeriesProperties.candleStyle.wickUpColor':'#089981','mainSeriesProperties.candleStyle.wickDownColor':'#F23645' },
      studies_overrides:{ 'volume.volume.color.0':'#F23645','volume.volume.color.1':'#089981','volume.volume.transparency':65 },
      custom_formatters:{ priceFormatterFactory:()=>({ format:fmtPrice }) } });
    window.tvWidget=w;
    w.headerReady().then(()=>{ const group=(pairs,get,set)=>{ const b=w.createButton(); b.style.cursor='default'; b.style.padding='0 16px'; b.style.fontWeight='500'; b.style.whiteSpace='nowrap';
        b.innerHTML=pairs.map((p,i)=>(i?'<span style="color:#7c8498;padding:0 6px">/</span>':'')+`<span data-v="${p[0]}" style="cursor:pointer">${p[1]}</span>`).join('');
        const paint=()=>b.querySelectorAll('[data-v]').forEach(x=>{ x.style.color=x.dataset.v===get()?'#ff4fa3':'#f3f5f9'; }); paint();
        b.querySelectorAll('[data-v]').forEach(x=>x.onclick=()=>{ set(x.dataset.v); w.setSymbol(symName()+(mode==='mcap'?'·MCAP':'')+(unit==='PAIR'?'·PAIR':''), w.activeChart().resolution(), ()=>{}); paint(); }); return b; };
      group([['USD','USD'],['PAIR',pairSym()]],()=>unit,v=>{unit=v;}); group([['mcap','MarketCap'],['price','Price']],()=>mode,v=>{mode=v;});
      const fs=w.createButton(); fs.setAttribute('title','Fullscreen mode'); fs.style.padding='0 10px'; fs.style.cursor='pointer'; fs.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2.5 6.5v-4h4M11.5 2.5h4v4M15.5 11.5v4h-4M6.5 15.5h-4v-4"/></svg>'; fs.onclick=()=>{ try{ w.startFullscreen(); }catch(e){} }; });
    return w; };
})();
