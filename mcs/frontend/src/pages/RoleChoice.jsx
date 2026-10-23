import { ArrowRight, History, ShieldCheck, Users } from "lucide-react";
import { useTheme } from "../hooks/useTheme";
import { Topbar } from "../components/ui/Topbar";
import { ThemeToggle } from "../components/ui/ThemeToggle";
import { PageFooter } from "../components/ui/PageFooter";
import { RoleCard } from "../components/ui/RoleCard";
import { BuildingIllustration } from "../components/landing/BuildingIllustration";

export function RoleChoice() {
  const { darkMode, toggleTheme } = useTheme();

  return (
    <main className="role-page access-page">
      <Topbar
        subtitle="WATTWISE ACCESS HUB"
        right={<ThemeToggle darkMode={darkMode} onToggle={toggleTheme} />}
      />

      <section className="access-hero access-hero--hub">
        <div className="access-intro">
          <div className="eyebrow">
            <span className="eyebrow-dot" /> SELECT ACCESS
          </div>
          <h1>
            Choose your
            <br />
            <em>console.</em>
          </h1>
          <p>
            Owners manage the campus and its coordinators. EMCs report appliance
            activity for the single room assigned to them.
          </p>

          <div className="access-route" aria-label="Access model">
            <span>
              <b>01</b> Owner workspace
            </span>
            <span className="access-route-arrow">
              <ArrowRight size={14} />
            </span>
            <span>
              <b>02</b> EMC room
            </span>
          </div>

          <div className="access-trust">
            <span>
              <ShieldCheck size={15} />
              Room-scoped access
            </span>
            <span>
              <History size={15} />
              Report history preserved
            </span>
            <span>
              <Users size={15} />
              Two distinct roles
            </span>
          </div>
        </div>

        <aside className="access-map" aria-label="Workspace access model">
          <div className="access-map-head">
            <span>ACCESS MODEL</span>
            <span>WATTWISE / 01</span>
          </div>

          <div className="access-map-art" aria-hidden="true">
            <BuildingIllustration />
          </div>

          <div className="access-map-row">
            <span className="access-map-icon">
              <ShieldCheck size={17} />
            </span>
            <span className="access-map-copy">
              <strong>Owner</strong>
              <small>Buildings, rooms, EMCs, reports</small>
            </span>
            <span className="access-map-tag">FULL</span>
          </div>
          <div className="access-map-row">
            <span className="access-map-icon">
              <Users size={17} />
            </span>
            <span className="access-map-copy">
              <strong>EMC</strong>
              <small>One assigned room and its appliances</small>
            </span>
            <span className="access-map-tag">SCOPED</span>
          </div>
        </aside>
      </section>

      <div className="access-section-head">
        <span className="ww-eyebrow">Access portals</span>
        <p>Select the console that matches your account.</p>
      </div>

      <section
        className="role-grid access-grid"
        aria-label="Choose your access portal"
      >
        <RoleCard
          title="Owner console"
          description="Structure the workspace, maintain appliances, manage EMC access, and review reported activity."
          icon={<ShieldCheck size={21} />}
          eyebrow="FOR WORKSPACE OWNERS"
          href="/admin"
          tone="owner"
          details={[
            "Buildings, floors, and rooms",
            "Appliance catalog and reports",
            "EMC access management",
          ]}
          cta="Sign in as owner"
        />
        <RoleCard
          title="EMC workspace"
          description="Open your assigned room, submit reported ON/OFF status, and review the activity you have reported."
          icon={<Users size={21} />}
          eyebrow="FOR ENERGY MANAGEMENT COORDINATORS"
          href="/user"
          details={[
            "One assigned room",
            "Reported ON/OFF status",
            "Your reporting history",
          ]}
          cta="Sign in as EMC"
        />
      </section>

      <p className="access-note">
        Access follows your role. Owners manage the workspace and its EMC
        accounts; each EMC account is limited to its assigned room.
      </p>

      <PageFooter
        showPrivacy
        onPrivacyClick={() => window.dispatchEvent(new CustomEvent("open-privacy"))}
      />
    </main>
  );
}
