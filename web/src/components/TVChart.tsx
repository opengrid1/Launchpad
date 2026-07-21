import { useEffect, useRef } from "react";
import type { Address } from "@launchpad/sdk";

import { makeDatafeed } from "../lib/tvDatafeed";

// The TradingView Advanced Charts library is served from jsDelivr (mirroring the
// public charting-library repo) so it isn't re-bundled into every app deploy.
const TV_BASE = "https://cdn.jsdelivr.net/gh/opengrid1/hltradingviewtest@main/charting_library/charting_library/";

// Load the TradingView Advanced Charts standalone bundle once.
let tvScript: Promise<void> | null = null;
function loadTradingView(): Promise<void> {
  if ((window as any).TradingView?.widget) return Promise.resolve();
  if (tvScript) return tvScript;
  tvScript = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `${TV_BASE}charting_library.standalone.js`;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load TradingView library"));
    document.head.appendChild(s);
  });
  return tvScript;
}

/** Real TradingView Advanced Charts, fed by our on-chain candles. */
export function TVChart({ token, symbol }: { token: Address; symbol: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const idRef = useRef(`tv_${Math.random().toString(36).slice(2)}`);

  useEffect(() => {
    let widget: any;
    let dead = false;
    loadTradingView()
      .then(() => {
        if (dead || !ref.current) return;
        const TV = (window as any).TradingView;
        widget = new TV.widget({
          container: idRef.current,
          datafeed: makeDatafeed(token, symbol),
          symbol,
          interval: "5",
          library_path: TV_BASE,
          locale: "en",
          timezone: "Etc/UTC",
          autosize: true,
          theme: "dark",
          disabled_features: [
            "use_localstorage_for_settings",
            "header_symbol_search",
            "symbol_search_hot_key",
            "header_compare",
            "header_saveload",
            "display_market_status",
            "popup_hints",
          ],
          enabled_features: ["hide_left_toolbar_by_default", "iframe_loading_compatibility_mode"],
          loading_screen: { backgroundColor: "#0a0e18", foregroundColor: "#ffb765" },
          overrides: {
            "paneProperties.background": "#0a0e18",
            "paneProperties.backgroundType": "solid",
            "paneProperties.vertGridProperties.color": "#1a2338",
            "paneProperties.horzGridProperties.color": "#1a2338",
            "scalesProperties.textColor": "#8593b0",
            "scalesProperties.backgroundColor": "#0a0e18",
            "mainSeriesProperties.candleStyle.upColor": "#57e39a",
            "mainSeriesProperties.candleStyle.downColor": "#ff6b7a",
            "mainSeriesProperties.candleStyle.borderUpColor": "#57e39a",
            "mainSeriesProperties.candleStyle.borderDownColor": "#ff6b7a",
            "mainSeriesProperties.candleStyle.wickUpColor": "#57e39a",
            "mainSeriesProperties.candleStyle.wickDownColor": "#ff6b7a",
          },
          studies_overrides: {
            "volume.volume.color.0": "#ff6b7a",
            "volume.volume.color.1": "#57e39a",
            "volume.volume.transparency": 70,
          },
        });
      })
      .catch(() => undefined);
    return () => {
      dead = true;
      try {
        widget?.remove();
      } catch {
        /* ignore */
      }
    };
  }, [token, symbol]);

  return <div id={idRef.current} ref={ref} className="h-full w-full" />;
}
