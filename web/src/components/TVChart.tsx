import { useEffect, useRef, useState } from "react";
import type { Address } from "@launchpad/sdk";

import { IS_INK } from "../lib/brand";
import { makeDatafeed } from "../lib/tvDatafeed";

// squidpad runs a light theme, so its chart is light to sit inside the white
// trading page; every other flavor keeps the dark terminal chart.
const LIGHT = IS_INK;
const CHART_BG = LIGHT ? "#ffffff" : "#14161a";
const GRID = LIGHT ? "#eef0f4" : "#1f232a";
const AXIS_TEXT = LIGHT ? "#8a8fa0" : "#9298a2";
const UP = LIGHT ? "#16a34a" : "#21c45d";
const DOWN = LIGHT ? "#e11d48" : "#ef584d";

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
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let widget: any;
    let dead = false;
    setFailed(false);
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
          theme: LIGHT ? "light" : "dark",
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
          loading_screen: { backgroundColor: CHART_BG, foregroundColor: LIGHT ? "#0f766e" : "#2f6bff" },
          overrides: {
            "paneProperties.background": CHART_BG,
            "paneProperties.backgroundType": "solid",
            "paneProperties.vertGridProperties.color": GRID,
            "paneProperties.horzGridProperties.color": GRID,
            "scalesProperties.textColor": AXIS_TEXT,
            "scalesProperties.backgroundColor": CHART_BG,
            "mainSeriesProperties.candleStyle.upColor": UP,
            "mainSeriesProperties.candleStyle.downColor": DOWN,
            "mainSeriesProperties.candleStyle.borderUpColor": UP,
            "mainSeriesProperties.candleStyle.borderDownColor": DOWN,
            "mainSeriesProperties.candleStyle.wickUpColor": UP,
            "mainSeriesProperties.candleStyle.wickDownColor": DOWN,
          },
          studies_overrides: {
            "volume.volume.color.0": DOWN,
            "volume.volume.color.1": UP,
            "volume.volume.transparency": 70,
          },
        });
      })
      .catch(() => { if (!dead) setFailed(true); });
    return () => {
      dead = true;
      try {
        widget?.remove();
      } catch {
        /* ignore */
      }
    };
  }, [token, symbol, attempt]);

  const retry = () => { tvScript = null; setAttempt((a) => a + 1); };

  if (failed) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-center text-ink-3">
        <p className="text-sm">Chart failed to load.</p>
        <button onClick={retry} className="rounded-lg border border-edge bg-panel px-4 py-2 text-sm text-ink transition-colors hover:border-edge-2">
          Retry
        </button>
      </div>
    );
  }

  return <div id={idRef.current} ref={ref} className="h-full w-full" />;
}
