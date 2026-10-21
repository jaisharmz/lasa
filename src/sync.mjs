import fs from "node:fs";
import path from "node:path";
import { readAppleBooks } from "./sources/apple-books.mjs";
import { readKindleMac } from "./sources/kindle-mac.mjs";
import { exportActivity, loadKindleExport, mergeSessions } from "./sources/kindle-export.mjs";
import { advance, estimateSeconds, sessionName } from "./sessions.mjs";
import { ensureBook } from "./books.mjs";
import { bookKey } from "../web/lib/books.mjs";

export function readState(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { books: {}, open: {} };
}

function hidden(config, title) {
  const lower = String(title).toLowerCase();
  return (config.hide || []).some((word) => lower.includes(String(word).toLowerCase()));
}

export const SOURCES = [["apple-books", readAppleBooks], ["kindle", readKindleMac]];

function readSources(config, tmpDir, list) {
  const results = [];
  for (const [source, read] of list) {
    if ((config.sources || {})[source] === false) continue;
    try {
      results.push(read({ tmpDir }));
    } catch (error) {
      const denied = error.code === "EPERM" || error.code === "EACCES" || /authorization|permission/i.test(error.message);
      results.push({ source, available: false, items: [], highlights: [], error: denied ? "permission denied (grant Full Disk Access to node)" : error.message });
    }
  }
  return results;
}

function readMinutesPerPage(mine) {
  const timed = mine.filter((activity) => !activity.estimated && activity.pages >= 5);
  const pages = timed.reduce((sum, activity) => sum + activity.pages, 0);
  const seconds = timed.reduce((sum, activity) => sum + activity.seconds, 0);
  return pages >= 50 ? seconds / 60 / pages : 1.6;
}

export async function sync({ sink, config = {}, statePath, tmpDir, dryRun = false, offline = false, now = new Date(), sources: list = SOURCES, log = console.log }) {
  const sources = readSources(config, tmpDir, list);
  for (const source of sources) {
    if (source.error) log(`${source.source}: ${source.error}`);
    else if (!source.available) log(`${source.source}: not found on this machine`);
    else log(`${source.source}: ${source.items.length} books`);
  }
  const items = sources.flatMap((source) => source.items).filter((item) => !hidden(config, item.title));
  const highlights = sources.flatMap((source) => source.highlights);

  const previous = readState(statePath);
  const { state, changes, baseline } = advance(previous, items, now);
  if (baseline) log(`baseline recorded for ${baseline} books; reading from here on becomes activities`);

  const mine = changes.length ? await sink.mine() : [];
  const byId = new Map(mine.map((activity) => [activity.id, activity]));
  const minutesPerPage = readMinutesPerPage(mine);
  const written = [];
  for (const change of changes) {
    const { book } = dryRun ? { book: { key: bookKey(change.item.title), title: change.item.title, pages: 300 } } : await ensureBook(sink, change.item, { offline });
    const progress = change.progressEnd - change.progressStart;
    const pages = Math.max(1, Math.round(progress * book.pages));
    const { seconds, estimated } = estimateSeconds({ start: change.start, end: change.end, pages, minutesPerPage });
    const start = change.start || new Date(Date.parse(change.end) - seconds * 1000).toISOString();
    const existing = byId.get(change.id);
    const activity = {
      id: change.id,
      reader: sink.handle,
      book: book.key,
      name: existing?.name || sessionName(start),
      start,
      end: change.end,
      seconds,
      estimated,
      pages,
      progressStart: change.progressStart,
      progressEnd: change.progressEnd,
      finished: change.progressEnd >= 0.985 || Boolean(change.item.finished && !change.progressStart),
      source: change.item.source,
      device: change.device,
      format: change.item.format,
      note: existing?.note || "",
      visibility: existing?.visibility || config.visibility || "everyone",
      highlights: config.shareHighlights
        ? highlights.filter((highlight) => highlight.source === change.item.source && highlight.sourceId === change.item.sourceId && highlight.at >= start && highlight.at <= change.end).map(({ text, note, at }) => ({ text, note, at }))
        : [],
    };
    written.push(activity);
    log(`${change.extended ? "extended" : "new"}: ${activity.name}, ${book.title}, ${Math.round(seconds / 60)} min, ${pages} pages${estimated ? " (time estimated)" : ""}`);
  }
  if (!changes.length && !baseline) log("no new reading");

  if (!dryRun) {
    if (written.length) await sink.saveActivities(written);
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify({ ...state, syncedAt: now.toISOString() }, null, 2) + "\n");
  }
  return { changes, written, baseline, sources: sources.map(({ source, available, items, error }) => ({ source, available, books: items.length, error })) };
}

export async function importKindleExport({ sink, config = {}, input, tmpDir, dryRun = false, offline = false, log = console.log }) {
  const { sessionFiles, sessions, titles } = loadKindleExport(input, tmpDir);
  if (!sessionFiles.length) throw new Error("no ReadingSession CSV in that export (look for Kindle.Devices.ReadingSession)");
  log(`${sessions.length} raw sessions in ${sessionFiles.length} file(s), ${titles.size} titles`);

  const localTitles = new Map();
  try {
    for (const item of readKindleMac({ tmpDir }).items) localTitles.set(item.asin, item.title);
  } catch {
    log("kindle for mac unreadable; titles come from the export only");
  }

  const merged = mergeSessions(sessions);
  const books = new Map();
  const written = [];
  for (const session of merged) {
    const title = titles.get(session.asin) || localTitles.get(session.asin) || `Kindle book ${session.asin}`;
    if (hidden(config, title)) continue;
    let book = books.get(session.asin);
    if (!book) {
      const item = { source: "kindle", sourceId: session.asin, title, author: null };
      book = dryRun ? { key: bookKey(title), title } : (await ensureBook(sink, item, { offline })).book;
      books.set(session.asin, book);
    }
    written.push(exportActivity(session, book.key, { reader: sink.handle, visibility: config.visibility }));
  }
  if (!dryRun && written.length) await sink.saveActivities(written);
  log(`${written.length} activities across ${books.size} books${dryRun ? " (dry run, nothing written)" : ""}`);
  return { written, books: [...books.values()] };
}
