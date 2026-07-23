import { useEffect } from "react";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { AppProvider } from "./lib/store";
import { NavBar } from "./components/NavBar";
import { ToastStack } from "./components/ui";
import { Landing } from "./pages/Landing";
import { Dashboard } from "./pages/Dashboard";
import { Markets } from "./pages/Markets";
import { TokenDetail } from "./pages/TokenDetail";
import { Activity } from "./pages/Activity";
import { Settings } from "./pages/Settings";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);
  return null;
}

function AnimatedRoutes() {
  const location = useLocation();
  return (
    <div key={location.pathname} className="route-fade">
      <Routes location={location}>
        <Route path="/" element={<Landing />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/markets" element={<Markets />} />
        <Route path="/token/:symbol" element={<TokenDetail />} />
        <Route path="/activity" element={<Activity />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Landing />} />
      </Routes>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <ScrollToTop />
        <NavBar />
        <AnimatedRoutes />
        <ToastStack />
      </BrowserRouter>
    </AppProvider>
  );
}
