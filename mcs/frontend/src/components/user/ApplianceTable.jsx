import { ApplianceRow } from "./ApplianceRow";

export function ApplianceTable({
  applianceRows,
  grandTotalKwh,
  appliances,
  onStart,
  onStop,
  roomId,
  busy,
}) {
  if (!appliances.length) {
    return (
      <div className="empty-state">
        Add an appliance to start logging classroom usage.
      </div>
    );
  }

  return (
    <div className="responsive-table appliance-table-wrap">
      <table className="appliance-table">
        <thead>
          <tr>
            <th>APPLIANCE</th>
            <th>ESTIMATED KWH</th>
            <th>ON / OFF</th>
          </tr>
        </thead>
        <tbody>
          {applianceRows.map(
            ({
              appliance,
              session,
              elapsedSeconds,
              estimatedKwh,
              sessionKwh,
              loggedSessions,
              connectedWatts,
            }) => (
              <ApplianceRow
                key={appliance.id}
                appliance={appliance}
                session={session}
                elapsedSeconds={elapsedSeconds}
                estimatedKwh={estimatedKwh}
                sessionKwh={sessionKwh}
                loggedSessions={loggedSessions}
                connectedWatts={connectedWatts}
                busy={busy}
                onStart={onStart}
                onStop={onStop}
                roomId={roomId}
              />
            ),
          )}
        </tbody>
        <tfoot>
          <tr>
            <td data-label="Total">
              <span className="appliance-name-cell">
                <span>
                  <strong>
                    E<sub>total</sub> = Σ (P<sub>i</sub> × t
                    <sub>i</sub>) ÷ 1000
                  </strong>
                  <small>Sum of every row above</small>
                </span>
              </span>
            </td>
            <td data-label="Total kwh">
              <span className="appliance-estimate-cell">
                <strong>{grandTotalKwh.toFixed(4)} kWh</strong>
                <small>Saved history + running</small>
              </span>
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}