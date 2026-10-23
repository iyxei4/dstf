import { Link } from "react-router-dom";
import { ArrowRight, AlertTriangle } from "lucide-react";
import { Topbar } from "../components/ui/Topbar";
import { ThemeToggle } from "../components/ui/ThemeToggle";
import { PageFooter } from "../components/ui/PageFooter";
import { useTheme } from "../hooks/useTheme";

export function ServerErrorPage() {
  const { darkMode, toggleTheme } = useTheme();

  return (
    <main className="lp-page lp-error-page">
      <Topbar
        right={<ThemeToggle darkMode={darkMode} onToggle={toggleTheme} />}
      />
      <section className="lp-error-section">
        <div className="lp-error-content">
          <div className="lp-error-icon lp-error-icon-warn">
            <AlertTriangle size={48} />
          </div>
          <h1 className="lp-error-title">503</h1>
          <p className="lp-error-desc">
            The server is temporarily unable to handle the request. Please try
            again shortly.
          </p>
          <Link to="/" className="lp-button lp-button-primary lp-button-large">
            <ArrowRight size={18} /> Return to homepage
          </Link>
        </div>
      </section>
      <PageFooter showPrivacy />
    </main>
  );
}
