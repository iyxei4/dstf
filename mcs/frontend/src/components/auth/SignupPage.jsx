import { useState, useEffect } from "react";
import { ArrowLeft, ArrowRight, UserPlus, Check, Github, Chrome } from "lucide-react";
import { request } from "../../utils/api";
import { groupSectionsByGrade } from "../../utils/formatters";
import { Topbar } from "../ui/Topbar";
import { ThemeToggle } from "../ui/ThemeToggle";
import { Notice } from "../ui/Notice";
import { useTheme } from "../../hooks/useTheme";

export function SignupPage({ onBack }) {
  const { darkMode, toggleTheme } = useTheme();
  const [sections, setSections] = useState([]);
  const [sectionId, setSectionId] = useState("");
  const [signupUsername, setSignupUsername] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(null);

  useEffect(() => {
    request("/sections")
      .then((data) => {
        setSections(data);
        setSectionId((current) => current || String(data[0]?.id || ""));
      })
      .catch((error) => setNotice(error.message));
  }, []);

  async function register(event) {
    event.preventDefault();
    setNotice("");
    if (signupPassword !== confirmPassword) {
      setNotice("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const result = await request("/users/register", {
        method: "POST",
        body: JSON.stringify({
          username: signupUsername,
          password: signupPassword,
          section_id: Number(sectionId),
        }),
      });
      setCreated(result);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  const signupTopbar = (
    <Topbar
      subtitle="USER REGISTRATION"
      right={
        <>
          <ThemeToggle darkMode={darkMode} onToggle={toggleTheme} />
          <a className="topbar-link" href="/">
            <ArrowLeft size={15} /> All workspaces
          </a>
        </>
      }
    />
  );

  if (created) {
    return (
      <main className="auth-page animate-in">
        {signupTopbar}
        <section className="auth-layout">
          <div className="auth-aside">
            <span className="auth-aside-number">02 / SIGNUP</span>
            <div className="auth-aside-mark">
              <UserPlus size={30} />
            </div>
            <h1>
              One step
              <br />
              to go.
            </h1>
            <p>Every new account is reviewed by an administrator first.</p>
            <div className="auth-aside-line" />
          </div>
          <div className="auth-form signup-success animate-in">
            <span className="signup-check">
              <Check size={28} />
            </span>
            <div className="eyebrow">ACCOUNT REQUESTED</div>
            <h2>Almost there, {created.username}.</h2>
            <p className="form-intro">
              Your account for <strong>{created.section?.name}</strong> is
              waiting for administrator approval. You can sign in as soon as it
              is approved.
            </p>
            <a className="button button-primary button-wide" href="/user">
              <ArrowLeft size={16} /> Back to sign in
            </a>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-page animate-in">
      {signupTopbar}
      <section className="auth-layout">
        <div className="auth-aside">
          <span className="auth-aside-number">02 / SIGNUP</span>
          <div className="auth-aside-mark">
            <UserPlus size={30} />
          </div>
          <h1>
            Join your
            <br />
            classroom.
          </h1>
          <p>
            Register once, pick your section, and an administrator opens the
            door.
          </p>
          <div className="auth-aside-line" />
        </div>
        <form className="auth-form animate-in" onSubmit={register}>
          <div className="eyebrow">NEW ACCOUNT</div>
          <h2>Create your account</h2>
          <p className="form-intro">
            Choose your classroom section and a username. Your administrator
            approves the account before you can sign in.
          </p>
          <label className="field-label">
            Classroom section
            <select
              value={sectionId}
              onChange={(event) => setSectionId(event.target.value)}
              required
            >
              {sections.length ? (
                groupSectionsByGrade(sections).map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.items.map((section) => (
                      <option key={section.id} value={section.id}>
                        {section.name}
                      </option>
                    ))}
                  </optgroup>
                ))
              ) : (
                <option value="">No sections available</option>
              )}
            </select>
          </label>
          <label className="field-label">
            Account name
            <input
              autoComplete="username"
              value={signupUsername}
              onChange={(event) => setSignupUsername(event.target.value)}
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
              autoComplete="new-password"
              value={signupPassword}
              onChange={(event) => setSignupPassword(event.target.value)}
              placeholder="At least 8 characters"
              required
              minLength={8}
            />
          </label>
          <label className="field-label">
            Confirm password
            <input
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
              minLength={8}
            />
          </label>
          <div className="oauth-divider">
            <span>or sign up with</span>
          </div>
          <div className="oauth-buttons">
            <a
              className="oauth-button"
              href="/api/auth/google/login"
              title="Sign up with Google"
            >
              <Chrome size={18} />
              <span>Google</span>
            </a>
            <a
              className="oauth-button"
              href="/api/auth/github/login"
              title="Sign up with GitHub"
            >
              <Github size={18} />
              <span>GitHub</span>
            </a>
          </div>
          <Notice>{notice}</Notice>
          <button
            className="button button-primary button-wide"
            disabled={busy || !sections.length}
          >
            {busy ? "Creating account..." : "Request approval"}
            <ArrowRight size={16} />
          </button>
          <p className="auth-footnote">
            Already have an account? <a href="#" onClick={(e) => { e.preventDefault(); onBack?.(); }}>Sign in instead</a>.
          </p>
        </form>
      </section>
    </main>
  );
}