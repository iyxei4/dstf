import { Brand } from "./Brand";

export function Topbar({ subtitle, right, children }) {
  return (
    <header className="topbar">
      <Brand />
      <div className="topbar-middle">{subtitle}</div>
      <div className="topbar-actions">{right}</div>
      {children}
    </header>
  );
}