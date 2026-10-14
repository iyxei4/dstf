import { Moon, Sun } from "lucide-react";

export function ThemeToggle({ darkMode, onToggle }) {
  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={`Switch to ${darkMode ? "light" : "dark"} mode`}
      aria-pressed={darkMode}
      onClick={onToggle}
    >
      {darkMode ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  );
}