import { Zap, Building2 } from "lucide-react";
import { kwhText, money } from "../../utils/formatters";

export function UserSummary({ totalKwh, totalBill, records, ratePerKwh }) {
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
  );
}