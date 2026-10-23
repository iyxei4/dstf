import { useEffect } from "react";
import { Search, Building2 } from "lucide-react";
import { roomKwh } from "../../utils/formatters";
import { ROOM_TYPES } from "../../constants";

function buildingFloorCount(building) {
  return new Set(building.rooms.map((room) => room.floor)).size;
}

export function AdminRooms({
  roomsData,
  selectedRoomId,
  setSelectedRoomId,
  roomQuery,
  setRoomQuery,
  usageOnly,
  setUsageOnly,
  roomType,
  setRoomType,
  customRoomType,
  setCustomRoomType,
  roomName,
  setRoomName,
  busy,
  saveRoomDetails,
  currentDetail,
}) {
  const selectedRoom = roomsData?.buildings
    .flatMap((building) => building.rooms)
    .find((room) => room.id === selectedRoomId);

  const flatRooms = roomsData
    ? roomsData.buildings.flatMap((building) =>
        building.rooms.map((room) => ({
          ...room,
          building_name_full: building.name,
        })),
      )
    : [];

  function roomMatches(room) {
    if (usageOnly && !room.submission_count) return false;
    const query = roomQuery.trim().toLowerCase();
    if (!query) return true;
    return (
      String(room.room_number).includes(query) ||
      room.display_name.toLowerCase().includes(query) ||
      room.display_type.toLowerCase().includes(query) ||
      room.building_name.toLowerCase().includes(query) ||
      room.assigned_users.some((username) =>
        username.toLowerCase().includes(query),
      )
    );
  }

  const visibleRooms = flatRooms.filter(roomMatches);
  const floorCounts = roomsData?.buildings.map(buildingFloorCount) ?? [];
  const floorLabel =
    floorCounts.length === 0
      ? "no floors"
      : floorCounts.every((count) => count === floorCounts[0])
        ? `${floorCounts[0]} ${floorCounts[0] === 1 ? "floor" : "floors"} per building`
        : `${Math.min(...floorCounts)}-${Math.max(...floorCounts)} floors per building`;

  useEffect(() => {
    if (!selectedRoom) {
      setRoomType("classroom");
      setCustomRoomType("");
      setRoomName("");
      return;
    }
    setRoomType(selectedRoom.room_type);
    setCustomRoomType(selectedRoom.custom_type || "");
    setRoomName(selectedRoom.room_name || "");
  }, [selectedRoom]);

  function chooseRoom(room) {
    setSelectedRoomId(room.id);
  }

  return (
    <>
      <div className="room-map-heading">
        <div>
          <span className="eyebrow">CAMPUS ROOM MAP</span>
          <p>
            {flatRooms.length} rooms · {floorLabel} · consumption over
            the last 30 days
          </p>
        </div>
        <div className="room-status-legend">
          <span>
            <i className="room-dot average-dot" /> AVERAGE USE
          </span>
          <span title="High = 1.5x or more of the building's per-room average">
            <i className="room-dot high-dot" /> HIGH CONSUMPTION
          </span>
        </div>
      </div>
      <div className="room-map-tools">
        <label className="room-search">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            placeholder="Search room, name, or account"
            aria-label="Search rooms"
            value={roomQuery}
            onChange={(event) => setRoomQuery(event.target.value)}
          />
        </label>
        <label className="usage-filter">
          <input
            type="checkbox"
            checked={usageOnly}
            onChange={(event) => setUsageOnly(event.target.checked)}
          />
          Only rooms with usage
        </label>
        <span className="room-count-note">
          {visibleRooms.length} of {flatRooms.length} rooms
        </span>
      </div>
      {visibleRooms.length === 0 ? (
        <div className="panel room-empty-panel">
          <div className="empty-state compact-empty">
            No rooms match your search. Try a room number, room
            name, or account.
          </div>
        </div>
      ) : (
        <section className="building-grid">
          {roomsData.buildings
            .filter((building) => building.rooms.some(roomMatches))
            .map((building) => (
              <article
                className="panel building-panel"
                key={building.code}
              >
                <div className="building-heading">
                  <span className="building-icon">
                    <Building2 size={17} />
                  </span>
                  <span>
                    <strong>{building.name}</strong>
                    <small>
                      {
                        building.rooms.filter(roomMatches).length
                      }{" "}
                      OF {building.rooms.length} ROOMS ·{" "}
                      {buildingFloorCount(building)} FLOORS
                    </small>
                  </span>
                  <span className="building-average">
                    {roomKwh(building.average_kwh_per_room)}
                    <small>kWh avg</small>
                  </span>
                </div>
                <div className="floor-stack">
                  {[...new Set(building.rooms.map((room) => room.floor))]
                    .sort((left, right) => right - left)
                    .filter((floor) =>
                      building.rooms.some(
                        (room) =>
                          room.floor === floor && roomMatches(room),
                      ),
                    )
                    .map((floor) => (
                      <div
                        className="floor-row"
                        key={`${building.code}-${floor}`}
                      >
                        <span className="floor-label">
                          <small>FLOOR</small>
                          <strong>{floor}</strong>
                        </span>
                        <div className="floor-rooms">
                          {building.rooms
                            .filter(
                              (room) =>
                                room.floor === floor && roomMatches(room),
                            )
                            .map((room) => (
                              <button
                                type="button"
                                key={room.id}
                                className={`room-tile ${room.usage_status === "high" ? "room-high" : "room-average"}${selectedRoomId === room.id ? " room-selected" : ""}`}
                                onClick={() => chooseRoom(room)}
                                aria-pressed={selectedRoomId === room.id}
                                title={`${room.display_name} · ${room.display_type} · ${roomKwh(room.average_kwh)} kWh / 30 days`}
                              >
                                <strong>
                                  {room.room_number}
                                </strong>
                                <small>
                                  {roomKwh(room.average_kwh)}
                                </small>
                              </button>
                            ))}
                        </div>
                      </div>
                    ))}
                </div>
              </article>
            ))}
        </section>
      )}
      {selectedRoom && (
        <section className="panel room-detail-panel">
          <div className="panel-heading room-detail-heading">
            <div>
              <span className="eyebrow">ROOM DETAILS</span>
              <h2>
                {selectedRoom.display_name} ·{" "}
                {selectedRoom.building_name}
              </h2>
            </div>
            <span
              className={`room-status-pill ${selectedRoom.usage_status === "high" ? "pill-high" : "pill-average"}`}
            >
              <i />{" "}
              {selectedRoom.usage_status === "high"
                ? "HIGH CONSUMPTION"
                : "AVERAGE USE"}
            </span>
          </div>
          <form onSubmit={saveRoomDetails}>
            <table className="room-detail-table">
              <tbody>
                <tr>
                  <th>Type of room</th>
                  <td>
                    <select
                      value={roomType}
                      onChange={(event) => setRoomType(event.target.value)}
                    >
                      {ROOM_TYPES.map((type) => (
                        <option key={type.value} value={type.value}>
                          {type.label}
                        </option>
                      ))}
                    </select>
                    {roomType === "custom" && (
                      <input
                        className="room-custom-type"
                        value={customRoomType}
                        onChange={(event) => setCustomRoomType(event.target.value)}
                        placeholder="Room type"
                        required
                        minLength={2}
                        maxLength={64}
                      />
                    )}
                  </td>
                </tr>
                <tr>
                  <th>Room name</th>
                  <td>
                    <input
                      value={roomName}
                      onChange={(event) => setRoomName(event.target.value)}
                      placeholder="Optional custom room name"
                      maxLength={80}
                    />
                  </td>
                </tr>
                <tr>
                  <th>Room number</th>
                  <td>
                    <strong className="room-number-value">
                      {selectedRoom.room_number}
                    </strong>
                    <span className="room-number-hint">
                      Floor {selectedRoom.floor} · room{" "}
                      {selectedRoom.room_index} from the left
                    </span>
                  </td>
                </tr>
                <tr>
                  <th>Average consumption</th>
                  <td>
                    <strong className="room-number-value">
                      {roomKwh(selectedRoom.average_kwh)} kWh
                    </strong>
                    <span className="room-number-hint">
                      Last 30 days ·{" "}
                      {roomKwh(selectedRoom.building_average_kwh)}
                      kWh building average
                    </span>
                  </td>
                </tr>
                <tr>
                  <th>Number of appliances</th>
                  <td>
                    <strong className="room-number-value">
                      {selectedRoom.appliance_count}
                    </strong>
                    <span className="room-number-hint">
                      Unique appliances reported in the last 30
                      days · {selectedRoom.submission_count}{" "}
                      {selectedRoom.submission_count === 1
                        ? "submission"
                        : "submissions"}
                    </span>
                  </td>
                </tr>
                <tr>
                  <th>Accounts assigned</th>
                  <td>
                    {currentDetail ? (
                      currentDetail.assigned_users.length ? (
                        <span className="room-user-chips">
                          {currentDetail.assigned_users.map((account) => (
                            <span
                              className="room-user-chip"
                              key={account}
                            >
                              {account}
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span className="room-number-hint">
                          No accounts assigned to this room
                        </span>
                      )
                    ) : (
                      <span className="room-number-hint">
                        Loading accounts...
                      </span>
                    )}
                  </td>
                </tr>
                <tr>
                  <th>Recent activity</th>
                  <td>
                    {!currentDetail ? (
                      <span className="room-number-hint">
                        Loading recent submissions...
                      </span>
                    ) : currentDetail.recent.length ? (
                      <ul className="room-recent-list">
                        {currentDetail.recent.map((record) => (
                          <li
                            className="room-recent-item"
                            key={record.id}
                          >
                            <span>
                              <strong>
                                {record.appliance}
                              </strong>{" "}
                              · {record.username}
                            </span>
                            <span>
                              {roomKwh(record.energy_kwh)} kWh ·{" "}
                              {new Date(record.created_at).toLocaleDateString("en-PH", {
                                month: "short",
                                day: "numeric",
                              })}{" "}
                              {new Date(record.created_at).toLocaleTimeString("en-PH", {
                                hour: "numeric",
                                minute: "2-digit",
                              })}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="room-number-hint">
                        No submissions in the last 30 days.
                      </span>
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
            <div className="room-detail-actions">
              <span>
                Room type and name changes apply to this room
                only.
              </span>
              <button
                className="button button-primary"
                disabled={busy}
              >
                Save room details
              </button>
            </div>
          </form>
        </section>
      )}
    </>
  );
}