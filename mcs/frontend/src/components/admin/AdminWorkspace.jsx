import { useState, useEffect, useRef } from "react";
import { Bell, LogOut, Menu } from "lucide-react";
import { request, invalidateCache } from "../../utils/api";
import { useTheme } from "../../hooks/useTheme";
import { useLiveTables } from "../../hooks/useLiveTables";
import { supabase } from "../../utils/supabase";
import { Topbar } from "../ui/Topbar";
import { ThemeToggle } from "../ui/ThemeToggle";
import { Notice } from "../ui/Notice";
import { PageFooter } from "../ui/PageFooter";
import { AdminNav } from "./AdminNav";
import { AdminOverview } from "./AdminOverview";
import { AdminReports } from "./AdminReports";
import { AdminRooms } from "./AdminRooms";
import { AdminFacilities } from "./AdminFacilities";

export function AdminWorkspace({ onSignOut }) {
  const { darkMode, toggleTheme } = useTheme();
  const [admin, setAdmin] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [roomsData, setRoomsData] = useState(null);
  const [reports, setReports] = useState(null);
  const [tab, setTab] = useState("overview");
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [notice, setNotice] = useState("");
  const [success, setSuccess] = useState("");
  // busy gates the admin forms; child tabs own their own submit flows.
  const [busy] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [liveAlerts, setLiveAlerts] = useState([]);
  // Room that should glow briefly after a coordinator switches an appliance on.
  const [glowRoom, setGlowRoom] = useState(null);
  const glowTimerRef = useRef(null);
  
  // Rooms state
  const [selectedRoomId, setSelectedRoomId] = useState(null);
  const [roomQuery, setRoomQuery] = useState("");
  const [usageOnly, setUsageOnly] = useState(false);
  const [roomType, setRoomType] = useState("classroom");
  const [customRoomType, setCustomRoomType] = useState("");
  const [roomName, setRoomName] = useState("");
  const [roomDetail, setRoomDetail] = useState(null);
  const [roomDetailTick, setRoomDetailTick] = useState(0);
  
  // Reports state
  const [reportGroup, setReportGroup] = useState("day");
  const [reportBuilding, setReportBuilding] = useState("");
  const [reportRoomId, setReportRoomId] = useState("");
  const [reportSectionId, setReportSectionId] = useState("");
  const [reportApplianceId, setReportApplianceId] = useState("");
  const [reportQuery, setReportQuery] = useState("");
  const [reportAnswer, setReportAnswer] = useState(null);
  
  // Facilities state
  const [sectionName, setSectionName] = useState("");
  const [sectionGrade, setSectionGrade] = useState("11");
  const [applianceName, setApplianceName] = useState("");
  const [applianceWatts, setApplianceWatts] = useState(100);
  const [editingId, setEditingId] = useState(null);
  const [userAccount, setUserAccount] = useState("");
  const [userPassword, setUserPassword] = useState("");
  const [userRoomId, setUserRoomId] = useState("");
  const [credentialsMessage, setCredentialsMessage] = useState("");

  async function loadDashboard(selectedMonth = month) {
    // The accounts table lists every account, so ask for the full roster
    // rather than the default first page.
    const data = await request(
      `/admin/dashboard?month=${selectedMonth}&users_limit=200`,
    );
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

  const pendingUsers = (dashboard?.users || []).filter(
    (user) => user.status === "pending",
  );
  const allAccounts = dashboard?.users || [];
  // The server reports the true totals, so the counts stay right even if
  // the account list is ever paged.
  const totalPending = dashboard?.pending_count ?? pendingUsers.length;
  const activeAccounts = allAccounts.filter(
    (user) => user.status === "active",
  ).length;
  const inactiveAccounts = allAccounts.length - activeAccounts;

  useEffect(() => {
    if (localStorage.getItem("wattwise-admin-session") !== "true") return;
    request("/admin/session")
      .then((session) => {
        setAdmin(session);
        // Dashboard/room load failures keep the panel in its loading state.
        Promise.all([loadDashboard(), loadRooms()]).catch(() => {});
      })
      .catch(() => {
        // Session cookie expired: clear the flag and fall back to login.
        localStorage.removeItem("wattwise-admin-session");
        window.dispatchEvent(new CustomEvent("wattwise-admin-signout"));
      });
  }, []);

  // Room detail loads whenever another tab bumps roomDetailTick (e.g. after
  // saving room details), which is how AdminRooms asks for a refetch.
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

  useLiveTables(["classroom_users", "usage_records"], admin
    ? () => {
        loadDashboard(month).catch(() => {});
        if (reports) {
          loadReports({ group: reportGroup, month }).catch(() => {});
        }
      }
    : null,
  );

  // Live EMC activity: a user/coordinator switching an appliance on broadcasts
  // here, so the admin sees it without refreshing the page.
  useEffect(() => {
    if (!supabase) return undefined;
    const channel = supabase.channel("emc-activity");
    channel.on("broadcast", { event: "appliance-enabled" }, ({ payload }) => {
      setLiveAlerts((current) =>
        [{ id: `${Date.now()}-${Math.random()}`, ...payload }, ...current].slice(0, 5),
      );
      // New clients send roomId; older ones only send the "… · Room 403" label.
      const labelMatch = /Room\s+(\d+)/.exec(payload.room || "");
      setGlowRoom({
        id: payload.roomId ?? null,
        number: Number.isFinite(Number(payload.roomNumber))
          ? Number(payload.roomNumber)
          : labelMatch
            ? Number(labelMatch[1])
            : null,
      });
      if (glowTimerRef.current) window.clearTimeout(glowTimerRef.current);
      glowTimerRef.current = window.setTimeout(() => setGlowRoom(null), 8000);
    });
    channel.subscribe();
    return () => {
      if (glowTimerRef.current) window.clearTimeout(glowTimerRef.current);
      supabase.removeChannel(channel);
    };
  }, []);

  async function signOut() {
    await request("/admin/logout", { method: "POST" }).catch(() => {});
    localStorage.removeItem("wattwise-admin-session");
    window.dispatchEvent(new CustomEvent("wattwise-admin-signout"));
    onSignOut?.();
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
      invalidateCache("/sections");
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
      invalidateCache("/sections");
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
      invalidateCache("/appliances");
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
      invalidateCache("/appliances");
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

  if (!admin) {
    return null; // Login handled by parent
  }

  return (
    <main className="admin-page">
      <Topbar
        subtitle="ADMIN CONSOLE"
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
            <button className="topbar-link signout-link" onClick={signOut}>
              <LogOut size={15} /> Sign out
            </button>
          </>
        }
      />
      {liveAlerts.length > 0 && (
        <div className="live-alerts" role="status" aria-live="polite">
          {liveAlerts.map((alert) => (
            <div className="live-alert" key={alert.id}>
              <Bell size={14} />
              <span>
                <strong>{alert.username}</strong> turned on{" "}
                <strong>{alert.appliance}</strong>
                {alert.room ? ` in ${alert.room}` : ""}
              </span>
              <button
                type="button"
                className="live-alert__close"
                onClick={() =>
                  setLiveAlerts((current) =>
                    current.filter((item) => item.id !== alert.id),
                  )
                }
                aria-label="Dismiss notification"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      {navOpen && (
        <div className="nav-scrim" onClick={() => setNavOpen(false)} />
      )}
      <div className="admin-layout">
        <AdminNav
          open={navOpen}
          tab={tab}
          setTab={setTab}
          pendingCount={totalPending}
          admin={admin}
          onReportsClick={() => loadReports().catch((error) => setNotice(error.message))}
          onClose={() => setNavOpen(false)}
        />
        <section className="admin-main">
          <div className="admin-heading">
            <div>
              <div className="eyebrow">
                <span className="eyebrow-dot" /> ENERGY MONITORING
              </div>
              <h1>
                {tab === "overview"
                  ? "System overview"
                  : tab === "reports"
                  ? "Reports"
                  : tab === "rooms"
                  ? "Buildings & rooms"
                  : "Users & facilities"}
              </h1>
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
                <AdminOverview
                  dashboard={dashboard}
                  month={month}
                  activeAccounts={activeAccounts}
                  inactiveAccounts={inactiveAccounts}
                  pendingCount={totalPending}
                />
              )}
              {tab === "reports" && (
                <AdminReports
                  month={month}
                  dashboard={dashboard}
                  roomsData={roomsData}
                  reports={reports}
                  reportGroup={reportGroup}
                  setReportGroup={setReportGroup}
                  reportBuilding={reportBuilding}
                  setReportBuilding={setReportBuilding}
                  reportRoomId={reportRoomId}
                  setReportRoomId={setReportRoomId}
                  reportSectionId={reportSectionId}
                  setReportSectionId={setReportSectionId}
                  reportApplianceId={reportApplianceId}
                  setReportApplianceId={setReportApplianceId}
                  reportQuery={reportQuery}
                  setReportQuery={setReportQuery}
                  reportAnswer={reportAnswer}
                  setReportAnswer={setReportAnswer}
                  busy={busy}
                  setNotice={setNotice}
                  loadReports={loadReports}
                />
              )}
              {tab === "rooms" && (
                <AdminRooms
                  roomsData={roomsData}
                  selectedRoomId={selectedRoomId}
                  setSelectedRoomId={setSelectedRoomId}
                  roomQuery={roomQuery}
                  setRoomQuery={setRoomQuery}
                  usageOnly={usageOnly}
                  setUsageOnly={setUsageOnly}
                  roomType={roomType}
                  setRoomType={setRoomType}
                  customRoomType={customRoomType}
                  setCustomRoomType={setCustomRoomType}
                  roomName={roomName}
                  setRoomName={setRoomName}
                  busy={busy}
                  saveRoomDetails={saveRoomDetails}
                  glowRoom={glowRoom}
                  currentDetail={
                    roomDetail && roomDetail.id === selectedRoomId
                      ? roomDetail
                      : null
                  }
                />
              )}
              {tab === "facilities" && (
                <AdminFacilities
                  dashboard={dashboard}
                  roomsData={roomsData}
                  pendingUsers={pendingUsers}
                  sectionName={sectionName}
                  setSectionName={setSectionName}
                  sectionGrade={sectionGrade}
                  setSectionGrade={setSectionGrade}
                  applianceName={applianceName}
                  setApplianceName={setApplianceName}
                  applianceWatts={applianceWatts}
                  setApplianceWatts={setApplianceWatts}
                  editingId={editingId}
                  setEditingId={setEditingId}
                  userAccount={userAccount}
                  setUserAccount={setUserAccount}
                  userPassword={userPassword}
                  setUserPassword={setUserPassword}
                  userRoomId={userRoomId}
                  setUserRoomId={setUserRoomId}
                  credentialsMessage={credentialsMessage}
                  busy={busy}
                  onAddSection={addSection}
                  onRemoveSection={removeSection}
                  onSaveAppliance={saveAppliance}
                  onRemoveAppliance={removeAppliance}
                  onSaveUserCredentials={saveUserCredentials}
                  onAssignUserRoom={assignUserRoom}
                  onAssignUserSection={assignUserSection}
                  onApproveUser={approveUser}
                  onRejectUser={rejectUser}
                />
              )}
            </div>
          )}
        </section>
      </div>
      <PageFooter
        showPrivacy
        onPrivacyClick={() => window.dispatchEvent(new CustomEvent("open-privacy"))}
      />
    </main>
  );
}