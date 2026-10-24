import { Activity, Search } from "lucide-react";
import { groupSectionsByGrade, kwhText } from "../../utils/formatters";
import { REPORT_SUGGESTIONS } from "../../constants";
import { ReportsPanel } from "./ReportsPanel";

export function AdminReports({
  month,
  dashboard,
  roomsData,
  reports,
  reportGroup,
  setReportGroup,
  reportBuilding,
  setReportBuilding,
  reportRoomId,
  setReportRoomId,
  reportSectionId,
  setReportSectionId,
  reportApplianceId,
  setReportApplianceId,
  reportQuery,
  setReportQuery,
  reportAnswer,
  setReportAnswer,
  busy,
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
            onClick={() => loadReports().catch((error) => setNotice(error.message))}
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
              onChange={(event) => setReportRoomId(event.target.value)}
            >
              <option value="">All rooms</option>
              {roomsData?.buildings
                .filter(
                  (building) =>
                    !reportBuilding || building.code === reportBuilding,
                )
                .map((building) => (
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
          <label className="manual-field">
            <span>Section</span>
            <select
              value={reportSectionId}
              onChange={(event) => setReportSectionId(event.target.value)}
            >
              <option value="">All sections</option>
              {groupSectionsByGrade(
                dashboard?.sections_catalog || [],
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
              onChange={(event) => setReportApplianceId(event.target.value)}
            >
              <option value="">All appliances</option>
              {(dashboard?.appliances || []).map((appliance) => (
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