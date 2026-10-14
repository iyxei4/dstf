export function Notice({ children, kind = "error" }) {
  if (!children) return null;
  return (
    <p
      className={`notice notice-${kind}`}
      role={kind === "error" ? "alert" : "status"}
    >
      {children}
    </p>
  );
}