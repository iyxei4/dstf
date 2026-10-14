import { Users, ShieldCheck } from "lucide-react";
import { useTheme } from "../hooks/useTheme";
import { Topbar } from "../components/ui/Topbar";
import { ThemeToggle } from "../components/ui/ThemeToggle";
import { PageFooter } from "../components/ui/PageFooter";
import { RoleCard } from "../components/ui/RoleCard";

export function RoleChoice() {
  const { darkMode, toggleTheme } = useTheme();

  return (
    <main className="role-page animate-in">
      <Topbar
        subtitle="POWER CONSUMPTION MONITOR"
        right={<ThemeToggle darkMode={darkMode} onToggle={toggleTheme} />}
      />
      <section className="role-hero">
        <div className="role-intro">
          <div className="eyebrow">
            <span className="eyebrow-dot" /> CLASSROOM ENERGY, IN FOCUS
          </div>
          <h1>
            Make every energy
            <br />
            <em>count.</em>
          </h1>
          <p>
            Choose your workspace to track classroom electricity use, log
            appliances, and see where every kilowatt-hour goes.
          </p>
        </div>
        <div className="role-visual" aria-hidden="true">
          <div className="role-visual-head">
            <span className="eyebrow">TYPICAL CLASSROOM DAY</span>
            <span className="visual-tag">kWh</span>
          </div>
          <svg className="visual-chart" viewBox="0 0 440 190" role="presentation">
            <defs>
              <linearGradient id="hero-area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="var(--green)" stopOpacity="0.26" />
                <stop offset="1" stopColor="var(--green)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <g className="chart-grid">
              <line x1="0" y1="40" x2="440" y2="40" />
              <line x1="0" y1="85" x2="440" y2="85" />
              <line x1="0" y1="130" x2="440" y2="130" />
              <line x1="0" y1="175" x2="440" y2="175" />
            </g>
            <path
              className="chart-area"
              d="M0,150 L55,132 L110,96 L165,104 L220,64 L275,44 L330,82 L385,116 L440,138 L440,175 L0,175 Z"
            />
            <path
              className="chart-line"
              pathLength="1000"
              d="M0,150 L55,132 L110,96 L165,104 L220,64 L275,44 L330,82 L385,116 L440,138"
            />
            <circle className="chart-tip" cx="440" cy="138" r="4.5" />
          </svg>
          <div className="visual-axis">
            <span>7A</span>
            <span>9A</span>
            <span>11A</span>
            <span>1P</span>
            <span>3P</span>
            <span>5P</span>
            <span>7P</span>
          </div>
          <div className="visual-foot">
            <span>ESTIMATE MODEL</span>
            <span>watts × hours ÷ 1000</span>
          </div>
        </div>
      </section>
      <section className="role-grid" aria-label="Choose your workspace">
        <RoleCard
          title="User workspace"
          description="Log appliance run time, record classroom activity, and see your energy estimates."
          icon={<Users size={20} />}
          eyebrow="FOR TEACHERS & STAFF"
          href="/mcs/user"
        />
        <RoleCard
          title="Admin console"
          description="Review submissions, compare classroom usage, and maintain the appliance catalog."
          icon={<ShieldCheck size={20} />}
          eyebrow="FOR SYSTEM MANAGERS"
          href="/mcs/admin"
          color="admin"
        />
      </section>
      <section className="role-about">
        <span className="eyebrow">ABOUT WATTWISE</span>
        <p>
          WattWise Classrooms turns appliance run time into estimated energy
          use — watts × hours ÷ 1000 — so teachers can log what they switch on
          and managers can see which rooms use the most. All figures are
          estimates, not meter readings.
        </p>
      </section>
      <PageFooter
        showPrivacy
        onPrivacyClick={() => window.dispatchEvent(new CustomEvent("open-privacy"))}
      />
    </main>
  );
}