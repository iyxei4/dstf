import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { RoleChoice } from "./pages/RoleChoice";
import { UserPage } from "./pages/UserPage";
import { AdminPage } from "./pages/AdminPage";
import { AboutPage } from "./components/shared/AboutPage";
import { PrivacyPolicy } from "./components/shared/PrivacyPolicy";
import { CookieConsent } from "./components/shared/CookieConsent";

export default function App() {
  const [showPrivacy, setShowPrivacy] = useState(false);

  useEffect(() => {
    const handleOpenPrivacy = () => setShowPrivacy(true);
    window.addEventListener("open-privacy", handleOpenPrivacy);
    return () => window.removeEventListener("open-privacy", handleOpenPrivacy);
  }, []);

  return (
    <BrowserRouter basename="/mcs">
      <Routes>
        <Route path="/" element={<RoleChoice />} />
        <Route path="/user" element={<UserPage />} />
        <Route path="/user/signup" element={<UserPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
      <PrivacyPolicy isOpen={showPrivacy} onClose={() => setShowPrivacy(false)} />
      <CookieConsent />
    </BrowserRouter>
  );
}