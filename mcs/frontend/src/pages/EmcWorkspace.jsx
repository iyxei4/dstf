import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  ClipboardList,
  DoorOpen,
  LogOut,
  Menu,
  ShieldCheck,
  Zap,
  X,
} from "lucide-react";
import { Topbar } from "../components/ui/Topbar";
import { ThemeToggle } from "../components/ui/ThemeToggle";
import { PageFooter } from "../components/ui/PageFooter";
import { Notice } from "../components/ui/Notice";
import { useTheme } from "../hooks/useTheme";
import { request } from "../utils/api";

const TABS = [
  { key: "overview", label: "My Room", icon: DoorOpen },
  { key: "appliances", label: "Appliances", icon: Zap },
  { key: "reports", label: "My Reports", icon: ClipboardList },
];

export function EmcWorkspace() {
  const { darkMode, toggleTheme } = useTheme();
  const [notice, setNotice] = useState("");
  const [navOpen, setNavOpen] = useState(false);
  const [selectedTab, setSelectedTab] = useState("overview");
  const [session, setSession] = useState(null);
  const [appliances, setAppliances] = useState([]);
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [sessionData, applianceData, recordData] = await Promise.all([
          request("/users/session"),
          request("/appliances"),
          request("/users/me/records"),
        ]);
        if (cancelled) return;
        setSession(sessionData);
        setAppliances(applianceData || []);
        setRecords(recordData || []);
      } catch (error) {
        if (!cancelled) setNotice(error.message || "Could not load your room.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSignOut = async () => {
    try {
      await request("/users/logout", { method: "POST" });
    } catch {
      // Signing out locally is still correct if the session already expired.
    }
    localStorage.removeItem("wattwise-user");
    window.dispatchEvent(new CustomEvent("wattwise-signout"));
    window.location.href = "/";
  };

  const room = session?.assigned_room;
  const roomLabel = room
    ? `${room.room_name || "Room"} ${room.room_number ?? ""}`.trim()
    : "No room assigned";

  const navItems = TABS;

  const renderNav = () => (
    <nav className={`admin-nav${navOpen ? " is-open" : ""}`} aria-label="EMC sections">
      <div className="nav-heading">
        <span className="nav-label">MY ASSIGNED ROOM</span>
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
          type="button"
          className={`nav-link${selectedTab === item.key ? " active" : ""}`}
          onClick={() => {
            setSelectedTab(item.key);
            setNavOpen(false);
          }}
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
          <strong>{session?.workspace_name || "Workspace"}</strong>
          <small>Energy Monitoring Coordinator</small>
        </span>
      </div>
    </nav>
  );

  return (
    <main className="admin-page">
      <Topbar
        subtitle="EMC WORKSPACE"
        right={
          <>
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
            <ThemeToggle darkMode={darkMode} onToggle={toggleTheme} />
            <button className="topbar-link signout-link" onClick={handleSignOut}>
              <LogOut size={15} /> Sign out
            </button>
          </>
        }
      />
      {navOpen && <div className="nav-scrim" onClick={() => setNavOpen(false)} />}
      <div className="admin-layout">
        <nav className="admin-sidebar" aria-label="EMC navigation">
          {renderNav()}
        </nav>
        <section className="admin-main">
          <div className="admin-heading">
            <div>
              <div className="eyebrow">
                <span className="eyebrow-dot" /> ASSIGNED ROOM
              </div>
              <h1>{roomLabel}</h1>
              {room && (
                <p>
                  {room.building_name}
                  {room.floor ? ` · Floor ${room.floor}` : ""}
                  {room.room_type ? ` · ${room.room_type}` : ""}
                </p>
              )}
            </div>
            <Link className="topbar-link" to="/mcs/user">
              <Activity size={15} /> Open reporting workspace
            </Link>
          </div>
          <Notice>{notice}</Notice>
          <div className="tab-content">
            {selectedTab === "overview" && (
              <>
                <section className="admin-metrics">
                  <article>
                    <span>
                      <span className="metric-icon green">
                        <DoorOpen size={15} />
                      </span>
                      ASSIGNED ROOM
                    </span>
                    <strong>{loading ? "—" : roomLabel}</strong>
                    <small className="metric-foot">
                      {room?.building_name || "Ask your workspace owner to assign a room"}
                    </small>
                  </article>
                  <article>
                    <span>
                      <span className="metric-icon amber">
                        <Zap size={15} />
                      </span>
                      APPLIANCES
                    </span>
                    <strong>{loading ? "—" : appliances.length}</strong>
                    <small className="metric-foot">Available to report</small>
                  </article>
                  <article>
                    <span>
                      <span className="metric-icon blue">
                        <ClipboardList size={15} />
                      </span>
                      REPORTS SUBMITTED
                    </span>
                    <strong>{loading ? "—" : records.length}</strong>
                    <small className="metric-foot">Your recent observations</small>
                  </article>
                </section>
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <span className="eyebrow">HOW IT WORKS</span>
                      <h2>Report what you observe</h2>
                    </div>
                  </div>
                  <p>
                    Reports are observations, not live sensor readings. Choose an appliance,
                    enter the hours it was used, and submit. No report means the status is
                    unknown, not off.
                  </p>
                  <Link className="topbar-link" to="/mcs/user">
                    <Activity size={15} /> Submit a report
                  </Link>
                </section>
              </>
            )}

            {selectedTab === "appliances" && (
              <section className="panel table-panel">
                <div className="panel-heading">
                  <div>
                    <span className="eyebrow">CATALOG</span>
                    <h2>Appliances</h2>
                  </div>
                  <span className="count-pill">{appliances.length} items</span>
                </div>
                {appliances.length === 0 ? (
                  <p className="empty-state">No appliances are available yet.</p>
                ) : (
                  <div className="responsive-table"><table>
                    <thead>
                      <tr>
                        <th>Appliance</th>
                        <th>Watts</th>
                        <th>Units</th>
                        <th>Connected load</th>
                      </tr>
                    </thead>
                    <tbody>
                      {appliances.map((item) => (
                        <tr key={item.id}>
                          <td>{item.name}</td>
                          <td>{item.wattage}</td>
                          <td>{item.quantity}</td>
                          <td>{item.connected_watts} W</td>
                        </tr>
                      ))}
                    </tbody>
                  </table></div>
                )}
              </section>
            )}

            {selectedTab === "reports" && (
              <section className="panel table-panel">
                <div className="panel-heading">
                  <div>
                    <span className="eyebrow">HISTORY</span>
                    <h2>My recent reports</h2>
                  </div>
                  <span className="count-pill">{records.length} entries</span>
                </div>
                {records.length === 0 ? (
                  <p className="empty-state">No reports submitted yet.</p>
                ) : (
                  <div className="responsive-table"><table>
                    <thead>
                      <tr>
                        <th>Appliance</th>
                        <th>Hours</th>
                        <th>Energy</th>
                        <th>Submitted</th>
                      </tr>
                    </thead>
                    <tbody>
                      {records.slice(0, 50).map((record) => (
                        <tr key={record.id}>
                          <td>{record.appliance || "—"}</td>
                          <td>{Number(record.hours).toFixed(4)}</td>
                          <td>{record.energy_kwh} kWh</td>
                          <td>
                            {record.created_at
                              ? new Date(`${record.created_at}Z`).toLocaleString("en-PH")
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table></div>
                )}
              </section>
            )}
          </div>
        </section>
      </div>
      <PageFooter
        showPrivacy
        onPrivacyClick={() => window.dispatchEvent(new CustomEvent("open-privacy"))}
      />
    </main>
  );
}
