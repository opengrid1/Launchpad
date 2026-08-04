import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";

import { Footer } from "./components/Footer";
import { Header } from "./components/Header";
import { Skeleton, Toasts } from "./components/ui";
import { BRAND_FLAVOR } from "./lib/brand";
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
const BridgePage = lazy(() => import("./pages/Bridge").then((m) => ({ default: m.BridgePage })));

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
              <Suspense fallback={<PageFallback />}>
                <Routes>
                  <Route path="/" element={<Explore />} />
                  <Route path="/launch" element={<LaunchPage />} />
                  <Route path="/token/:address" element={<TokenPage />} />
                  <Route path="/docs" element={<DocsPage />} />
                  <Route path="/bridge" element={<BridgePage />} />
                  {/* Hidden operations console; access enforced on-chain by role. */}
                  <Route path="/admin" element={<AdminPage />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Suspense>
            </main>
            <Footer />
            <Toasts />
          </div>
        </BrowserRouter>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
