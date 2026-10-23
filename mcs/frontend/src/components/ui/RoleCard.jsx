import { Link } from "react-router-dom";
import { ArrowUpRight, Check } from "lucide-react";

export function RoleCard({
  title,
  description,
  icon,
  eyebrow,
  href,
  tone = "coordinator",
  details = [],
  cta,
}) {
  return (
    <Link className={`role-card role-card--${tone}`} to={href}>
      <div className="role-card-top">
        <span className="role-icon">{icon}</span>
        <span className="role-card-tag">
          {tone === "owner" ? "OWNER" : "EMC"}
        </span>
      </div>
      <div className="role-card-copy">
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {details.length > 0 && (
        <ul className="role-card-details">
          {details.map((detail) => (
            <li key={detail}>
              <Check size={13} />
              {detail}
            </li>
          ))}
        </ul>
      )}
      <div className="role-card-bottom">
        <span>{cta ?? "Continue"}</span>
        <ArrowUpRight size={17} />
      </div>
    </Link>
  );
}
