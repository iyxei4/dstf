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
      <section className="role-intro">
        <div className="eyebrow">
          <span className="eyebrow-dot" /> CLASSROOM ENERGY, IN FOCUS
        </div>
        <h1>
          Every room has
          <br />a <em>power story.</em>
        </h1>
        <p>
          Choose your workspace to track classroom electricity use and make
          every kilowatt-hour count.
        </p>
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
      <PageFooter
        showPrivacy
        onPrivacyClick={() => window.dispatchEvent(new CustomEvent("open-privacy"))}
      />
    </main>
  );
}