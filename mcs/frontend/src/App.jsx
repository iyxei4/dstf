import { lazy, Suspense, useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { PublicLandingPage } from "./pages/PublicLandingPage";
import { RoleChoice } from "./pages/RoleChoice";
import { AboutPage } from "./components/shared/AboutPage";
import { PrivacyPolicy } from "./components/shared/PrivacyPolicy";
import { CookieConsent } from "./components/shared/CookieConsent";
import { NotFoundPage } from "./pages/NotFoundPage";
import { ServerErrorPage } from "./pages/ServerErrorPage";
import { TermsPage } from "./pages/TermsPage";
import {
  CampusRoute,
  DemoAdminRoute,
  DemoUserRoute,
} from "./components/auth/CampusRoute";
// Lazy-loaded pages for code splitting
const AuthLandingPage = lazy(() => import("./pages/AuthLandingPage").then((m) => ({ default: m.AuthLandingPage })));
const OnboardingWizard = lazy(() => import("./pages/OnboardingWizard").then((m) => ({ default: m.OnboardingWizard })));
const OwnerDashboard = lazy(() => import("./pages/OwnerDashboard").then((m) => ({ default: m.OwnerDashboard })));
const UserWorkspace = lazy(() => import("./pages/UserPage").then((m) => ({ default: m.UserPage })));
const EmcWorkspace = lazy(() => import("./pages/EmcWorkspace").then((m) => ({ default: m.EmcWorkspace })));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard").then((m) => ({ default: m.AdminDashboard })));
const UserPage = lazy(() => import("./pages/UserPage").then((m) => ({ default: m.UserPage })));
const AdminPage = lazy(() => import("./pages/AdminPage").then((m) => ({ default: m.AdminPage })));

function LegacyMcsRedirect() {
  const location = useLocation();
  const target = location.pathname.replace(/^\/mcs(?=\/|$)/, "") || "/";
  return <Navigate to={`${target}${location.search}${location.hash}`} replace />;
}

export default function App() {
  const [showPrivacy, setShowPrivacy] = useState(false);

  useEffect(() => {
    const handleOpenPrivacy = () => setShowPrivacy(true);
    window.addEventListener("open-privacy", handleOpenPrivacy);
    return () => window.removeEventListener("open-privacy", handleOpenPrivacy);
  }, []);

  return (
    <BrowserRouter>
      <Suspense fallback={<div className="route-fallback" role="status" aria-live="polite">Loading…</div>}>
        <Routes>
          <Route path="/" element={<PublicLandingPage />} />
          <Route path="/auth/*" element={<AuthLandingPage />} />
          <Route path="/onboarding" element={<OnboardingWizard />} />
          <Route path="/owner/*" element={<OwnerDashboard />} />
          <Route path="/administrator" element={<AdminDashboard />} />
          <Route path="/users" element={<UserWorkspace />} />
          <Route path="/emc" element={<EmcWorkspace />} />
          <Route path="/choose" element={<RoleChoice />} />
          <Route path="/user" element={<UserPage />} />
          <Route path="/user/signup" element={<UserPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/mcs/admin" element={<AdminPage />} />
          {/* Fixed demo routes. The private site-owner console stays at /admin. */}
          <Route
            path="/mcs/admin/*"
            element={
              <DemoAdminRoute>
                <OwnerDashboard />
              </DemoAdminRoute>
            }
          />
          <Route
            path="/mcs/user/*"
            element={
              <DemoUserRoute>
                <UserPage />
              </DemoUserRoute>
            }
          />
          {/* Campus-scoped owner and EMC workspaces. */}
          <Route
            path="/mcs/:username/:campus/dashboard"
            element={
              <CampusRoute role="owner">
                <OwnerDashboard />
              </CampusRoute>
            }
          />
          <Route
            path="/mcs/:username/:campus/emc"
            element={
              <CampusRoute role="emc">
                <EmcWorkspace />
              </CampusRoute>
            }
          />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/tos" element={<TermsPage />} />
          <Route path="/404" element={<NotFoundPage />} />
          <Route path="/503" element={<ServerErrorPage />} />
          <Route path="/mcs" element={<Navigate to="/" replace />} />
          <Route path="/mcs/*" element={<LegacyMcsRedirect />} />
          <Route path="*" element={<Navigate to="/404" replace />} />
        </Routes>
      </Suspense>
      <PrivacyPolicy isOpen={showPrivacy} onClose={() => setShowPrivacy(false)} />
      <CookieConsent />
    </BrowserRouter>
  );
}