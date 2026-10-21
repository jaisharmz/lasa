import { sessionName } from "./activity.mjs";
import { bookKey } from "./books.mjs";
import { parseCsv, pick } from "./csv.mjs";

// Amazon's Kindle data export: a zip, sometimes holding more zips, with a ReadingSession CSV of
// every real session and ownership files that map ASINs to titles. Shared by the CLI and the site.

export const TITLE_FILE_LIMIT = 50 * 1024 * 1024;

function baseName(name) {
  return String(name).split(/[\\/]/).pop();
}

export function isSessionFile(name) {
  return /ReadingSession/i.test(baseName(name)) && /\.csv$/i.test(name);
}

export function wanted(name, size = 0) {
  if (/(^|[\\/])__MACOSX[\\/]/.test(name) || baseName(name).startsWith("._")) return false;
  if (/\.zip$/i.test(name) || isSessionFile(name)) return true;
  return /\.(csv|json)$/i.test(name) && size <= TITLE_FILE_LIMIT;
}

export async function exportFiles(inputs, unzip, depth = 0) {
  const decoder = new TextDecoder();
  const files = [];
  for (const { name, bytes } of inputs) {
    if (!wanted(name, bytes.length)) continue;
    if (/\.zip$/i.test(name)) {
      if (depth >= 4) continue;
      const entries = await unzip(bytes, (entry) => wanted(entry.name, entry.originalSize));
      const inner = Object.entries(entries).filter(([entry]) => !entry.endsWith("/")).map(([entry, data]) => ({ name: `${name}/${entry}`, bytes: data }));
      files.push(...(await exportFiles(inner, unzip, depth + 1)));
    } else files.push({ name, text: decoder.decode(bytes) });
  }
  return files;
}

function parseTime(value) {
  if (!value || /not available/i.test(value)) return null;
  const text = /[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : value.replace(" ", "T") + "Z";
  const time = Date.parse(text);
  return Number.isNaN(time) ? null : time;
}

export function readingSessions(rows) {
  const sessions = [];
  for (const row of rows) {
    const asin = pick(row, "ASIN");
    const start = parseTime(pick(row, "start_timestamp", "start_time", "Start Timestamp"));
    const end = parseTime(pick(row, "end_timestamp", "end_time", "End Timestamp"));
    const millis = Number(pick(row, "total_reading_millis", "reading_millis", "Total Reading Millis")) || 0;
    if (!asin || !start || millis <= 0) continue;
    sessions.push({
      asin,
      start,
      end: end && end > start ? end : start + millis,
      millis,
      flips: Number(pick(row, "number_of_page_flips", "page_flips")) || 0,
      device: pick(row, "device_family", "Device Family") || null,
    });
  }
  return sessions;
}

export function mergeSessions(sessions, { gapMinutes = 15, minMinutes = 2 } = {}) {
  const byBook = new Map();
  for (const session of [...sessions].sort((a, b) => a.start - b.start)) {
    const list = byBook.get(session.asin) || [];
    const last = list[list.length - 1];
    if (last && session.start - last.end <= gapMinutes * 60000) {
      last.end = Math.max(last.end, session.end);
      last.millis += session.millis;
      last.flips += session.flips;
      last.parts += 1;
    } else list.push({ ...session, parts: 1 });
    byBook.set(session.asin, list);
  }
  return [...byBook.values()].flat()
    .filter((session) => session.millis >= minMinutes * 60000)
    .sort((a, b) => a.start - b.start);
}

function collectTitles(value, titles) {
  if (Array.isArray(value)) return value.forEach((item) => collectTitles(item, titles));
  if (!value || typeof value !== "object") return;
  const asin = value.ASIN || value.asin;
  const title = value["Product Name"] || value.ProductName || value.productName || value.title || value.Title;
  if (typeof asin === "string" && typeof title === "string" && title && !titles.has(asin)) titles.set(asin, title);
  for (const child of Object.values(value)) collectTitles(child, titles);
}

export function exportTitles(files) {
  const titles = new Map();
  for (const { name, text } of files) {
    if (/\.csv$/i.test(name)) {
      if (!/asin/i.test(text.slice(0, 2000).split("\n")[0])) continue;
      for (const row of parseCsv(text)) {
        const asin = pick(row, "ASIN");
        const title = pick(row, "Product Name", "ProductName", "Title", "product_name");
        if (asin && title && !titles.has(asin)) titles.set(asin, title);
      }
    } else if (/\.json$/i.test(name)) {
      try {
        collectTitles(JSON.parse(text), titles);
      } catch {
        continue;
      }
    }
  }
  return titles;
}

export function readExport(files) {
  const sessionFiles = files.filter((file) => isSessionFile(file.name));
  const sessions = sessionFiles.flatMap((file) => readingSessions(parseCsv(file.text)));
  const titles = exportTitles(files.filter((file) => !isSessionFile(file.name)));
  return { sessionFiles: sessionFiles.map((file) => file.name), sessions, titles };
}

export function exportActivity(session, book, { reader, visibility = "everyone" } = {}) {
  const start = new Date(session.start).toISOString();
  return {
    id: `kx-${session.asin.toLowerCase()}-${Math.floor(session.start / 1000)}`,
    reader,
    book,
    name: sessionName(start),
    start,
    end: new Date(session.end).toISOString(),
    seconds: Math.round(session.millis / 1000),
    estimated: false,
    pages: session.flips,
    progressStart: null,
    progressEnd: null,
    finished: false,
    source: "kindle-export",
    device: session.device ? `Kindle · ${session.device}` : "Kindle",
    format: "ebook",
    note: "",
    visibility: visibility === "private" ? "private" : "everyone",
    highlights: [],
  };
}

export function planImport({ sessions, titles }, { reader, visibility, known = new Map() } = {}) {
  const books = new Map();
  const activities = mergeSessions(sessions).map((session) => {
    const title = titles.get(session.asin) || known.get(session.asin)?.fullTitle || `Kindle book ${session.asin}`;
    const key = titles.has(session.asin) ? bookKey(title) : known.get(session.asin)?.key || bookKey(title);
    if (!books.has(key)) books.set(key, { key, title, source: "kindle", sourceId: session.asin, sessions: 0, seconds: 0 });
    const book = books.get(key);
    book.sessions += 1;
    book.seconds += Math.round(session.millis / 1000);
    return exportActivity(session, key, { reader, visibility });
  });
  return { activities, books: [...books.values()].sort((a, b) => b.seconds - a.seconds), records: sessions.length };
}

export function compareImport(activities, mine) {
  const byId = new Map(mine.map((activity) => [activity.id, activity]));
  const added = [];
  const updated = [];
  let unchanged = 0;
  for (const activity of activities) {
    const existing = byId.get(activity.id);
    if (!existing) added.push(activity);
    else if (existing.end !== activity.end || existing.seconds !== activity.seconds || existing.pages !== activity.pages) {
      updated.push({ ...activity, name: existing.name, note: existing.note || "", visibility: existing.visibility === "private" ? "private" : "everyone" });
    } else unchanged++;
  }
  return { added, updated, unchanged };
}

export function summarize(activities) {
  return {
    sessions: activities.length,
    books: new Set(activities.map((activity) => activity.book)).size,
    seconds: activities.reduce((sum, activity) => sum + activity.seconds, 0),
    from: activities.length ? activities[0].start : null,
    to: activities.reduce((last, activity) => (activity.end > last ? activity.end : last), ""),
  };
}
