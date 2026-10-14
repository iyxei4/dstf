import { Zap, Power } from "lucide-react";
import { formatElapsed } from "../../utils/formatters";

export function ApplianceRow({
  appliance,
  session,
  elapsedSeconds,
  estimatedKwh,
  sessionKwh,
  loggedSessions,
  connectedWatts,
  busy,
  onStart,
  onStop,
  roomId,
}) {
  const isRunning = Boolean(session);
  const elapsedDisplay = isRunning ? formatElapsed(elapsedSeconds) : null;

  return (
    <tr className={isRunning ? "running-row" : ""}>
      <td data-label="Appliance">
        <span className="appliance-name-cell">
          <span className={`record-icon${isRunning ? " running-icon" : ""}`}>
            <Zap size={16} />
          </span>
          <span>
            <strong>{appliance.name}</strong>
            <small>
              {connectedWatts} W
              {(appliance.quantity || 1) > 1
                ? ` (${appliance.quantity} × ${appliance.wattage} W)`
                : ""}
            </small>
          </span>
        </span>
      </td>
      <td data-label="Estimated kwh">
        <span className="appliance-estimate-cell">
          <strong key={estimatedKwh.toFixed(4)}>
            {estimatedKwh.toFixed(4)} kWh
          </strong>
          <small>
            {isRunning
              ? `${elapsedDisplay} elapsed · +${sessionKwh.toFixed(4)} kWh now`
              : loggedSessions
              ? `${loggedSessions} completed session${loggedSessions === 1 ? "" : "s"}`
              : "Not running"}
          </small>
        </span>
      </td>
      <td>
        <span className="appliance-actions">
          <button
            type="button"
            className={`power-toggle${isRunning ? " is-on" : ""}`}
            aria-pressed={isRunning}
            disabled={
              busy || (!isRunning && !roomId)
            }
            onClick={() => (isRunning ? onStop(appliance) : onStart(appliance))}
          >
            <Power size={15} /> {isRunning ? "OFF" : "ON"}
          </button>
        </span>
      </td>
    </tr>
  );
}