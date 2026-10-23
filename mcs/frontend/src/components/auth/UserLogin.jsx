import { useState } from "react";
import { ArrowLeft, Zap, ArrowRight, Github, Chrome } from "lucide-react";
import { request } from "../../utils/api";
import { Topbar } from "../ui/Topbar";
import { ThemeToggle } from "../ui/ThemeToggle";
import { Notice } from "../ui/Notice";
import { useTheme } from "../../hooks/useTheme";

export function UserLogin({ onSignIn, onSignup }) {
  const { darkMode, toggleTheme } = useTheme();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function signIn(event) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      const account = await request("/users/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      localStorage.setItem("wattwise-user", account.username);
      onSignIn(account);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page animate-in">
      <Topbar
        subtitle="USER ACCESS"
        right={
          <>
            <ThemeToggle darkMode={darkMode} onToggle={toggleTheme} />
            <a className="topbar-link" href="/">
              <ArrowLeft size={15} /> All workspaces
            </a>
          </>
        }
      />
      <section className="auth-layout">
        <div className="auth-aside">
          <span className="auth-aside-number">01 / @MCS</span>
          <div className="auth-aside-mark">
            <Zap size={30} fill="currentColor" />
          </div>
          <h1>
            Make your
            <br />
            room count.
          </h1>
          <p>Record what your classroom uses. Make every energy count.</p>
          <div className="auth-aside-line" />
        </div>
        <form className="auth-form animate-in" onSubmit={signIn}>
          <h2>Welcome!</h2>
          <p className="form-intro">
            Use the username and password provided by your administrator.
          </p>
          <label className="field-label">
            Account name
            <input
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="e.g. maria.santos"
              required
              minLength={2}
              maxLength={80}
            />
          </label>
          <label className="field-label">
            Password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          <div className="oauth-divider">
            <span>or continue with</span>
          </div>
          <div className="oauth-buttons">
            <a
              className="oauth-button"
              href="/api/auth/google/login"
              title="Sign in with Google"
            >
              <Chrome size={18} />
              <span>Google</span>
            </a>
            <a
              className="oauth-button"
              href="/api/auth/github/login"
              title="Sign in with GitHub"
            >
              <Github size={18} />
              <span>GitHub</span>
            </a>
          </div>
          <Notice>{notice}</Notice>
          <button
            className="button button-primary button-wide"
            disabled={busy}
          >
            {busy ? "Opening workspace..." : "Continue to workspace"}
            <ArrowRight size={16} />
          </button>
          <p className="auth-footnote">
            Ask your administrator to create or reset your credentials.
          </p>
          <p className="auth-alt-link">
            No account yet? <a href="#" onClick={(e) => { e.preventDefault(); onSignup?.(); }}>Register for one</a>
          </p>
        </form>
      </section>
    </main>
  );
}