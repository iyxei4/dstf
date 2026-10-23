import { useState, useEffect } from "react";

export function useTheme() {
  const [darkMode, setDarkMode] = useState(
    () => localStorage.getItem("wattwise-theme") !== "light",
  );
  useEffect(() => {
    document.documentElement.dataset.theme = darkMode ? "dark" : "light";
    localStorage.setItem("wattwise-theme", darkMode ? "dark" : "light");
  }, [darkMode]);
  return { darkMode, toggleTheme: () => setDarkMode((current) => !current) };
}