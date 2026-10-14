import { ClipboardList, Sun } from "lucide-react";
import { kwhText } from "../../utils/formatters";

export function RecentEntries({ records }) {
  if (!records.length) {
    return (
      <div className="empty-state">
        <span className="empty-mark">
          <ClipboardList size={22} />
        </span>
        <strong>No entries yet</strong>
        <span>Your submitted usage records will appear here.</span>
      </div>
    );
  }

  return (
    <div className="record-list">
      {records.slice(0, 8).map((record) => (
        <article className="record-row animate-in" key={record.id}>
          <span className="record-icon">
            <Sun size={16} />
          </span>
          <span className="record-main">
            <strong>{record.appliance}</strong>
            <small>
              {record.section} · {parseFloat(record.hours.toFixed(2))}{" "}
              hr{record.hours === 1 ? "" : "s"}
              {record.occupants != null
                ? ` · ${record.occupants} occupant${record.occupants === 1 ? "" : "s"}`
                : ""}
            </small>
          </span>
          <span className="record-values">
            <strong>{kwhText(record.energy_kwh)} kWh</strong>
            <small>
              {new Date(record.started_at || record.created_at).toLocaleDateString("en-PH", {
                month: "short",
                day: "numeric",
              })}{" "}
              {new Date(record.started_at || record.created_at).toLocaleTimeString("en-PH", {
                hour: "numeric",
                minute: "2-digit",
              })}
            </small>
          </span>
        </article>
      ))}
    </div>
  );
}