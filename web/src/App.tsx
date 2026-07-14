import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";

import { Header } from "./components/Header";
import { Skeleton, Toasts } from "./components/ui";
import { wagmiConfig } from "./lib/wagmi";
import { Explore } from "./pages/Explore";

const TokenPage = lazy(() => import("./pages/Token").then((m) => ({ default: m.TokenPage })));
const LaunchPage = lazy(() => import("./pages/Launch").then((m) => ({ default: m.LaunchPage })));
const AdminPage = lazy(() => import("./pages/Admin").then((m) => ({ default: m.AdminPage })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 10_000, refetchOnWindowFocus: false },
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
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <div className="flex min-h-screen flex-col bg-bg">
            <Header />
            <main className="flex-1">
              <Suspense fallback={<PageFallback />}>
                <Routes>
                  <Route path="/" element={<Explore />} />
                  <Route path="/launch" element={<LaunchPage />} />
                  <Route path="/token/:address" element={<TokenPage />} />
                  {/* Hidden operations console; access enforced on-chain by role. */}
                  <Route path="/admin" element={<AdminPage />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Suspense>
            </main>
            <footer className="border-t border-edge py-5">
              <p className="mx-auto max-w-5xl px-4 text-xs text-ink-3 sm:px-6">
                Meridian. Real markets on Robinhood Chain.
              </p>
            </footer>
            <Toasts />
          </div>
        </BrowserRouter>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
