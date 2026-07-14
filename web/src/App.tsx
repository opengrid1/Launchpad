import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";

import { Header } from "./components/Header";
import { Skeleton, Toasts } from "./components/ui";
import { wagmiConfig } from "./lib/wagmi";
import { Landing } from "./pages/Landing";

const Explore = lazy(() => import("./pages/Explore").then((m) => ({ default: m.Explore })));
const TokenPage = lazy(() => import("./pages/Token").then((m) => ({ default: m.TokenPage })));
const CreatePage = lazy(() => import("./pages/Create").then((m) => ({ default: m.CreatePage })));
const DashboardPage = lazy(() => import("./pages/Dashboard").then((m) => ({ default: m.DashboardPage })));
const AdminPage = lazy(() => import("./pages/Admin").then((m) => ({ default: m.AdminPage })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 10_000, refetchOnWindowFocus: false },
  },
});

function PageFallback() {
  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-6">
      <Skeleton className="h-14" />
      <Skeleton className="h-[400px]" />
    </div>
  );
}

export default function App() {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <div className="min-h-screen bg-bg">
            <Header />
            <main>
              <Suspense fallback={<PageFallback />}>
                <Routes>
                  <Route path="/" element={<Landing />} />
                  <Route path="/markets" element={<Explore />} />
                  <Route path="/t/:address" element={<TokenPage />} />
                  <Route path="/create" element={<CreatePage />} />
                  <Route path="/dashboard" element={<DashboardPage />} />
                  <Route path="/admin" element={<AdminPage />} />
                </Routes>
              </Suspense>
            </main>
            <footer className="mt-12 border-t border-edge py-6">
              <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 text-[11px] text-ink-3">
                <span>Meridian. Real contracts, real pools, real trades.</span>
                <span>Liquidity is protocol-managed. Anti-whale limits lift automatically at 40,000 USD market cap.</span>
              </div>
            </footer>
            <Toasts />
          </div>
        </BrowserRouter>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
