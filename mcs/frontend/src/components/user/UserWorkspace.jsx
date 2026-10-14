import { useState, useEffect } from "react";
import { Settings, LogOut, Clock3 } from "lucide-react";
import { request } from "../../utils/api";
import { APPLIANCE_PRESETS, MAX_HOURS } from "../../constants";
import {
  connectedWattsOf,
  kwhText,
  money,
  localDateValue,
  clampHours,
  getTodayLabel,
} from "../../utils/formatters";
import { useLiveTables } from "../../hooks/useLiveTables";
import { useTheme } from "../../hooks/useTheme";
import { Topbar } from "../ui/Topbar";
import { ThemeToggle } from "../ui/ThemeToggle";
import { Notice } from "../ui/Notice";
import { PageFooter } from "../ui/PageFooter";
import { SettingsPanel } from "./SettingsPanel";
import { ManualEntryForm } from "./ManualEntryForm";
import { FormulaBlock } from "./FormulaBlock";
import { ApplianceTable } from "./ApplianceTable";
import { RecentEntries } from "./RecentEntries";
import { UserSummary } from "./UserSummary";

export function UserWorkspace({ onSignOut }) {
  const { darkMode, toggleTheme } = useTheme();
  const [username, setUsername] = useState(
    () => localStorage.getItem("wattwise-user") || "",
  );
  const [signedIn, setSignedIn] = useState(() =>
    Boolean(localStorage.getItem("wattwise-user")),
  );
  const [appliances, setAppliances] = useState([]);
  const [assignedRoom, setAssignedRoom] = useState(null);
  const [records, setRecords] = useState([]);
  const [roomId, setRoomId] = useState("");
  const [occupants, setOccupants] = useState("");
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualAppliance, setManualAppliance] = useState("");
  const [manualHours, setManualHours] = useState("");
  const [manualDate, setManualDate] = useState(() => localDateValue());
  const [showSettings, setShowSettings] = useState(false);
  const [presetChoice, setPresetChoice] = useState("");
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
  const [accountSection, setAccountSection] = useState(null);

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
          // Session is gone: hand control back to the parent login view.
          window.dispatchEvent(new CustomEvent("wattwise-signout"));
        }
      });
    }
  }, [signedIn, username]);

  useEffect(() => {
    if (!Object.keys(running).length) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  useLiveTables(
    ["classroom_users"],
    signedIn ? () => loadWorkspace().catch(() => {}) : null,
    (payload) =>
      payload.eventType === "DELETE" ||
      (payload.new?.username ?? payload.old?.username) === username,
  );

  const connectedWatts = appliances.reduce(
    (sum, item) => sum + connectedWattsOf(item),
    0,
  );

  const applianceRows = appliances.map((appliance) => {
    const session = running[appliance.id];
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
      sessionKwh,
      estimatedKwh: loggedKwh + sessionKwh,
      loggedSessions,
    };
  });

  const grandTotalKwh = applianceRows.reduce(
    (sum, row) => sum + row.estimatedKwh,
    0,
  );

  const totalKwh = Number(
    records.reduce((sum, item) => sum + item.energy_kwh, 0).toFixed(4),
  );
  const totalBill = totalKwh * ratePerKwh;

  async function addPresetAppliance(event) {
    event.preventDefault();
    if (!presetChoice) return;
    const preset = APPLIANCE_PRESETS.find((p) => p.name === presetChoice);
    if (!preset) return;
    setBusy(true);
    setNotice("");
    setSuccess("");
    try {
      const created = await request("/appliances", {
        method: "POST",
        body: JSON.stringify({ name: preset.name, wattage: preset.watts }),
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
    const manualApplianceRow = appliances.find(
      (item) => String(item.id) === manualAppliance,
    );
    const manualHoursValue = clampHours(manualHours);
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
          hours: manualHoursValue,
          occupants:
            occupants === ""
              ? null
              : Math.max(0, Math.floor(Number(occupants) || 0)),
          started_at: `${manualDate || localDateValue()}T12:00:00`,
        }),
      });
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
    window.dispatchEvent(new CustomEvent("wattwise-signout"));
    onSignOut?.();
  }

  if (!signedIn) {
    return null; // Login handled by parent
  }

  const todayLabel = getTodayLabel();

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
        <SettingsPanel
          appliances={appliances}
          setShowSettings={setShowSettings}
          presetChoice={presetChoice}
          setPresetChoice={setPresetChoice}
          busy={busy}
          notice={notice}
          success={success}
          onAddPreset={addPresetAppliance}
          onUpdateAppliance={saveAppliance}
          onRemoveAppliance={removeAppliance}
          running={running}
        />
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
              <ManualEntryForm
                appliances={appliances}
                manualAppliance={manualAppliance}
                setManualAppliance={setManualAppliance}
                manualHours={manualHours}
                setManualHours={setManualHours}
                manualDate={manualDate}
                setManualDate={setManualDate}
                assignedRoom={assignedRoom}
                ratePerKwh={ratePerKwh}
                busy={busy}
                onSubmit={submitManualUsage}
                onClose={() => setShowManualForm(false)}
              />
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
            <FormulaBlock
              connectedWatts={connectedWatts}
              applianceRows={applianceRows}
              appliances={appliances}
            />
          </div>
          <Notice>{notice}</Notice>
          <Notice kind="success">{success}</Notice>
          <ApplianceTable
            applianceRows={applianceRows}
            grandTotalKwh={grandTotalKwh}
            appliances={appliances}
            onStart={startAppliance}
            onStop={stopAppliance}
            roomId={roomId}
            busy={busy}
          />
        </section>
        <section className="panel recent-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">YOUR ACTIVITY</span>
              <h2>Recent entries</h2>
            </div>
            <span className="count-pill">{records.length}</span>
          </div>
          <RecentEntries records={records} />
        </section>
        <UserSummary
          totalKwh={totalKwh}
          totalBill={totalBill}
          records={records}
          ratePerKwh={ratePerKwh}
        />
      </section>
      <PageFooter
        showPrivacy
        onPrivacyClick={() => window.dispatchEvent(new CustomEvent("open-privacy"))}
      />
    </main>
  );
}