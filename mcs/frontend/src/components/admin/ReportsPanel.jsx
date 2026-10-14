import { ClipboardList } from "lucide-react";
import { kwhText, money } from "../../utils/formatters";

export function ReportsPanel({ reports, group, month, criteria, onGroupChange }) {
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