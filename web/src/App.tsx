import { Component, lazy, Suspense, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";

import { Footer } from "./components/Footer";
import { Header } from "./components/Header";
import { Skeleton, Toasts } from "./components/ui";
import { BRAND_FLAVOR, IS_HYPER, IS_STOCK_BOARD } from "./lib/brand";
import { HammrApp } from "./hammr/HammrApp";
import { wagmiConfig } from "./lib/wagmi";
import { Explore } from "./pages/Explore";

const TokenPage = lazy(() => import("./pages/Token").then((m) => ({ default: m.TokenPage })));
const LaunchPage = lazy(() => import("./pages/Launch").then((m) => ({ default: m.LaunchPage })));
const AdminPage =
  String(import.meta.env.VITE_PROTOCOL ?? "") === "stable-v3"
    ? lazy(() => import("./pages/AdminStable").then((m) => ({ default: m.AdminStable })))
    : lazy(() => import("./pages/Admin").then((m) => ({ default: m.AdminPage })));
const DocsPage = lazy(() => import("./pages/Docs").then((m) => ({ default: m.DocsPage })));
const ProfilePage = lazy(() => import("./pages/Profile").then((m) => ({ default: m.ProfilePage })));
const FlywheelPage = lazy(() => import("./pages/Flywheel").then((m) => ({ default: m.FlywheelPage })));
const BridgePage = lazy(() => import("./pages/Bridge").then((m) => ({ default: m.BridgePage })));
// koi.fun (Base flavor) discovery pages
const BasePartyPage = lazy(() => import("./pages/BaseParty").then((m) => ({ default: m.BaseParty })));
const BaseLeaderboardPage = lazy(() => import("./pages/BaseLeaderboard").then((m) => ({ default: m.BaseLeaderboard })));
const BaseSearchPage = lazy(() => import("./pages/BaseSearch").then((m) => ({ default: m.BaseSearch })));
const BaseFeedPage = lazy(() => import("./pages/BaseFeed").then((m) => ({ default: m.BaseFeed })));
// hyperstock holder-rewards page: claimable fee shares across every coin.
const RewardsPage = lazy(() => import("./pages/Rewards").then((m) => ({ default: m.RewardsPage })));

const queryClient = new QueryClient({
  defaultOptions: {
    // Serve cached reads longer and keep them in memory across navigation so
    // moving between pages doesn't re-hit the RPC for data we already have.
    queries: { staleTime: 30_000, gcTime: 300_000, refetchOnWindowFocus: false, retry: 2 },
  },
});

function PageFallback() {
  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-8">
      <Skeleton className="h-14" />
      <Skeleton className="h-[400px] rounded-2xl" />
    </div>
  );
}

/** Last-resort net under the routed pages: a render crash shows a reload
 *  screen instead of unmounting the app into a blank page. */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: "60vh", display: "grid", placeItems: "center", padding: 24 }}>
          <div style={{ textAlign: "center", maxWidth: 420 }}>
            <p style={{ fontSize: 16, fontWeight: 700, color: "var(--color-ink, #eceff2)" }}>Something went wrong.</p>
            <p style={{ marginTop: 8, fontSize: 12.5, color: "var(--color-ink-3, #676f76)", overflowWrap: "anywhere" }}>
              {String(this.state.error?.message ?? this.state.error).slice(0, 200)}
            </p>
            <button
              onClick={() => { this.setState({ error: null }); window.location.href = "/"; }}
              style={{ marginTop: 16, padding: "10px 22px", borderRadius: 10, border: 0, cursor: "pointer", fontWeight: 700, background: "var(--color-accent, #4fe0cb)", color: "var(--color-accent-fg, #04221e)" }}
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  // The hammr flavor is a self-contained auction app with its own chrome.
  if (BRAND_FLAVOR === "hammr") {
    return (
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <HammrApp />
        </QueryClientProvider>
      </WagmiProvider>
    );
  }
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <div className="flex min-h-screen flex-col bg-bg">
            <Header />
            <main className="flex-1 pb-14 sm:pb-0">
              <ErrorBoundary>
              <Suspense fallback={<PageFallback />}>
                <Routes>
                  <Route path="/" element={<Explore />} />
                  <Route path="/launch" element={<LaunchPage />} />
                  <Route path="/token/:address" element={<TokenPage />} />
                  <Route path="/docs" element={<DocsPage />} />
                  <Route path="/profile" element={<ProfilePage />} />
                  <Route path="/flywheel" element={<FlywheelPage />} />
                  <Route path="/bridge" element={<BridgePage />} />
                  {IS_STOCK_BOARD && (
                    <>
                      <Route path="/party" element={<BasePartyPage />} />
                      <Route path="/pool-party" element={<Navigate to="/party" replace />} />
                    </>
                  )}
                  {/* Flavor-generic discovery pages, shared by the stock board
                      and hyperstock (leaderboard, feed, docked search). */}
                  {(IS_STOCK_BOARD || IS_HYPER) && (
                    <>
                      <Route path="/leaderboard" element={<BaseLeaderboardPage />} />
                      <Route path="/feed" element={<BaseFeedPage />} />
                      <Route path="/search" element={<BaseSearchPage />} />
                    </>
                  )}
                  {IS_HYPER && <Route path="/rewards" element={<RewardsPage />} />}
                  {/* Hidden operations console; access enforced on-chain by role. */}
                  <Route path="/admin" element={<AdminPage />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Suspense>
              </ErrorBoundary>
            </main>
            <Footer />
            <Toasts />
          </div>
        </BrowserRouter>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
