import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";

import App from "./App";
import { publicClient, setClient } from "./lib/client";
import { DemoClient } from "./lib/demo";
import { DEMO } from "./lib/env";
import { wagmiConfig } from "./lib/wallet";
import "./styles.css";

if (DEMO) setClient(new DemoClient(publicClient));

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

/** A render error shows a message and a reload button instead of a blank page. */
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="page">
        <section className="hero">
          <div className="caps" style={{ marginBottom: 12 }}>Something broke</div>
          <h1>Page <em>error</em>.</h1>
          <p className="sub">{String(this.state.error.message || this.state.error)}</p>
          <div className="cta"><button className="btn acc" onClick={() => location.reload()}>Reload</button><a className="btn ghost" href="/">Back home</a></div>
        </section>
      </main>
    );
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </QueryClientProvider>
      </WagmiProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
