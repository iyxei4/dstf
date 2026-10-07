import { useEffect, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import {
  Activity,
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  Bolt,
  Building2,
  Check,
  ChevronDown,
  ClipboardList,
  Clock3,
  DoorOpen,
  LogOut,
  Moon,
  Plus,
  Power,
  ShieldCheck,
  Search,
  Settings,
  Sun,
  Trash2,
  UserPlus,
  Users,
  X,
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
// Mirrors the backend UsageRequest.hours ceiling (le=24). The live preview and
// the ON/OFF timer both clamp to this so what a user sees on screen is exactly
// what POST /api/records will store.
const MAX_HOURS = 24;

// Preset appliance catalog, from the approved table. `watts` feeds straight
// into E = P x t / 1000. The classroom set the school tests with:
//   2 x Electric fan + 1 x TV + 1 x Water Dispenser
//   = 2(55) + 100 + 500 = 710 W connected load
// and over time: 4h -> 2.84 kWh, 8h -> 5.68 kWh, 12h -> 8.52 kWh.
const APPLIANCE_PRESETS = [
  { name: "Electric fan", watts: 55 },
  { name: "TV", watts: 100 },
  { name: "Printer", watts: 100 },
  { name: "Water Dispenser", watts: 500 },
  { name: "Linear Fluorescent Light", watts: 40 },
  { name: "Desktop Computer", watts: 135 },
];

// Watts are the stored unit; kWh per hour of use is watts / 1000. Both are
// shown so figures can be read against either the table or the formula.
function kwhPerHourOf(watts) {
  return Number(((watts || 0) / 1000).toFixed(4));
}


// <input type="date"> wants a local YYYY-MM-DD string; toISOString() would
// shift the day for anyone east of UTC, so build it from local parts.
function localDateValue(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;
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

const phpMoney = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 2,
});

function money(value) {
  return phpMoney.format(value || 0);
}

// kWh values arrive already rounded to the API's KWH_PRECISION. Show that exact
// value (trailing zeros trimmed) so a reader can multiply it by the rate and
// land on the same bill the API reported.
function kwhText(value) {
  const text = Number(value || 0).toFixed(4);
  return text.replace(/\.?0+$/, "") || "0";
}

// Connected load of one appliance row: unit wattage x how many units it covers
// ("2 electric fans" is one row with quantity 2). Prefers the server-computed
// connected_watts so the client never disagrees with the API.
function connectedWattsOf(appliance) {
  if (!appliance) return 0;
  return typeof appliance.connected_watts === "number"
    ? appliance.connected_watts
    : appliance.wattage * (appliance.quantity || 1);
}

function roomKwh(value) {
  if (!value) return "0.0";
  if (value < 0.0001) return "<0.0001";
  if (value < 0.01) return value.toFixed(4);
  if (value < 1) return value.toFixed(3);
  return value.toFixed(2);
}

// Sections arrive as "11 - BERNOULLI"; group them for <optgroup> so a
// 40-plus item catalog stays navigable in a plain <select>.
function groupSectionsByGrade(sections) {
  const groups = new Map();
  sections.forEach((section) => {
    const grade = section.grade || section.name.split(" - ")[0] || "";
    if (!groups.has(grade)) groups.set(grade, []);
    groups.get(grade).push(section);
  });
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([grade, items]) => ({
      grade,
      label: grade ? `Grade ${grade}` : "Other",
      items,
    }));
}

function Brand({ compact = false }) {
  return (
    <a className={`brand${compact ? " brand-compact" : ""}`} href="/mcs">
      <span className="brand-icon">
        <Bolt size={18} fill="currentColor" />
      </span>
      <span className="brand-word">
        wattwise<span>.</span>
      </span>
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
          <a href="/mcs/about">ABOUT THIS APP</a>
          <span className="footer-sep">·</span>
          WATTWISE MCS <span className="footer-year">/ 2026</span>
        </span>
      </footer>
    </main>
  );
}

// Subscribes to Supabase Realtime changes on one or more tables and calls the
// latest handler (debounced, so a burst of events across those tables triggers
// a single refresh). `match` can drop payloads before the debounce — e.g. only
// this account's row. When the env vars are missing or the handler is null, it
// stays inert.
function useLiveTables(tables, handler, match) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const matchRef = useRef(match);
  matchRef.current = match;
  const active = Boolean(handler);
  const tableKey = tables.join(",");
  useEffect(() => {
    if (!supabase || !active) return undefined;
    let timer = null;
    const fire = () => {
      if (timer) return;
      timer = window.setTimeout(() => {
        timer = null;
        if (handlerRef.current) handlerRef.current();
      }, 700);
    };
    const channel = supabase.channel(
      `live:${tableKey}:${Math.random().toString(36).slice(2)}`,
    );
    for (const table of tableKey.split(",")) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        (payload) => {
          if (matchRef.current && !matchRef.current(payload)) return;
          fire();
        },
      );
    }
    channel.subscribe();
    return () => {
      if (timer) window.clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [tableKey, active]);
}

function SignupPage() {
  const { darkMode, toggleTheme } = useTheme();
  const [sections, setSections] = useState([]);
  const [sectionId, setSectionId] = useState("");
  const [signupUsername, setSignupUsername] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(null);

  useEffect(() => {
    request("/sections")
      .then((data) => {
        setSections(data);
        setSectionId((current) => current || String(data[0]?.id || ""));
      })
      .catch((error) => setNotice(error.message));
  }, []);

  async function register(event) {
    event.preventDefault();
    setNotice("");
    if (signupPassword !== confirmPassword) {
      setNotice("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const result = await request("/users/register", {
        method: "POST",
        body: JSON.stringify({
          username: signupUsername,
          password: signupPassword,
          section_id: Number(sectionId),
        }),
      });
      setCreated(result);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  const signupTopbar = (
    <Topbar
      subtitle="USER REGISTRATION"
      right={
        <>
          <ThemeToggle darkMode={darkMode} onToggle={toggleTheme} />
          <a className="topbar-link" href="/mcs">
            <ArrowLeft size={15} /> All workspaces
          </a>
        </>
      }
    />
  );

  if (created) {
    return (
      <main className="auth-page">
        {signupTopbar}
        <section className="auth-layout">
          <div className="auth-aside">
            <span className="auth-aside-number">02 / SIGNUP</span>
            <div className="auth-aside-mark">
              <UserPlus size={30} />
            </div>
            <h1>
              One step
              <br />
              to go.
            </h1>
            <p>Every new account is reviewed by an administrator first.</p>
            <div className="auth-aside-line" />
          </div>
          <div className="auth-form signup-success">
            <span className="signup-check">
              <Check size={28} />
            </span>
            <div className="eyebrow">ACCOUNT REQUESTED</div>
            <h2>Almost there, {created.username}.</h2>
            <p className="form-intro">
              Your account for <strong>{created.section?.name}</strong> is
              waiting for administrator approval. You can sign in as soon as it
              is approved.
            </p>
            <a className="button button-primary button-wide" href="/mcs/user">
              <ArrowLeft size={16} /> Back to sign in
            </a>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-page">
      {signupTopbar}
      <section className="auth-layout">
        <div className="auth-aside">
          <span className="auth-aside-number">02 / SIGNUP</span>
          <div className="auth-aside-mark">
            <UserPlus size={30} />
          </div>
          <h1>
            Join your
            <br />
            classroom.
          </h1>
          <p>
            Register once, pick your section, and an administrator opens the
            door.
          </p>
          <div className="auth-aside-line" />
        </div>
        <form className="auth-form" onSubmit={register}>
          <div className="eyebrow">NEW ACCOUNT</div>
          <h2>Create your account</h2>
          <p className="form-intro">
            Choose your classroom section and a username. Your administrator
            approves the account before you can sign in.
          </p>
          <label className="field-label">
            Classroom section
            <select
              value={sectionId}
              onChange={(event) => setSectionId(event.target.value)}
              required
            >
              {sections.length ? (
                groupSectionsByGrade(sections).map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.items.map((section) => (
                      <option key={section.id} value={section.id}>
                        {section.name}
                      </option>
                    ))}
                  </optgroup>
                ))
              ) : (
                <option value="">No sections available</option>
              )}
            </select>
            <ChevronDown className="select-chevron" size={16} />
          </label>
          <label className="field-label">
            Account name
            <input
              autoComplete="username"
              value={signupUsername}
              onChange={(event) => setSignupUsername(event.target.value)}
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
              autoComplete="new-password"
              value={signupPassword}
              onChange={(event) => setSignupPassword(event.target.value)}
              placeholder="At least 8 characters"
              required
              minLength={8}
            />
          </label>
          <label className="field-label">
            Confirm password
            <input
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
              minLength={8}
            />
          </label>
          <Notice>{notice}</Notice>
          <button
            className="button button-primary button-wide"
            disabled={busy || !sections.length}
          >
            {busy ? "Creating account..." : "Request approval"}
            <ArrowRight size={16} />
          </button>
          <p className="auth-footnote">
            Already have an account? <a href="/mcs/user">Sign in instead</a>.
          </p>
        </form>
      </section>
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
  const [accountSection, setAccountSection] = useState(null);
  const [appliances, setAppliances] = useState([]);
  const [assignedRoom, setAssignedRoom] = useState(null);
  const [records, setRecords] = useState([]);
  const [roomId, setRoomId] = useState("");
  const [occupants, setOccupants] = useState("");
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualAppliance, setManualAppliance] = useState("");
  const [manualHours, setManualHours] = useState("");
  // Defaults to today; the picker lets a teacher backfill the real usage date.
  const [manualDate, setManualDate] = useState(() => localDateValue());
  // User settings drawer: appliance add/remove lives here now.
  const [showSettings, setShowSettings] = useState(false);
  const [presetChoice, setPresetChoice] = useState("");
  // Mirrors MCS_ELECTRICITY_RATE from the API so the live preview shows the
  // exact bill the server will compute, never a hardcoded guess.
  const [ratePerKwh, setRatePerKwh] = useState(12);
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

  // Manual-entry preview: E = P × t ÷ 1000, then bill = kWh × rate. Hours are
  // clamped to the same ceiling the API enforces, so the preview always
  // matches the stored record.
  const manualApplianceRow = appliances.find(
    (item) => String(item.id) === manualAppliance,
  );
  const manualHoursValue = Math.min(
    MAX_HOURS,
    Math.max(0, Number.parseFloat(manualHours) || 0),
  );
  const manualKwh = manualApplianceRow
    ? Number(
        (
          (connectedWattsOf(manualApplianceRow) * manualHoursValue) /
          1000
        ).toFixed(4),
      )
    : 0;
  const manualBill = manualKwh * ratePerKwh;
  const manualValid =
    Boolean(manualApplianceRow) && manualHoursValue > 0 && Boolean(manualDate);

  // Connected load: the whole classroom's wattage, i.e. SUM(unit W x units).
  // This is the P that E = P x t / 1000 uses when every appliance runs.
  const connectedWatts = appliances.reduce(
    (sum, item) => sum + connectedWattsOf(item),
    0,
  );

  // Settings: presets the workspace has not added yet, so the picker never
  // offers a duplicate.
  const takenNames = new Set(
    appliances.map((item) => item.name.trim().toLowerCase()),
  );
  const availablePresets = APPLIANCE_PRESETS.filter(
    (preset) => !takenNames.has(preset.name.toLowerCase()),
  );
  const presetRow = APPLIANCE_PRESETS.find(
    (preset) => preset.name === presetChoice,
  );

  async function loadWorkspace() {
    const [nextAppliances, nextRecords, session] = await Promise.all([
      request("/appliances"),
      request("/users/me/records"),
      request("/users/session"),
    ]);
    setAppliances(nextAppliances);
    setRecords(nextRecords);
    setAssignedRoom(session.assigned_room);
    setRoomId(session.assigned_room ? String(session.assigned_room.id) : "");
    setAccountSection(session.section || null);
    if (session.rate_php_per_kwh) setRatePerKwh(session.rate_php_per_kwh);
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

  // Only this account's row matters here: without the payload filter, every
  // other account's last_seen heartbeat would reload this whole workspace.
  // DELETE payloads carry only the row id, so they always pass through — that
  // keeps the instant sign-out when an admin removes this account.
  useLiveTables(
    ["classroom_users"],
    signedIn ? () => loadWorkspace().catch(() => {}) : null,
    (payload) =>
      payload.eventType === "DELETE" ||
      (payload.new?.username ?? payload.old?.username) === username,
  );

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
      setAccountSection(account.section || null);
      if (account.rate_php_per_kwh) setRatePerKwh(account.rate_php_per_kwh);
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

  async function addPresetAppliance(event) {
    event.preventDefault();
    if (!presetRow) return;
    setBusy(true);
    setNotice("");
    setSuccess("");
    try {
      const created = await request("/appliances", {
        method: "POST",
        body: JSON.stringify({ name: presetRow.name, wattage: presetRow.watts }),
      });
      setAppliances((current) =>
        [...current, created].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setPresetChoice("");
      setSuccess(`${created.name} added at ${created.wattage} W.`);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  // One save path for the settings table: changing the type, the unit count,
  // or both re-uses it so the PUT payload can never drop a field.
  async function saveAppliance(appliance, patch) {
    setBusy(true);
    setNotice("");
    setSuccess("");
    try {
      const updated = await request(`/appliances/${appliance.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: patch.name ?? appliance.name,
          wattage: patch.wattage ?? appliance.wattage,
          quantity: patch.quantity ?? (appliance.quantity || 1),
        }),
      });
      setAppliances((current) =>
        current
          .map((item) => (item.id === updated.id ? updated : item))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
      setSuccess(
        `${updated.name} · ${updated.quantity} × ${updated.wattage} W = ` +
          `${updated.connected_watts} W connected.`,
      );
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  // Re-typing a row updates its name and wattage, so every future kWh
  // calculation for that appliance uses the new rating.
  function updateApplianceType(appliance, presetName) {
    const preset = APPLIANCE_PRESETS.find((item) => item.name === presetName);
    if (!preset || preset.name === appliance.name) return;
    saveAppliance(appliance, { name: preset.name, wattage: preset.watts });
  }

  function updateApplianceQuantity(appliance, value) {
    const quantity = Math.max(1, Math.min(999, Math.floor(Number(value) || 1)));
    if (quantity === (appliance.quantity || 1)) return;
    saveAppliance(appliance, { quantity });
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
        MAX_HOURS,
        Math.max(0.0001, (Date.now() - session.startedAt) / 3_600_000),
      );
      const saved = await request("/records", {
        method: "POST",
        body: JSON.stringify({
          room_id: session.roomId,
          appliance_id: appliance.id,
          hours: elapsedHours,
          occupants:
            occupants === ""
              ? null
              : Math.max(0, Math.floor(Number(occupants) || 0)),
          started_at: new Date(session.startedAt).toISOString(),
        }),
      });
      setRecords((current) => [saved, ...current]);
      setSuccess(
        `${saved.appliance} stopped · ${kwhText(saved.energy_kwh)} kWh recorded for ${saved.section}.`,
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

  async function submitManualUsage(event) {
    event.preventDefault();
    if (!manualApplianceRow || manualHoursValue <= 0) return;
    if (!assignedRoom) {
      setNotice("Ask an administrator to assign your room first.");
      return;
    }
    setBusy(true);
    setNotice("");
    setSuccess("");
    try {
      const saved = await request("/records", {
        method: "POST",
        body: JSON.stringify({
          room_id: assignedRoom.id,
          appliance_id: manualApplianceRow.id,
          hours: Math.min(MAX_HOURS, manualHoursValue),
          occupants:
            occupants === ""
              ? null
              : Math.max(0, Math.floor(Number(occupants) || 0)),
          // Naive local datetime: the API stores it as-is, and building it by
          // hand avoids toISOString() shifting the day across time zones.
          started_at: `${manualDate || localDateValue()}T12:00:00`,
        }),
      });
      // The server's numbers are canonical — replace the preview with them.
      setRecords((current) => [saved, ...current]);
      setSuccess(
        `${saved.appliance} · ${saved.hours.toFixed(2)} h on ${manualDate} — ` +
          `${kwhText(saved.energy_kwh)} kWh, ${money(saved.estimated_cost_php)}.`,
      );
      setShowManualForm(false);
      setManualAppliance("");
      setManualHours("");
      setManualDate(localDateValue());
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
            <span className="auth-aside-number">01 / @MCS</span>
            <div className="auth-aside-mark">
              <Zap size={30} fill="currentColor" />
            </div>
            <h1>
              Make your
              <br />
              room count.
            </h1>
            <p>Record what your classroom uses. Make every energy count.</p>
            <div className="auth-aside-line" />
          </div>
          <form className="auth-form" onSubmit={signIn}>
            <h2>Welcome!</h2>
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
            <p className="auth-alt-link">
              No account yet? <a href="/mcs/user/signup">Register for one</a>
            </p>
          </form>
        </section>
      </main>
    );
  }

  // Round the logged total once, then derive the bill from that same value so
  // displayed kWh x rate always equals displayed cost.
  const totalKwh = Number(
    records.reduce((sum, item) => sum + item.energy_kwh, 0).toFixed(4),
  );
  const totalBill = totalKwh * ratePerKwh;
  // E = P x t / 1000 for one device; E_total = SUM(P_i x t_i) / 1000 across
  // devices. Both are derived once here so the table, footer, and formula card
  // can never disagree about a value.
  const applianceRows = appliances.map((appliance) => {
    const session = running[appliance.id];
    // Clamp to MAX_HOURS so a forgotten timer can never preview more energy
    // than the API will accept when the session is stopped.
    const elapsedSeconds = session
      ? Math.min(
          MAX_HOURS * 3600,
          Math.max(0, Math.floor((now - session.startedAt) / 1000)),
        )
      : 0;
    const loggedKwh = records
      .filter((record) => record.appliance_id === appliance.id)
      .reduce((total, record) => total + record.energy_kwh, 0);
    const sessionKwh = session
      ? (connectedWattsOf(appliance) * elapsedSeconds) / 3_600_000
      : 0;
    const loggedSessions = records.filter(
      (record) => record.appliance_id === appliance.id,
    ).length;
    return {
      appliance,
      session,
      elapsedSeconds,
      loggedKwh,
      connectedWatts: connectedWattsOf(appliance),
      // Live figure for this device only while its timer runs.
      sessionKwh,
      // Row value: saved history for the appliance plus the live session, so
      // the footer really is "sum of every row above".
      estimatedKwh: loggedKwh + sessionKwh,
      loggedSessions,
    };
  });
  // Grand total across every appliance (history + anything running now).
  const grandTotalKwh = applianceRows.reduce(
    (sum, row) => sum + row.estimatedKwh,
    0,
  );
  // Live-within-a-session total: E_total = SUM(P_i x t_i) / 1000 over the
  // appliances running right now. Idle appliances contribute nothing, so this
  // never mixes saved history into the live figure.
  const liveTotalKwh = applianceRows.reduce(
    (sum, row) => sum + row.sessionKwh,
    0,
  );

  return (
    <main className="workspace-page">
      <Topbar
        subtitle="USER WORKSPACE"
        right={
          <>
            <ThemeToggle darkMode={darkMode} onToggle={toggleTheme} />
            <button
              type="button"
              className={`icon-button${showSettings ? " is-active" : ""}`}
              onClick={() => setShowSettings((open) => !open)}
              title="User settings"
              aria-label="User settings"
              aria-expanded={showSettings}
            >
              <Settings size={17} />
            </button>
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
      {showSettings && (
        <section className="panel settings-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">USER SETTINGS</span>
              <h2>Select your appliances</h2>
            </div>
            <button
              type="button"
              className="icon-button"
              onClick={() => setShowSettings(false)}
              title="Close settings"
              aria-label="Close settings"
            >
              <X size={17} />
            </button>
          </div>
          <p className="settings-help">
            Choose an appliance type to add it to your classroom list. Each type
            carries a preset wattage that feeds the E = P × t ÷ 1000 estimate.
          </p>
          <form className="settings-add" onSubmit={addPresetAppliance}>
            <label className="manual-field">
              <span>Type of appliance</span>
              <select
                value={presetChoice}
                onChange={(event) => setPresetChoice(event.target.value)}
              >
                <option value="">Choose an appliance type…</option>
                {availablePresets.map((preset) => (
                  <option key={preset.name} value={preset.name}>
                    {preset.name} · {preset.watts} W
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="button button-primary"
              disabled={busy || !presetRow}
            >
              <Plus size={15} /> Add appliance
            </button>
          </form>
          <div className="responsive-table settings-table-wrap">
            <table className="settings-table">
              <thead>
                <tr>
                  <th>NAME</th>
                  <th>TYPE OF APPLIANCE</th>
                  <th className="qty-col">QTY</th>
                  <th>CONNECTED LOAD</th>
                  <th aria-label="Remove" />
                </tr>
              </thead>
              <tbody>
                {appliances.map((appliance) => {
                  const isKnownPreset = APPLIANCE_PRESETS.some(
                    (preset) => preset.name === appliance.name,
                  );
                  return (
                    <tr key={appliance.id}>
                      <td data-label="Name">
                        <strong>{appliance.name}</strong>
                        <small>
                          {kwhPerHourOf(appliance.wattage)} kWh/h each
                        </small>
                      </td>
                      <td data-label="Type of appliance">
                        <select
                          value={appliance.name}
                          disabled={busy}
                          onChange={(event) =>
                            updateApplianceType(appliance, event.target.value)
                          }
                          aria-label={`Type for ${appliance.name}`}
                        >
                          {!isKnownPreset && (
                            <option value={appliance.name}>
                              {appliance.name} ·{" "}
                              {kwhPerHourOf(appliance.wattage)} kWh/h
                            </option>
                          )}
                          {APPLIANCE_PRESETS.map((preset) => (
                            <option key={preset.name} value={preset.name}>
                              {preset.name} · {preset.watts} W
                            </option>
                          ))}
                        </select>
                      </td>
                      <td data-label="Quantity" className="qty-col">
                        <input
                          type="number"
                          min="1"
                          max="999"
                          step="1"
                          className="qty-input"
                          key={`${appliance.id}-${appliance.quantity || 1}`}
                          defaultValue={appliance.quantity || 1}
                          disabled={busy}
                          aria-label={`Units of ${appliance.name}`}
                          onBlur={(event) =>
                            updateApplianceQuantity(appliance, event.target.value)
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter") event.currentTarget.blur();
                          }}
                        />
                      </td>
                      <td data-label="Connected load">
                        <strong className="connected-load-cell">
                          {connectedWattsOf(appliance)} W
                        </strong>
                        <small>
                          {kwhPerHourOf(connectedWattsOf(appliance))} kWh/h
                          {(appliance.quantity || 1) > 1
                            ? ` · ${appliance.quantity} × ${appliance.wattage} W`
                            : ""}
                        </small>
                      </td>
                      <td data-label="Remove">
                        <button
                          type="button"
                          className="delete-action"
                          disabled={busy || Boolean(running[appliance.id])}
                          title={
                            running[appliance.id]
                              ? "Turn this appliance off before removing it"
                              : `Remove ${appliance.name}`
                          }
                          aria-label={`Remove appliance ${appliance.name}`}
                          onClick={() => removeAppliance(appliance)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!appliances.length && (
              <div className="empty-state compact-empty">
                No appliances yet — add one from the dropdown above.
              </div>
            )}
          </div>
        </section>
      )}
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
      <section className="user-stack">
        <section className="panel appliance-list-panel">
          <div className="panel-heading appliance-list-heading">
            <div>
              <span className="eyebrow">LIVE APPLIANCE LOG</span>
              <h2>Classroom appliances</h2>
            </div>
            <button
              type="button"
              className="button button-outline add-appliance-trigger"
              onClick={() => setShowSettings(true)}
            >
              <Settings size={15} /> Manage appliances
            </button>
          </div>
          <div className="appliance-table-tools">
            <div className="manual-record-trigger">
              <button
                type="button"
                className={`button button-outline${showManualForm ? " is-active" : ""}`}
                onClick={() => setShowManualForm((open) => !open)}
                aria-expanded={showManualForm}
              >
                <Clock3 size={15} />{" "}
                {showManualForm ? "Close custom time" : "Custom time"}
              </button>
            </div>
            {showManualForm && (
              <div className="manual-record-form">
                <div className="manual-form-header">
                  <span className="eyebrow">CUSTOM TIME ENTRY</span>
                  <p>
                    Forgot to start your timer? Log hours you missed below.
                  </p>
                </div>
                <div className="manual-form-grid">
                  <label className="manual-field">
                    <span>Appliance</span>
                    <select
                      value={manualAppliance}
                      onChange={(event) => setManualAppliance(event.target.value)}
                    >
                      <option value="">Select an appliance…</option>
                      {appliances.map((appliance) => (
                        <option key={appliance.id} value={appliance.id}>
                          {appliance.name} · {connectedWattsOf(appliance)} W
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="manual-field">
                    <span>Hours used (t)</span>
                    <input
                      type="number"
                      min="0.1"
                      max={MAX_HOURS}
                      step="0.1"
                      placeholder="e.g. 2.5"
                      value={manualHours}
                      onChange={(event) => setManualHours(event.target.value)}
                    />
                  </label>
                  <label className="manual-field">
                    <span>Date of use</span>
                    <input
                      type="date"
                      value={manualDate}
                      max={localDateValue()}
                      onChange={(event) => setManualDate(event.target.value)}
                      required
                    />
                  </label>
                </div>
                <div className="manual-calc-preview" aria-live="polite">
                  <div className="manual-calc-row">
                    <span className="manual-calc-label">FORMULA</span>
                    <code>
                      E ={" "}
                      {manualApplianceRow
                        ? connectedWattsOf(manualApplianceRow)
                        : "P"}{" "}
                      W × {manualHoursValue || "t"} h ÷ 1000
                    </code>
                  </div>
                  <div className="manual-calc-row">
                    <span className="manual-calc-label">LOGGED FOR</span>
                    <code>
                      {manualDate
                        ? new Date(`${manualDate}T00:00:00`).toLocaleDateString(
                            "en-PH",
                            {
                              weekday: "short",
                              year: "numeric",
                              month: "short",
                              day: "numeric",
                            },
                          )
                        : "Pick a date"}
                    </code>
                  </div>
                  <div className="manual-calc-totals">
                    <div className="manual-calc-item">
                      <span className="manual-calc-label">ESTIMATED ENERGY</span>
                      <strong>{kwhText(manualKwh)} kWh</strong>
                    </div>
                    <div className="manual-calc-item">
                      <span className="manual-calc-label">
                        EST. BILL · {ratePerKwh}/kWh
                      </span>
                      <strong>{money(manualBill)}</strong>
                    </div>
                  </div>
                </div>
                <div className="manual-form-actions">
                  <button
                    type="button"
                    className="button"
                    onClick={() => setShowManualForm(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="button button-primary"
                    disabled={busy || !manualValid || !assignedRoom}
                    onClick={submitManualUsage}
                  >
                    {busy ? "Saving…" : "Submit record"}
                  </button>
                </div>
                {!assignedRoom && (
                  <small className="manual-form-hint">
                    A room must be assigned to your account before you can log
                    usage.
                  </small>
                )}
              </div>
            )}
            <div
              className="section-choice section-fixed"
              title={accountSection?.name}
            >
              <span>CLASSROOM SECTION</span>
              <strong>
                {accountSection ? accountSection.name : "Not set"}
              </strong>
            </div>
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
            <div className="formula-block">
              <div className="formula-block-title">
                <Bolt size={14} fill="currentColor" /> POWER CONSUMPTION FORMULAS
              </div>
              <div>
                • Individual device: <strong>E = P × t ÷ 1000</strong> — kWh =
                watts × hours ÷ 1000
              </div>
              <div>
                • Multiple devices:{" "}
                <strong>
                  E<sub>total</sub> = Σ (P<sub>i</sub> × t<sub>i</sub>) ÷ 1000
                </strong>{" "}
                — sum each device's own kWh
              </div>
              <div className="formula-load">
                <span className="formula-load-label">CONNECTED LOAD</span>
                <strong key={connectedWatts} data-testid="connected-load">
                  {kwhText(connectedWatts)} W
                </strong>
                <span className="formula-load-note">
                  = {kwhPerHourOf(connectedWatts)} kWh/h · Σ (unit W × units)
                  across {appliances.length}{" "}
                  {appliances.length === 1 ? "appliance" : "appliances"}
                </span>
              </div>
              <div className="formula-total">
                <span>
                  Running now (
                  {applianceRows.filter((row) => row.session).length} of{" "}
                  {appliances.length} appliances):
                </span>
                <output key={liveTotalKwh.toFixed(4)}>
                  {liveTotalKwh.toFixed(4)} kWh
                </output>
              </div>
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
                {applianceRows.map(
                  ({
                    appliance,
                    session,
                    elapsedSeconds,
                    estimatedKwh,
                    sessionKwh,
                    loggedSessions,
                  }) => (
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
                            <small>
                              {connectedWattsOf(appliance)} W
                              {(appliance.quantity || 1) > 1
                                ? ` (${appliance.quantity} × ${appliance.wattage} W)`
                                : ""}
                            </small>
                          </span>
                        </span>
                      </td>
                      <td data-label="Estimated kwh">
                        <span className="appliance-estimate-cell">
                          <strong key={estimatedKwh.toFixed(4)}>
                            {estimatedKwh.toFixed(4)} kWh
                          </strong>
                          <small>
                            {session
                              ? `${String(Math.floor(elapsedSeconds / 3600)).padStart(2, "0")}:${String(Math.floor((elapsedSeconds % 3600) / 60)).padStart(2, "0")}:${String(elapsedSeconds % 60).padStart(2, "0")} elapsed · +${sessionKwh.toFixed(4)} kWh now`
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
                              busy || (!session && (!accountSection || !roomId))
                            }
                            onClick={() =>
                              session
                                ? stopAppliance(appliance)
                                : startAppliance(appliance)
                            }
                          >
                            <Power size={15} /> {session ? "OFF" : "ON"}
                          </button>
                        </span>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
              {applianceRows.length > 0 && (
                <tfoot>
                  <tr>
                    <td data-label="Total">
                      <span className="appliance-name-cell">
                        <span>
                          <strong>
                            E<sub>total</sub> = Σ (P<sub>i</sub> × t
                            <sub>i</sub>) ÷ 1000
                          </strong>
                          <small>Sum of every row above</small>
                        </span>
                      </span>
                    </td>
                    <td data-label="Total kwh">
                      <span className="appliance-estimate-cell">
                        <strong>{grandTotalKwh.toFixed(4)} kWh</strong>
                        <small>Saved history + running</small>
                      </span>
                    </td>
                    <td />
                  </tr>
                </tfoot>
              )}
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
                      {record.section} · {parseFloat(record.hours.toFixed(2))}{" "}
                      hr
                      {record.hours === 1 ? "" : "s"}
                      {record.occupants != null
                        ? ` · ${record.occupants} occupant${record.occupants === 1 ? "" : "s"}`
                        : ""}
                    </small>
                  </span>
                  <span className="record-values">
                    <strong>{kwhText(record.energy_kwh)} kWh</strong>
                    <small>
                      {/* The usage date the teacher logged, not the submit time. */}
                      {new Date(
                        record.started_at || record.created_at,
                      ).toLocaleDateString("en-PH", {
                        month: "short",
                        day: "numeric",
                      })}{" "}
                      {new Date(
                        record.started_at || record.created_at,
                      ).toLocaleTimeString("en-PH", {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
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
        <section className="user-summary">
          <article className="summary-tile summary-green">
            <span className="summary-label">
              <Zap size={15} /> TOTAL LOGGED
            </span>
            <strong key={totalKwh}>
              {kwhText(totalKwh)} <small>kWh</small>
            </strong>
            <span className="summary-note">
              Σ (P × t) ÷ 1000 over {records.length} usage{" "}
              {records.length === 1 ? "entry" : "entries"}
            </span>
          </article>
          <article className="summary-tile">
            <span className="summary-label">
              <Building2 size={15} /> ESTIMATED COST
            </span>
            <strong>{money(totalBill)}</strong>
            <span className="summary-note">
              {kwhText(totalKwh)} kWh × {money(ratePerKwh)} per kWh
            </span>
          </article>
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
  const [sectionGrade, setSectionGrade] = useState("11");
  const [applianceName, setApplianceName] = useState("");
  const [applianceWatts, setApplianceWatts] = useState(100);
  const [editingId, setEditingId] = useState(null);
  const [userAccount, setUserAccount] = useState("");
  const [userPassword, setUserPassword] = useState("");
  const [userRoomId, setUserRoomId] = useState("");
  const [credentialsMessage, setCredentialsMessage] = useState("");
  const [reports, setReports] = useState(null);
  const [reportGroup, setReportGroup] = useState("day");
  // Report criteria: building / room / section / appliance narrow the report,
  // and the search box answers questions over whatever the report contains.
  const [reportBuilding, setReportBuilding] = useState("");
  const [reportRoomId, setReportRoomId] = useState("");
  const [reportSectionId, setReportSectionId] = useState("");
  const [reportApplianceId, setReportApplianceId] = useState("");
  const [reportQuery, setReportQuery] = useState("");
  const [reportAnswer, setReportAnswer] = useState(null);
  // Workspace rail auto-hides; pinning keeps it open.
  const [railOpen, setRailOpen] = useState(false);
  const [railPinned, setRailPinned] = useState(false);

  async function loadDashboard(selectedMonth = month) {
    const data = await request(`/admin/dashboard?month=${selectedMonth}`);
    setDashboard(data);
  }

  async function loadReports(overrides = {}) {
    const params = new URLSearchParams({
      month: overrides.month ?? month,
      group: overrides.group ?? reportGroup,
    });
    const filters = {
      building: overrides.building ?? reportBuilding,
      room_id: overrides.roomId ?? reportRoomId,
      section_id: overrides.sectionId ?? reportSectionId,
      appliance_id: overrides.applianceId ?? reportApplianceId,
    };
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, String(value));
    });
    const data = await request(`/admin/reports?${params.toString()}`);
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

  // One subscription for both tables: a submission lands as a usage INSERT
  // plus the account's last_seen UPDATE, and a merged channel refreshes once
  // instead of once per table. Reports reload only while they are on screen.
  const reportsRef = useRef(null);
  reportsRef.current = reports;
  const monthRef = useRef(month);
  monthRef.current = month;
  const reportGroupRef = useRef(reportGroup);
  reportGroupRef.current = reportGroup;
  useLiveTables(["classroom_users", "usage_records"], admin
    ? () => {
        loadDashboard(monthRef.current).catch(() => {});
        if (reportsRef.current) {
          loadReports({
            group: reportGroupRef.current,
            month: monthRef.current,
          }).catch(() => {});
        }
      }
    : null,
  );

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
    setSuccess("");
    try {
      const created = await request("/admin/sections", {
        method: "POST",
        body: JSON.stringify({
          grade: sectionGrade,
          section_name: sectionName,
        }),
      });
      setSectionName("");
      await loadDashboard();
      setSuccess(`${created.name} added to the section list.`);
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

  async function assignUserSection(accountName, nextSectionId) {
    setNotice("");
    setSuccess("");
    try {
      await request(`/admin/users/${encodeURIComponent(accountName)}/section`, {
        method: "PUT",
        body: JSON.stringify({ section_id: nextSectionId || null }),
      });
      await loadDashboard();
      setSuccess(
        nextSectionId
          ? `${accountName}'s classroom section updated.`
          : `Classroom section cleared for ${accountName}.`,
      );
    } catch (error) {
      setNotice(error.message);
    }
  }

  async function approveUser(accountName) {
    setNotice("");
    setSuccess("");
    try {
      const result = await request(
        `/admin/users/${encodeURIComponent(accountName)}/approve`,
        { method: "POST" },
      );
      await loadDashboard();
      setSuccess(`${result.username} approved — they can sign in now.`);
    } catch (error) {
      setNotice(error.message);
    }
  }

  async function rejectUser(accountName) {
    if (
      !window.confirm(
        `Reject and remove the registration for "${accountName}"?`,
      )
    ) {
      return;
    }
    setNotice("");
    setSuccess("");
    try {
      await request(`/admin/users/${encodeURIComponent(accountName)}`, {
        method: "DELETE",
      });
      await loadDashboard();
      setSuccess(`${accountName}'s registration was rejected and removed.`);
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

  const pendingUsers = (dashboard?.users || []).filter(
    (user) => user.status === "pending",
  );
  // Consolidated account posture for the Overview tab.
  const allAccounts = dashboard?.users || [];
  const activeAccounts = allAccounts.filter(
    (user) => user.status === "active",
  ).length;
  const inactiveAccounts = allAccounts.length - activeAccounts;

  // Rule-based report search: matches keywords against the aggregates the
  // reports endpoint already returns, so answers stay consistent with the
  // table and never invent numbers.
  function answerReportQuery(rawQuery) {
    const query = rawQuery.trim().toLowerCase();
    if (!query) return null;
    const rooms = reports?.room_ranking || [];
    const applianceRank = reports?.appliance_ranking || [];
    const sections = dashboard?.sections || [];
    const patterns = reports?.patterns;
    const wantsMost = /(highest|most|top|busiest|max|largest|biggest)/.test(query);
    const rankingNote = (rows, pick) =>
      rows.slice(1, 4).map((row) => `${pick(row)} (${kwhText(row.kwh)} kWh)`);

    if (wantsMost && /(room|classroom)/.test(query)) {
      const top = rooms[0];
      return top
        ? {
            title: top.room,
            value: `${kwhText(top.kwh)} kWh`,
            detail: "Highest-consuming room in this report.",
            also: rankingNote(rooms, (row) => row.room),
          }
        : { title: "No room usage", detail: "No rooms have records for this criteria." };
    }
    if (wantsMost && /(appliance|device|equipment)/.test(query)) {
      const top = applianceRank[0];
      return top
        ? {
            title: top.name,
            value: `${kwhText(top.kwh)} kWh`,
            detail: "Appliance drawing the most energy in this report.",
            also: rankingNote(applianceRank, (row) => row.name),
          }
        : { title: "No appliance usage", detail: "No appliances have records for this criteria." };
    }
    if (wantsMost && /section/.test(query)) {
      const top = sections[0];
      return top
        ? {
            title: top.name,
            value: `${kwhText(top.kwh)} kWh`,
            detail: "Highest-consuming section this month.",
            also: sections
              .slice(1, 4)
              .map((row) => `${row.name} (${kwhText(row.kwh)} kWh)`),
          }
        : { title: "No section usage", detail: "No sections have records this month." };
    }
    if (/(peak|busiest).*(hour|time)|what.*hour/.test(query)) {
      const peak = patterns?.peak_hour;
      return peak
        ? { title: peak.hour, value: `${kwhText(peak.kwh)} kWh`, detail: "Busiest start hour." }
        : { title: "No usage", detail: "Nothing recorded for this criteria." };
    }
    if (/(weekday|what day|which day)/.test(query)) {
      const peak = patterns?.peak_weekday;
      return peak
        ? { title: peak.day, value: `${kwhText(peak.kwh)} kWh`, detail: "Busiest weekday." }
        : { title: "No usage", detail: "Nothing recorded for this criteria." };
    }
    if (/(bill|cost|peso|php|price|spend)/.test(query)) {
      return {
        title: money(reports?.total_bill ?? 0),
        detail: `Estimated cost for ${reports?.session_count ?? 0} sessions at ${money(dashboard?.rate_php_per_kwh)}/kWh.`,
      };
    }
    if (/(total|how much|kwh|energy|consumption|sum)/.test(query)) {
      return {
        title: `${kwhText(reports?.total_kwh ?? 0)} kWh`,
        detail: `Total for ${reports?.session_count ?? 0} sessions under the current criteria.`,
      };
    }
    if (/(account|user|teacher)/.test(query)) {
      return {
        title: `${allAccounts.length} accounts`,
        detail: `${activeAccounts} active, ${inactiveAccounts} inactive. ${pendingUsers.length} awaiting approval.`,
      };
    }
    if (/(room|classroom)s?.*(count|how many)/.test(query)) {
      return {
        title: `${flatRooms.length} rooms`,
        detail: `${flatRooms.filter((room) => room.submission_count > 0).length} have usage in the last 30 days.`,
      };
    }
    if (/(occupant|attendance|students)/.test(query)) {
      return patterns?.avg_occupants != null
        ? {
            title: `${patterns.avg_occupants} avg occupants`,
            detail: "Average per recorded session.",
          }
        : { title: "No occupant data", detail: "Occupants were not filled in for these sessions." };
    }
    return {
      title: "No match",
      detail:
        "Try: highest consumption room · top appliance · peak hour · total kWh · estimated bill · how many accounts · rooms with usage",
    };
  }

  function askReportQuery(event) {
    event.preventDefault();
    setReportAnswer(answerReportQuery(reportQuery));
  }

  const tabs = [
    // Merged first, per the "user management & facilities at the top left" brief.
    ["facilities", "Users & facilities", Building2],
    ["overview", "Overview", Activity],
    ["reports", "Reports", Zap],
    ["rooms", "Buildings & rooms", DoorOpen],
  ];
  const railExpanded = railOpen || railPinned;

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
      <div className={`admin-layout${railExpanded ? " rail-wide" : ""}`}>
        <aside
          className={`admin-rail${railExpanded ? " is-open" : ""}`}
          onMouseEnter={() => setRailOpen(true)}
          onMouseLeave={() => {
            if (!railPinned) setRailOpen(false);
          }}
          onFocus={() => setRailOpen(true)}
          onBlur={(event) => {
            if (
              !railPinned &&
              !event.currentTarget.contains(event.relatedTarget)
            ) {
              setRailOpen(false);
            }
          }}
        >
          <div className="rail-label">WORKSPACE</div>
          {tabs.map(([key, label, Icon]) => (
            <button
              key={key}
              className={`rail-link${tab === key ? " active" : ""}`}
              title={label}
              aria-label={label}
              onClick={() => {
                setTab(key);
                if (key === "reports") {
                  loadReports().catch((error) => setNotice(error.message));
                }
              }}
            >
              <Icon size={17} />
              <span className="rail-text">{label}</span>
              {key === "facilities" && pendingUsers.length > 0 && (
                <span className="rail-badge">{pendingUsers.length}</span>
              )}
              {tab === key && <span className="rail-active-mark" />}
            </button>
          ))}
          <button
            type="button"
            className={`rail-pin${railPinned ? " is-pinned" : ""}`}
            onClick={() => {
              setRailPinned((pinned) => !pinned);
              setRailOpen(true);
            }}
            title={railPinned ? "Unpin the rail" : "Keep the rail open"}
            aria-pressed={railPinned}
          >
            <ChevronDown size={15} />
            <span className="rail-text">
              {railPinned ? "Unpin rail" : "Pin rail open"}
            </span>
          </button>
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
                    loadReports({
                      group: reportGroup,
                      month: event.target.value,
                    }).catch((error) => setNotice(error.message));
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
            <div className="tab-content" key={tab}>
              {tab === "overview" && (
                <>
                  <section className="admin-metrics">
                    <article className="metric-primary">
                      <span>
                        <Zap size={15} /> TOTAL CONSUMPTION
                      </span>
                      <strong key={dashboard.total_kwh}>
                        {kwhText(dashboard.total_kwh)} <small>kWh</small>
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
                      </small>s
                    </article>
                    <article>
                      <span>
                        <span className="metric-icon green">
                          <Users size={15} />
                        </span>
                        ACTIVE ACCOUNTS
                      </span>
                      <strong key={activeAccounts}>
                        {activeAccounts.toString().padStart(2, "0")}
                      </strong>
                      <small className="metric-foot">
                        Approved and able to sign in
                      </small>
                    </article>
                    <article className={inactiveAccounts ? "metric-alert" : ""}>
                      <span>
                        <span className="metric-icon blue">
                          <ClipboardList size={15} />
                        </span>
                        INACTIVE ACCOUNTS
                      </span>
                      <strong key={inactiveAccounts}>
                        {inactiveAccounts.toString().padStart(2, "0")}
                      </strong>
                      <small className="metric-foot">
                        {pendingUsers.length
                          ? `${pendingUsers.length} awaiting approval`
                          : "Nothing awaiting approval"}
                      </small>
                    </article>
                  </section>
                  <section className="panel consolidated-panel">
                    <div className="panel-heading">
                      <div>
                        <span className="eyebrow">CONSOLIDATED</span>
                        <h2>Campus summary</h2>
                      </div>
                      <span className="count-pill">
                        {new Date(`${month}-01T00:00:00`).toLocaleDateString(
                          "en-PH",
                          { month: "short", year: "numeric" },
                        )}
                      </span>
                    </div>
                    <div className="consolidated-grid">
                      <div className="consolidated-item is-total">
                        <span>TOTAL ACCOUNTS</span>
                        <strong>{allAccounts.length}</strong>
                      </div>
                      <div className="consolidated-item">
                        <span>Active</span>
                        <strong>{activeAccounts}</strong>
                      </div>
                      <div className="consolidated-item">
                        <span>Inactive</span>
                        <strong>{inactiveAccounts}</strong>
                      </div>
                      <div className="consolidated-item">
                        <span>Classrooms</span>
                        <strong>{flatRooms.length}</strong>
                      </div>
                      <div className="consolidated-item">
                        <span>Sections</span>
                        <strong>{dashboard.section_count}</strong>
                      </div>
                      <div className="consolidated-item">
                        <span>Appliances</span>
                        <strong>{dashboard.appliances.length}</strong>
                      </div>
                      <div className="consolidated-item">
                        <span>Usage entries</span>
                        <strong>{dashboard.record_count}</strong>
                      </div>
                      <div className="consolidated-item">
                        <span>Energy this month</span>
                        <strong>{kwhText(dashboard.total_kwh)} kWh</strong>
                      </div>
                      <div className="consolidated-item">
                        <span>Estimated bill</span>
                        <strong>{money(dashboard.estimated_bill_php)}</strong>
                      </div>
                    </div>
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
                                  ? `${kwhText(value)} kWh`
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
                                  <strong>{kwhText(section.kwh)}</strong>
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
                </>
              )}
              {tab === "reports" && (
                <>
                  <section className="panel report-controls">
                    <div className="panel-heading">
                      <div>
                        <span className="eyebrow">REPORT CRITERIA</span>
                        <h2>Generate a report</h2>
                      </div>
                      <button
                        type="button"
                        className="button button-primary"
                        disabled={busy}
                        onClick={() =>
                          loadReports().catch((error) =>
                            setNotice(error.message),
                          )
                        }
                      >
                        <Activity size={15} /> Generate
                      </button>
                    </div>
                    <div className="report-criteria-grid">
                      <label className="manual-field">
                        <span>Building</span>
                        <select
                          value={reportBuilding}
                          onChange={(event) => {
                            setReportBuilding(event.target.value);
                            setReportRoomId("");
                          }}
                        >
                          <option value="">All buildings</option>
                          {roomsData?.buildings.map((building) => (
                            <option key={building.code} value={building.code}>
                              {building.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="manual-field">
                        <span>Room</span>
                        <select
                          value={reportRoomId}
                          onChange={(event) =>
                            setReportRoomId(event.target.value)
                          }
                        >
                          <option value="">All rooms</option>
                          {roomsData?.buildings
                            .filter(
                              (building) =>
                                !reportBuilding ||
                                building.code === reportBuilding,
                            )
                            .map((building) => (
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
                      </label>
                      <label className="manual-field">
                        <span>Section</span>
                        <select
                          value={reportSectionId}
                          onChange={(event) =>
                            setReportSectionId(event.target.value)
                          }
                        >
                          <option value="">All sections</option>
                          {groupSectionsByGrade(
                            dashboard.sections_catalog || [],
                          ).map((group) => (
                            <optgroup key={group.label} label={group.label}>
                              {group.items.map((section) => (
                                <option key={section.id} value={section.id}>
                                  {section.name}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      </label>
                      <label className="manual-field">
                        <span>Appliance</span>
                        <select
                          value={reportApplianceId}
                          onChange={(event) =>
                            setReportApplianceId(event.target.value)
                          }
                        >
                          <option value="">All appliances</option>
                          {(dashboard.appliances || []).map((appliance) => (
                            <option key={appliance.id} value={appliance.id}>
                              {appliance.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <form className="report-search" onSubmit={askReportQuery}>
                      <Search size={16} aria-hidden="true" />
                      <input
                        type="search"
                        value={reportQuery}
                        onChange={(event) =>
                          setReportQuery(event.target.value)
                        }
                        placeholder='Ask the report — e.g. "what room has the highest consumption?"'
                        aria-label="Search the report"
                      />
                      <button className="button button-primary" disabled={busy}>
                        Ask
                      </button>
                    </form>
                    <div className="report-suggestions">
                      {[
                        "which room has the highest consumption?",
                        "top appliance",
                        "peak hour",
                        "total kWh",
                        "estimated bill",
                        "how many accounts",
                      ].map((suggestion) => (
                        <button
                          key={suggestion}
                          type="button"
                          className="suggestion-chip"
                          onClick={() => {
                            setReportQuery(suggestion);
                            setReportAnswer(answerReportQuery(suggestion));
                          }}
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                    {reportAnswer && (
                      <div className="report-answer" role="status">
                        <span className="report-answer-icon">
                          <Search size={16} />
                        </span>
                        <div>
                          <span className="report-answer-label">
                            {reportQuery ? `“${reportQuery}”` : "Answer"}
                          </span>
                          <strong>{reportAnswer.title}</strong>
                          <p>{reportAnswer.detail}</p>
                          {reportAnswer.also?.length ? (
                            <p className="report-answer-also">
                              Next: {reportAnswer.also.join(" · ")}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    )}
                  </section>
                  <ReportsPanel
                    reports={reports}
                    group={reportGroup}
                    month={month}
                    criteria={reports?.criteria}
                    onGroupChange={(nextGroup) => {
                      setReportGroup(nextGroup);
                      loadReports({ group: nextGroup }).catch((error) =>
                        setNotice(error.message),
                      );
                    }}
                  />
                </>
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
                            onChange={(event) =>
                              setRoomQuery(event.target.value)
                            }
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
                      {visibleRooms.length === 0 ? (
                        <div className="panel room-empty-panel">
                          <div className="empty-state compact-empty">
                            No rooms match your search. Try a room number, room
                            name, or account.
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
                                      {
                                        building.rooms.filter(roomMatches)
                                          .length
                                      }{" "}
                                      OF {building.rooms.length} ROOMS · 4
                                      FLOORS
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
                                          room.floor === floor &&
                                          roomMatches(room),
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
                                                <strong>
                                                  {room.room_number}
                                                </strong>
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
              {tab === "facilities" && (
                <>
                  <section className="panel user-monitor-panel">
                    <div className="panel-heading">
                      <div>
                        <span className="eyebrow">USER MANAGEMENT</span>
                        <h2>User accounts</h2>
                      </div>
                      <span className="count-pill">
                        {dashboard.users.length} accounts
                      </span>
                    </div>
                  {pendingUsers.length > 0 && (
                    <div className="approval-block">
                      <div className="approval-heading">
                        <span className="eyebrow">REGISTRATION REQUESTS</span>
                        <span className="count-pill pending-pill">
                          {pendingUsers.length} pending
                        </span>
                      </div>
                      <div className="approval-list">
                        {pendingUsers.map((user) => (
                          <article className="approval-row" key={user.username}>
                            <span className="account-avatar pending-avatar">
                              {user.username.slice(0, 1).toUpperCase()}
                            </span>
                            <span className="approval-main">
                              <strong>{user.username}</strong>
                              <small>
                                {user.section
                                  ? user.section.name
                                  : "No section set"}{" "}
                                · requested{" "}
                                {new Date(
                                  `${user.last_seen}Z`,
                                ).toLocaleDateString("en-PH", {
                                  month: "short",
                                  day: "numeric",
                                })}
                              </small>
                            </span>
                            <span className="approval-actions">
                              <button
                                type="button"
                                className="approve-action"
                                title={`Approve ${user.username}`}
                                onClick={() => approveUser(user.username)}
                              >
                                <Check size={15} /> Approve
                              </button>
                              <button
                                type="button"
                                className="reject-action"
                                title={`Reject ${user.username}`}
                                onClick={() => rejectUser(user.username)}
                              >
                                <X size={15} /> Reject
                              </button>
                            </span>
                          </article>
                        ))}
                      </div>
                    </div>
                  )}
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
                          <th>SECTION</th>
                          <th>ASSIGNED ROOM</th>
                          <th>ENTRIES</th>
                          <th>LAST ACTIVE</th>
                          <th>STATUS</th>
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
                                className="user-section-select"
                                value={
                                  user.section ? String(user.section.id) : ""
                                }
                                onChange={(event) => {
                                  const value = event.target.value;
                                  assignUserSection(
                                    user.username,
                                    value ? Number(value) : null,
                                  );
                                }}
                                aria-label={`Set section for ${user.username}`}
                              >
                                <option value="">No section</option>
                                {groupSectionsByGrade(
                                  dashboard.sections_catalog,
                                ).map((group) => (
                                  <optgroup
                                    key={group.label}
                                    label={group.label}
                                  >
                                    {group.items.map((section) => (
                                      <option
                                        key={section.id}
                                        value={section.id}
                                      >
                                        {section.name}
                                      </option>
                                    ))}
                                  </optgroup>
                                ))}
                              </select>
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
                                className={`account-status${user.status === "active" ? " is-approved" : ""}`}
                              >
                                <i />{" "}
                                {user.status === "active"
                                  ? "APPROVED"
                                  : "PENDING"}
                              </span>
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
                    <form
                      className="inline-add-form section-add-form"
                      onSubmit={addSection}
                    >
                      <label className="grade-select">
                        <select
                          value={sectionGrade}
                          onChange={(event) =>
                            setSectionGrade(event.target.value)
                          }
                          aria-label="Grade"
                        >
                          <option value="11">Grade 11</option>
                          <option value="12">Grade 12</option>
                        </select>
                        <ChevronDown className="select-chevron" size={15} />
                      </label>
                      <input
                        value={sectionName}
                        onChange={(event) => setSectionName(event.target.value)}
                        placeholder="Section name (e.g. bernoulli)"
                        minLength={2}
                        maxLength={40}
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
                      {groupSectionsByGrade(dashboard.sections_catalog).map(
                        (group) => (
                          <div className="catalog-group" key={group.label}>
                            <span className="catalog-group-label">
                              {group.label}
                            </span>
                            {group.items.map((section) => (
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
                        ),
                      )}
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
                </>
              )}
            </div>
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

function ReportsPanel({ reports, group, month, criteria, onGroupChange }) {
  const patterns = reports?.patterns;
  const activeCriteria = [];
  if (criteria?.building) activeCriteria.push(`Building ${criteria.building}`);
  if (criteria?.room_id) activeCriteria.push(`Room #${criteria.room_id}`);
  if (criteria?.section_id) activeCriteria.push(`Section #${criteria.section_id}`);
  if (criteria?.appliance_id)
    activeCriteria.push(`Appliance #${criteria.appliance_id}`);
  const cards = [
    {
      label: "PEAK WEEKDAY",
      value: patterns?.peak_weekday?.day || "—",
      note: patterns?.peak_weekday
        ? `${kwhText(patterns.peak_weekday.kwh)} kWh`
        : "No usage this month",
    },
    {
      label: "PEAK START HOUR",
      value: patterns?.peak_hour?.hour || "—",
      note: patterns?.peak_hour
        ? `${kwhText(patterns.peak_hour.kwh)} kWh started`
        : "No usage this month",
    },
    {
      label: "TOP APPLIANCE",
      value: patterns?.top_appliance?.name || "—",
      note: patterns?.top_appliance
        ? `${kwhText(patterns.top_appliance.kwh)} kWh`
        : "No usage this month",
    },
    {
      label: "BUSIEST ROOM",
      value: patterns?.busiest_room?.room || "—",
      note: patterns?.busiest_room
        ? `${kwhText(patterns.busiest_room.kwh)} kWh`
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
            {activeCriteria.length ? (
              <p className="criteria-note">
                Filtered by {activeCriteria.join(" · ")} ·{" "}
                {reports?.session_count ?? 0} sessions ·{" "}
                {kwhText(reports?.total_kwh ?? 0)} kWh ·{" "}
                {money(reports?.total_bill ?? 0)}
              </p>
            ) : null}
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
                          {kwhText(bucket.kwh)} kWh
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

function AboutPage() {
  const { darkMode, toggleTheme } = useTheme();
  const sections = [
    {
      icon: <Users size={18} />,
      title: "Role chooser · /mcs",
      body: "Pick your workspace: a teacher/staff account or the admin console. The landing page also shows the estimate disclaimer and a link back here.",
    },
    {
      icon: <Bolt size={18} />,
      title: "User workspace · /mcs/user",
      body: "Sign in with credentials issued by an admin, then log classroom electricity use in two ways: start the ON/OFF timer for live tracking, or open Custom time to backfill hours you forgot to record. Every appliance shows its live kWh estimate, and your submissions list recent entries with estimated cost.",
    },
    {
      icon: <ShieldCheck size={18} />,
      title: "Admin console · /mcs/admin",
      body: "Review the six-month consumption dashboard, compare rooms across three buildings, issue or reset user credentials, assign rooms and classroom sections, and maintain the appliance catalog. Rooms that exceed 1.5× their building's per-room average are flagged as high-use.",
    },
    {
      icon: <Activity size={18} />,
      title: "Energy math",
      body: "Individual device: E = P × t ÷ 1000 (watts × hours ÷ 1000 = kWh). Multiple devices: E_total = Σ (Pᵢ × tᵢ) ÷ 1000 — the sum of each device's own kWh. Bills are kWh × the configured electricity rate. Values are estimates, not meter readings.",
    },
  ];
  const demoSteps = [
    "Open /mcs and choose User workspace.",
    "Sign in with the credentials your administrator issued (an admin creates them under User activity).",
    "Pick an appliance in the log and press ON — the timer starts and the estimated kWh ticks up live.",
    "Press OFF to save the session; the record lands in Recent submissions with kWh and cost.",
    "Forgot to start the timer? Press Custom time, choose the appliance, type the hours you missed, review the E = P × t ÷ 1000 preview, and hit Submit record.",
    "Sign out, open /mcs/admin, and sign in as admin to see the same data on the dashboard, room map, and monthly reports.",
  ];
  return (
    <main className="workspace-page about-page">
      <Topbar
        subtitle="ABOUT WATTWISE"
        right={
          <>
            <ThemeToggle darkMode={darkMode} onToggle={toggleTheme} />
            <a className="topbar-link" href="/mcs">
              <ArrowLeft size={15} /> Back to start
            </a>
          </>
        }
      />
      <section className="workspace-heading">
        <div>
          <div className="eyebrow">
            <span className="eyebrow-dot" /> CLASSROOM ENERGY MONITORING
          </div>
          <h1>
            About <em>WattWise.</em>
          </h1>
          <p>
            WattWise Classrooms is a lightweight web app that helps Cabiao
            Senior High School track, estimate, and manage classroom
            electricity use — without smart-meter hardware. Teachers log
            appliance run time; the app estimates consumption and cost;
            administrators see the school-wide picture.
          </p>
        </div>
        <span className="date-stamp">{todayLabel}</span>
      </section>

      <section className="about-grid">
        {sections.map((item) => (
          <article className="about-card" key={item.title}>
            <span className="about-card-icon">{item.icon}</span>
            <h2>{item.title}</h2>
            <p>{item.body}</p>
          </article>
        ))}
      </section>

      <section className="panel about-demo">
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
          <a className="button button-primary" href="/mcs/user">
            <Bolt size={15} /> Open user workspace
          </a>
          <a className="button button-outline" href="/mcs/admin">
            <ShieldCheck size={15} /> Open admin console
          </a>
        </div>
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

export default function App() {
  const path = window.location.pathname.replace(/\/$/, "") || "/mcs";
  if (path === "/mcs/user/signup") return <SignupPage />;
  if (path === "/mcs/user") return <UserPortal />;
  if (path === "/mcs/admin") return <AdminPortal />;
  if (path === "/mcs/about") return <AboutPage />;
  return <RoleChoice />;
}
