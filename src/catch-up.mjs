import { slug } from "../web/lib/books.mjs";
import { MIN_PROGRESS, estimateSeconds } from "./sessions.mjs";

// Reading done before Läsa was watching. The apps keep no log of it, only how far each book got and when it was
// last opened, so each started book gets one estimated activity from its first page to where Läsa first found it.
export const CATCH_UP_SOURCES = ["apple-books"];
export const CATCH_UP_NAME = "Read before Läsa";

const PREFIX = { "apple-books": "ab", kindle: "kd" };

function time(iso) {
  return iso ? Date.parse(iso) : null;
}

// config.json's "catchUp" lists the sources to catch up; Kindle is left out by default because its data export
// holds the real sessions.
export function catchUpSources(config = {}) {
  return Array.isArray(config.catchUp) ? config.catchUp : CATCH_UP_SOURCES;
}

// One per book, so writing it again replaces it and deleting it on the site keeps it deleted.
export function catchUpId(item) {
  return `${PREFIX[item.source] || item.source}-${slug(item.sourceId).slice(0, 16)}-catchup`;
}

// How much of the book came before Läsa: up to where its first session began, or all of it when it has none.
export function catchUpPlan(item, activities) {
  if (item.sample) return null;
  const id = catchUpId(item);
  if (activities.some((activity) => activity.id === id)) return null;
  if (item.source === "kindle" && activities.some((activity) => activity.id.startsWith(`kx-${String(item.asin || item.sourceId).toLowerCase()}-`))) return null;
  const prefix = id.slice(0, -"catchup".length);
  const sessions = activities.filter((activity) => activity.id.startsWith(prefix) && !activity.catchUp);
  const progress = sessions.length ? Math.min(...sessions.map((activity) => activity.progressStart ?? 0)) : item.progress;
  if (!(progress >= MIN_PROGRESS)) return null;
  return { id, progress, firstSession: sessions.length ? Math.min(...sessions.map((activity) => time(activity.start))) : null };
}

// Dated where the apps last saw the book: finished, last read or last opened. When Läsa has already logged
// later reading, that date belongs to the later reading, so the catch-up starts the day the book was added instead.
export function catchUpActivity(item, plan, { book, reader, visibility, minutesPerPage = 1.6, now = new Date() }) {
  const pages = Math.max(1, Math.round(plan.progress * book.pages));
  const { seconds } = estimateSeconds({ start: null, end: now.toISOString(), pages, minutesPerPage });
  let startMs;
  let endMs;
  if (plan.firstSession) {
    const added = time(item.addedAt);
    if (added && added + seconds * 1000 <= plan.firstSession) {
      startMs = added;
      endMs = added + seconds * 1000;
    } else {
      endMs = plan.firstSession;
      startMs = endMs - seconds * 1000;
    }
  } else {
    const seen = [item.finished ? item.finishedAt : null, item.readAt, item.openedAt].map(time).filter((ms) => ms && ms <= now.getTime());
    endMs = seen.length ? Math.max(...seen) : time(item.addedAt);
    if (!endMs) return null;
    startMs = endMs - seconds * 1000;
  }
  return {
    id: plan.id,
    reader,
    book: book.key,
    name: CATCH_UP_NAME,
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
    seconds,
    estimated: true,
    catchUp: true,
    pages,
    progressStart: 0,
    progressEnd: plan.progress,
    finished: plan.progress >= 0.985 || Boolean(item.finished && !plan.firstSession),
    source: item.source,
    device: item.device,
    format: item.format,
    note: "",
    visibility: visibility || "everyone",
    highlights: [],
  };
}
