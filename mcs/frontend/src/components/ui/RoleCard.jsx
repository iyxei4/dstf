import { ArrowRight } from "lucide-react";

export function RoleCard({ title, description, icon, eyebrow, href, color = "default" }) {
  const isAdmin = color === "admin";
  return (
    <a className={`role-card ${isAdmin ? "admin-role" : "user-role"}`} href={href}>
      <div className="role-card-top">
        <span className="role-icon">
          {icon}
        </span>
        <ArrowRight size={18} />
      </div>
      <div className="role-card-copy">
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      <div className="role-card-bottom">
        <span>{isAdmin ? "Sign in as admin" : "Enter your account"}</span>
        <ArrowRight size={16} />
      </div>
    </a>
  );
}