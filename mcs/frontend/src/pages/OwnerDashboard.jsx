import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Bell,
  Building2,
  ClipboardList,
  Clock,
  LogOut,
  Menu,
  Settings,
  ShieldCheck,
  Users,
  X,
  Zap,
} from "lucide-react";
import { Topbar } from "../components/ui/Topbar";
import { ThemeToggle } from "../components/ui/ThemeToggle";
import { PageFooter } from "../components/ui/PageFooter";
import { Notice } from "../components/ui/Notice";
import { useTheme } from "../hooks/useTheme";
import { request } from "../utils/api";
import { Button, Input, Select } from "../components/design";
import { CampusMap } from "../components/owner/CampusMap";
import { SetupGuide } from "../components/owner/SetupGuide";

const NAV_ITEMS = [
  { key: "overview", label: "Overview", icon: Activity },
  { key: "buildings", label: "Buildings & Rooms", icon: Building2 },
  { key: "appliances", label: "Appliances", icon: Zap },
  { key: "emcs", label: "EMC Accounts", icon: Users },
  { key: "reports", label: "Reports", icon: ClipboardList },
  { key: "notifications", label: "Notifications", icon: Bell },
  { key: "settings", label: "Settings", icon: Settings },
];

function formatNumber(value, digits = 0) {
  const number = Number(value) || 0;
  return number.toLocaleString("en-PH", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function OwnerDashboard() {
  const { darkMode, toggleTheme } = useTheme();
  const [notice, setNotice] = useState("");
  const [success, setSuccess] = useState("");
  const [navOpen, setNavOpen] = useState(false);
  const [selectedTab, setSelectedTab] = useState("overview");
  const [loading, setLoading] = useState(true);

  const [dashboard, setDashboard] = useState(null);
  const [buildings, setBuildings] = useState([]);
  const [appliances, setAppliances] = useState([]);
  const [emcs, setEmcs] = useState([]);
  const [notifications, setNotifications] = useState([]);

  const [emcForm, setEmcForm] = useState({
    username: "",
    email: "",
    password: "",
    assigned_room_id: "",
  });
  const [applianceForm, setApplianceForm] = useState({
    name: "",
    wattage: "",
    quantity: "1",
  });
  const [busy, setBusy] = useState(false);

  const roomOptions = useMemo(() => {
    const options = [{ label: "Unassigned", value: "" }];
    for (const building of buildings) {
      for (const floor of building.floors || []) {
        for (const room of floor.rooms || []) {
          const label = `${building.building_name} · Floor ${floor.floor} · ${
            room.room_name || "Room"
          } ${room.room_number}`;
          options.push({ label, value: String(room.id) });
        }
      }
    }
    return options;
  }, [buildings]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [dashboardData, buildingData, applianceData, emcData] = await Promise.all([
        request("/owner/dashboard"),
        request("/owner/buildings"),
        request("/owner/appliances"),
        request("/owner/emcs"),
      ]);
      setDashboard(dashboardData);
      setBuildings(buildingData || []);
      setAppliances(applianceData || []);
      setEmcs(emcData || []);
      setNotice("");
    } catch (error) {
      setNotice(error.message || "Could not load your workspace.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    if (selectedTab !== "notifications") return;
    let cancelled = false;
    request("/owner/notifications")
      .then((data) => {
        if (!cancelled) setNotifications(data || []);
      })
      .catch((error) => {
        if (!cancelled) setNotice(error.message || "Could not load notifications.");
      });
    return () => {
      cancelled = true;
    };
  }, [selectedTab]);

  const handleSignOut = async () => {
    try {
      await request("/users/logout", { method: "POST" });
    } catch {
      // The local session is cleared even if the server cookie already expired.
    }
    localStorage.removeItem("wattwise-user");
    window.dispatchEvent(new CustomEvent("wattwise-signout"));
    window.location.href = "/";
  };

  const handleCreateEmc = async (event) => {
    event.preventDefault();
    setNotice("");
    setSuccess("");
    setBusy(true);
    try {
      const data = await request("/owner/emcs", {
        method: "POST",
        body: JSON.stringify({
          username: emcForm.username.trim(),
          email: emcForm.email.trim() || null,
          password: emcForm.password || null,
          assigned_room_id: emcForm.assigned_room_id
            ? Number(emcForm.assigned_room_id)
            : null,
        }),
      });
      setEmcForm({ username: "", email: "", password: "", assigned_room_id: "" });
      if (data.temporary_password && data.password) {
        setSuccess(
          `EMC ${data.username} created. Temporary password: ${data.password} — share it once, then ask them to change it.`,
        );
      } else {
        setSuccess(`EMC ${data.username} created.`);
      }
      await loadAll();
    } catch (error) {
      setNotice(error.message || "Could not create the EMC account.");
    } finally {
      setBusy(false);
    }
  };

  const handleAssignRoom = async (emcId, roomId) => {
    setNotice("");
    try {
      await request(`/owner/emcs/${emcId}`, {
        method: "PUT",
        body: JSON.stringify({
          assigned_room_id: roomId ? Number(roomId) : null,
        }),
      });
      await loadAll();
    } catch (error) {
      setNotice(error.message || "Could not update the assignment.");
    }
  };

  const handleToggleEmc = async (emc) => {
    setNotice("");
    try {
      if (emc.status === "active") {
        await request(`/owner/emcs/${emc.id}`, { method: "DELETE" });
        setSuccess(`${emc.username} disabled.`);
      } else {
        await request(`/owner/emcs/${emc.id}`, {
          method: "PUT",
          body: JSON.stringify({ status: "active" }),
        });
        setSuccess(`${emc.username} reactivated.`);
      }
      await loadAll();
    } catch (error) {
      setNotice(error.message || "Could not update the EMC account.");
    }
  };

  const handleCreateAppliance = async (event) => {
    event.preventDefault();
    setNotice("");
    setSuccess("");
    setBusy(true);
    try {
      await request("/owner/appliances", {
        method: "POST",
        body: JSON.stringify({
          name: applianceForm.name.trim(),
          wattage: Number(applianceForm.wattage),
          quantity: Number(applianceForm.quantity) || 1,
        }),
      });
      setApplianceForm({ name: "", wattage: "", quantity: "1" });
      setSuccess("Appliance added.");
      await loadAll();
    } catch (error) {
      setNotice(error.message || "Could not add the appliance.");
    } finally {
      setBusy(false);
    }
  };

  const renderNav = () => (
    <nav className={`admin-nav${navOpen ? " is-open" : ""}`} aria-label="Owner sections">
      <div className="nav-heading">
        <span className="nav-label">MY WORKSPACE</span>
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
      {NAV_ITEMS.map((item) => (
        <button
          key={item.key}
          type="button"
          className={`nav-link${selectedTab === item.key ? " active" : ""}`}
          onClick={() => {
            setSelectedTab(item.key);
            setSuccess("");
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
          <strong>{dashboard?.workspace_name || "Workspace"}</strong>
          <small>Workspace owner</small>
        </span>
      </div>
    </nav>
  );

  const recentActivity = dashboard?.recent_activity || [];

  return (
    <main className="admin-page">
      <Topbar
        subtitle="WORKSPACE ADMIN"
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
        <nav className="admin-sidebar" aria-label="Owner navigation">
          {renderNav()}
        </nav>
        <section className="admin-main">
          <div className="admin-heading">
            <div>
              <div className="eyebrow">
                <span className="eyebrow-dot" /> ENERGY MONITORING
              </div>
              <h1>Owner Dashboard</h1>
              <p>
                {dashboard?.workspace_name || "Your workspace"} · Reports are observations,
                not live sensor readings.
              </p>
            </div>
          </div>
          <Notice>{notice}</Notice>
          <Notice kind="success">{success}</Notice>
          <div className="tab-content">
            {selectedTab === "overview" && (
              <>
                <SetupGuide
                  dashboard={dashboard}
                  buildings={buildings}
                  appliances={appliances}
                  emcs={emcs}
                  onNavigate={setSelectedTab}
                />
                <section className="admin-metrics">
                  <article className="metric-primary">
                    <span>
                      <Zap size={15} /> REPORTED ENERGY
                    </span>
                    <strong>
                      {formatNumber(dashboard?.estimated_energy_kwh, 3)}{" "}
                      <small>kWh</small>
                    </strong>
                    <small className="metric-foot">Reports from the last 30 days</small>
                  </article>
                  <article>
                    <span>
                      <span className="metric-icon green">
                        <Building2 size={15} />
                      </span>
                      BUILDINGS
                    </span>
                    <strong>{loading ? "—" : formatNumber(dashboard?.total_buildings)}</strong>
                    <small className="metric-foot">
                      {formatNumber(dashboard?.total_floors)} floors ·{" "}
                      {formatNumber(dashboard?.total_rooms)} rooms
                    </small>
                  </article>
                  <article>
                    <span>
                      <span className="metric-icon amber">
                        <Users size={15} />
                      </span>
                      EMC ACCOUNTS
                    </span>
                    <strong>{loading ? "—" : formatNumber(dashboard?.active_emcs)}</strong>
                    <small className="metric-foot">Active coordinators</small>
                  </article>
                  <article>
                    <span>
                      <span className="metric-icon blue">
                        <Zap size={15} />
                      </span>
                      APPLIANCES
                    </span>
                    <strong>{loading ? "—" : formatNumber(dashboard?.total_appliances)}</strong>
                    <small className="metric-foot">Available in the catalog</small>
                  </article>
                </section>

                <section className="panel table-panel">
                  <div className="panel-heading">
                    <div>
                      <span className="eyebrow">RECENT</span>
                      <h2>Latest reports</h2>
                    </div>
                    <span className="count-pill">{recentActivity.length} entries</span>
                  </div>
                  {recentActivity.length === 0 ? (
                    <p className="empty-state">No reports have been submitted yet.</p>
                  ) : (
                    <div className="responsive-table"><table>
                      <thead>
                        <tr>
                          <th>Appliance</th>
                          <th>Room</th>
                          <th>Hours</th>
                          <th>Energy</th>
                          <th>Submitted</th>
                        </tr>
                      </thead>
                      <tbody>
                        {recentActivity.map((item) => (
                          <tr key={item.id}>
                            <td>{item.appliance_name || "—"}</td>
                            <td>{item.room_label || "—"}</td>
                            <td>{Number(item.hours).toFixed(4)}</td>
                            <td>{item.energy_kwh} kWh</td>
                            <td>
                              {item.created_at
                                ? new Date(`${item.created_at}Z`).toLocaleString("en-PH")
                                : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table></div>
                  )}
                </section>
              </>
            )}

            {selectedTab === "buildings" && (
              <CampusMap
                buildings={buildings}
                onReload={loadAll}
                setNotice={setNotice}
                setSuccess={setSuccess}
              />
            )}

            {selectedTab === "appliances" && (
              <>
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <span className="eyebrow">CATALOG</span>
                      <h2>Add an appliance</h2>
                    </div>
                  </div>
                  <div className="form-grid">
                    <Input
                      label="Name"
                      value={applianceForm.name}
                      maxLength={80}
                      onChange={(event) =>
                        setApplianceForm((prev) => ({ ...prev, name: event.target.value }))
                      }
                      placeholder="Electric fan"
                    />
                    <Input
                      label="Watts"
                      type="number"
                      min="1"
                      step="0.01"
                      value={applianceForm.wattage}
                      onChange={(event) =>
                        setApplianceForm((prev) => ({ ...prev, wattage: event.target.value }))
                      }
                    />
                    <Input
                      label="Units"
                      type="number"
                      min="1"
                      step="1"
                      value={applianceForm.quantity}
                      onChange={(event) =>
                        setApplianceForm((prev) => ({ ...prev, quantity: event.target.value }))
                      }
                    />
                    <div className="form-actions">
                      <Button
                        onClick={handleCreateAppliance}
                        loading={busy}
                        disabled={!applianceForm.name.trim() || !applianceForm.wattage}
                      >
                        Add appliance
                      </Button>
                    </div>
                  </div>
                </section>
                <section className="panel table-panel">
                  <div className="panel-heading">
                    <div>
                      <span className="eyebrow">CATALOG</span>
                      <h2>Appliances</h2>
                    </div>
                    <span className="count-pill">{appliances.length} items</span>
                  </div>
                  {appliances.length === 0 ? (
                    <p className="empty-state">No appliances yet.</p>
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
              </>
            )}

            {selectedTab === "emcs" && (
              <>
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <span className="eyebrow">COORDINATORS</span>
                      <h2>Create an EMC account</h2>
                    </div>
                  </div>
                  <div className="form-grid">
                    <Input
                      label="Username"
                      value={emcForm.username}
                      maxLength={80}
                      onChange={(event) =>
                        setEmcForm((prev) => ({ ...prev, username: event.target.value }))
                      }
                      placeholder="maria.santos"
                    />
                    <Input
                      label="Email (optional)"
                      type="email"
                      value={emcForm.email}
                      maxLength={255}
                      onChange={(event) =>
                        setEmcForm((prev) => ({ ...prev, email: event.target.value }))
                      }
                    />
                    <Input
                      label="Password (optional)"
                      type="password"
                      minLength={8}
                      value={emcForm.password}
                      onChange={(event) =>
                        setEmcForm((prev) => ({ ...prev, password: event.target.value }))
                      }
                      hint="Leave blank to generate a temporary password."
                    />
                    <Select
                      label="Assigned room"
                      value={emcForm.assigned_room_id}
                      onChange={(event) =>
                        setEmcForm((prev) => ({
                          ...prev,
                          assigned_room_id: event.target.value,
                        }))
                      }
                      options={roomOptions}
                    />
                    <div className="form-actions">
                      <Button
                        onClick={handleCreateEmc}
                        loading={busy}
                        disabled={!emcForm.username.trim()}
                      >
                        Create EMC
                      </Button>
                    </div>
                  </div>
                </section>
                <section className="panel table-panel">
                  <div className="panel-heading">
                    <div>
                      <span className="eyebrow">COORDINATORS</span>
                      <h2>EMC accounts</h2>
                    </div>
                    <span className="count-pill">{emcs.length} accounts</span>
                  </div>
                  {emcs.length === 0 ? (
                    <p className="empty-state">No EMC accounts yet.</p>
                  ) : (
                    <div className="responsive-table"><table>
                      <thead>
                        <tr>
                          <th>Account</th>
                          <th>Status</th>
                          <th>Assigned room</th>
                          <th>Last seen</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {emcs.map((emc) => (
                          <tr key={emc.id}>
                            <td>
                              <strong>{emc.username}</strong>
                              <br />
                              <small>{emc.email || "No email"}</small>
                            </td>
                            <td>
                              <span className="status-label">
                                <i /> {emc.status}
                              </span>
                            </td>
                            <td>
                              <select
                                className="ds-field__select"
                                value={emc.assigned_room_id || ""}
                                onChange={(event) =>
                                  handleAssignRoom(emc.id, event.target.value)
                                }
                              >
                                {roomOptions.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td>
                              {emc.last_seen
                                ? new Date(`${emc.last_seen}Z`).toLocaleDateString("en-PH")
                                : "—"}
                            </td>
                            <td>
                              <button
                                type="button"
                                className="topbar-link"
                                onClick={() => handleToggleEmc(emc)}
                              >
                                {emc.status === "active" ? "Disable" : "Reactivate"}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table></div>
                  )}
                </section>
              </>
            )}

            {selectedTab === "reports" && (
              <section className="panel table-panel">
                <div className="panel-heading">
                  <div>
                    <span className="eyebrow">HISTORY</span>
                    <h2>Recent reports</h2>
                  </div>
                </div>
                {recentActivity.length === 0 ? (
                  <p className="empty-state">No reports have been submitted yet.</p>
                ) : (
                  <div className="responsive-table"><table>
                    <thead>
                      <tr>
                        <th>Appliance</th>
                        <th>Room</th>
                        <th>Hours</th>
                        <th>Energy</th>
                        <th>Submitted</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentActivity.map((item) => (
                        <tr key={item.id}>
                          <td>{item.appliance_name || "—"}</td>
                          <td>{item.room_label || "—"}</td>
                          <td>{Number(item.hours).toFixed(4)}</td>
                          <td>{item.energy_kwh} kWh</td>
                          <td>
                            {item.created_at
                              ? new Date(`${item.created_at}Z`).toLocaleString("en-PH")
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table></div>
                )}
              </section>
            )}

            {selectedTab === "notifications" && (
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <span className="eyebrow">ACTIVITY</span>
                    <h2>Notifications</h2>
                  </div>
                </div>
                {notifications.length === 0 ? (
                  <p className="empty-state">No workspace activity yet.</p>
                ) : (
                  <ul className="notification-list">
                    {notifications.map((item) => (
                      <li key={item.id}>
                        <Clock size={15} />
                        <span>
                          <strong>{item.title}</strong>
                          <br />
                          <small>{item.message}</small>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {selectedTab === "settings" && (
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <span className="eyebrow">WORKSPACE</span>
                    <h2>Settings</h2>
                  </div>
                </div>
                <p>
                  <strong>Workspace name:</strong>{" "}
                  {dashboard?.workspace_name || "Not set"}
                </p>
                <p>
                  <strong>Signed in as:</strong> Workspace owner
                </p>
                <p className="empty-state">
                  Building and room editing is available from the setup flow. Account
                  security settings are managed by your sign-in provider.
                </p>
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
