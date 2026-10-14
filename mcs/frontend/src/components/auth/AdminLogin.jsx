import { useState } from "react";
import { ArrowLeft, ShieldCheck, ArrowRight } from "lucide-react";
import { request } from "../../utils/api";
import { Topbar } from "../ui/Topbar";
import { ThemeToggle } from "../ui/ThemeToggle";
import { Notice } from "../ui/Notice";
import { useTheme } from "../../hooks/useTheme";

export function AdminLogin({ onSignIn }) {
  const { darkMode, toggleTheme } = useTheme();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function signIn(event) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      const session = await request("/admin/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      localStorage.setItem("wattwise-admin-session", "true");
      onSignIn(session);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page animate-in">
      <Topbar
        subtitle="ADMIN ACCESS"
        right={
          <>
            <ThemeToggle darkMode={darkMode} onToggle={toggleTheme} />
            <a className="topbar-link" href="/mcs">
              <ArrowLeft size={15} /> All workspaces
            </a>
          </>
        }
      />
      <section className="auth-layout admin-auth-layout">
        <div className="auth-aside">
          <span className="auth-aside-number">02 / ADMIN</span>
          <div className="auth-aside-mark">
            <ShieldCheck size={30} />
          </div>
          <h1>
            See the whole
            <br />
            <em>picture.</em>
          </h1>
          <p>
            One view for classroom activity, energy estimates, and cost
            trends.
          </p>
          <div className="auth-aside-line" />
        </div>
        <form className="auth-form animate-in" onSubmit={signIn}>
          <div className="eyebrow">SYSTEM MANAGEMENT</div>
          <h2>Admin sign in</h2>
          <p className="form-intro">
            Sign in to monitor submissions and manage your classroom catalog.
          </p>
          <label className="field-label">
            Username
            <input
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
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
          <Notice>{notice}</Notice>
          <button
            className="button button-primary button-wide"
            disabled={busy}
          >
            {busy ? "Checking access..." : "Open admin console"}
            <ArrowRight size={16} />
          </button>
          <p className="auth-footnote">
            Admin credentials are configured on the API server.
          </p>
        </form>
      </section>
    </main>
  );
}