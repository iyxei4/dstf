import { Bolt } from "lucide-react";

export function Brand({ compact = false }) {
  return (
    <a className={`brand${compact ? " brand-compact" : ""}`} href="/">
      <span className="brand-icon">
        <Bolt size={18} fill="currentColor" />
      </span>
      <span className="brand-word">
        wattwise<span>.</span>
      </span>
    </a>
  );
}