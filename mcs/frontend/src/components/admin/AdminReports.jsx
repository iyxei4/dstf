import { ClipboardList, Search } from "lucide-react";
import { kwhText } from "../../utils/formatters";
import { REPORT_SUGGESTIONS } from "../../constants";
import { ReportsPanel } from "./ReportsPanel";

export function AdminReports({
  month,
  dashboard,
  roomsData,
  reports,
  reportGroup,
  setReportGroup,
  reportQuery,
  setReportQuery,
  reportAnswer,
  setReportAnswer,
  busy,
  roomReports,
  roomReportsLoading,
  setNotice,
  loadReports,
}) {
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
    if (/(total|how much|kwh|energy|consumption|sum)/.test(query)) {
      return {
        title: `${kwhText(reports?.total_kwh ?? 0)} kWh`,
        detail: `Total for ${reports?.session_count ?? 0} sessions under the current criteria.`,
      };
    }
    if (/(account|user|teacher)/.test(query)) {
      const allAccounts = dashboard?.users || [];
      const totalAccounts = dashboard?.users_total ?? allAccounts.length;
      const activeAccounts = allAccounts.filter((u) => u.status === "active").length;
      const pendingUsers = allAccounts.filter((u) => u.status === "pending");
      return {
        title: `${totalAccounts} accounts`,
        detail: `${activeAccounts} active, ${totalAccounts - activeAccounts} inactive. ${dashboard?.pending_count ?? pendingUsers.length} awaiting approval.`,
      };
    }
    if (/(room|classroom)s?.*(count|how many)/.test(query)) {
      const flatRooms = roomsData?.buildings.flatMap((b) => b.rooms) || [];
      return {
        title: `${flatRooms.length} rooms`,
        detail: `${flatRooms.filter((r) => r.submission_count > 0).length} have usage in the last 30 days.`,
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
        "Try: highest consumption room · top appliance · peak hour · total kWh · how many accounts · rooms with usage",
    };
  }

  function askReportQuery(event) {
    event.preventDefault();
    setReportAnswer(answerReportQuery(reportQuery));
  }

  return (
    <>
      <section className="panel table-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">AUTO-CALCULATED</span>
            <h2>Active EMC rooms</h2>
            <p className="criteria-note">
              {roomReports.length}{" "}
              {roomReports.length === 1 ? "room" : "rooms"} · {month} · accounts
              approved and assigned
            </p>
          </div>
        </div>
        {roomReportsLoading ? (
          <div className="loading-panel">Calculating room reports...</div>
        ) : roomReports.length ? (
          <div className="responsive-table">
            <table>
              <thead>
                <tr>
                  <th>ROOM</th>
                  <th>LOCATION</th>
                  <th>SESSIONS</th>
                  <th>ENERGY</th>
                  <th>TOP APPLIANCE</th>
                  <th>PEAK DAY</th>
                  <th>PEAK HOUR</th>
                </tr>
              </thead>
              <tbody>
                {roomReports.map((entry) => (
                  <tr key={entry.room.id}>
                    <td>
                      <strong>
                        {entry.room.room_name ||
                          `Room ${entry.room.room_number}`}
                      </strong>
                    </td>
                    <td>
                      {entry.room.building_name} · Floor {entry.room.floor}
                    </td>
                    <td>{entry.report ? entry.report.session_count : "—"}</td>
                    <td>
                      {entry.report ? (
                        <strong className="energy-cell">
                          {kwhText(entry.report.total_kwh)} kWh
                        </strong>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      {entry.report?.patterns?.top_appliance?.name || "—"}
                    </td>
                    <td>
                      {entry.report?.patterns?.peak_weekday?.day || "—"}
                    </td>
                    <td>
                      {entry.report?.patterns?.peak_hour?.hour || "—"}
                    </td>
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
            <strong>No active EMC rooms</strong>
            <span>Assign an approved account to a room to include it here.</span>
          </div>
        )}
      </section>
      <section className="panel report-controls">
        <span className="eyebrow">ASK THE REPORT</span>
        <form className="report-search" onSubmit={askReportQuery}>
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            value={reportQuery}
            onChange={(event) => setReportQuery(event.target.value)}
            placeholder='Ask the report — e.g. "what room has the highest consumption?"'
            aria-label="Search the report"
          />
          <button className="button button-primary" disabled={busy}>
            Ask
          </button>
        </form>
        <div className="report-suggestions">
          {REPORT_SUGGESTIONS.map((suggestion) => (
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
  );
}