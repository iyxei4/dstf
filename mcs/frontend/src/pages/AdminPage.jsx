import { useState, useEffect } from "react";
import { AdminLogin } from "../components/auth/AdminLogin";
import { AdminWorkspace } from "../components/admin/AdminWorkspace";

export function AdminPage() {
  const [view, setView] = useState(() => {
    return localStorage.getItem("wattwise-admin-session") === "true" ? "workspace" : "login";
  });

  const handleSignIn = () => {
    setView("workspace");
  };

  const handleSignOut = () => {
    setView("login");
  };

  useEffect(() => {
    const handleSignOut = () => setView("login");
    window.addEventListener("wattwise-admin-signout", handleSignOut);
    return () => window.removeEventListener("wattwise-admin-signout", handleSignOut);
  }, []);

  if (view === "workspace") {
    return <AdminWorkspace onSignOut={handleSignOut} />;
  }

  return <AdminLogin onSignIn={handleSignIn} />;
}