import { useState } from "react";
import {
  Building2,
  Users,
  ClipboardList,
  Activity,
  LogOut,
  ShieldCheck,
  Menu,
  Settings,
  Bell,
  Zap,
  X,
} from "lucide-react";
import { Topbar } from "../components/ui/Topbar";
import { ThemeToggle } from "../components/ui/ThemeToggle";
import { PageFooter } from "../components/ui/PageFooter";
import { useTheme } from "../hooks/useTheme";
import { request } from "../utils/api";
import { useWorkspace } from "../hooks/useWorkspace";
import { Notice } from "../components/ui/Notice";

export function AdminDashboard() {
  const { darkMode, toggleTheme } = useTheme();
  const { currentWorkspace } = useWorkspace();
  const [notice] = useState("");
  const [navOpen, setNavOpen] = useState(false);
  const [selectedTab, setSelectedTab] = useState("overview");

  const navItems = [
    { key: "overview", label: "Overview", icon: Activity },
    { key: "users", label: "All Users", icon: Users },
    { key: "buildings", label: "Buildings & Rooms", icon: Building2 },
    { key: "appliances", label: "Appliances", icon: Zap },
    { key: "emcs", label: "EMC Accounts", icon: Users },
    { key: "reports", label: "Reports", icon: ClipboardList },
    { key: "notifications", label: "Notifications", icon: Bell },
    { key: "settings", label: "Settings", icon: Settings },
  ];

  const handleSignOut = async () => {
    await request("/admin/logout", { method: "POST" });
    localStorage.removeItem("wattwise-admin-session");
    window.dispatchEvent(new CustomEvent("wattwise-admin-signout"));
    setNavOpen(false);
  };

  const renderNav = () => (
    <nav className={`admin-nav${navOpen ? " is-open" : ""}`} aria-label="Admin sections">
      <div className="nav-heading">
        <span className="nav-label">ADMINISTRATOR</span>
        <button
          type="button"
          className="icon-button nav-close"
          onClick={() => setNavOpen(false)}
          title="Close menu"
          aria-label="Close menu"
        >
          <X size={16} />
        </button>
      </div>
      {navItems.map((item) => (
        <button
          key={item.key}
          className={`nav-link${selectedTab === item.key ? " active" : ""}`}
          onClick={() => setSelectedTab(item.key)}
        >
          <item.icon size={16} />
          <span>{item.label}</span>
        </button>
      ))}
      <div className="nav-bottom">
        <span className="nav-admin-icon">
          <ShieldCheck size={16} />
        </span>
        <span>
          <strong>{currentWorkspace?.name || "All Workspaces"}</strong>
          <small>Platform Administrator</small>
        </span>
      </div>
    </nav>
  );

  return (
    <main className="admin-page">
      <Topbar
        subtitle="PLATFORM ADMIN"
        right={
          <>
            <ThemeToggle darkMode={darkMode} onToggle={toggleTheme} />
            <button
              type="button"
              className="icon-button nav-toggle"
              onClick={() => setNavOpen((open) => !open)}
              title="Toggle navigation"
              aria-label="Toggle navigation menu"
              aria-expanded={navOpen}
            >
              <Menu size={17} />
            </button>
            <button className="topbar-link signout-link" onClick={handleSignOut}>
              <LogOut size={15} /> Sign out
            </button>
          </>
        }
      />
      {navOpen && (
        <div className="nav-scrim" onClick={() => setNavOpen(false)} />
      )}
      <section className="admin-main">
        <div className="admin-header">
          <h1>Platform Administration</h1>
          <p>Manage all workspaces, users, and platform settings.</p>
        </div>
        <nav className="admin-sidebar" aria-label="Admin navigation">
          {renderNav()}
        </nav>
        <section className="admin-content">
          <Notice>{notice}</Notice>
          <div className="admin-tab-content">
            {selectedTab === "overview" && (
              <div className="panel">
                <h2>Platform Overview</h2>
                <p>Welcome, administrator. Monitor all workspaces and users.</p>
              </div>
            )}
            {selectedTab === "users" && (
              <div className="panel">
                <h2>All Users</h2>
                <p>View and manage all registered users across workspaces.</p>
              </div>
            )}
            {selectedTab === "buildings" && (
              <div className="panel">
                <h2>Buildings & Rooms</h2>
                <p>View and manage all buildings and rooms across workspaces.</p>
              </div>
            )}
            {selectedTab === "appliances" && (
              <div className="panel">
                <h2>Appliances</h2>
                <p>Manage the appliance catalog for the platform.</p>
              </div>
            )}
            {selectedTab === "emcs" && (
              <div className="panel">
                <h2>EMC Accounts</h2>
                <p>View and manage all EMC accounts across workspaces.</p>
              </div>
            )}
            {selectedTab === "reports" && (
              <div className="panel">
                <h2>Reports</h2>
                <p>View platform-wide reports and analytics.</p>
              </div>
            )}
            {selectedTab === "notifications" && (
              <div className="panel">
                <h2>Notifications</h2>
                <p>Manage platform notifications and alerts.</p>
              </div>
            )}
            {selectedTab === "settings" && (
              <div className="panel">
                <h2>Settings</h2>
                <p>Platform configuration and settings.</p>
              </div>
            )}
          </div>
        </section>
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