import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Lock,
  ArrowRight,
  Eye,
  EyeOff,
  User,
  Shield,
} from "lucide-react";
import { Topbar } from "../components/ui/Topbar";
import { ThemeToggle } from "../components/ui/ThemeToggle";
import { PageFooter } from "../components/ui/PageFooter";
import { useTheme } from "../hooks/useTheme";
import { Button, Input, Card, CardBody } from "../components/design";
import { request } from "../utils/api";

export function AdminSignInPage() {
  const { darkMode, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const validateForm = () => {
    if (!username.trim()) return "Username is required";
    if (!password) return "Password is required";
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
      await request("/admin/login", {
        method: "POST",
        body: JSON.stringify({ username: username.trim(), password }),
      });
      localStorage.setItem("wattwise-admin-session", "true");
      navigate("/mcs/admin/dashboard", { replace: true });
    } catch (err) {
      setError(err.message || "Invalid credentials. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="auth-page">
      <Topbar
        subtitle="ADMIN SIGN IN"
        right={
          <>
            <ThemeToggle darkMode={darkMode} onToggle={toggleTheme} />
          </>
        }
      />

      <section className="auth-layout auth-landing">
        <div className="auth-aside">
          <span className="auth-aside-number">
            01 / ADMIN
          </span>
          <div className="auth-aside-mark">
            <Shield size={30} fill="currentColor" />
          </div>
          <h1>
            Administrator access.
          </h1>
          <p>
            Sign in to manage campus settings, users, and appliances.
          </p>
          <div className="auth-aside-line" />
        </div>

        <Card className="auth-form-card" variant="elevated">
          <CardBody>
            <form onSubmit={handleSubmit} className="auth-form">
              <h2>Sign in to admin panel</h2>
              <p className="form-intro">
                Use your administrator credentials to access the management dashboard.
              </p>

              {error && (
                <div className="ds-field__error" role="alert" style={{ marginBottom: 16 }}>
                  {error}
                </div>
              )}

              <Input
                label="Username"
                placeholder="admin"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                icon={<User size={16} />}
                autoComplete="username"
              />

              <Input
                label="Password"
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                icon={<Lock size={16} />}
                autoComplete="current-password"
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

              <Button
                type="submit"
                variant="primary"
                fullWidth
                size="lg"
                loading={isLoading}
                rightIcon={<ArrowRight size={16} />}
              >
                Sign in
              </Button>
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