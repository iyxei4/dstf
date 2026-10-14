import { X, Plus, Trash2 } from "lucide-react";
import { APPLIANCE_PRESETS } from "../../constants";
import { connectedWattsOf, kwhPerHourOf } from "../../utils/formatters";
import { Notice } from "../ui/Notice";

export function SettingsPanel({
  appliances,
  setShowSettings,
  presetChoice,
  setPresetChoice,
  busy,
  notice,
  success,
  onAddPreset,
  onUpdateAppliance,
  onRemoveAppliance,
  running,
}) {
  const takenNames = new Set(
    appliances.map((item) => item.name.trim().toLowerCase()),
  );
  const availablePresets = APPLIANCE_PRESETS.filter(
    (preset) => !takenNames.has(preset.name.toLowerCase()),
  );
  const presetRow = APPLIANCE_PRESETS.find(
    (preset) => preset.name === presetChoice,
  );

  return (
    <section className="panel settings-panel animate-in">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">USER SETTINGS</span>
          <h2>Select your appliances</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={() => setShowSettings(false)}
          title="Close settings"
          aria-label="Close settings"
        >
          <X size={17} />
        </button>
      </div>
      <p className="settings-help">
        Choose an appliance type to add it to your classroom list. Each type
        carries a preset wattage that feeds the E = P × t ÷ 1000 estimate.
      </p>
      <form className="settings-add" onSubmit={onAddPreset}>
        <label className="manual-field">
          <span>Type of appliance</span>
          <select
            value={presetChoice}
            onChange={(event) => setPresetChoice(event.target.value)}
          >
            <option value="">Choose an appliance type…</option>
            {availablePresets.map((preset) => (
              <option key={preset.name} value={preset.name}>
                {preset.name} · {preset.watts} W
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="button button-primary"
          disabled={busy || !presetRow}
        >
          <Plus size={15} /> Add appliance
        </button>
      </form>
      <div className="responsive-table settings-table-wrap">
        <table className="settings-table">
          <thead>
            <tr>
              <th>NAME</th>
              <th>TYPE OF APPLIANCE</th>
              <th className="qty-col">QTY</th>
              <th>CONNECTED LOAD</th>
              <th aria-label="Remove" />
            </tr>
          </thead>
          <tbody>
            {appliances.map((appliance) => {
              const isKnownPreset = APPLIANCE_PRESETS.some(
                (preset) => preset.name === appliance.name,
              );
              return (
                <tr key={appliance.id}>
                  <td data-label="Name">
                    <strong>{appliance.name}</strong>
                    <small>
                      {kwhPerHourOf(appliance.wattage)} kWh/h each
                    </small>
                  </td>
                  <td data-label="Type of appliance">
                    <select
                      value={appliance.name}
                      disabled={busy}
                      onChange={(event) =>
                        onUpdateAppliance(appliance, {
                          name: event.target.value,
                          wattage: APPLIANCE_PRESETS.find(p => p.name === event.target.value)?.watts || appliance.wattage,
                        })
                      }
                      aria-label={`Type for ${appliance.name}`}
                    >
                      {!isKnownPreset && (
                        <option value={appliance.name}>
                          {appliance.name} ·{" "}
                          {kwhPerHourOf(appliance.wattage)} kWh/h
                        </option>
                      )}
                      {APPLIANCE_PRESETS.map((preset) => (
                        <option key={preset.name} value={preset.name}>
                          {preset.name} · {preset.watts} W
                        </option>
                      ))}
                    </select>
                  </td>
                  <td data-label="Quantity" className="qty-col">
                    <input
                      type="number"
                      min="1"
                      max="999"
                      step="1"
                      className="qty-input"
                      key={`${appliance.id}-${appliance.quantity || 1}`}
                      defaultValue={appliance.quantity || 1}
                      disabled={busy}
                      aria-label={`Units of ${appliance.name}`}
                      onBlur={(event) =>
                        onUpdateAppliance(appliance, {
                          quantity: Math.max(1, Math.min(999, Math.floor(Number(event.target.value) || 1))),
                        })
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                      }}
                    />
                  </td>
                  <td data-label="Connected load">
                    <strong className="connected-load-cell">
                      {connectedWattsOf(appliance)} W
                    </strong>
                    <small>
                      {kwhPerHourOf(connectedWattsOf(appliance))} kWh/h
                      {(appliance.quantity || 1) > 1
                        ? ` · ${appliance.quantity} × ${appliance.wattage} W`
                        : ""}
                    </small>
                  </td>
                  <td data-label="Remove">
                    <button
                      type="button"
                      className="delete-action"
                      disabled={busy || Boolean(running[appliance.id])}
                      title={
                        running[appliance.id]
                          ? "Turn this appliance off before removing it"
                          : `Remove ${appliance.name}`
                      }
                      aria-label={`Remove appliance ${appliance.name}`}
                      onClick={() => onRemoveAppliance(appliance)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!appliances.length && (
          <div className="empty-state compact-empty">
            No appliances yet — add one from the dropdown above.
          </div>
        )}
      </div>
      <Notice>{notice}</Notice>
      <Notice kind="success">{success}</Notice>
    </section>
  );
}