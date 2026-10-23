import { useState } from "react";
import {
  Building2,
  DoorOpen,
  Layers,
  Pencil,
  Plus,
  Trash2,
  Users,
  X,
  Zap,
} from "lucide-react";
import { Button, Input, Select } from "../design";
import { ROOM_TYPES } from "../../constants";
import { request } from "../../utils/api";

function roomLabel(room) {
  return room.room_name || `Room ${room.room_number}`;
}

function roomTypeLabel(room) {
  if (room.room_type === "custom") return room.custom_type || "Custom";
  return (
    ROOM_TYPES.find((type) => type.value === room.room_type)?.label ||
    room.room_type ||
    "Classroom"
  );
}

function usageOf(room) {
  return room.usage_30d || { kwh: 0, submissions: 0, appliance_count: 0 };
}

function buildingRoomCount(building) {
  if (Number.isFinite(building.room_count)) return building.room_count;
  return (building.floors || []).reduce(
    (total, floor) => total + (floor.rooms || []).length,
    0,
  );
}

function formatKwh(value) {
  return Number(value || 0).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function CampusMap({ buildings, onReload, setNotice, setSuccess }) {
  const [createForm, setCreateForm] = useState({
    name: "",
    code: "",
    template: false,
  });
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(null);
  const [hover, setHover] = useState(null);
  const [edit, setEdit] = useState(null);

  const showError = (error, fallback) => {
    setNotice(error?.message || fallback);
  };

  const handleCreateBuilding = async (event) => {
    event.preventDefault();
    setNotice("");
    setSuccess("");
    const name = createForm.name.trim();
    const code = createForm.code.trim().toUpperCase();
    if (!name || !code) {
      setNotice("Building name and code are required.");
      return;
    }

    setBusy(true);
    try {
      await request("/user/buildings", {
        method: "POST",
        body: JSON.stringify({ building_code: code, building_name: name }),
      });

      if (createForm.template) {
        // Optional screenshot layout: four floors, five rooms per floor.
        for (let floor = 1; floor <= 4; floor += 1) {
          await request(`/user/buildings/${encodeURIComponent(code)}/floors`, {
            method: "POST",
            body: JSON.stringify({ floor }),
          });
          for (let roomIndex = 1; roomIndex <= 5; roomIndex += 1) {
            await request(
              `/user/buildings/${encodeURIComponent(code)}/floors/${floor}/rooms`,
              {
                method: "POST",
                body: JSON.stringify({
                  room_index: roomIndex,
                  room_number: floor * 100 + roomIndex,
                  room_name: null,
                  room_type: "classroom",
                  custom_type: null,
                }),
              },
            );
          }
        }
      }

      setCreateForm({ name: "", code: "", template: false });
      setSuccess(
        createForm.template
          ? `Building ${name} created with 4 floors and 20 rooms.`
          : `Building ${name} created. Add floors and rooms next.`,
      );
      await onReload();
    } catch (error) {
      showError(error, "Could not add the building.");
    } finally {
      setBusy(false);
    }
  };

  const handleAddFloor = async (building) => {
    setNotice("");
    setSuccess("");
    const nextFloor =
      Math.max(0, ...(building.floors || []).map((floor) => floor.floor)) + 1;
    setBusy(true);
    try {
      await request(
        `/user/buildings/${encodeURIComponent(building.building_code)}/floors`,
        {
          method: "POST",
          body: JSON.stringify({ floor: nextFloor }),
        },
      );
      setSuccess(`Floor ${nextFloor} added to ${building.building_name}.`);
      await onReload();
    } catch (error) {
      showError(error, "Could not add the floor.");
    } finally {
      setBusy(false);
    }
  };

  const handleAddRoom = async (building, floor) => {
    setNotice("");
    setSuccess("");
    const nextIndex =
      Math.max(0, ...(floor.rooms || []).map((room) => room.room_index)) + 1;
    setBusy(true);
    try {
      await request(
        `/user/buildings/${encodeURIComponent(building.building_code)}/floors/${
          floor.floor
        }/rooms`,
        {
          method: "POST",
          body: JSON.stringify({
            room_index: nextIndex,
            room_number: floor.floor * 100 + nextIndex,
            room_name: null,
            room_type: "classroom",
            custom_type: null,
          }),
        },
      );
      setSuccess(`Room added on floor ${floor.floor}.`);
      await onReload();
    } catch (error) {
      showError(error, "Could not add the room.");
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteBuilding = async (building) => {
    if (!window.confirm(`Delete ${building.building_name}?`)) return;
    setNotice("");
    setBusy(true);
    try {
      await request(
        `/user/buildings/${encodeURIComponent(building.building_code)}`,
        { method: "DELETE" },
      );
      setSuccess(`Building ${building.building_name} deleted.`);
      await onReload();
    } catch (error) {
      showError(error, "Could not delete the building.");
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteFloor = async (building, floor) => {
    if (!window.confirm(`Delete floor ${floor.floor}?`)) return;
    setNotice("");
    setBusy(true);
    try {
      await request(
        `/user/buildings/${encodeURIComponent(building.building_code)}/floors/${
          floor.floor
        }`,
        { method: "DELETE" },
      );
      setSuccess(`Floor ${floor.floor} deleted.`);
      await onReload();
    } catch (error) {
      showError(error, "Could not delete the floor.");
    } finally {
      setBusy(false);
    }
  };

  const handleSelectRoom = (building, floor, room) => {
    setSelected({ building, floor, room });
    setEdit({
      room_name: room.room_name || "",
      room_number: String(room.room_number ?? ""),
      room_type: room.room_type || "classroom",
      custom_type: room.custom_type || "",
    });
    setHover(null);
  };

  const closeDetail = () => {
    setSelected(null);
    setEdit(null);
  };

  const handleSaveRoom = async (event) => {
    event.preventDefault();
    if (!selected || !edit) return;
    setNotice("");
    setSuccess("");
    setBusy(true);
    try {
      await request(
        `/user/buildings/${encodeURIComponent(
          selected.building.building_code,
        )}/floors/${selected.floor.floor}/rooms/${selected.room.room_index}`,
        {
          method: "PUT",
          body: JSON.stringify({
            room_index: selected.room.room_index,
            room_number:
              Number(edit.room_number) || selected.room.room_number,
            room_name: edit.room_name.trim() || null,
            room_type: edit.room_type,
            custom_type:
              edit.room_type === "custom"
                ? edit.custom_type.trim() || null
                : null,
          }),
        },
      );
      setSuccess("Room updated.");
      closeDetail();
      await onReload();
    } catch (error) {
      showError(error, "Could not update the room.");
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteRoom = async () => {
    if (!selected) return;
    if (!window.confirm(`Delete ${roomLabel(selected.room)}?`)) return;
    setNotice("");
    setBusy(true);
    try {
      await request(
        `/user/buildings/${encodeURIComponent(
          selected.building.building_code,
        )}/floors/${selected.floor.floor}/rooms/${selected.room.room_index}`,
        { method: "DELETE" },
      );
      setSuccess("Room deleted.");
      closeDetail();
      await onReload();
    } catch (error) {
      showError(error, "Could not delete the room.");
    } finally {
      setBusy(false);
    }
  };

  const showHover = (event, building, floor, room) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const width = 280;
    const left = Math.min(
      Math.max(rect.left + rect.width / 2, width / 2 + 12),
      window.innerWidth - width / 2 - 12,
    );
    const below = rect.top < 270;
    setHover({
      building,
      floor,
      room,
      left,
      top: below ? rect.bottom + 8 : rect.top - 8,
      below,
    });
  };

  return (
    <section className="campus-map">
      <div className="panel-heading campus-map__heading">
        <div>
          <span className="eyebrow">CAMPUS MAKER</span>
          <h2>Buildings, floors, and rooms</h2>
          <p>
            Build your campus one building at a time. Hover or select a room to
            preview its appliances and last-30-day reports.
          </p>
        </div>
        <span className="count-pill">{buildings.length} buildings</span>
      </div>

      <form className="campus-map__create" onSubmit={handleCreateBuilding}>
        <div className="campus-map__create-fields">
          <Input
            label="Building name"
            value={createForm.name}
            maxLength={64}
            placeholder="BLDG 1 · G11 BLDG"
            onChange={(event) =>
              setCreateForm((prev) => ({ ...prev, name: event.target.value }))
            }
          />
          <Input
            label="Building code"
            value={createForm.code}
            maxLength={16}
            placeholder="CSHS-G11"
            hint="Codes must be unique across all campuses."
            onChange={(event) =>
              setCreateForm((prev) => ({
                ...prev,
                code: event.target.value.toUpperCase(),
              }))
            }
          />
        </div>
        <label className="campus-map__template">
          <input
            type="checkbox"
            checked={createForm.template}
            onChange={(event) =>
              setCreateForm((prev) => ({
                ...prev,
                template: event.target.checked,
              }))
            }
          />
          <span>
            <strong>Use standard layout</strong>
            <small>4 floors × 5 rooms (20 rooms)</small>
          </span>
        </label>
        <Button
          type="submit"
          loading={busy}
          disabled={!createForm.name.trim() || !createForm.code.trim()}
        >
          <Plus size={15} /> Add building
        </Button>
      </form>

      {buildings.length === 0 ? (
        <p className="empty-state">
          No buildings yet. Add one above, or use the standard layout to create
          four floors and twenty rooms in one step.
        </p>
      ) : (
        <div className="campus-map__buildings">
          {buildings.map((building) => {
            const floors = building.floors || [];
            return (
              <article
                className="campus-map__building"
                key={building.building_code}
              >
                <header className="campus-map__building-head">
                  <div>
                    <span className="campus-map__code">
                      {building.building_code}
                    </span>
                    <h3>
                      <Building2 size={16} /> {building.building_name}
                    </h3>
                  </div>
                  <div className="campus-map__building-actions">
                    <span className="count-pill">
                      {buildingRoomCount(building)} rooms
                    </span>
                    <button
                      type="button"
                      className="campus-map__action"
                      onClick={() => handleAddFloor(building)}
                      disabled={busy}
                    >
                      <Plus size={14} /> Floor
                    </button>
                    <button
                      type="button"
                      className="campus-map__icon-button"
                      onClick={() => handleDeleteBuilding(building)}
                      disabled={busy || floors.length > 0}
                      title={
                        floors.length > 0
                          ? "Delete the floors and rooms first."
                          : "Delete building"
                      }
                      aria-label={`Delete ${building.building_name}`}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </header>

                {floors.length === 0 ? (
                  <p className="campus-map__empty">
                    No floors yet. Use <strong>Floor</strong> to add one.
                  </p>
                ) : (
                  floors.map((floor) => {
                    const rooms = floor.rooms || [];
                    return (
                      <div className="campus-map__floor" key={floor.floor}>
                        <div className="campus-map__floor-head">
                          <h4>
                            <Layers size={14} /> Floor {floor.floor}
                          </h4>
                          <span>{rooms.length} rooms</span>
                          <button
                            type="button"
                            className="campus-map__action"
                            onClick={() => handleAddRoom(building, floor)}
                            disabled={busy}
                          >
                            <Plus size={14} /> Room
                          </button>
                          <button
                            type="button"
                            className="campus-map__icon-button"
                            onClick={() => handleDeleteFloor(building, floor)}
                            disabled={busy || rooms.length > 0}
                            title={
                              rooms.length > 0
                                ? "Delete the rooms first."
                                : "Delete floor"
                            }
                            aria-label={`Delete floor ${floor.floor}`}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>

                        {rooms.length === 0 ? (
                          <span className="campus-map__empty">
                            No rooms on this floor yet.
                          </span>
                        ) : (
                          <div className="campus-map__rooms">
                            {rooms.map((room) => {
                              const usage = usageOf(room);
                              return (
                                <button
                                  type="button"
                                  key={room.id}
                                  className={`campus-room${
                                    selected?.room.id === room.id
                                      ? " is-selected"
                                      : ""
                                  }${
                                    usage.submissions > 0 ? " has-reports" : ""
                                  }`}
                                  onClick={() =>
                                    handleSelectRoom(building, floor, room)
                                  }
                                  onMouseEnter={(event) =>
                                    showHover(event, building, floor, room)
                                  }
                                  onMouseLeave={() => setHover(null)}
                                  onFocus={(event) =>
                                    showHover(event, building, floor, room)
                                  }
                                  onBlur={() => setHover(null)}
                                  aria-label={`${roomLabel(room)}, ${roomTypeLabel(
                                    room,
                                  )}`}
                                >
                                  <span className="campus-room__name">
                                    <DoorOpen size={13} /> {roomLabel(room)}
                                  </span>
                                  <span className="campus-room__meta">
                                    {roomTypeLabel(room)}
                                  </span>
                                  {room.assigned_emc && (
                                    <span className="campus-room__emc">
                                      <Users size={11} /> {room.assigned_emc}
                                    </span>
                                  )}
                                  {usage.kwh > 0 && (
                                    <span className="campus-room__kwh">
                                      <Zap size={11} /> {formatKwh(usage.kwh)} kWh
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </article>
            );
          })}
        </div>
      )}

      {hover && !selected && (
        <div
          className={`room-hover-card${hover.below ? " is-below" : ""}`}
          style={{ left: hover.left, top: hover.top }}
          role="status"
        >
          <div className="room-hover-card__head">
            <strong>{roomLabel(hover.room)}</strong>
            <span>{roomTypeLabel(hover.room)}</span>
          </div>
          <small>
            {hover.building.building_name} · Floor {hover.floor.floor}
          </small>
          <div className="room-hover-card__stats">
            <span>
              <Zap size={12} /> {formatKwh(usageOf(hover.room).kwh)} kWh
            </span>
            <span>{usageOf(hover.room).submissions} reports</span>
          </div>
          {hover.room.assigned_emc ? (
            <p>
              <Users size={12} /> EMC: {hover.room.assigned_emc}
            </p>
          ) : (
            <p className="muted">No EMC assigned.</p>
          )}
          {hover.room.appliances?.length ? (
            <ul>
              {hover.room.appliances.slice(0, 3).map((item) => (
                <li key={item.name}>
                  <span>{item.name}</span>
                  <strong>{formatKwh(item.kwh)} kWh</strong>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">
              No appliance reports in the last 30 days. Unknown, not off.
            </p>
          )}
        </div>
      )}

      {selected && edit && (
        <>
          <div className="campus-detail-scrim" onClick={closeDetail} />
          <aside
            className="campus-room-detail"
            role="dialog"
            aria-modal="true"
            aria-label={`${roomLabel(selected.room)} details`}
          >
            <header className="campus-room-detail__head">
              <div>
                <span className="eyebrow">
                  {selected.building.building_name} · FLOOR{" "}
                  {selected.floor.floor}
                </span>
                <h3>{roomLabel(selected.room)}</h3>
                <p>{roomTypeLabel(selected.room)}</p>
              </div>
              <button
                type="button"
                className="campus-map__icon-button"
                onClick={closeDetail}
                aria-label="Close room details"
              >
                <X size={18} />
              </button>
            </header>

            <div className="campus-room-detail__stats">
              <article>
                <span>30-DAY ENERGY</span>
                <strong>{formatKwh(usageOf(selected.room).kwh)} kWh</strong>
              </article>
              <article>
                <span>REPORTS</span>
                <strong>{usageOf(selected.room).submissions}</strong>
              </article>
              <article>
                <span>APPLIANCES</span>
                <strong>{usageOf(selected.room).appliance_count}</strong>
              </article>
            </div>

            <div className="campus-room-detail__section">
              <h4>
                <Zap size={14} /> Appliances with reports
              </h4>
              {selected.room.appliances?.length ? (
                <ul className="campus-room-detail__appliances">
                  {selected.room.appliances.map((item) => (
                    <li key={item.name}>
                      <span>{item.name}</span>
                      <small>{item.submissions} reports</small>
                      <strong>{formatKwh(item.kwh)} kWh</strong>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="empty-state">
                  No reports in the last 30 days. This room is unknown, not off.
                </p>
              )}
            </div>

            <form className="campus-room-detail__form" onSubmit={handleSaveRoom}>
              <h4>
                <Pencil size={14} /> Edit room
              </h4>
              <div className="campus-room-detail__form-grid">
                <Input
                  label="Room name"
                  value={edit.room_name}
                  maxLength={80}
                  placeholder={`Room ${selected.room.room_number}`}
                  onChange={(event) =>
                    setEdit((prev) => ({
                      ...prev,
                      room_name: event.target.value,
                    }))
                  }
                />
                <Input
                  label="Room number"
                  type="number"
                  min="0"
                  value={edit.room_number}
                  onChange={(event) =>
                    setEdit((prev) => ({
                      ...prev,
                      room_number: event.target.value,
                    }))
                  }
                />
                <Select
                  label="Room type"
                  value={edit.room_type}
                  onChange={(event) =>
                    setEdit((prev) => ({
                      ...prev,
                      room_type: event.target.value,
                    }))
                  }
                  options={ROOM_TYPES}
                />
                {edit.room_type === "custom" && (
                  <Input
                    label="Custom type"
                    value={edit.custom_type}
                    maxLength={64}
                    onChange={(event) =>
                      setEdit((prev) => ({
                        ...prev,
                        custom_type: event.target.value,
                      }))
                    }
                  />
                )}
              </div>
              <div className="campus-room-detail__actions">
                <Button type="submit" loading={busy}>
                  Save room
                </Button>
                <Button type="button" variant="outline" onClick={closeDetail}>
                  Cancel
                </Button>
              </div>
            </form>

            <div className="campus-room-detail__danger">
              <div>
                <strong>Delete this room</strong>
                <small>
                  {Number(selected.room.total_submissions || 0) > 0
                    ? "Rooms with reports are kept so history stays intact."
                    : "This cannot be undone."}
                </small>
              </div>
              <button
                type="button"
                className="campus-room-detail__delete"
                onClick={handleDeleteRoom}
                disabled={
                  busy || Number(selected.room.total_submissions || 0) > 0
                }
              >
                <Trash2 size={14} /> Delete
              </button>
            </div>
          </aside>
        </>
      )}
    </section>
  );
}
