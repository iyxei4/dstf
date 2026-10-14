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
    if (location.pathname === "/user/signup") return "signup";
    return localStorage.getItem("wattwise-user") ? "workspace" : "login";
  });

  const handleSignIn = () => {
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