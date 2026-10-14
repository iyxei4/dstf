import { X } from "lucide-react";
import { connectedWattsOf, kwhText, money } from "../../utils/formatters";

export function ManualEntryForm({
  appliances,
  manualAppliance,
  setManualAppliance,
  manualHours,
  setManualHours,
  manualDate,
  setManualDate,
  assignedRoom,
  ratePerKwh,
  busy,
  onSubmit,
  onClose,
}) {
  const manualApplianceRow = appliances.find(
    (item) => String(item.id) === manualAppliance,
  );
  const manualHoursValue = Math.min(
    24,
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

  return (
    <div className="manual-record-form animate-in">
      <div className="manual-form-header">
        <span className="eyebrow">CUSTOM TIME ENTRY</span>
        <p>Forgot to start your timer? Log hours you missed below.</p>
        <button
          type="button"
          className="icon-button manual-close"
          onClick={onClose}
          aria-label="Close custom time entry"
        >
          <X size={16} />
        </button>
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
            max={24}
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
            max={new Date().toISOString().split("T")[0]}
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
              ? new Date(`${manualDate}T00:00:00`).toLocaleDateString("en-PH", {
                  weekday: "short",
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })
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
        <button type="button" className="button" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="button button-primary"
          disabled={busy || !manualValid || !assignedRoom}
          onClick={onSubmit}
        >
          {busy ? "Saving…" : "Submit record"}
        </button>
      </div>
      {!assignedRoom && (
        <small className="manual-form-hint">
          A room must be assigned to your account before you can log usage.
        </small>
      )}
    </div>
  );
}