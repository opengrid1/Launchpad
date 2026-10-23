/* TradingView Advanced Charts integration for the token page (library in /charting_library).
   Candles come from the ledger's Trade events through chain.js; prices are pair units per coin,
   shown in USD or in the paired asset, as price or as market cap.
   A coin on several chains has a pool on each. The chart draws them as one line each (default), merged into
   one series, or one chain's pool alone. Across chains it is USD only, since each chain can pair differently. */
(function(){
  const RES={ '1':60,'3':180,'5':300,'15':900,'30':1800,'60':3600,'120':7200,'240':14400,'1D':86400,'1W':604800 };
  let X=null; // the token shown (from app.js)
  let unit='USD', mode='mcap', draw='hyper';
  const NAT=(window.INKY&&INKY.native)||'HYPE', MAIN=()=>(typeof SP!=='undefined'&&SP.mainKey)||'hyper';
  const pairSym=()=>X?X.pair:NAT;
  const chains=()=>(typeof SP!=='undefined'&&SP.coinChains&&X)?SP.coinChains(X):[MAIN()];
  const nChains=()=>chains().length;
  const multi=()=>nChains()>1;
  const chainOf=k=>(typeof SP!=='undefined'&&SP.chain&&SP.chain(k))||{name:k,color:'#948e9b'};
  /** the pair's USD price on a chain (each chain can pair with its own coin); merged series use the coin's main pair */
  const pairUsdFor=k=>(X&&X.byChain&&X.byChain[k]&&X.byChain[k].pairUsd)||(X?X.pairUsd:1);
  const factorFor=(k,u,m)=>(m==='mcap'?SUPPLY*nChains():1)*(u==='USD'?pairUsdFor(k):1);
  /** pair units only make sense for one pool at a time */
  const single=()=>draw!=='all'&&draw!=='merged';
  const mainKey=()=>draw==='all'?'merged':draw;
  const symName=()=>X?`${X.t}/${X.pair}`:'TOKEN/'+NAT;
  const symFor=k=>symName()+(mode==='mcap'?'·MCAP':'')+(unit==='PAIR'?'·PAIR':'')+'@'+k;
  const keyOf=name=>{ const m=/@([a-z]+)$/i.exec(name||''); return m?m[1].toLowerCase():'merged'; };
  const label=k=>k==='merged'?'All chains':chainOf(k).name;
  const scaleFor=(u,m)=>{ const p=(X?X.pxPair:1e-9)*(m==='mcap'?SUPPLY*nChains():1)*(u==='USD'?(X?X.pairUsd:1):1); if(!(p>0)) return 100; const digits=Math.max(2,Math.ceil(-Math.log10(p))+3); return Math.pow(10,Math.min(16,digits)); };
  const subs={};
  const datafeed={
    onReady(cb){ setTimeout(()=>cb({ supported_resolutions:['1','5','15','30','60','240','1D','1W'], supports_marks:false, supports_timescale_marks:false, supports_time:true, exchanges:[{value:'Liqio',name:'Liqio',desc:'Uniswap v4 on HyperEVM'}], symbols_types:[{name:'crypto',value:'crypto'}] }),0); },
    searchSymbols(q,ex,type,cb){ cb([{symbol:symName(),full_name:'Liqio:'+symName(),description:X?X.n:'',exchange:'Liqio',ticker:symName(),type:'crypto'}]); },
    resolveSymbol(name,ok){ const m=/·MCAP/.test(name)?'mcap':'price', u=/·PAIR/.test(name)?'PAIR':'USD', k=keyOf(name);
      const where=multi()?' · '+label(k):'';
      setTimeout(()=>ok({ ticker:name, name:multi()?(k==='merged'?X.t+' · All chains':label(k)):symName(), description:(m==='mcap'?X.t+' market cap':symName())+(u==='PAIR'?' in '+pairSym():'')+where, type:'crypto', session:'24x7', timezone:'Etc/UTC', exchange:'Liqio', listed_exchange:'Liqio', format:'price', minmov:1, pricescale:scaleFor(u,m), has_intraday:true, intraday_multipliers:['1','5','15','30','60','240'], has_daily:true, has_weekly_and_monthly:true, supported_resolutions:['1','5','15','30','60','240','1D','1W'], volume_precision:4, data_status:'streaming', visible_plots_set:'ohlcv', currency_code:u==='USD'?'USD':pairSym() }),0); },
    async getBars(info,res,params,ok,err){ try{ const step=RES[res]||3600; if(!X||!window.CHAIN){ ok([],{noData:true}); return; }
      const name=info.ticker||info.name, k=keyOf(name), u=/·PAIR/.test(name)?'PAIR':'USD', m=/·MCAP/.test(name)?'mcap':'price';
      const bars=await CHAIN.bars(X.addr,step,params.from,params.to,multi()&&k!=='merged'?k:undefined); const f=factorFor(k,u,m), vu=pairUsdFor(k)||1;
      if(!bars.length){ ok([],{noData:true}); return; }
      ok(bars.map(b=>({time:b.time*1000,open:b.open*f,high:b.high*f,low:b.low*f,close:b.close*f,volume:b.volume*vu})),{noData:false}); }catch(e){ err(String(e)); } },
    subscribeBars(info,res,cb,uid){ const name=info.ticker||info.name; subs[uid]={res:RES[res]||3600,cb,k:keyOf(name),u:/·PAIR/.test(name)?'PAIR':'USD',m:/·MCAP/.test(name)?'mcap':'price'}; },
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
  window.tvTick=function(pxPair,newTrades){ if(!X) return; const now=Math.floor(Date.now()/1000);
    Object.values(subs).forEach(s=>{ const f=factorFor(s.k,s.u,s.m), one=multi()&&s.k!=='merged';
      // one chain's line follows that chain's pool; the merged line follows the coin's headline price
      const cp=one&&X.byChain&&X.byChain[s.k]&&X.byChain[s.k].px?X.byChain[s.k].px/pairUsdFor(s.k):pxPair;
      const t0=Math.floor(now/s.res)*s.res; const key=t0*1000; const price=cp*f;
      if(!s.last||s.last.time!==key){ s.last={time:key,open:s.prevClose||price,high:price,low:price,close:price,volume:0}; }
      const L=s.last; (newTrades||[]).filter(t=>!one||(t.chain||MAIN())===s.k).forEach(t=>{ const p=CHAIN.tradePrice(t)*f; if(p>0&&t.ts>=t0){ L.high=Math.max(L.high,p); L.low=Math.min(L.low,p); L.volume+=Number(t.pair)/1e18*(pairUsdFor(s.k)||1); } });
      L.close=price; L.high=Math.max(L.high,price); L.low=Math.min(L.low,price); s.prevClose=price; s.cb({...L}); }); };
  window.initTV=function(container,x){
    X=x; draw=multi()?'all':chains()[0]; const mobile=innerWidth<768; const lang=(typeof LANG!=='undefined'&&LANG!=='en')?(LANG==='zh'?'zh':'tr'):'en';
    const w=new TradingView.widget({ symbol:symFor(mainKey()), interval:'5', container, datafeed, library_path:'/charting_library/', locale:lang, timezone:'Etc/UTC', theme:'light', autosize:true, fullscreen:false, header_widget_buttons_mode:'fullsize',
      custom_css_url:'/tv-light.css', custom_font_family:"'Instrument Sans', Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      loading_screen:{ backgroundColor:'#ffffff', foregroundColor:'#17131c' },
      disabled_features:['use_localstorage_for_settings','header_symbol_search','symbol_search_hot_key','header_compare','display_market_status','popup_hints','header_saveload','header_quick_search','header_fullscreen_button','go_to_date'].concat(mobile?['left_toolbar','header_undo_redo','header_screenshot','header_settings']:[]),
      enabled_features:['side_toolbar_in_fullscreen_mode'],
      time_frames:[{text:'3m',resolution:'60',description:'3 months'},{text:'1m',resolution:'30',description:'1 month'},{text:'5d',resolution:'5',description:'5 days'},{text:'1d',resolution:'1',description:'1 day'}],
      overrides:{ 'paneProperties.background':'#ffffff','paneProperties.backgroundType':'solid','paneProperties.backgroundGradientStartColor':'#ffffff','paneProperties.backgroundGradientEndColor':'#ffffff','paneProperties.vertGridProperties.color':'#ebe7df','paneProperties.horzGridProperties.color':'#ebe7df','paneProperties.legendProperties.showSeriesTitle':true,'symbolWatermarkProperties.transparency':100,'scalesProperties.textColor':'#948e9b','scalesProperties.lineColor':'#ebe7df','scalesProperties.backgroundColor':'#ffffff','mainSeriesProperties.candleStyle.upColor':'#08794f','mainSeriesProperties.candleStyle.downColor':'#c2351c','mainSeriesProperties.candleStyle.borderUpColor':'#08794f','mainSeriesProperties.candleStyle.borderDownColor':'#c2351c','mainSeriesProperties.candleStyle.wickUpColor':'#08794f','mainSeriesProperties.candleStyle.wickDownColor':'#c2351c' },
      studies_overrides:{ 'volume.volume.color.0':'#c2351c','volume.volume.color.1':'#08794f','volume.volume.transparency':65 },
      custom_formatters:{ priceFormatterFactory:()=>({ format:fmtPrice }) } });
    window.tvWidget=w;
    // multichain: the merged series is the main one; in "all" mode each chain gets its own line on the same scale
    let overlays=[], gen=0, dd=null;
    const apply=()=>{ const ch=w.activeChart(), my=++gen; overlays.forEach(id=>{ try{ ch.removeEntity(id,{disableUndo:true}); }catch(e){} }); overlays=[];
      if(!single()) unit='USD';
      ch.setSymbol(symFor(mainKey()),()=>{ if(my!==gen) return;
        if(draw==='all'){ ch.setChartType(2,()=>{ const st={colorType:'solid',color:'rgba(23,19,28,0.5)',linewidth:1,linestyle:2}; try{ ch.getSeries().setChartStyleProperties(2,st); }catch(e){ w.applyOverrides({'mainSeriesProperties.lineStyle.color':st.color,'mainSeriesProperties.lineStyle.linewidth':1,'mainSeriesProperties.lineStyle.linestyle':2}); } });
          chains().forEach(k=>{ ch.createStudy('Overlay',true,false,{symbol:symFor(k)},{'style':2,'lineStyle.color':chainOf(k).color,'lineStyle.linewidth':2},{priceScale:'as-series',disableUndo:true}).then(id=>{ if(!id) return; if(my!==gen){ try{ ch.removeEntity(id,{disableUndo:true}); }catch(e){} return; } overlays.push(id); }).catch(()=>{}); }); }
        else ch.setChartType(1); });
      if(dd) dd.applyOptions({title:drawTitle()}); if(window.tvDrawChanged) window.tvDrawChanged(draw); };
    const drawTitle=()=>draw==='all'?'All chains':draw==='merged'?'Merged':chainOf(draw).name;
    window.tvDraw=k=>{ if(!multi()||k===draw) return; draw=k; apply(); };
    if(multi()) w.onChartReady(()=>apply());
    w.headerReady().then(()=>{ const group=(pairs,get,set)=>{ const b=w.createButton(); b.style.cursor='default'; b.style.padding='0 16px'; b.style.fontWeight='500'; b.style.whiteSpace='nowrap';
        b.innerHTML=pairs.map((p,i)=>(i?'<span style="color:#948e9b;padding:0 6px">/</span>':'')+`<span data-v="${p[0]}" style="cursor:pointer">${p[1]}</span>`).join('');
        const paint=()=>b.querySelectorAll('[data-v]').forEach(x=>{ x.style.color=x.dataset.v===get()?'#0e9a7c':'#17131c'; }); paint();
        b.querySelectorAll('[data-v]').forEach(x=>x.onclick=()=>{ set(x.dataset.v); if(multi()) apply(); else w.setSymbol(symFor(mainKey()), w.activeChart().resolution(), ()=>{}); paint(); }); return b; };
      if(multi()){ const cnt=k=>{ const n=X.byChain&&X.byChain[k]&&X.byChain[k].trades; return n!=null?` · ${n.toLocaleString('en-US')} trades`:''; };
        w.createDropdown({ title:drawTitle(), tooltip:'Which pools to draw', align:'left', items:[
          {title:'All chains · a line each',onSelect:()=>window.tvDraw('all')},
          {title:'Merged · one series',onSelect:()=>window.tvDraw('merged')},
          ...chains().map(k=>({title:chainOf(k).name+cnt(k),onSelect:()=>window.tvDraw(k)})) ] }).then(d=>{ dd=d; }).catch(()=>{}); }
      group([['USD','USD'],['PAIR',pairSym()]],()=>unit,v=>{ if(v==='PAIR'&&!single()){ if(typeof SP!=='undefined'&&SP.toast) SP.toast('Pick one chain to see the price in '+pairSym(),'info'); return; } unit=v;}); group([['mcap','MarketCap'],['price','Price']],()=>mode,v=>{mode=v;});
      const fs=w.createButton(); fs.setAttribute('title','Fullscreen mode'); fs.style.padding='0 10px'; fs.style.cursor='pointer'; fs.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2.5 6.5v-4h4M11.5 2.5h4v4M15.5 11.5v4h-4M6.5 15.5h-4v-4"/></svg>'; fs.onclick=()=>{ try{ w.startFullscreen(); }catch(e){} }; });
    return w; };
})();
