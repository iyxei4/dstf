export const API = "/api";
export const MAX_HOURS = 24;
export const SESSION_SECONDS = 8 * 60 * 60;

export const APPLIANCE_PRESETS = [
  { name: "Electric fan", watts: 55 },
  { name: "TV", watts: 100 },
  { name: "Printer", watts: 100 },
  { name: "Water Dispenser", watts: 500 },
  { name: "Linear Fluorescent Light", watts: 40 },
  { name: "Desktop Computer", watts: 135 },
];

export const GRADES = ["11", "12"];

export const ROOM_TYPES = [
  { value: "classroom", label: "Classroom" },
  { value: "office", label: "Office" },
  { value: "custom", label: "Custom type" },
];

export const REPORT_GROUPS = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

export const TABS = [
  ["facilities", "Users & facilities", "Building2"],
  ["overview", "Overview", "Activity"],
  ["reports", "Reports", "Zap"],
  ["rooms", "Buildings & rooms", "DoorOpen"],
];

export const REPORT_SUGGESTIONS = [
  "which room has the highest consumption?",
  "top appliance",
  "peak hour",
  "total kWh",
  "estimated bill",
  "how many accounts",
];

export const DATE_FORMAT_OPTIONS = {
  full: { weekday: "long", month: "long", day: "numeric" },
  short: { month: "short", day: "numeric" },
  datetime: { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" },
};