import { bookProgress } from "./stats.mjs";

export function sessionName(iso) {
  const hour = new Date(iso).getHours();
  if (hour < 5) return "Late Night Read";
  if (hour < 11) return "Morning Read";
  if (hour < 14) return "Lunch Read";
  if (hour < 17) return "Afternoon Read";
  if (hour < 21) return "Evening Read";
  return "Night Read";
}

export function monthKey(iso) {
  return new Date(iso).toISOString().slice(0, 7);
}

export function manualActivity(input, book, earlier, reader) {
  const seconds = Math.round(Number(input.seconds) || Number(input.minutes) * 60 || 0);
  if (seconds < 30) throw new Error("a session needs at least 30 seconds");
  const end = input.end ? new Date(input.end) : new Date();
  const start = input.start ? new Date(input.start) : new Date(end.getTime() - seconds * 1000);
  const before = bookProgress(earlier.filter((activity) => activity.book === book.key))[0]?.progress ?? null;
  const progressEnd = input.progressEnd != null && input.progressEnd !== "" ? Math.max(0, Math.min(1, Number(input.progressEnd))) : null;
  let pages = Math.round(Number(input.pages) || 0);
  if (!pages && progressEnd != null && before != null) pages = Math.max(0, Math.round((progressEnd - before) * book.pages));
  let progressStart = progressEnd != null ? before ?? Math.max(0, progressEnd - pages / book.pages) : null;
  let progressAfter = progressEnd;
  if (progressAfter == null && pages > 0 && before != null) {
    progressStart = before;
    progressAfter = Math.min(1, before + pages / book.pages);
  }
  return {
    id: `mn-${Math.floor(start.getTime() / 1000)}`,
    reader,
    book: book.key,
    name: String(input.name || "").trim() || sessionName(start.toISOString()),
    start: start.toISOString(),
    end: end.toISOString(),
    seconds,
    estimated: false,
    pages,
    progressStart,
    progressEnd: progressAfter,
    finished: Boolean(input.finished) || (progressAfter != null && progressAfter >= 0.985),
    source: "manual",
    device: input.timer ? "Läsa timer" : "Manual entry",
    format: input.format || "print",
    note: String(input.note || "").trim().slice(0, 2000),
    visibility: input.visibility === "private" ? "private" : "everyone",
    highlights: [],
  };
}
