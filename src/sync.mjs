import fs from "node:fs";
import path from "node:path";
import { readAppleBooks } from "./sources/apple-books.mjs";
import { readKindleMac } from "./sources/kindle-mac.mjs";
import { exportActivity, loadKindleExport, mergeSessions } from "./sources/kindle-export.mjs";
import { advance, estimateSeconds, sessionName } from "./sessions.mjs";
import { catchUpActivity, catchUpPlan, catchUpSources } from "./catch-up.mjs";
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

export function isDenied(error) {
  return error?.code === "EPERM" || error?.code === "EACCES" || /authorization|permission|not permitted/i.test(error?.message || "");
}

// deniedHint is the fix in the words of whoever is running sync: node for the CLI, the app for Läsa for Mac.
export function readSources({ config = {}, tmpDir, list = SOURCES, deniedHint = "grant Full Disk Access to node" }) {
  const results = [];
  for (const [source, read] of list) {
    if ((config.sources || {})[source] === false) continue;
    try {
      results.push(read({ tmpDir }));
    } catch (error) {
      const denied = isDenied(error);
      results.push({ source, available: false, denied, items: [], highlights: [], error: denied ? `permission denied (${deniedHint})` : error.message });
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

// Catch-up runs once over every book of a source, then only for books Läsa meets later.
function catchUpItems(items, fresh, previous, config) {
  const done = new Set(previous.caughtUp || []);
  const wanted = catchUpSources(config);
  const freshKeys = new Set(fresh.map((item) => `${item.source}:${item.sourceId}`));
  return items.filter((item) => wanted.includes(item.source) && (!done.has(item.source) || freshKeys.has(`${item.source}:${item.sourceId}`)));
}

async function catchUpWrites({ sink, items, activities, config, dryRun, offline, minutesPerPage, now, log }) {
  const written = [];
  for (const item of items) {
    const plan = catchUpPlan(item, activities);
    if (!plan) continue;
    const { book } = dryRun ? { book: { key: bookKey(item.title), title: item.title, pages: 300 } } : await ensureBook(sink, item, { offline });
    const activity = catchUpActivity(item, plan, { book, reader: sink.handle, visibility: config.visibility, minutesPerPage, now });
    if (!activity) continue;
    written.push(activity);
    const percent = plan.progress < 0.01 ? (plan.progress * 100).toFixed(1) : Math.round(plan.progress * 100);
    log(`before Läsa: ${book.title}, ${percent}% on ${activity.end.slice(0, 10)}, ${activity.pages} ${activity.pages === 1 ? "page" : "pages"} (time estimated)`);
  }
  return written;
}

export async function sync({ sink, config = {}, statePath, tmpDir, dryRun = false, offline = false, now = new Date(), sources: list = SOURCES, deniedHint, log = console.log }) {
  const sources = readSources({ config, tmpDir, list, deniedHint });
  for (const source of sources) {
    if (source.error) log(`${source.source}: ${source.error}`);
    else if (!source.available) log(`${source.source}: not found on this machine`);
    else log(`${source.source}: ${source.items.length} books`);
  }
  const items = sources.flatMap((source) => source.items).filter((item) => !hidden(config, item.title));
  const highlights = sources.flatMap((source) => source.highlights);

  const previous = readState(statePath);
  const { state, changes, baseline, fresh } = advance(previous, items, now);
  if (baseline) log(`baseline recorded for ${baseline} books; reading from here on becomes activities`);
  const catching = catchUpItems(items, fresh, previous, config);

  const mine = changes.length || catching.length ? await sink.mine() : [];
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
  written.push(...await catchUpWrites({ sink, items: catching, activities: [...mine, ...written], config, dryRun, offline, minutesPerPage, now, log }));
  if (!written.length && !baseline) log("no new reading");

  if (!dryRun) {
    if (written.length) await sink.saveActivities(written);
    const read = sources.filter((source) => source.available).map((source) => source.source);
    const caughtUp = [...new Set([...(previous.caughtUp || []), ...catchUpSources(config).filter((source) => read.includes(source))])];
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify({ ...state, caughtUp, syncedAt: now.toISOString() }, null, 2) + "\n");
  }
  return { changes, written, baseline, sources: sources.map(({ source, available, denied, items, error }) => ({ source, available, denied: Boolean(denied), books: items.length, error })) };
}

// The same catch-up on demand, over every book of the chosen sources: `lasa catch-up`, and `--kindle` to add Kindle.
export async function catchUp({ sink, config = {}, tmpDir, include, dryRun = false, offline = false, now = new Date(), sources: list = SOURCES, log = console.log }) {
  const wanted = include || catchUpSources(config);
  const sources = readSources({ config, tmpDir, list });
  const items = sources.flatMap((source) => source.items).filter((item) => !hidden(config, item.title) && wanted.includes(item.source));
  const mine = await sink.mine();
  const written = await catchUpWrites({ sink, items, activities: mine, config, dryRun, offline, minutesPerPage: readMinutesPerPage(mine), now, log });
  if (!dryRun && written.length) await sink.saveActivities(written);
  log(`${written.length} catch-up ${written.length === 1 ? "activity" : "activities"} from ${wanted.join(" and ")}${dryRun ? " (dry run, nothing written)" : ""}`);
  return { written };
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
