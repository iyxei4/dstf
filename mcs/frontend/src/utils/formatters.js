import { APPLIANCE_PRESETS, MAX_HOURS } from "../constants";

export const phpMoney = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 2,
});

export function money(value) {
  return phpMoney.format(value || 0);
}

export function kwhText(value) {
  const text = Number(value || 0).toFixed(4);
  return text.replace(/\.?0+$/, "") || "0";
}

export function kwhPerHourOf(watts) {
  return Number(((watts || 0) / 1000).toFixed(4));
}

export function localDateValue(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function connectedWattsOf(appliance) {
  if (!appliance) return 0;
  return typeof appliance.connected_watts === "number"
    ? appliance.connected_watts
    : appliance.wattage * (appliance.quantity || 1);
}

export function roomKwh(value) {
  if (!value) return "0.0";
  if (value < 0.0001) return "<0.0001";
  if (value < 0.01) return value.toFixed(4);
  if (value < 1) return value.toFixed(3);
  return value.toFixed(2);
}

export function groupSectionsByGrade(sections) {
  const groups = new Map();
  sections.forEach((section) => {
    const grade = section.grade || section.name.split(" - ")[0] || "";
    if (!groups.has(grade)) groups.set(grade, []);
    groups.get(grade).push(section);
  });
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([grade, items]) => ({
      grade,
      label: grade ? `Grade ${grade}` : "Other",
      items,
    }));
}

export function formatElapsed(seconds) {
  const h = String(Math.floor(seconds / 3600)).padStart(2, "0");
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const s = String(seconds % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

export function clampHours(hours) {
  return Math.min(MAX_HOURS, Math.max(0, Number.parseFloat(hours) || 0));
}

export function getTodayLabel() {
  return new Intl.DateTimeFormat("en-PH", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date());
}

export function getAvailablePresets(appliances) {
  const takenNames = new Set(
    appliances.map((item) => item.name.trim().toLowerCase()),
  );
  return APPLIANCE_PRESETS.filter(
    (preset) => !takenNames.has(preset.name.toLowerCase()),
  );
}