import { Users, Bolt, ShieldCheck, Activity, ArrowLeft } from "lucide-react";
import { useTheme } from "../../hooks/useTheme";
import { Topbar } from "../ui/Topbar";
import { ThemeToggle } from "../ui/ThemeToggle";
import { PageFooter } from "../ui/PageFooter";
import { getTodayLabel } from "../../utils/formatters";

export function AboutPage() {
  const { darkMode, toggleTheme } = useTheme();
  const todayLabel = getTodayLabel();

  const sections = [
    {
      icon: <Users size={18} />,
      title: "Role chooser · /",
      body: "Pick your workspace: a teacher/staff account or the admin console. The landing page also shows the estimate disclaimer and a link back here.",
    },
    {
      icon: <Bolt size={18} />,
      title: "User workspace · /user",
      body: "Sign in with credentials issued by an admin, then log classroom electricity use in two ways: start the ON/OFF timer for live tracking, or open Custom time to backfill hours you forgot to record. Every appliance shows its live kWh estimate, and your submissions list recent entries with estimated cost.",
    },
    {
      icon: <ShieldCheck size={18} />,
      title: "Admin console · /admin",
      body: "Review the six-month consumption dashboard, compare rooms across three buildings, issue or reset user credentials, assign rooms and classroom sections, and maintain the appliance catalog. Rooms that exceed 1.5× their building's per-room average are flagged as high-use.",
    },
    {
      icon: <Activity size={18} />,
      title: "Energy math",
      body: "Individual device: E = P × t ÷ 1000 (watts × hours ÷ 1000 = kWh). Multiple devices: E_total = Σ (Pᵢ × tᵢ) ÷ 1000 — the sum of each device's own kWh. Bills are kWh × the configured electricity rate. Values are estimates, not meter readings.",
    },
  ];

  const demoSteps = [
    "Open / and choose User workspace.",
    "Sign in with the credentials your administrator issued (an admin creates them under User activity).",
    "Pick an appliance in the log and press ON — the timer starts and the estimated kWh ticks up live.",
    "Press OFF to save the session; the record lands in Recent submissions with kWh and cost.",
    "Forgot to start the timer? Press Custom time, choose the appliance, type the hours you missed, review the E = P × t ÷ 1000 preview, and hit Submit record.",
    "Sign out, open /admin, and sign in as admin to see the same data on the dashboard, room map, and monthly reports.",
  ];

  return (
    <main className="workspace-page about-page animate-in">
      <Topbar
        subtitle="ABOUT WATTWISE"
        right={
          <>
            <ThemeToggle darkMode={darkMode} onToggle={toggleTheme} />
            <a className="topbar-link" href="/">
              <ArrowLeft size={15} /> Back to start
            </a>
          </>
        }
      />
      <section className="workspace-heading">
        <div>
          <div className="eyebrow">
            <span className="eyebrow-dot" /> ENERGY MONITORING SYSTEM
          </div>
          <h1>
            About <em>WattWise.</em>
          </h1>
          <p>
            WattWise Classrooms is a web app based on react that tracks, estimate, and manage classroom
            electricity use without smart-meter hardware. Teachers log
            appliance run time; the app estimates consumption and cost;
            administrators see the school-wide picture.
          </p>
        </div>
        <span className="date-stamp">{todayLabel}</span>
      </section>

      <section className="about-grid">
        {sections.map((item) => (
          <article className="about-card animate-in" key={item.title}>
            <span className="about-card-icon">{item.icon}</span>
            <h2>{item.title}</h2>
            <p>{item.body}</p>
          </article>
        ))}
      </section>

      <section className="panel about-demo animate-in">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">TRY THE DEMO</span>
            <h2>Walk through a full cycle</h2>
          </div>
        </div>
        <ol className="about-steps">
          {demoSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <div className="about-demo-actions">
          <a className="button button-primary" href="/user">
            <Bolt size={15} /> Open user workspace
          </a>
          <a className="button button-outline" href="/admin">
            <ShieldCheck size={15} /> Open admin console
          </a>
        </div>
      </section>

      <PageFooter
        showPrivacy
        onPrivacyClick={() => window.dispatchEvent(new CustomEvent("open-privacy"))}
      />
    </main>
  );
}