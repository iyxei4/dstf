import { Zap } from "lucide-react";
import { kwhText } from "../../utils/formatters";

export function UserSummary({ totalKwh, records }) {
  return (
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
    </section>
  );
}