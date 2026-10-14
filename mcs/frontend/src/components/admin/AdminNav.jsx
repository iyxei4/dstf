import { Building2, Activity, Zap, DoorOpen, X, ShieldCheck } from "lucide-react";

export function AdminNav({ open, tab, setTab, pendingCount, admin, onReportsClick, onClose }) {
  const tabs = [
    ["overview", "Overview", Activity],
    ["reports", "Reports", Zap],
    ["rooms", "Buildings & rooms", DoorOpen],
    ["facilities", "Users & facilities", Building2],
  ];

  return (
    <aside
      className={`admin-nav${open ? " is-open" : ""}`}
      aria-label="Admin sections"
    >
      <div className="nav-heading">
        <span className="nav-label">WORKSPACE</span>
        <button
          type="button"
          className="icon-button nav-close"
          onClick={onClose}
          title="Close menu"
          aria-label="Close menu"
        >
          <X size={16} />
        </button>
      </div>
      {tabs.map(([key, label, Icon]) => (
        <button
          key={key}
          className={`nav-link${tab === key ? " active" : ""}`}
          onClick={() => {
            setTab(key);
            if (key === "reports") onReportsClick();
            onClose();
          }}
        >
          <Icon size={16} />
          <span>{label}</span>
          {key === "facilities" && pendingCount > 0 && (
            <span className="nav-badge">{pendingCount}</span>
          )}
        </button>
      ))}
      <div className="nav-bottom">
        <span className="nav-admin-icon">
          <ShieldCheck size={16} />
        </span>
        <span>
          <strong>{admin?.username}</strong>
          <small>Administrator</small>
        </span>
      </div>
    </aside>
  );
}
