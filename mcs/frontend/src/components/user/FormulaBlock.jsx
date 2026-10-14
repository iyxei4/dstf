import { Bolt } from "lucide-react";
import { kwhText, kwhPerHourOf } from "../../utils/formatters";

export function FormulaBlock({
  connectedWatts,
  applianceRows,
  appliances,
}) {
  const liveTotalKwh = applianceRows.reduce(
    (sum, row) => sum + (row.sessionKwh || 0),
    0,
  );
  const runningCount = applianceRows.filter((row) => row.session).length;

  return (
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
          {runningCount} of{" "}
          {appliances.length} appliances):
        </span>
        <output key={liveTotalKwh.toFixed(4)}>
          {liveTotalKwh.toFixed(4)} kWh
        </output>
      </div>
      <span className="formula">LIVE ESTIMATE · W × HOURS ÷ 1,000</span>
    </div>
  );
}