import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { UserLogin } from "../components/auth/UserLogin";
import { SignupPage } from "../components/auth/SignupPage";
import { UserWorkspace } from "../components/user/UserWorkspace";

export function UserPage() {
  const location = useLocation();
  // The /user/signup path opens the signup form directly; otherwise resume
  // the workspace when the account cookie is present, else show the login.
  const [view, setView] = useState(() => {
    if (location.pathname.endsWith("/user/signup")) return "signup";
    return localStorage.getItem("wattwise-user") ? "workspace" : "login";
  });

  const handleSignIn = (account) => {
    if (account?.role === "owner") {
      // /mcs/user is the reporting workspace. Owners belong at /mcs/admin
      // for the demo campus, or at their normal campus dashboard.
      if (account.username === "admin" && account.campus_slug === "cshs") {
        window.location.href = "/mcs/admin";
      } else if (account.campus_slug) {
        window.location.href = `/mcs/${account.username}/${account.campus_slug}/dashboard`;
      } else {
        window.location.href = "/onboarding";
      }
      return;
    }
    setView("workspace");
  };

  const handleSignOut = () => {
    setView("login");
  };

  const handleGoToSignup = () => setView("signup");
  const handleBackToLogin = () => setView("login");

  // UserWorkspace dispatches this event after POST /users/logout succeeds.
  useEffect(() => {
    const onSignOut = () => setView("login");
    window.addEventListener("wattwise-signout", onSignOut);
    return () => window.removeEventListener("wattwise-signout", onSignOut);
  }, []);

  if (view === "signup") {
    return <SignupPage onBack={handleBackToLogin} />;
  }

  if (view === "workspace") {
    return <UserWorkspace onSignOut={handleSignOut} />;
  }

  return <UserLogin onSignIn={handleSignIn} onSignup={handleGoToSignup} />;
}