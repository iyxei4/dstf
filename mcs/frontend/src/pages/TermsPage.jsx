import { Link } from "react-router-dom";
import { ArrowRight, FileText } from "lucide-react";
import { Topbar } from "../components/ui/Topbar";
import { ThemeToggle } from "../components/ui/ThemeToggle";
import { PageFooter } from "../components/ui/PageFooter";
import { useTheme } from "../hooks/useTheme";

export function TermsPage() {
  const { darkMode, toggleTheme } = useTheme();

  return (
    <main className="lp-page lp-terms-page">
      <Topbar
        right={<ThemeToggle darkMode={darkMode} onToggle={toggleTheme} />}
      />
      <section className="lp-terms-section">
        <div className="lp-container lp-terms-container">
          <div className="lp-terms-header">
            <div className="lp-terms-icon">
              <FileText size={24} />
            </div>
            <h1 className="lp-terms-title">Terms &amp; Conditions</h1>
            <Link to="/" className="lp-button lp-button-secondary">
              <ArrowRight size={16} /> Back to homepage
            </Link>
          </div>
          <div className="lp-terms-body">
            <h2>1. Acceptance of Terms</h2>
            <p>
              By accessing and using WattWise Classrooms, you accept these
              terms and conditions in full. If you disagree with any part of
              these terms, do not use the application.
            </p>

            <h2>2. Use of the Application</h2>
            <p>
              WattWise Classrooms is a user-reported, room-based appliance
              status reporting and analytics system. You may use the
              application to log appliance ON/OFF status and runtime for rooms
              to which you have been assigned by an administrator.
            </p>

            <h2>3. Estimates, Not Measurements</h2>
            <p>
              All figures displayed are estimates based on user-reported
              appliance status and runtime. They are not meter readings, not
              live sensor data, and not guaranteed to be accurate. WattWise
              makes no representations or warranties regarding the accuracy or
              completeness of any estimate.
            </p>

            <h2>4. Data and Privacy</h2>
            <p>
              We only collect data necessary for room-scoped energy reporting:
              room assignments, appliance names and wattages, report
              timestamps, and submission metadata. We do not use third-party
              analytics or tracking scripts. Session cookies are used solely
              for authentication and expire after 8 hours.
            </p>
            <p>
              For inquiries or data requests, contact
              <a href="mailto:cshswattwise@gmail.com">cshswattwise@gmail.com</a>.
            </p>

            <h2>5. Conduct</h2>
            <p>
              You agree not to submit false or misleading reports, attempt to
              access rooms or data you are not authorized to view, or
              interfere with the operation of the application.
            </p>

            <h2>6. Limitation of Liability</h2>
            <p>
              To the fullest extent permitted by law, WattWise Classrooms and
              its operators are not liable for any indirect, incidental,
              special, consequential, or punitive damages arising out of or
              relating to your use of or inability to use the application.
            </p>

            <h2>7. Changes to These Terms</h2>
            <p>
              We may update these terms from time to time. Continued use of
              the application after changes are posted constitutes acceptance
              of the revised terms.
            </p>

            <h2>8. Governing Law</h2>
            <p>
              These terms are governed by the laws of the jurisdiction in
              which the facility is located, without regard to conflict of law
              principles.
            </p>
          </div>
        </div>
      </section>
      <PageFooter showPrivacy />
    </main>
  );
}
