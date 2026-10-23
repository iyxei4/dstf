import { useState } from "react";
import { Check, X, Plus, Trash2, DoorOpen, Zap, ChevronDown } from "lucide-react";
import { groupSectionsByGrade } from "../../utils/formatters";
import { GRADES } from "../../constants";

const SECTION_PAGE_SIZE = 10;

export function AdminFacilities({
  dashboard,
  roomsData,
  pendingUsers,
  sectionName,
  setSectionName,
  sectionGrade,
  setSectionGrade,
  applianceName,
  setApplianceName,
  applianceWatts,
  setApplianceWatts,
  editingId,
  setEditingId,
  userAccount,
  setUserAccount,
  userPassword,
  setUserPassword,
  userRoomId,
  setUserRoomId,
  credentialsMessage,
  busy,
  onAddSection,
  onRemoveSection,
  onSaveAppliance,
  onRemoveAppliance,
  onSaveUserCredentials,
  onAssignUserRoom,
  onAssignUserSection,
  onApproveUser,
  onRejectUser,
}) {
  // The section catalog is paginated so a big school doesn't stretch this tab
  // into a mile-long page; grade labels are re-derived for the visible slice.
  const [sectionPage, setSectionPage] = useState(1);
  const sectionGroups = groupSectionsByGrade(dashboard?.sections_catalog || []);
  const flatSections = sectionGroups.flatMap((group) =>
    group.items.map((item) => ({ ...item, grade: group.label })),
  );
  const sectionPages = Math.max(
    1,
    Math.ceil(flatSections.length / SECTION_PAGE_SIZE),
  );
  const currentPage = Math.min(sectionPage, sectionPages);
  const pageSections = flatSections.slice(
    (currentPage - 1) * SECTION_PAGE_SIZE,
    currentPage * SECTION_PAGE_SIZE,
  );
  const pageGroups = [];
  for (const item of pageSections) {
    const last = pageGroups[pageGroups.length - 1];
    if (last && last.label === item.grade) last.items.push(item);
    else pageGroups.push({ label: item.grade, items: [item] });
  }

  return (
    <>
      <section className="panel user-monitor-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">USER MANAGEMENT</span>
            <h2>User accounts</h2>
          </div>
          <span className="count-pill">
            {dashboard?.users_total ?? (dashboard?.users?.length || 0)} accounts
          </span>
        </div>
        {pendingUsers.length > 0 && (
          <div className="approval-block">
            <div className="approval-heading">
              <span className="eyebrow">REGISTRATION REQUESTS</span>
              <span className="count-pill pending-pill">
                {dashboard?.pending_count ?? pendingUsers.length} pending
              </span>
            </div>
            <div className="approval-list">
              {pendingUsers.map((user) => (
                <article className="approval-row" key={user.username}>
                  <span className="account-avatar pending-avatar">
                    {user.username.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="approval-main">
                    <strong>{user.username}</strong>
                    <small>
                      {user.section
                        ? user.section.name
                        : "No section set"}{" "}
                      · requested{" "}
                      {new Date(
                        `${user.last_seen}Z`,
                      ).toLocaleDateString("en-PH", {
                        month: "short",
                        day: "numeric",
                      })}
                    </small>
                  </span>
                  <span className="approval-actions">
                    <button
                      type="button"
                      className="approve-action"
                      title={`Approve ${user.username}`}
                      onClick={() => onApproveUser(user.username)}
                    >
                      <Check size={15} /> Approve
                    </button>
                    <button
                      type="button"
                      className="reject-action"
                      title={`Reject ${user.username}`}
                      onClick={() => onRejectUser(user.username)}
                    >
                      <X size={15} /> Reject
                    </button>
                  </span>
                </article>
              ))}
            </div>
          </div>
        )}
        <div className="credential-provision">
          <div>
            <span className="eyebrow">ISSUE OR RESET ACCESS</span>
            <p>
              Create an account and password for a teacher or staff
              member.
            </p>
          </div>
          <form
            className="credential-form"
            onSubmit={onSaveUserCredentials}
          >
            <label>
              Username
              <input
                value={userAccount}
                onChange={(event) => setUserAccount(event.target.value)}
                minLength={2}
                maxLength={80}
                autoComplete="off"
                required
              />
            </label>
            <label>
              Temporary password
              <input
                type="password"
                value={userPassword}
                onChange={(event) => setUserPassword(event.target.value)}
                minLength={10}
                autoComplete="new-password"
                required
              />
            </label>
            <label>
              Assigned room
              <select
                value={userRoomId}
                onChange={(event) => setUserRoomId(event.target.value)}
                required
              >
                {roomsData?.buildings.map((building) => (
                  <optgroup key={building.code} label={building.name}>
                    {building.rooms.map((room) => (
                      <option key={room.id} value={room.id}>
                        {room.room_name || `Room ${room.room_number}`}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <button className="button button-primary" disabled={busy}>
              Set credentials
            </button>
          </form>
          {credentialsMessage && (
            <p className="credential-success" role="status">
              {credentialsMessage}
            </p>
          )}
        </div>
        <div className="responsive-table">
          <table>
            <thead>
              <tr>
                <th>ACCOUNT</th>
                <th>SECTION</th>
                <th>ASSIGNED ROOM</th>
                <th>ENTRIES</th>
                <th>LAST ACTIVE</th>
                <th>STATUS</th>
                <th>CREDENTIALS</th>
              </tr>
            </thead>
            <tbody>
              {dashboard?.users?.map((user) => (
                <tr key={user.username}>
                  <td>
                    <span className="table-user">
                      <span className="account-avatar">
                        {user.username.slice(0, 1).toUpperCase()}
                      </span>
                      <strong>{user.username}</strong>
                    </span>
                  </td>
                  <td>
                    <select
                      className="user-section-select"
                      value={user.section ? String(user.section.id) : ""}
                      onChange={(event) => {
                        const value = event.target.value;
                        onAssignUserSection(
                          user.username,
                          value ? Number(value) : null,
                        );
                      }}
                      aria-label={`Set section for ${user.username}`}
                    >
                      <option value="">No section</option>
                      {groupSectionsByGrade(
                        dashboard?.sections_catalog || [],
                      ).map((group) => (
                        <optgroup
                          key={group.label}
                          label={group.label}
                        >
                          {group.items.map((section) => (
                            <option
                              key={section.id}
                              value={section.id}
                            >
                              {section.name}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      className="user-room-select"
                      value={
                        user.assigned_room
                          ? String(user.assigned_room.id)
                          : ""
                      }
                      onChange={(event) => {
                        const value = event.target.value;
                        onAssignUserRoom(
                          user.username,
                          value ? Number(value) : null,
                        );
                      }}
                      aria-label={`Assign room to ${user.username}`}
                    >
                      <option value="">Unassigned</option>
                      {roomsData?.buildings.map((building) => (
                        <optgroup
                          key={building.code}
                          label={building.name}
                        >
                          {building.rooms.map((room) => (
                            <option key={room.id} value={room.id}>
                              {room.room_name ||
                                `Room ${room.room_number}`}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </td>
                  <td>{user.records}</td>
                  <td>
                    {new Date(`${user.last_seen}Z`).toLocaleString(
                      "en-PH",
                      { dateStyle: "medium", timeStyle: "short" },
                    )}
                  </td>
                  <td>
                    <span
                      className={`account-status${user.status === "active" ? " is-approved" : ""}`}
                    >
                      <i />{" "}
                      {user.status === "active"
                        ? "APPROVED"
                        : "PENDING"}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`credential-status${user.credentials_set ? " is-ready" : ""}`}
                    >
                      <i />{" "}
                      {user.credentials_set ? "READY" : "NEEDS SETUP"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!dashboard?.users?.length && (
          <div className="empty-state">No user accounts yet.</div>
        )}
      </section>
      <section className="catalog-grid">
        <div className="panel catalog-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">CLASSROOMS</span>
              <h2>Sections</h2>
            </div>
            <span className="count-pill">
              {dashboard?.sections_catalog?.length || 0}
            </span>
          </div>
          <form
            className="inline-add-form section-add-form"
            onSubmit={onAddSection}
          >
            <label className="grade-select">
              <select
                value={sectionGrade}
                onChange={(event) => setSectionGrade(event.target.value)}
                aria-label="Grade"
              >
                {GRADES.map((grade) => (
                  <option key={grade} value={grade}>
                    Grade {grade}
                  </option>
                ))}
              </select>
              <ChevronDown className="select-chevron" size={15} />
            </label>
            <input
              value={sectionName}
              onChange={(event) => setSectionName(event.target.value)}
              placeholder="Section name (e.g. bernoulli)"
              minLength={2}
              maxLength={40}
              required
            />
            <button
              className="button button-primary"
              title="Add section"
            >
              <Plus size={16} />
              <span>Add</span>
            </button>
          </form>
          <div className="catalog-list">
            {pageGroups.map((group) => (
              <div className="catalog-group" key={group.label}>
                <span className="catalog-group-label">
                  {group.label}
                </span>
                {group.items.map((section) => (
                  <div className="catalog-row" key={section.id}>
                    <span className="catalog-row-icon">
                      <DoorOpen size={16} />
                    </span>
                    <strong>{section.name}</strong>
                    <button
                      type="button"
                      className="delete-action"
                      title={`Remove ${section.name}`}
                      aria-label={`Remove section ${section.name}`}
                      onClick={() => onRemoveSection(section)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>
          {sectionPages > 1 && (
            <div className="catalog-pager">
              <button
                type="button"
                className="button button-secondary"
                disabled={currentPage <= 1}
                onClick={() => setSectionPage(currentPage - 1)}
              >
                Prev
              </button>
              <span className="pager-status">
                Page {currentPage} / {sectionPages}
              </span>
              <button
                type="button"
                className="button button-secondary"
                disabled={currentPage >= sectionPages}
                onClick={() => setSectionPage(currentPage + 1)}
              >
                Next
              </button>
            </div>
          )}
        </div>
        <div className="panel catalog-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">EQUIPMENT</span>
              <h2>Appliances</h2>
            </div>
            <span className="count-pill">
              {dashboard?.appliances?.length || 0}
            </span>
          </div>
          <form
            className="inline-add-form appliance-add-form"
            onSubmit={onSaveAppliance}
          >
            <input
              value={applianceName}
              onChange={(event) => setApplianceName(event.target.value)}
              placeholder={editingId ? "Edit appliance" : "Appliance name"}
              minLength={2}
              maxLength={80}
              required
            />
            <input
              className="watt-input"
              type="number"
              min="1"
              max="100000"
              value={applianceWatts}
              onChange={(event) => setApplianceWatts(event.target.value)}
              aria-label="Wattage"
              required
            />
            <button
              className="button button-primary"
              title={editingId ? "Save appliance" : "Add appliance"}
            >
              <Plus size={16} />
              <span>{editingId ? "Save" : "Add"}</span>
            </button>
          </form>
          <div className="catalog-list">
            {dashboard?.appliances?.map((appliance) => (
              <div className="catalog-row" key={appliance.id}>
                <span className="catalog-row-icon">
                  <Zap size={16} />
                </span>
                <strong>{appliance.name}</strong>
                <span className="wattage-value">
                  {appliance.wattage} W
                </span>
                <button
                  className="edit-action"
                  onClick={() => {
                    setEditingId(appliance.id);
                    setApplianceName(appliance.name);
                    setApplianceWatts(appliance.wattage);
                  }}
                  aria-label={`Edit ${appliance.name}`}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="delete-action"
                  title={`Remove ${appliance.name}`}
                  aria-label={`Remove appliance ${appliance.name}`}
                  onClick={() => onRemoveAppliance(appliance)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}