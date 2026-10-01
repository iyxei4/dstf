import { useEffect, useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  Bolt,
  Building2,
  ClipboardList,
  DoorOpen,
  LogOut,
  Moon,
  Plus,
  Power,
  ShieldCheck,
  Search,
  Sun,
  Trash2,
  Users,
  Zap,
} from "lucide-react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const API = "/api";
const todayLabel = new Intl.DateTimeFormat("en-PH", {
  weekday: "long",
  month: "long",
  day: "numeric",
}).format(new Date());

async function request(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    credentials: "same-origin",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || "Something went wrong. Please try again.");
  }
  return data;
}

function money(value) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 2,
  }).format(value || 0);
}

function roomKwh(value) {
  if (!value) return "0.0";
  if (value < 0.0001) return "<0.0001";
  if (value < 0.01) return value.toFixed(4);
  if (value < 1) return value.toFixed(3);
  return value.toFixed(2);
}

function Brand({ compact = false }) {
  return (
    <a
      className={`brand${compact ? " brand-compact" : ""}`}
      href="/mcs"
    >
      <span className="brand-icon">
        <Bolt size={18} fill="currentColor" />
      </span>
      <span className="brand-word">
        wattwise<span>.</span>
      </span>
      {!compact && <span className="brand-divider" />}
      {!compact && <span className="brand-context">CLASSROOM ENERGY</span>}
    </a>
  );
}
function Topbar({ subtitle, right }) {
  return (
    <header className="topbar">
      <Brand />
      <div className="topbar-middle">{subtitle}</div>
      <div className="topbar-actions">
        {right || <span className="today-label">{todayLabel}</span>}
      </div>
    </header>
  );
}

function useTheme() {
  const [darkMode, setDarkMode] = useState(
    () => localStorage.getItem("wattwise-theme") === "dark",
  );
  useEffect(() => {
    document.documentElement.dataset.theme = darkMode ? "dark" : "light";
    localStorage.setItem("wattwise-theme", darkMode ? "dark" : "light");
  }, [darkMode]);
  return { darkMode, toggleTheme: () => setDarkMode((current) => !current) };
}

function ThemeToggle({ darkMode, onToggle }) {
  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={`Switch to ${darkMode ? "light" : "dark"} mode`}
      aria-pressed={darkMode}
      onClick={onToggle}
    >
      {darkMode ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  );
}

function Notice({ children, kind = "error" }) {
  if (!children) return null;
  return (
    <p
      className={`notice notice-${kind}`}
      role={kind === "error" ? "alert" : "status"}
    >
      {children}
    </p>
  );
}

function RoleChoice() {
  const { darkMode, toggleTheme } = useTheme();
  return (
    <main className="role-page">
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
        <a className="role-card user-role" href="/mcs/user">
          <div className="role-card-top">
            <span className="role-icon">
              <Users size={20} />
            </span>
            <ArrowRight size={18} />
          </div>
          <div className="role-card-copy">
            <span className="eyebrow">FOR TEACHERS & STAFF</span>
            <h2>User workspace</h2>
            <p>
              Log appliance run time, record classroom activity, and see your
              energy estimates.
            </p>
          </div>
          <div className="role-card-bottom">
            <span>Enter your account</span>
            <ArrowRight size={16} />
          </div>
        </a>
        <a className="role-card admin-role" href="/mcs/admin">
          <div className="role-card-top">
            <span className="role-icon">
              <ShieldCheck size={20} />
            </span>
            <ArrowRight size={18} />
          </div>
          <div className="role-card-copy">
            <span className="eyebrow">FOR SYSTEM MANAGERS</span>
            <h2>Admin console</h2>
            <p>
              Review submissions, compare classroom usage, and maintain the
              appliance catalog.
            </p>
          </div>
          <div className="role-card-bottom">
            <span>Sign in as admin</span>
            <ArrowRight size={16} />
          </div>
        </a>
      </section>
      <footer className="page-footer">
        <span>
          <span className="live-dot" /> ESTIMATES UPDATED WHEN USAGE IS
          SUBMITTED
        </span>
        <span>
          WATTWISE MCS <span className="footer-year">/ 2026</span>
        </span>
      </footer>
    </main>
  );
}

function UserPortal() {
  const { darkMode, toggleTheme } = useTheme();
  const [username, setUsername] = useState(
    () => localStorage.getItem("wattwise-user") || "",
  );
  const [password, setPassword] = useState("");
  const [signedIn, setSignedIn] = useState(() =>
    Boolean(localStorage.getItem("wattwise-user")),
  );
  const [sections, setSections] = useState([]);
  const [appliances, setAppliances] = useState([]);
  const [assignedRoom, setAssignedRoom] = useState(null);
  const [records, setRecords] = useState([]);
  const [sectionId, setSectionId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [occupants, setOccupants] = useState("");
  const [showApplianceForm, setShowApplianceForm] = useState(false);
  const [applianceName, setApplianceName] = useState("");
  const [applianceWatts, setApplianceWatts] = useState(100);
  const [running, setRunning] = useState(() => {
    try {
      const account = localStorage.getItem("wattwise-user") || "";
      return JSON.parse(
        localStorage.getItem(`wattwise-running:${account}`) || "{}",
      );
    } catch {
      return {};
    }
  });
  const [now, setNow] = useState(Date.now());
  const [notice, setNotice] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadWorkspace() {
    const [nextSections, nextAppliances, nextRecords, session] =
      await Promise.all([
        request("/sections"),
        request("/appliances"),
        request("/users/me/records"),
        request("/users/session"),
      ]);
    setSections(nextSections);
    setAppliances(nextAppliances);
    setRecords(nextRecords);
    setAssignedRoom(session.assigned_room);
    setRoomId(session.assigned_room ? String(session.assigned_room.id) : "");
    setSectionId((current) =>
      nextSections.some((section) => String(section.id) === current)
        ? current
        : String(nextSections[0]?.id || ""),
    );
  }

  useEffect(() => {
    if (signedIn && username) {
      loadWorkspace().catch((error) => {
        setNotice(error.message);
        if (
          error.message.includes("sign-in required") ||
          error.message.includes("credentials")
        ) {
          localStorage.removeItem("wattwise-user");
          setSignedIn(false);
          setUsername("");
        }
      });
    }
  }, [signedIn, username]);

  useEffect(() => {
    if (!Object.keys(running).length) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  async function signIn(event) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      const account = await request("/users/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      setUsername(account.username);
      setPassword("");
      setAssignedRoom(account.assigned_room);
      setRoomId(account.assigned_room ? String(account.assigned_room.id) : "");
      localStorage.setItem("wattwise-user", account.username);
      try {
        setRunning(
          JSON.parse(
            localStorage.getItem(`wattwise-running:${account.username}`) ||
              "{}",
          ),
        );
      } catch {
        setRunning({});
      }
      setSignedIn(true);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function addAppliance(event) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    setSuccess("");
    try {
      const created = await request("/appliances", {
        method: "POST",
        body: JSON.stringify({
          name: applianceName,
          wattage: Number(applianceWatts),
        }),
      });
      setAppliances((current) =>
        [...current, created].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setApplianceName("");
      setApplianceWatts(100);
      setShowApplianceForm(false);
      setSuccess(`${created.name} added to the appliance list.`);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeAppliance(appliance) {
    if (running[appliance.id]) {
      setNotice("Turn off this appliance before removing it.");
      return;
    }
    if (!window.confirm(`Remove ${appliance.name} from the appliance list?`)) {
      return;
    }
    setBusy(true);
    setNotice("");
    setSuccess("");
    try {
      await request(`/appliances/${appliance.id}`, { method: "DELETE" });
      setAppliances((current) =>
        current.filter((item) => item.id !== appliance.id),
      );
      setSuccess(`${appliance.name} removed from the appliance list.`);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  function startAppliance(appliance) {
    const nextRunning = {
      ...running,
      [appliance.id]: {
        startedAt: Date.now(),
        sectionId: Number(sectionId),
        roomId: Number(roomId),
      },
    };
    setRunning(nextRunning);
    localStorage.setItem(
      `wattwise-running:${username}`,
      JSON.stringify(nextRunning),
    );
    setNow(Date.now());
  }

  async function stopAppliance(appliance) {
    const session = running[appliance.id];
    if (!session) return;
    setBusy(true);
    setNotice("");
    setSuccess("");
    try {
      const elapsedHours = Math.min(
        24,
        Math.max(0.0001, (Date.now() - session.startedAt) / 3_600_000),
      );
      const saved = await request("/records", {
        method: "POST",
        body: JSON.stringify({
          section_id: session.sectionId,
          room_id: session.roomId,
          appliance_id: appliance.id,
          hours: elapsedHours,
          occupants: occupants === "" ? null : Math.max(0, Math.floor(Number(occupants) || 0)),
          started_at: new Date(session.startedAt).toISOString(),
        }),
      });
      setRecords((current) => [saved, ...current]);
      setSuccess(
        `${saved.appliance} stopped · ${saved.energy_kwh.toFixed(3)} kWh recorded for ${saved.section}.`,
      );
      const nextRunning = { ...running };
      delete nextRunning[appliance.id];
      setRunning(nextRunning);
      localStorage.setItem(
        `wattwise-running:${username}`,
        JSON.stringify(nextRunning),
      );
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    if (Object.keys(running).length) {
      setNotice("Turn off running appliances before signing out.");
      return;
    }
    await request("/users/logout", { method: "POST" }).catch(() => {});
    localStorage.removeItem("wattwise-user");
    setSignedIn(false);
    setUsername("");
    setRecords([]);
  }

  if (!signedIn) {
    return (
      <main className="auth-page">
        <Topbar
          subtitle="USER ACCESS"
          right={
            <>
              <ThemeToggle darkMode={darkMode} onToggle={toggleTheme} />
              <a className="topbar-link" href="/mcs">
                <ArrowLeft size={15} /> All workspaces
              </a>
            </>
          }
        />
        <section className="auth-layout">
          <div className="auth-aside">
            <span className="auth-aside-number">01 / USER</span>
            <div className="auth-aside-mark">
              <Zap size={30} fill="currentColor" />
            </div>
            <h1>
              Make your
              <br />
              room count.
            </h1>
            <p>
              Record what your classroom uses. WattWise handles the energy math.
            </p>
            <div className="auth-aside-line" />
          </div>
          <form className="auth-form" onSubmit={signIn}>
            <div className="eyebrow">TEACHER & STAFF PORTAL</div>
            <h2>Welcome back</h2>
            <p className="form-intro">
              Use the username and password provided by your administrator.
            </p>
            <label className="field-label">
              Account name
              <input
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
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
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            <Notice>{notice}</Notice>
            <button
              className="button button-primary button-wide"
              disabled={busy}
            >
              {busy ? "Opening workspace..." : "Continue to workspace"}
              <ArrowRight size={16} />
            </button>
            <p className="auth-footnote">
              Ask your administrator to create or reset your credentials.
            </p>
          </form>
        </section>
      </main>
    );
  }

  const totalKwh = records.reduce((sum, item) => sum + item.energy_kwh, 0);
  const totalBill = records.reduce(
    (sum, item) => sum + item.estimated_cost_php,
    0,
  );

  return (
    <main className="workspace-page">
      <Topbar
        subtitle="USER WORKSPACE"
        right={
          <>
            <ThemeToggle darkMode={darkMode} onToggle={toggleTheme} />
            <span className="account-chip">
              <span className="account-avatar">
                {username.slice(0, 1).toUpperCase()}
              </span>
              {username}
            </span>
            <button
              className="icon-button"
              onClick={signOut}
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut size={17} />
            </button>
          </>
        }
      />
      <section className="workspace-heading">
        <div>
          <div className="eyebrow">
            <span className="eyebrow-dot" /> CLASSROOM LOG
          </div>
          <h1>
            Good to have you, <em>{username.split(/[ ._-]/)[0]}.</em>
          </h1>
          <p>
            Submit appliance use as it happens. Your estimates stay here for
            easy reference.
          </p>
        </div>
        <span className="date-stamp">{todayLabel}</span>
      </section>
      <section className="user-summary">
        <article className="summary-tile summary-green">
          <span className="summary-label">
            <Zap size={15} /> TOTAL LOGGED
          </span>
          <strong>
            {totalKwh.toFixed(2)} <small>kWh</small>
          </strong>
          <span className="summary-note">
            Across {records.length} usage{" "}
            {records.length === 1 ? "entry" : "entries"}
          </span>
        </article>
        <article className="summary-tile">
          <span className="summary-label">
            <Building2 size={15} /> ESTIMATED COST
          </span>
          <strong>{money(totalBill)}</strong>
          <span className="summary-note">Based on submitted usage</span>
        </article>
        <article className="summary-tile">
          <span className="summary-label">
            <ClipboardList size={15} /> CLASSROOM SECTIONS
          </span>
          <strong>{sections.length.toString().padStart(2, "0")}</strong>
          <span className="summary-note">Available to report</span>
        </article>
      </section>
      <section className="user-table-layout">
        <section className="panel appliance-list-panel">
          <div className="panel-heading appliance-list-heading">
            <div>
              <span className="eyebrow">LIVE APPLIANCE LOG</span>
              <h2>Classroom appliances</h2>
            </div>
            <button
              type="button"
              className="button button-primary add-appliance-trigger"
              onClick={() => setShowApplianceForm((open) => !open)}
              aria-expanded={showApplianceForm}
            >
              <Plus size={15} /> Add appliance
            </button>
          </div>
          {showApplianceForm && (
            <form className="user-appliance-form" onSubmit={addAppliance}>
              <label>
                Appliance name
                <input
                  value={applianceName}
                  onChange={(event) => setApplianceName(event.target.value)}
                  placeholder="e.g. Document camera"
                  minLength={2}
                  maxLength={80}
                  required
                />
              </label>
              <label>
                Wattage
                <input
                  type="number"
                  min="1"
                  max="100000"
                  step="1"
                  value={applianceWatts}
                  onChange={(event) => setApplianceWatts(event.target.value)}
                  required
                />
              </label>
              <button className="button button-primary" disabled={busy}>
                {busy ? "Saving..." : "Save appliance"}
              </button>
            </form>
          )}
          <div className="appliance-table-tools">
            <label className="section-choice">
              <span>CLASSROOM SECTION</span>
              <select
                value={sectionId}
                onChange={(event) => setSectionId(event.target.value)}
              >
                {sections.map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="section-choice">
              <span>OCCUPANTS (OPTIONAL)</span>
              <input
                type="number"
                className="occupants-input"
                min="0"
                max="500"
                step="1"
                placeholder="e.g. 30"
                value={occupants}
                onChange={(event) => setOccupants(event.target.value)}
              />
            </label>
            <div className="assigned-room-chip">
              <span>ASSIGNED ROOM: </span>
              <strong>
                {assignedRoom
                  ? `${assignedRoom.building_name} · ${assignedRoom.room_name || `Room ${assignedRoom.room_number}`}`
                  : "Ask an administrator to assign a room"}
              </strong>
            </div>
            <span className="formula">LIVE ESTIMATE · W × HOURS ÷ 1,000</span>
          </div>
          <Notice>{notice}</Notice>
          <Notice kind="success">{success}</Notice>
          <div className="responsive-table appliance-table-wrap">
            <table className="appliance-table">
              <thead>
                <tr>
                  <th>APPLIANCE</th>
                  <th>ESTIMATED KWH</th>
                  <th>ON / OFF</th>
                </tr>
              </thead>
              <tbody>
                {appliances.map((appliance) => {
                  const session = running[appliance.id];
                  const elapsedSeconds = session
                    ? Math.floor((now - session.startedAt) / 1000)
                    : 0;
                  const loggedKwh = records
                    .filter((record) => record.appliance_id === appliance.id)
                    .reduce((total, record) => total + record.energy_kwh, 0);
                  const estimatedKwh = session
                    ? (appliance.wattage * elapsedSeconds) / 3_600_000
                    : loggedKwh;
                  const loggedSessions = records.filter(
                    (record) => record.appliance_id === appliance.id,
                  ).length;
                  return (
                    <tr key={appliance.id}>
                      <td data-label="Appliance">
                        <span className="appliance-name-cell">
                          <span
                            className={`record-icon${session ? " running-icon" : ""}`}
                          >
                            <Zap size={16} />
                          </span>
                          <span>
                            <strong>{appliance.name}</strong>
                            <small>{appliance.wattage} W</small>
                          </span>
                        </span>
                      </td>
                      <td data-label="Estimated kwh">
                        <span className="appliance-estimate-cell">
                          <strong>{estimatedKwh.toFixed(4)} kWh</strong>
                          <small>
                            {session
                              ? `${String(Math.floor(elapsedSeconds / 3600)).padStart(2, "0")}:${String(Math.floor((elapsedSeconds % 3600) / 60)).padStart(2, "0")}:${String(elapsedSeconds % 60).padStart(2, "0")} elapsed`
                              : loggedSessions
                                ? `${loggedSessions} completed session${loggedSessions === 1 ? "" : "s"}`
                                : "Not running"}
                          </small>
                        </span>
                      </td>
                      <td>
                        <span className="appliance-actions">
                          <button
                            type="button"
                            className={`power-toggle${session ? " is-on" : ""}`}
                            aria-pressed={Boolean(session)}
                            disabled={
                              busy || (!session && (!sectionId || !roomId))
                            }
                            onClick={() =>
                              session
                                ? stopAppliance(appliance)
                                : startAppliance(appliance)
                            }
                          >
                            <Power size={15} /> {session ? "OFF" : "ON"}
                          </button>
                          <button
                            type="button"
                            className="delete-action"
                            aria-label={`Remove appliance ${appliance.name}`}
                            title={`Remove ${appliance.name}`}
                            disabled={busy || Boolean(session)}
                            onClick={() => removeAppliance(appliance)}
                          >
                            <Trash2 size={15} />
                          </button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!appliances.length && (
              <div className="empty-state">
                Add an appliance to start logging classroom usage.
              </div>
            )}
          </div>
        </section>
        <section className="panel recent-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">YOUR ACTIVITY</span>
              <h2>Recent entries</h2>
            </div>
            <span className="count-pill">{records.length}</span>
          </div>
          {records.length ? (
            <div className="record-list">
              {records.slice(0, 8).map((record) => (
                <article className="record-row" key={record.id}>
                  <span className="record-icon">
                    <Sun size={16} />
                  </span>
                  <span className="record-main">
                    <strong>{record.appliance}</strong>
                    <small>
                      {record.section} · {parseFloat(record.hours.toFixed(2))} hr
                      {record.hours === 1 ? "" : "s"}
                      {record.occupants != null
                        ? ` · ${record.occupants} occupant${record.occupants === 1 ? "" : "s"}`
                        : ""}
                    </small>
                  </span>
                  <span className="record-values">
                    <strong>{record.energy_kwh.toFixed(2)} kWh</strong>
                    <small>
                      {new Date(record.created_at).toLocaleDateString(
                        "en-PH",
                        { month: "short", day: "numeric" },
                      )}{" "}
                      {new Date(record.created_at).toLocaleTimeString(
                        "en-PH",
                        { hour: "numeric", minute: "2-digit" },
                      )}
                    </small>
                  </span>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <span className="empty-mark">
                <ClipboardList size={22} />
              </span>
              <strong>No entries yet</strong>
              <span>Your submitted usage records will appear here.</span>
            </div>
          )}
        </section>
      </section>
      <footer className="page-footer">
        <span>ENERGY VALUES ARE ESTIMATES, NOT METER READINGS.</span>
        <a href="/mcs">
          WATTWISE MCS <ArrowLeft size={12} />
        </a>
      </footer>
    </main>
  );
}

function AdminPortal() {
  const { darkMode, toggleTheme } = useTheme();
  const [admin, setAdmin] = useState(null);
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("admin");
  const [dashboard, setDashboard] = useState(null);
  const [roomsData, setRoomsData] = useState(null);
  const [selectedRoomId, setSelectedRoomId] = useState(null);
  const [roomDetail, setRoomDetail] = useState(null);
  const [roomDetailTick, setRoomDetailTick] = useState(0);
  const [roomQuery, setRoomQuery] = useState("");
  const [usageOnly, setUsageOnly] = useState(false);
  const [roomType, setRoomType] = useState("classroom");
  const [customRoomType, setCustomRoomType] = useState("");
  const [roomName, setRoomName] = useState("");
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [tab, setTab] = useState("overview");
  const [notice, setNotice] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [sectionName, setSectionName] = useState("");
  const [applianceName, setApplianceName] = useState("");
  const [applianceWatts, setApplianceWatts] = useState(100);
  const [editingId, setEditingId] = useState(null);
  const [userAccount, setUserAccount] = useState("");
  const [userPassword, setUserPassword] = useState("");
  const [userRoomId, setUserRoomId] = useState("");
  const [credentialsMessage, setCredentialsMessage] = useState("");
  const [reports, setReports] = useState(null);
  const [reportGroup, setReportGroup] = useState("day");

  async function loadDashboard(selectedMonth = month) {
    const data = await request(`/admin/dashboard?month=${selectedMonth}`);
    setDashboard(data);
  }

  async function loadReports(group = reportGroup, selectedMonth = month) {
    const data = await request(
      `/admin/reports?month=${selectedMonth}&group=${group}`,
    );
    setReports(data);
  }

  async function loadRooms() {
    const data = await request("/admin/rooms");
    setRoomsData(data);
    setUserRoomId(
      (current) => current || String(data.buildings[0]?.rooms[0]?.id || ""),
    );
    setSelectedRoomId(
      (current) => current || data.buildings[0]?.rooms[0]?.id || null,
    );
  }

  const selectedRoom = roomsData?.buildings
    .flatMap((building) => building.rooms)
    .find((room) => room.id === selectedRoomId);

  function chooseRoom(room) {
    setSelectedRoomId(room.id);
  }

  useEffect(() => {
    if (!selectedRoom) return;
    setRoomType(selectedRoom.room_type);
    setCustomRoomType(selectedRoom.custom_type || "");
    setRoomName(selectedRoom.room_name || "");
  }, [selectedRoom]);

  useEffect(() => {
    if (!selectedRoomId) {
      setRoomDetail(null);
      return undefined;
    }
    let cancelled = false;
    request(`/admin/rooms/${selectedRoomId}`)
      .then((data) => {
        if (!cancelled) setRoomDetail(data);
      })
      .catch((error) => {
        if (!cancelled) setNotice(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRoomId, roomDetailTick]);

  const currentDetail =
    roomDetail && roomDetail.id === selectedRoomId ? roomDetail : null;

  const flatRooms = roomsData
    ? roomsData.buildings.flatMap((building) =>
        building.rooms.map((room) => ({
          ...room,
          building_name_full: building.name,
        })),
      )
    : [];

  function roomMatches(room) {
    if (usageOnly && !room.submission_count) return false;
    const query = roomQuery.trim().toLowerCase();
    if (!query) return true;
    return (
      String(room.room_number).includes(query) ||
      room.display_name.toLowerCase().includes(query) ||
      room.display_type.toLowerCase().includes(query) ||
      room.building_name.toLowerCase().includes(query) ||
      room.assigned_users.some((username) =>
        username.toLowerCase().includes(query),
      )
    );
  }

  const visibleRooms = flatRooms.filter(roomMatches);

  const busiestRooms = flatRooms
    .filter((room) => room.submission_count > 0)
    .sort((a, b) => b.average_kwh - a.average_kwh)
    .slice(0, 5);

  async function saveRoomDetails(event) {
    event.preventDefault();
    setNotice("");
    try {
      await request(`/admin/rooms/${selectedRoomId}`, {
        method: "PUT",
        body: JSON.stringify({
          room_type: roomType,
          custom_type: customRoomType,
          room_name: roomName,
        }),
      });
      await loadRooms();
      setRoomDetailTick((tick) => tick + 1);
    } catch (error) {
      setNotice(error.message);
    }
  }

  useEffect(() => {
    if (localStorage.getItem("wattwise-admin-session") !== "true") return;
    request("/admin/session")
      .then((session) => {
        setAdmin(session);
        return Promise.all([loadDashboard(), loadRooms()]);
      })
      .catch(() => {});
  }, []);

  async function signIn(event) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      const session = await request("/admin/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      localStorage.setItem("wattwise-admin-session", "true");
      setAdmin(session);
      setPassword("");
      await Promise.all([loadDashboard(), loadRooms()]);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await request("/admin/logout", { method: "POST" }).catch(() => {});
    localStorage.removeItem("wattwise-admin-session");
    setAdmin(null);
    setDashboard(null);
  }

  async function addSection(event) {
    event.preventDefault();
    setNotice("");
    try {
      await request("/admin/sections", {
        method: "POST",
        body: JSON.stringify({ name: sectionName }),
      });
      setSectionName("");
      await loadDashboard();
    } catch (error) {
      setNotice(error.message);
    }
  }

  async function removeSection(section) {
    if (!window.confirm(`Remove section "${section.name}"?`)) return;
    setNotice("");
    try {
      await request(`/admin/sections/${section.id}`, { method: "DELETE" });
      await loadDashboard();
    } catch (error) {
      setNotice(error.message);
    }
  }

  async function saveAppliance(event) {
    event.preventDefault();
    setNotice("");
    try {
      const payload = JSON.stringify({
        name: applianceName,
        wattage: Number(applianceWatts),
      });
      await request(
        editingId ? `/admin/appliances/${editingId}` : "/admin/appliances",
        { method: editingId ? "PUT" : "POST", body: payload },
      );
      setApplianceName("");
      setApplianceWatts(100);
      setEditingId(null);
      await loadDashboard();
    } catch (error) {
      setNotice(error.message);
    }
  }

  async function removeAppliance(appliance) {
    if (
      !window.confirm(
        `Remove appliance "${appliance.name}"? Past usage records for it are kept.`,
      )
    )
      return;
    setNotice("");
    setSuccess("");
    try {
      const result = await request(`/admin/appliances/${appliance.id}`, {
        method: "DELETE",
      });
      if (editingId === appliance.id) {
        setEditingId(null);
        setApplianceName("");
        setApplianceWatts(100);
      }
      await loadDashboard();
      setSuccess(
        result.status === "appliance archived"
          ? `${appliance.name} removed from the catalog. Its usage records are kept.`
          : `${appliance.name} removed from the appliance list.`,
      );
    } catch (error) {
      setNotice(error.message);
    }
  }

  async function saveUserCredentials(event) {
    event.preventDefault();
    setNotice("");
    setCredentialsMessage("");
    try {
      const result = await request("/admin/users/credentials", {
        method: "POST",
        body: JSON.stringify({
          username: userAccount,
          password: userPassword,
          assigned_room_id: Number(userRoomId) || null,
        }),
      });
      setUserAccount("");
      setUserPassword("");
      setCredentialsMessage(
        `Credentials saved for ${result.username}. Give the user their password securely.`,
      );
      await loadDashboard();
    } catch (error) {
      setNotice(error.message);
    }
  }

  async function assignUserRoom(accountName, assignedRoomId) {
    setNotice("");
    try {
      await request(`/admin/users/${encodeURIComponent(accountName)}/room`, {
        method: "PUT",
        body: JSON.stringify({ room_id: assignedRoomId || null }),
      });
      await loadDashboard();
    } catch (error) {
      setNotice(error.message);
    }
  }

  if (!admin) {
    return (
      <main className="auth-page">
        <Topbar
          subtitle="ADMIN ACCESS"
          right={
            <>
              <ThemeToggle darkMode={darkMode} onToggle={toggleTheme} />
              <a className="topbar-link" href="/mcs">
                <ArrowLeft size={15} /> All workspaces
              </a>
            </>
          }
        />
        <section className="auth-layout admin-auth-layout">
          <div className="auth-aside">
            <span className="auth-aside-number">02 / ADMIN</span>
            <div className="auth-aside-mark">
              <ShieldCheck size={30} />
            </div>
            <h1>
              See the whole
              <br />
              <em>picture.</em>
            </h1>
            <p>
              One view for classroom activity, energy estimates, and cost
              trends.
            </p>
            <div className="auth-aside-line" />
          </div>
          <form className="auth-form" onSubmit={signIn}>
            <div className="eyebrow">SYSTEM MANAGEMENT</div>
            <h2>Admin sign in</h2>
            <p className="form-intro">
              Sign in to monitor submissions and manage your classroom catalog.
            </p>
            <label className="field-label">
              Username
              <input
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                required
              />
            </label>
            <label className="field-label">
              Password
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            <Notice>{notice}</Notice>
            <button
              className="button button-primary button-wide"
              disabled={busy}
            >
              {busy ? "Checking access..." : "Open admin console"}
              <ArrowRight size={16} />
            </button>
            <p className="auth-footnote">
              Admin credentials are configured on the API server.
            </p>
          </form>
        </section>
      </main>
    );
  }

  const tabs = [
    ["overview", "Overview", Activity],
    ["reports", "Reports", Zap],
    ["rooms", "Buildings & rooms", DoorOpen],
    ["records", "Submissions", ClipboardList],
    ["users", "User activity", Users],
    ["catalog", "Manage catalog", Building2],
  ];

  return (
    <main className="admin-page">
      <Topbar
        subtitle="ADMIN CONSOLE"
        right={
          <>
            <span className="admin-online">
              <span className="live-dot" /> SYSTEM ONLINE
            </span>
            <ThemeToggle darkMode={darkMode} onToggle={toggleTheme} />
            <button className="topbar-link signout-link" onClick={signOut}>
              <LogOut size={15} /> Sign out
            </button>
          </>
        }
      />
      <div className="admin-layout">
        <aside className="admin-rail">
          <div className="rail-label">WORKSPACE</div>
          {tabs.map(([key, label, Icon]) => (
            <button
              key={key}
              className={`rail-link${tab === key ? " active" : ""}`}
              onClick={() => {
                setTab(key);
                if (key === "reports") {
                  loadReports().catch((error) => setNotice(error.message));
                }
              }}
            >
              <Icon size={17} />
              {label}
              {tab === key && <span className="rail-active-mark" />}
            </button>
          ))}
          <div className="rail-bottom">
            <span className="rail-admin-icon">
              <ShieldCheck size={16} />
            </span>
            <span>
              <strong>{admin.username}</strong>
              <small>Administrator</small>
            </span>
          </div>
        </aside>
        <section className="admin-main">
          <div className="admin-heading">
            <div>
              <div className="eyebrow">
                <span className="eyebrow-dot" /> ENERGY MONITORING
              </div>
              <h1>
                {tab === "overview"
                  ? "System overview"
                  : tabs.find((item) => item[0] === tab)?.[1]}
              </h1>
              <p>
                Classroom consumption, submissions, and estimated costs in one
                place.
              </p>
            </div>
            <label className="month-picker">
              <span>REPORTING MONTH</span>
              <input
                type="month"
                value={month}
                onChange={(event) => {
                  setMonth(event.target.value);
                  loadDashboard(event.target.value).catch((error) =>
                    setNotice(error.message),
                  );
                  if (tab === "reports") {
                    loadReports(reportGroup, event.target.value).catch(
                      (error) => setNotice(error.message),
                    );
                  }
                }}
              />
            </label>
          </div>
          <Notice>{notice}</Notice>
          <Notice kind="success">{success}</Notice>
          {!dashboard ? (
            <div className="panel loading-panel">Loading classroom data...</div>
          ) : (
            <>
              {tab === "overview" && (
                <>
                  <section className="admin-metrics">
                    <article className="metric-primary">
                      <span>
                        <Zap size={15} /> TOTAL CONSUMPTION
                      </span>
                      <strong>
                        {dashboard.total_kwh.toFixed(2)} <small>kWh</small>
                      </strong>
                      <small className="metric-foot">
                        For{" "}
                        {new Date(`${month}-01T00:00:00`).toLocaleDateString(
                          "en-PH",
                          { month: "long", year: "numeric" },
                        )}
                      </small>
                    </article>
                    <article>
                      <span>
                        <span className="metric-icon amber">
                          <Building2 size={15} />
                        </span>
                        EST. MONTHLY BILL
                      </span>
                      <strong>{money(dashboard.estimated_bill_php)}</strong>
                      <small className="metric-foot">
                        At {money(dashboard.rate_php_per_kwh)} / kWh
                      </small>
                    </article>
                    <article>
                      <span>
                        <span className="metric-icon blue">
                          <ClipboardList size={15} />
                        </span>
                        USAGE ENTRIES
                      </span>
                      <strong>
                        {dashboard.record_count.toString().padStart(2, "0")}
                      </strong>
                      <small className="metric-foot">
                        Submitted this month
                      </small>
                    </article>
                    <article>
                      <span>
                        <span className="metric-icon green">
                          <Users size={15} />
                        </span>
                        ACTIVE ACCOUNTS
                      </span>
                      <strong>
                        {dashboard.user_count.toString().padStart(2, "0")}
                      </strong>
                      <small className="metric-foot">
                        {dashboard.section_count} sections configured
                      </small>
                    </article>
                  </section>
                  <section className="admin-analysis-grid">
                    <article className="panel trend-panel">
                      <div className="panel-heading">
                        <div>
                          <span className="eyebrow">SIX-MONTH VIEW</span>
                          <h2>Energy & estimated bill</h2>
                        </div>
                        <span className="trend-unit">kWh / PHP</span>
                      </div>
                      <div className="chart-area">
                        <ResponsiveContainer width="100%" height="100%">
                          <ComposedChart
                            data={dashboard.monthly}
                            margin={{ top: 8, right: 4, left: -16, bottom: 0 }}
                          >
                            <defs>
                              <linearGradient
                                id="usageFill"
                                x1="0"
                                y1="0"
                                x2="0"
                                y2="1"
                              >
                                <stop
                                  offset="0%"
                                  stopColor="#278253"
                                  stopOpacity={0.2}
                                />
                                <stop
                                  offset="100%"
                                  stopColor="#278253"
                                  stopOpacity={0}
                                />
                              </linearGradient>
                            </defs>
                            <CartesianGrid stroke="#e9ece4" vertical={false} />
                            <XAxis
                              dataKey="month"
                              axisLine={false}
                              tickLine={false}
                              tick={{ fill: "#879087", fontSize: 11 }}
                            />
                            <YAxis
                              yAxisId="energy"
                              axisLine={false}
                              tickLine={false}
                              tick={{ fill: "#879087", fontSize: 11 }}
                            />
                            <YAxis
                              yAxisId="cost"
                              orientation="right"
                              axisLine={false}
                              tickLine={false}
                              tick={{ fill: "#a58b60", fontSize: 10 }}
                            />
                            <Tooltip
                              formatter={(value, name) => [
                                name === "Energy"
                                  ? `${Number(value).toFixed(2)} kWh`
                                  : money(value),
                                name,
                              ]}
                              contentStyle={{
                                borderRadius: 8,
                                borderColor: "#e3e8df",
                                fontSize: 12,
                              }}
                            />
                            <Area
                              yAxisId="energy"
                              type="monotone"
                              dataKey="kwh"
                              name="Energy"
                              stroke="#278253"
                              strokeWidth={2.5}
                              fill="url(#usageFill)"
                              activeDot={{ r: 4 }}
                            />
                            <Line
                              yAxisId="cost"
                              type="monotone"
                              dataKey="bill"
                              name="Est. bill"
                              stroke="#e2a23b"
                              strokeWidth={2}
                              dot={{ r: 2, fill: "#e2a23b" }}
                              activeDot={{ r: 4 }}
                            />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="chart-legend">
                        <span>
                          <i className="legend-dot green-legend" /> ENERGY USE{" "}
                          <strong>kWh</strong>
                        </span>
                        <span>
                          <i className="legend-dot amber-legend" /> EST. BILL{" "}
                          <strong>PHP</strong>
                        </span>
                      </div>
                    </article>
                    <article className="panel section-panel">
                      <div className="panel-heading">
                        <div>
                          <span className="eyebrow">SECTION RANKING</span>
                          <h2>Highest usage</h2>
                        </div>
                        <ArrowDownRight className="ranking-icon" size={18} />
                      </div>
                      {dashboard.sections.length ? (
                        <div className="section-rank-list">
                          {dashboard.sections
                            .slice(0, 5)
                            .map((section, index) => (
                              <div className="section-rank" key={section.name}>
                                <span className="rank-number">
                                  {String(index + 1).padStart(2, "0")}
                                </span>
                                <span className="rank-name">
                                  <strong>{section.name}</strong>
                                  <i>
                                    <b
                                      style={{
                                        width: `${Math.max(5, (section.kwh / Math.max(dashboard.sections[0].kwh, 1)) * 100)}%`,
                                      }}
                                    />
                                  </i>
                                </span>
                                <span className="rank-value">
                                  <strong>{section.kwh.toFixed(2)}</strong>
                                  <small>kWh</small>
                                </span>
                              </div>
                            ))}
                        </div>
                      ) : (
                        <div className="empty-state compact-empty">
                          No usage recorded for this month.
                        </div>
                      )}
                      {dashboard.highest_section && (
                        <div className="highest-note">
                          <span className="highest-note-icon">
                            <Zap size={15} />
                          </span>
                          <span>
                            Highest this month
                            <strong>{dashboard.highest_section}</strong>
                          </span>
                        </div>
                      )}
                    </article>
                  </section>
                  <section className="panel table-panel">
                    <div className="panel-heading">
                      <div>
                        <span className="eyebrow">LATEST ACTIVITY</span>
                        <h2>Recent submissions</h2>
                      </div>
                      <button
                        className="text-action"
                        onClick={() => setTab("records")}
                      >
                        All submissions <ArrowRight size={14} />
                      </button>
                    </div>
                    <RecordsTable records={dashboard.records.slice(0, 5)} />
                  </section>
                  {dashboard.alerts?.length ? (
                    <section className="panel table-panel">
                      <div className="panel-heading">
                        <div>
                          <span className="eyebrow">USAGE ALERTS</span>
                          <h2>Unusually long sessions</h2>
                        </div>
                        <span className="count-pill">
                          {dashboard.alerts.length} flagged
                        </span>
                      </div>
                      <RecordsTable records={dashboard.alerts} />
                      <p className="alert-legend">
                        Flagged sessions ran 8 hours or more, or over twice
                        the appliance average.
                      </p>
                    </section>
                  ) : null}
                </>
              )}
              {tab === "reports" && (
                <ReportsPanel
                  reports={reports}
                  group={reportGroup}
                  month={month}
                  onGroupChange={(nextGroup) => {
                    setReportGroup(nextGroup);
                    loadReports(nextGroup).catch((error) =>
                      setNotice(error.message),
                    );
                  }}
                />
              )}
              {tab === "rooms" && (
                <>
                  <div className="room-map-heading">
                    <div>
                      <span className="eyebrow">CAMPUS ROOM MAP</span>
                      <p>
                        60 rooms · four floors per building · consumption over
                        the last 30 days
                      </p>
                    </div>
                    <div className="room-status-legend">
                      <span>
                        <i className="room-dot average-dot" /> AVERAGE USE
                      </span>
                      <span title="High = 1.5x or more of the building's per-room average">
                        <i className="room-dot high-dot" /> HIGH CONSUMPTION
                      </span>
                    </div>
                  </div>
                  {!roomsData ? (
                    <div className="panel loading-panel">
                      Loading building rooms...
                    </div>
                  ) : (
                    <>
                      <div className="room-map-tools">
                        <label className="room-search">
                          <Search size={15} aria-hidden="true" />
                          <input
                            type="search"
                            placeholder="Search room, name, or account"
                            aria-label="Search rooms"
                            value={roomQuery}
                            onChange={(event) => setRoomQuery(event.target.value)}
                          />
                        </label>
                        <label className="usage-filter">
                          <input
                            type="checkbox"
                            checked={usageOnly}
                            onChange={(event) =>
                              setUsageOnly(event.target.checked)
                            }
                          />
                          Only rooms with usage
                        </label>
                        <span className="room-count-note">
                          {visibleRooms.length} of {flatRooms.length} rooms
                        </span>
                      </div>
                      <section className="panel table-panel room-rank-panel">
                        <div className="panel-heading">
                          <div>
                            <span className="eyebrow">LAST 30 DAYS</span>
                            <h2>Busiest rooms</h2>
                          </div>
                          <ArrowDownRight
                            className="ranking-icon"
                            size={18}
                            aria-hidden="true"
                          />
                        </div>
                        {busiestRooms.length ? (
                          <div className="section-rank-list">
                            {busiestRooms.map((room, index) => (
                              <button
                                type="button"
                                className="section-rank room-rank"
                                key={room.id}
                                onClick={() => chooseRoom(room)}
                              >
                                <span className="rank-number">
                                  {String(index + 1).padStart(2, "0")}
                                </span>
                                <span className="rank-name">
                                  <strong>{room.display_name}</strong>
                                  <i>
                                    <b
                                      style={{
                                        width: `${Math.max(
                                          5,
                                          (room.average_kwh /
                                            busiestRooms[0].average_kwh) *
                                            100,
                                        )}%`,
                                      }}
                                    />
                                  </i>
                                  <small>
                                    {room.building_name} · floor{" "}
                                    {room.floor}
                                  </small>
                                </span>
                                <span className="rank-value">
                                  <strong>{roomKwh(room.average_kwh)}</strong>
                                  <small>
                                    kWh · {room.submission_count}{" "}
                                    {room.submission_count === 1
                                      ? "submission"
                                      : "submissions"}
                                  </small>
                                </span>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="empty-state compact-empty">
                            No room usage recorded in the last 30 days yet.
                          </div>
                        )}
                      </section>
                      {visibleRooms.length === 0 ? (
                        <div className="panel room-empty-panel">
                          <div className="empty-state compact-empty">
                            No rooms match your search. Try a room number,
                            room name, or account.
                          </div>
                        </div>
                      ) : (
                      <section className="building-grid">
                        {roomsData.buildings
                          .filter((building) =>
                            building.rooms.some(roomMatches),
                          )
                          .map((building) => (
                          <article
                            className="panel building-panel"
                            key={building.code}
                          >
                            <div className="building-heading">
                              <span className="building-icon">
                                <Building2 size={17} />
                              </span>
                              <span>
                                <strong>{building.name}</strong>
                                <small>
                                  {building.rooms.filter(roomMatches).length}{" "}
                                  OF {building.rooms.length} ROOMS · 4 FLOORS
                                </small>
                              </span>
                              <span className="building-average">
                                {roomKwh(building.average_kwh_per_room)}
                                <small>kWh avg</small>
                              </span>
                            </div>
                            <div className="floor-stack">
                              {[4, 3, 2, 1]
                                .filter((floor) =>
                                  building.rooms.some(
                                    (room) =>
                                      room.floor === floor && roomMatches(room),
                                  ),
                                )
                                .map((floor) => (
                                <div
                                  className="floor-row"
                                  key={`${building.code}-${floor}`}
                                >
                                  <span className="floor-label">
                                    <small>FLOOR</small>
                                    <strong>{floor}</strong>
                                  </span>
                                  <div className="floor-rooms">
                                    {building.rooms
                                      .filter(
                                        (room) =>
                                          room.floor === floor &&
                                          roomMatches(room),
                                      )
                                      .map((room) => (
                                        <button
                                          type="button"
                                          key={room.id}
                                          className={`room-tile ${room.usage_status === "high" ? "room-high" : "room-average"}${selectedRoomId === room.id ? " room-selected" : ""}`}
                                          onClick={() => chooseRoom(room)}
                                          aria-pressed={
                                            selectedRoomId === room.id
                                          }
                                          title={`${room.display_name} · ${room.display_type} · ${roomKwh(room.average_kwh)} kWh / 30 days`}
                                        >
                                          <strong>{room.room_number}</strong>
                                          <small>
                                            {roomKwh(room.average_kwh)}
                                          </small>
                                        </button>
                                      ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </article>
                        ))}
                      </section>
                      )}
                      {selectedRoom && (
                        <section className="panel room-detail-panel">
                          <div className="panel-heading room-detail-heading">
                            <div>
                              <span className="eyebrow">ROOM DETAILS</span>
                              <h2>
                                {selectedRoom.display_name} ·{" "}
                                {selectedRoom.building_name}
                              </h2>
                            </div>
                            <span
                              className={`room-status-pill ${selectedRoom.usage_status === "high" ? "pill-high" : "pill-average"}`}
                            >
                              <i />{" "}
                              {selectedRoom.usage_status === "high"
                                ? "HIGH CONSUMPTION"
                                : "AVERAGE USE"}
                            </span>
                          </div>
                          <form onSubmit={saveRoomDetails}>
                            <table className="room-detail-table">
                              <tbody>
                                <tr>
                                  <th>Type of room</th>
                                  <td>
                                    <select
                                      value={roomType}
                                      onChange={(event) =>
                                        setRoomType(event.target.value)
                                      }
                                    >
                                      <option value="classroom">
                                        Classroom
                                      </option>
                                      <option value="office">Office</option>
                                      <option value="custom">
                                        Custom type
                                      </option>
                                    </select>
                                    {roomType === "custom" && (
                                      <input
                                        className="room-custom-type"
                                        value={customRoomType}
                                        onChange={(event) =>
                                          setCustomRoomType(event.target.value)
                                        }
                                        placeholder="Room type"
                                        required
                                        minLength={2}
                                        maxLength={64}
                                      />
                                    )}
                                  </td>
                                </tr>
                                <tr>
                                  <th>Room name</th>
                                  <td>
                                    <input
                                      value={roomName}
                                      onChange={(event) =>
                                        setRoomName(event.target.value)
                                      }
                                      placeholder="Optional custom room name"
                                      maxLength={80}
                                    />
                                  </td>
                                </tr>
                                <tr>
                                  <th>Room number</th>
                                  <td>
                                    <strong className="room-number-value">
                                      {selectedRoom.room_number}
                                    </strong>
                                    <span className="room-number-hint">
                                      Floor {selectedRoom.floor} · room{" "}
                                      {selectedRoom.room_index} from the left
                                    </span>
                                  </td>
                                </tr>
                                <tr>
                                  <th>Average consumption</th>
                                  <td>
                                    <strong className="room-number-value">
                                      {roomKwh(selectedRoom.average_kwh)} kWh
                                    </strong>
                                    <span className="room-number-hint">
                                      Last 30 days ·{" "}
                                      {roomKwh(
                                        selectedRoom.building_average_kwh,
                                      )}{" "}
                                      kWh building average
                                    </span>
                                  </td>
                                </tr>
                                <tr>
                                  <th>Number of appliances</th>
                                  <td>
                                    <strong className="room-number-value">
                                      {selectedRoom.appliance_count}
                                    </strong>
                                    <span className="room-number-hint">
                                      Unique appliances reported in the last 30
                                      days · {selectedRoom.submission_count}{" "}
                                      {selectedRoom.submission_count === 1
                                        ? "submission"
                                        : "submissions"}
                                    </span>
                                  </td>
                                </tr>
                                <tr>
                                  <th>Accounts assigned</th>
                                  <td>
                                    {currentDetail ? (
                                      currentDetail.assigned_users.length ? (
                                        <span className="room-user-chips">
                                          {currentDetail.assigned_users.map(
                                            (account) => (
                                              <span
                                                className="room-user-chip"
                                                key={account}
                                              >
                                                {account}
                                              </span>
                                            ),
                                          )}
                                        </span>
                                      ) : (
                                        <span className="room-number-hint">
                                          No accounts assigned to this room
                                        </span>
                                      )
                                    ) : (
                                      <span className="room-number-hint">
                                        Loading accounts...
                                      </span>
                                    )}
                                  </td>
                                </tr>
                                <tr>
                                  <th>Recent activity</th>
                                  <td>
                                    {!currentDetail ? (
                                      <span className="room-number-hint">
                                        Loading recent submissions...
                                      </span>
                                    ) : currentDetail.recent.length ? (
                                      <ul className="room-recent-list">
                                        {currentDetail.recent.map((record) => (
                                          <li
                                            className="room-recent-item"
                                            key={record.id}
                                          >
                                            <span>
                                              <strong>
                                                {record.appliance}
                                              </strong>{" "}
                                              · {record.username}
                                            </span>
                                            <span>
                                              {roomKwh(record.energy_kwh)} kWh ·{" "}
                                              {new Date(
                                                record.created_at,
                                              ).toLocaleDateString("en-PH", {
                                                month: "short",
                                                day: "numeric",
                                              })}{" "}
                                              {new Date(
                                                record.created_at,
                                              ).toLocaleTimeString("en-PH", {
                                                hour: "numeric",
                                                minute: "2-digit",
                                              })}
                                            </span>
                                          </li>
                                        ))}
                                      </ul>
                                    ) : (
                                      <span className="room-number-hint">
                                        No submissions in the last 30 days.
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                            <div className="room-detail-actions">
                              <span>
                                Room type and name changes apply to this room
                                only.
                              </span>
                              <button
                                className="button button-primary"
                                disabled={busy}
                              >
                                Save room details
                              </button>
                            </div>
                          </form>
                        </section>
                      )}
                    </>
                  )}
                </>
              )}
              {tab === "records" && (
                <section className="panel table-panel">
                  <div className="panel-heading">
                    <div>
                      <span className="eyebrow">{month}</span>
                      <h2>Energy submissions</h2>
                    </div>
                    <span className="count-pill">
                      {dashboard.records.length} records
                    </span>
                  </div>
                  <RecordsTable records={dashboard.records} />
                </section>
              )}
              {tab === "users" && (
                <section className="panel user-monitor-panel">
                  <div className="panel-heading">
                    <div>
                      <span className="eyebrow">ACCOUNT MONITORING</span>
                      <h2>User activity</h2>
                    </div>
                    <span className="count-pill">
                      {dashboard.users.length} accounts
                    </span>
                  </div>
                  <div className="credential-provision">
                    <div>
                      <span className="eyebrow">ISSUE OR RESET ACCESS</span>
                      <p>
                        Create an account and password for a teacher or staff
                        member.
                      </p>
                    </div>
                    <form
                      className="credential-form"
                      onSubmit={saveUserCredentials}
                    >
                      <label>
                        Username
                        <input
                          value={userAccount}
                          onChange={(event) =>
                            setUserAccount(event.target.value)
                          }
                          minLength={2}
                          maxLength={80}
                          autoComplete="off"
                          required
                        />
                      </label>
                      <label>
                        Temporary password
                        <input
                          type="password"
                          value={userPassword}
                          onChange={(event) =>
                            setUserPassword(event.target.value)
                          }
                          minLength={10}
                          autoComplete="new-password"
                          required
                        />
                      </label>
                      <label>
                        Assigned room
                        <select
                          value={userRoomId}
                          onChange={(event) =>
                            setUserRoomId(event.target.value)
                          }
                          required
                        >
                          {roomsData?.buildings.map((building) => (
                            <optgroup key={building.code} label={building.name}>
                              {building.rooms.map((room) => (
                                <option key={room.id} value={room.id}>
                                  {room.room_name || `Room ${room.room_number}`}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      </label>
                      <button className="button button-primary" disabled={busy}>
                        Set credentials
                      </button>
                    </form>
                    {credentialsMessage && (
                      <p className="credential-success" role="status">
                        {credentialsMessage}
                      </p>
                    )}
                  </div>
                  <div className="responsive-table">
                    <table>
                      <thead>
                        <tr>
                          <th>ACCOUNT</th>
                          <th>ASSIGNED ROOM</th>
                          <th>ENTRIES</th>
                          <th>LAST ACTIVE</th>
                          <th>CREDENTIALS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dashboard.users.map((user) => (
                          <tr key={user.username}>
                            <td>
                              <span className="table-user">
                                <span className="account-avatar">
                                  {user.username.slice(0, 1).toUpperCase()}
                                </span>
                                <strong>{user.username}</strong>
                              </span>
                            </td>
                            <td>
                              <select
                                className="user-room-select"
                                value={
                                  user.assigned_room
                                    ? String(user.assigned_room.id)
                                    : ""
                                }
                                onChange={(event) => {
                                  const value = event.target.value;
                                  assignUserRoom(
                                    user.username,
                                    value ? Number(value) : null,
                                  );
                                }}
                                aria-label={`Assign room to ${user.username}`}
                              >
                                <option value="">Unassigned</option>
                                {roomsData?.buildings.map((building) => (
                                  <optgroup
                                    key={building.code}
                                    label={building.name}
                                  >
                                    {building.rooms.map((room) => (
                                      <option key={room.id} value={room.id}>
                                        {room.room_name ||
                                          `Room ${room.room_number}`}
                                      </option>
                                    ))}
                                  </optgroup>
                                ))}
                              </select>
                            </td>
                            <td>{user.records}</td>
                            <td>
                              {new Date(`${user.last_seen}Z`).toLocaleString(
                                "en-PH",
                                { dateStyle: "medium", timeStyle: "short" },
                              )}
                            </td>
                            <td>
                              <span
                                className={`credential-status${user.credentials_set ? " is-ready" : ""}`}
                              >
                                <i />{" "}
                                {user.credentials_set ? "READY" : "NEEDS SETUP"}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!dashboard.users.length && (
                    <div className="empty-state">No user accounts yet.</div>
                  )}
                </section>
              )}
              {tab === "catalog" && (
                <section className="catalog-grid">
                  <div className="panel catalog-panel">
                    <div className="panel-heading">
                      <div>
                        <span className="eyebrow">CLASSROOMS</span>
                        <h2>Sections</h2>
                      </div>
                      <span className="count-pill">
                        {dashboard.sections_catalog.length}
                      </span>
                    </div>
                    <form className="inline-add-form" onSubmit={addSection}>
                      <input
                        value={sectionName}
                        onChange={(event) => setSectionName(event.target.value)}
                        placeholder="New section name"
                        minLength={2}
                        maxLength={80}
                        required
                      />
                      <button
                        className="button button-primary"
                        title="Add section"
                      >
                        <Plus size={16} />
                        <span>Add</span>
                      </button>
                    </form>
                    <div className="catalog-list">
                      {dashboard.sections_catalog.map((section) => (
                        <div className="catalog-row" key={section.id}>
                          <span className="catalog-row-icon">
                            <DoorOpen size={16} />
                          </span>
                          <strong>{section.name}</strong>
                          <button
                            type="button"
                            className="delete-action"
                            title={`Remove ${section.name}`}
                            aria-label={`Remove section ${section.name}`}
                            onClick={() => removeSection(section)}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="panel catalog-panel">
                    <div className="panel-heading">
                      <div>
                        <span className="eyebrow">EQUIPMENT</span>
                        <h2>Appliances</h2>
                      </div>
                      <span className="count-pill">
                        {dashboard.appliances.length}
                      </span>
                    </div>
                    <form
                      className="inline-add-form appliance-add-form"
                      onSubmit={saveAppliance}
                    >
                      <input
                        value={applianceName}
                        onChange={(event) =>
                          setApplianceName(event.target.value)
                        }
                        placeholder={
                          editingId ? "Edit appliance" : "Appliance name"
                        }
                        minLength={2}
                        maxLength={80}
                        required
                      />
                      <input
                        className="watt-input"
                        type="number"
                        min="1"
                        max="100000"
                        value={applianceWatts}
                        onChange={(event) =>
                          setApplianceWatts(event.target.value)
                        }
                        aria-label="Wattage"
                        required
                      />
                      <button
                        className="button button-primary"
                        title={editingId ? "Save appliance" : "Add appliance"}
                      >
                        <Plus size={16} />
                        <span>{editingId ? "Save" : "Add"}</span>
                      </button>
                    </form>
                    <div className="catalog-list">
                      {dashboard.appliances.map((appliance) => (
                        <div className="catalog-row" key={appliance.id}>
                          <span className="catalog-row-icon">
                            <Zap size={16} />
                          </span>
                          <strong>{appliance.name}</strong>
                          <span className="wattage-value">
                            {appliance.wattage} W
                          </span>
                          <button
                            className="edit-action"
                            onClick={() => {
                              setEditingId(appliance.id);
                              setApplianceName(appliance.name);
                              setApplianceWatts(appliance.wattage);
                            }}
                            aria-label={`Edit ${appliance.name}`}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="delete-action"
                            title={`Remove ${appliance.name}`}
                            aria-label={`Remove appliance ${appliance.name}`}
                            onClick={() => removeAppliance(appliance)}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              )}
            </>
          )}
        </section>
      </div>
      <footer className="admin-footer">
        <span>
          WATTWISE MCS{" "}
          <span className="footer-year">/ CLASSROOM POWER MONITOR</span>
        </span>
        <span>ESTIMATES ONLY · NOT METER TELEMETRY</span>
      </footer>
    </main>
  );
}

function ReportsPanel({ reports, group, month, onGroupChange }) {
  const patterns = reports?.patterns;
  const cards = [
    {
      label: "PEAK WEEKDAY",
      value: patterns?.peak_weekday?.day || "—",
      note: patterns?.peak_weekday
        ? `${patterns.peak_weekday.kwh.toFixed(2)} kWh`
        : "No usage this month",
    },
    {
      label: "PEAK START HOUR",
      value: patterns?.peak_hour?.hour || "—",
      note: patterns?.peak_hour
        ? `${patterns.peak_hour.kwh.toFixed(2)} kWh started`
        : "No usage this month",
    },
    {
      label: "TOP APPLIANCE",
      value: patterns?.top_appliance?.name || "—",
      note: patterns?.top_appliance
        ? `${patterns.top_appliance.kwh.toFixed(2)} kWh`
        : "No usage this month",
    },
    {
      label: "BUSIEST ROOM",
      value: patterns?.busiest_room?.room || "—",
      note: patterns?.busiest_room
        ? `${patterns.busiest_room.kwh.toFixed(2)} kWh`
        : "No usage this month",
    },
  ];
  return (
    <>
      <section className="user-summary reports-patterns">
        {cards.map((card) => (
          <article className="summary-tile" key={card.label}>
            <span className="summary-label">{card.label}</span>
            <strong>{card.value}</strong>
            <span className="summary-note">{card.note}</span>
          </article>
        ))}
      </section>
      <section className="panel table-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">{month}</span>
            <h2>Usage report</h2>
          </div>
          <label className="section-choice">
            <span>GROUP BY</span>
            <select
              value={group}
              onChange={(event) => onGroupChange(event.target.value)}
            >
              <option value="day">Day</option>
              <option value="week">Week</option>
              <option value="month">Month</option>
            </select>
          </label>
        </div>
        {reports ? (
          reports.buckets.some((bucket) => bucket.sessions > 0) ? (
            <div className="responsive-table">
              <table>
                <thead>
                  <tr>
                    <th>PERIOD</th>
                    <th>SESSIONS</th>
                    <th>ENERGY</th>
                    <th>EST. COST</th>
                    <th>TOP APPLIANCE</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.buckets.map((bucket) => (
                    <tr key={bucket.period}>
                      <td>{bucket.period}</td>
                      <td>{bucket.sessions}</td>
                      <td>
                        <strong className="energy-cell">
                          {bucket.kwh.toFixed(2)} kWh
                        </strong>
                      </td>
                      <td>{money(bucket.bill)}</td>
                      <td>{bucket.top_appliance || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              <span className="empty-mark">
                <ClipboardList size={22} />
              </span>
              <strong>No usage in this month</strong>
              <span>New entries from user accounts will appear here.</span>
            </div>
          )
        ) : (
          <div className="panel loading-panel">Loading report...</div>
        )}
        {patterns?.avg_occupants != null && (
          <p className="alert-legend">
            Average {patterns.avg_occupants} occupants per recorded session.
          </p>
        )}
      </section>
    </>
  );
}

function RecordsTable({ records }) {
  return records.length ? (
    <div className="responsive-table">
      <table>
        <thead>
          <tr>
            <th>SUBMITTED BY</th>
            <th>SECTION</th>
            <th>APPLIANCE</th>
            <th>TIME</th>
            <th>ENERGY</th>
            <th>EST. COST</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={record.id}>
              <td>
                <span className="table-user">
                  <span className="account-avatar small-avatar">
                    {record.username.slice(0, 1).toUpperCase()}
                  </span>
                  {record.username}
                </span>
              </td>
              <td>{record.section}</td>
              <td>
                {record.appliance}
                {record.flags?.length ? (
                  <span className="flag-row">
                    {record.flags.map((flag) => (
                      <span
                        key={flag}
                        className={`flag-pill${flag === "unusual-duration" ? " flag-red" : ""}`}
                        title={
                          flag === "extended-use"
                            ? "Session ran 8 hours or more"
                            : "Session is unusually long for this appliance"
                        }
                      >
                        {flag === "extended-use" ? "EXTENDED" : "UNUSUAL"}
                      </span>
                    ))}
                  </span>
                ) : null}
              </td>
              <td>
                {parseFloat(record.hours.toFixed(2))} hr
                <span className="cell-sub">
                  {new Date(record.created_at).toLocaleDateString("en-PH", {
                    month: "short",
                    day: "numeric",
                  })}{" "}
                  {new Date(record.created_at).toLocaleTimeString("en-PH", {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              </td>
              <td>
                <strong className="energy-cell">
                  {record.energy_kwh.toFixed(2)} kWh
                </strong>
              </td>
              <td>{money(record.estimated_cost_php)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <div className="empty-state">
      <span className="empty-mark">
        <ClipboardList size={22} />
      </span>
      <strong>No submissions in this month</strong>
      <span>New entries from user accounts will be listed here.</span>
    </div>
  );
}

export default function App() {
  const path = window.location.pathname.replace(/\/$/, "") || "/mcs";
  if (path === "/mcs/user") return <UserPortal />;
  if (path === "/mcs/admin") return <AdminPortal />;
  return <RoleChoice />;
}
