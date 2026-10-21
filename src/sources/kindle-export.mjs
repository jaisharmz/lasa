import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parseCsv, pick } from "../csv.mjs";

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

function unzip(file, target) {
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  execFileSync("unzip", ["-q", "-o", file, "-d", target]);
  for (const nested of walk(target).filter((name) => name.endsWith(".zip"))) {
    execFileSync("unzip", ["-q", "-o", nested, "-d", nested.replace(/\.zip$/, "")]);
  }
  return target;
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
  for (const file of files) {
    if (fs.statSync(file).size > 50 * 1024 * 1024) continue;
    if (file.endsWith(".csv")) {
      for (const row of parseCsv(fs.readFileSync(file, "utf8"))) {
        const asin = pick(row, "ASIN");
        const title = pick(row, "Product Name", "ProductName", "Title", "product_name");
        if (asin && title && !titles.has(asin)) titles.set(asin, title);
      }
    } else if (file.endsWith(".json")) {
      try {
        collectTitles(JSON.parse(fs.readFileSync(file, "utf8")), titles);
      } catch {
        continue;
      }
    }
  }
  return titles;
}

export function loadKindleExport(input, tmpDir) {
  const root = input.endsWith(".zip") ? unzip(input, path.join(tmpDir, "kindle-export")) : input;
  const files = walk(root);
  const sessionFiles = files.filter((file) => /ReadingSession/i.test(path.basename(file)) && file.endsWith(".csv"));
  const sessions = sessionFiles.flatMap((file) => readingSessions(parseCsv(fs.readFileSync(file, "utf8"))));
  const titles = exportTitles(files.filter((file) => !sessionFiles.includes(file)));
  return { sessionFiles, sessions, titles };
}
