import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Mail,
  Lock,
  User,
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

export function AuthLandingPage({ initialMode = "login" }) {
  const { darkMode, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [mode, setMode] = useState(initialMode); // 'login' | 'signup'
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState("idle");

  // Form state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [campusName, setCampusName] = useState("");
  const [username, setUsername] = useState("");

  useEffect(() => {
    setMode(initialMode);
    setError("");
  }, [initialMode]);

  useEffect(() => {
    if (mode !== "signup") {
      setUsernameStatus("idle");
      return undefined;
    }

    const value = username.trim();
    if (!value) {
      setUsernameStatus("idle");
      return undefined;
    }
    if (!/^[A-Za-z0-9._-]+$/.test(value)) {
      setUsernameStatus("invalid");
      return undefined;
    }

    setUsernameStatus("checking");
    let cancelled = false;
    const timer = setTimeout(() => {
      request(`/users/username-available?username=${encodeURIComponent(value)}`)
        .then((data) => {
          if (!cancelled) {
            setUsernameStatus(data.available ? "available" : "taken");
          }
        })
        .catch(() => {
          if (!cancelled) setUsernameStatus("idle");
        });
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mode, username]);

  const validateForm = () => {
    if (mode === "login") {
      if (!email.trim()) return "Email or username is required";
      if (!password) return "Password is required";
    } else {
      if (!username.trim()) return "Username is required";
      if (!/^[A-Za-z0-9._-]+$/.test(username.trim())) {
        return "Username can only use letters, numbers, dots, dashes, and underscores";
      }
      if (usernameStatus === "taken") return "That username is already taken";
      if (!campusName.trim()) return "Campus name is required";
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
          navigate("/mcs/admin/dashboard");
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
        // Create a regular user account with campus name
        const data = await request("/users/register-user", {
          method: "POST",
          body: JSON.stringify({
            username: username.trim(),
            campus_name: campusName.trim(),
            email,
            password,
          }),
        });
        setError(data.message || "Account created. Please sign in after administrator approval.");
        setMode("login");
        setCampusName("");
        setUsername("");
        setEmail("");
        setPassword("");
        setConfirmPassword("");
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
              : (
                <>
                  Create your
                  <br />
                  account.
                </>
              )}
          </h1>
          <p>
            {mode === "login"
              ? "Sign in to manage your buildings, rooms, and coordinators."
              : "Pick a username and campus name. An admin will approve your access."}
          </p>
          <div className="auth-aside-line" />
        </div>

        <Card className="auth-form-card" variant="elevated">
          <CardBody>
            <form onSubmit={handleSubmit} className="auth-form">
              <h2>{mode === "login" ? "Sign in to your account" : "Create your workspace"}</h2>
              <p className="form-intro">
                {mode === "login"
                  ? "Use your email or username and password to access your dashboard."
                  : "Create your account with a username and campus name. An administrator must approve it before you can sign in."}
              </p>

              {error && (
                <div className="ds-field__error" role="alert" style={{ marginBottom: 16 }}>
                  {error}
                </div>
              )}

              {mode === "signup" && (
                <>
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
                  <Input
                    label="Campus name"
                    placeholder="CSHS"
                    value={campusName}
                    onChange={(e) => setCampusName(e.target.value)}
                    required
                    icon={<Building2 size={16} />}
                    hint="Your campus/organization name (used in URL as slug)"
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
                {mode === "login" ? "Sign in" : "Create account"}
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