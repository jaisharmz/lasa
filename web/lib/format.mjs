class Raw {
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

export function raw(value) {
  return new Raw(value);
}

export function escape(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]);
}

function render(value) {
  if (value == null || value === false) return "";
  if (Array.isArray(value)) return value.map(render).join("");
  if (value instanceof Raw) return value.value;
  return escape(value);
}

export function html(strings, ...values) {
  return raw(strings.reduce((out, part, index) => out + part + (index < values.length ? render(values[index]) : ""), ""));
}

export function duration(seconds) {
  const total = Math.round(seconds / 60);
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function hours(seconds) {
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const value = seconds / 3600;
  return value >= 10 ? `${Math.round(value)}h` : `${value.toFixed(1)}h`;
}

export function clock(seconds) {
  const whole = Math.floor(seconds);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const pad = (value) => String(value).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function pace(minutesPerPage) {
  if (!minutesPerPage || !Number.isFinite(minutesPerPage)) return "–";
  const whole = Math.floor(minutesPerPage);
  const seconds = Math.round((minutesPerPage - whole) * 60);
  return seconds === 60 ? `${whole + 1}:00` : `${whole}:${String(seconds).padStart(2, "0")}`;
}

export function percent(value) {
  if (value == null) return "–";
  const scaled = value * 100;
  return scaled > 0 && scaled < 1 ? `${scaled.toFixed(1)}%` : `${Math.round(scaled)}%`;
}

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const dateFormat = new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric", year: "numeric" });
const shortDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const weekday = new Intl.DateTimeFormat(undefined, { weekday: "long" });

export function when(iso, now = new Date()) {
  const date = new Date(iso);
  const days = Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(iso).setHours(0, 0, 0, 0)) / 86400000);
  const at = timeFormat.format(date);
  if (days === 0) return `Today at ${at}`;
  if (days === 1) return `Yesterday at ${at}`;
  if (days < 7) return `${weekday.format(date)} at ${at}`;
  return `${dateFormat.format(date)} at ${at}`;
}

export function day(iso) {
  return shortDate.format(new Date(iso));
}

export function longDate(iso) {
  return dateFormat.format(new Date(iso));
}

export function hue(text) {
  let hash = 0;
  for (const char of String(text)) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  return hash % 360;
}

export function initials(name) {
  return String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0].toUpperCase()).join("");
}
