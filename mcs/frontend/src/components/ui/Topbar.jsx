import { Brand } from "./Brand";

export function Topbar({ subtitle, nav, right, children }) {
  return (
    <header className="topbar">
      <Brand />
      <div className="topbar-middle">{nav ?? subtitle}</div>
      <div className="topbar-actions">{right}</div>
      {children}
    </header>
  );
}
