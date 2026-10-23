import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Mail,
  Lock,
  User,
  Github,
  Chrome,
  ArrowRight,
  Eye,
  EyeOff,
  Building2,
  Zap,
} from "lucide-react";
import { Topbar } from "../components/ui/Topbar";
import { ThemeToggle } from "../components/ui/ThemeToggle";
import { PageFooter } from "../components/ui/PageFooter";
import { useTheme } from "../hooks/useTheme";
import { Button, Input, Card, CardBody } from "../components/design";
import { request } from "../utils/api";

export function AuthLandingPage() {
  const { darkMode, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [mode, setMode] = useState("login"); // 'login' | 'signup'
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Form state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [username, setUsername] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthError = params.get("oauth_error");
    if (oauthError) setError(oauthError);
  }, []);

  const handleOAuthLogin = (provider) => {
    window.location.href = `/api/auth/${provider}/login`;
  };

  const validateForm = () => {
    if (mode === "login") {
      if (!email.trim()) return "Email is required";
      if (!password) return "Password is required";
    } else {
      if (!fullName.trim()) return "Full name is required";
      if (!workspaceName.trim()) return "Workspace name is required";
      if (!username.trim()) return "Username is required";
      if (!/^[A-Za-z0-9._-]+$/.test(username.trim())) {
        return "Username can only use letters, numbers, dots, dashes, and underscores";
      }
      if (!email.trim()) return "Email is required";
      if (password.length < 8) return "Password must be at least 8 characters";
      if (password !== confirmPassword) return "Passwords do not match";
    }
    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsLoading(true);

    try {
      if (mode === "login") {
        const data = await request("/users/login", {
          method: "POST",
          body: JSON.stringify({ username: email, password }),
        });
        localStorage.setItem("wattwise-user", data.username);
        if (data.username === "admin" && data.role === "owner") {
          navigate("/mcs/admin");
        } else if (data.username === "bernoulli" && data.role === "emc") {
          navigate("/mcs/user");
        } else if (data.role === "owner" && data.username && data.campus_slug) {
          navigate(`/mcs/${data.username}/${data.campus_slug}/dashboard`);
        } else if (data.role === "emc" && data.owner_username && data.campus_slug) {
          navigate(`/mcs/${data.owner_username}/${data.campus_slug}/emc`);
        } else if (data.role === "owner" || (!data.role && data.workspace_name)) {
          navigate("/owner");
        } else if (data.role === "emc") {
          navigate("/emc");
        } else {
          navigate("/user");
        }
      } else {
        // Create the owner account immediately so onboarding can save the
        // workspace and hierarchy against an authenticated session.
        const data = await request("/users/register-owner", {
          method: "POST",
          body: JSON.stringify({
            full_name: fullName,
            email,
            password,
            workspace_name: workspaceName,
            username: username.trim(),
          }),
        });
        localStorage.setItem("wattwise-user", data.username);
        navigate("/onboarding");
      }
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const switchMode = () => {
    setMode(mode === "login" ? "signup" : "login");
    setError("");
  };

  return (
    <main className="auth-page">
      <Topbar
        subtitle={mode === "login" ? "SIGN IN" : "CREATE ACCOUNT"}
        right={
          <>
            <ThemeToggle darkMode={darkMode} onToggle={toggleTheme} />
          </>
        }
      />

      <section className="auth-layout auth-landing">
        <div className="auth-aside">
          <span className="auth-aside-number">
            {mode === "login" ? "01" : "02"} / WATTWISE
          </span>
          <div className="auth-aside-mark">
            <Zap size={30} fill="currentColor" />
          </div>
          <h1>
            {mode === "login"
              ? "Welcome back."
              : "Start your<br />workspace."}
          </h1>
          <p>
            {mode === "login"
              ? "Sign in to manage your buildings, rooms, and coordinators."
              : "Create your workspace and begin monitoring energy in minutes."}
          </p>
          <div className="auth-aside-line" />
          <div className="auth-aside-oauth">
            <p className="oauth-divider">Or continue with</p>
            <div className="oauth-buttons">
              <Button
                variant="outline"
                className="auth-oauth-button"
                leftIcon={<Github size={18} />}
                onClick={() => handleOAuthLogin("github")}
                disabled={isLoading}
                fullWidth
              >
                GitHub
              </Button>
              <Button
                variant="outline"
                className="auth-oauth-button"
                leftIcon={<Chrome size={18} />}
                onClick={() => handleOAuthLogin("google")}
                disabled={isLoading}
                fullWidth
              >
                Google
              </Button>
            </div>
          </div>
        </div>

        <Card className="auth-form-card" variant="elevated">
          <CardBody>
            <form onSubmit={handleSubmit} className="auth-form">
              <h2>{mode === "login" ? "Sign in to your account" : "Create your workspace"}</h2>
              <p className="form-intro">
                {mode === "login"
                  ? "Use your email or username and password to access your dashboard."
                  : "Enter your details to get started with WattWise."}
              </p>

              {error && (
                <div className="ds-field__error" role="alert" style={{ marginBottom: 16 }}>
                  {error}
                </div>
              )}

              {mode === "signup" && (
                <>
                  <Input
                    label="Full name"
                    placeholder="John Doe"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                    icon={<User size={16} />}
                  />
                  <Input
                    label="Workspace name"
                    placeholder="Acme Corporation"
                    value={workspaceName}
                    onChange={(e) => setWorkspaceName(e.target.value)}
                    required
                    icon={<Building2 size={16} />}
                    hint="This will be your organization's display name"
                  />
                  <Input
                    label="Username"
                    placeholder="juan"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    icon={<User size={16} />}
                    autoComplete="username"
                    hint="Used in your campus link: /mcs/username/campus"
                  />
                </>
              )}

              <Input
                label={mode === "login" ? "Email or username" : "Email"}
                type={mode === "login" ? "text" : "email"}
                placeholder={mode === "login" ? "you@example.com or username" : "you@example.com"}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                icon={<Mail size={16} />}
                autoComplete={mode === "login" ? "username" : "email"}
              />

              <Input
                label="Password"
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                icon={<Lock size={16} />}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                rightIcon={
                  <button
                    type="button"
                    className="auth-password-toggle"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                }
              />

              {mode === "signup" && (
                <Input
                  label="Confirm password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  icon={<Lock size={16} />}
                  autoComplete="new-password"
                />
              )}

              <Button
                type="submit"
                variant="primary"
                fullWidth
                size="lg"
                loading={isLoading}
                rightIcon={<ArrowRight size={16} />}
              >
                {mode === "login" ? "Sign in" : "Continue to onboarding"}
              </Button>

              <p className="auth-switch">
                {mode === "login" ? "Don't have an account?" : "Already have an account?"}{" "}
                <button
                  type="button"
                  className="auth-switch-link"
                  onClick={switchMode}
                >
                  {mode === "login" ? "Sign up" : "Sign in"}
                </button>
              </p>
            </form>
          </CardBody>
        </Card>
      </section>

      <PageFooter
        showPrivacy
        showContact
        contactEmail="cshswattwise@gmail.com"
        onPrivacyClick={() => window.dispatchEvent(new CustomEvent("open-privacy"))}
      />
    </main>
  );
}