import { useState } from "react";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Circle,
} from "lucide-react";
import { Button } from "../design";

export function SetupGuide({
  dashboard,
  buildings,
  appliances,
  emcs,
  onNavigate,
}) {
  const [open, setOpen] = useState(
    () => localStorage.getItem("wattwise-setup-open") !== "0",
  );

  const steps = [
    {
      key: "campus",
      title: "Name your campus",
      detail: "Your workspace name becomes the campus part of your URL.",
      done: Boolean(dashboard?.workspace_name),
      tab: "settings",
    },
    {
      key: "building",
      title: "Create a building",
      detail: "Add a building, or use the standard 4-floor × 5-room layout.",
      done: (buildings || []).length > 0,
      tab: "buildings",
    },
    {
      key: "rooms",
      title: "Add rooms",
      detail: "Rooms are where your EMCs submit appliance reports.",
      done:
        Number(dashboard?.total_rooms || 0) > 0 ||
        (buildings || []).some((building) =>
          (building.floors || []).some((floor) => (floor.rooms || []).length > 0),
        ),
      tab: "buildings",
    },
    {
      key: "appliances",
      title: "Add appliances",
      detail: "Give each appliance a name, wattage, and number of units.",
      done: (appliances || []).length > 0,
      tab: "appliances",
    },
    {
      key: "emc",
      title: "Create an EMC account",
      detail: "Assign an Energy Monitoring Coordinator to a room.",
      done: (emcs || []).length > 0,
      tab: "emcs",
    },
    {
      key: "report",
      title: "Submit a test report",
      detail: "Reports are observations. No report means unknown, not off.",
      done: (dashboard?.recent_activity || []).length > 0,
      tab: "reports",
    },
  ];

  const completed = steps.filter((step) => step.done).length;
  const percent = Math.round((completed / steps.length) * 100);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    localStorage.setItem("wattwise-setup-open", next ? "1" : "0");
  };

  return (
    <section className={`panel setup-guide${open ? "" : " is-collapsed"}`}>
      <div className="panel-heading setup-guide__heading">
        <div>
          <span className="eyebrow">
            <BookOpen size={12} /> GETTING STARTED
          </span>
          <h2>Set up your campus</h2>
          <p>
            {completed === steps.length
              ? "Everything is ready. Your campus can start reporting."
              : "Follow these steps to get your first room reporting."}
          </p>
        </div>
        <div className="setup-guide__summary">
          <strong>
            {completed}/{steps.length}
          </strong>
          <span>complete</span>
          <Button variant="ghost" size="sm" onClick={toggle}>
            {open ? "Hide guide" : "Show guide"}
          </Button>
        </div>
      </div>

      <div className="setup-guide__bar" aria-hidden="true">
        <span style={{ width: `${percent}%` }} />
      </div>

      {open && (
        <ol className="setup-guide__steps">
          {steps.map((step, index) => (
            <li
              key={step.key}
              className={step.done ? "is-done" : ""}
            >
              <span className="setup-guide__icon" aria-hidden="true">
                {step.done ? (
                  <CheckCircle2 size={18} />
                ) : (
                  <Circle size={18} />
                )}
              </span>
              <div className="setup-guide__copy">
                <strong>
                  {index + 1}. {step.title}
                </strong>
                <small>{step.detail}</small>
              </div>
              {!step.done && (
                <button
                  type="button"
                  className="setup-guide__action"
                  onClick={() => onNavigate(step.tab)}
                >
                  Open <ArrowRight size={14} />
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
