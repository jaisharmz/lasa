import { slug } from "../web/lib/books.mjs";
export { sessionName } from "../web/lib/activity.mjs";

export const GAP_MINUTES = 30;
export const POLL_MINUTES = 20;
export const MIN_PROGRESS = 0.0005;

const MINUTE = 60000;

function time(iso) {
  return iso ? Date.parse(iso) : null;
}

export function activityId(item, startMs) {
  const source = item.source === "apple-books" ? "ab" : item.source === "kindle" ? "kd" : item.source;
  return `${source}-${slug(item.sourceId).slice(0, 16)}-${Math.floor(startMs / 1000)}`;
}

export function advance(previous, items, now = new Date()) {
  const state = { books: { ...(previous?.books || {}) }, open: { ...(previous?.open || {}) } };
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const changes = [];
  let baseline = 0;

  for (const item of items) {
    const key = `${item.source}:${item.sourceId}`;
    const before = state.books[key];
    state.books[key] = { progress: item.progress, readAt: item.readAt, seenAt: nowIso, title: item.title };
    if (!before) {
      baseline++;
      continue;
    }
    if (item.progress - before.progress < MIN_PROGRESS) continue;

    const seenMs = time(before.seenAt);
    const readMs = time(item.readAt);
    const changeMs = readMs && readMs > seenMs && readMs <= nowMs ? readMs : nowMs;
    const open = state.open[key];

    if (open && changeMs - time(open.end) <= GAP_MINUTES * MINUTE) {
      open.end = new Date(changeMs).toISOString();
      open.progressEnd = item.progress;
      open.device = item.device;
      changes.push({ ...open, item, extended: true });
      continue;
    }

    const openedMs = time(item.openedAt);
    let startMs = null;
    if (openedMs && openedMs >= seenMs - MINUTE && openedMs < changeMs) startMs = openedMs;
    else if (changeMs - seenMs <= POLL_MINUTES * MINUTE) startMs = seenMs;

    const session = {
      id: activityId(item, startMs ?? changeMs),
      key,
      start: startMs ? new Date(startMs).toISOString() : null,
      end: new Date(changeMs).toISOString(),
      progressStart: before.progress,
      progressEnd: item.progress,
      device: item.device,
    };
    state.open[key] = session;
    changes.push({ ...session, item, extended: false });
  }

  for (const [key, open] of Object.entries(state.open)) {
    if (nowMs - time(open.end) > GAP_MINUTES * MINUTE) delete state.open[key];
  }

  return { state, changes, baseline };
}

export function estimateSeconds({ start, end, pages, minutesPerPage = 1.6 }) {
  const fallback = Math.max(60, Math.round(pages * minutesPerPage * 60));
  if (!start) return { seconds: fallback, estimated: true };
  const elapsed = Math.round((Date.parse(end) - Date.parse(start)) / 1000);
  const low = Math.round(pages * 0.4 * 60);
  const high = Math.round(pages * 5 * 60);
  if (elapsed < 60) return { seconds: Math.max(60, low), estimated: true };
  if (pages > 0 && (elapsed < low || elapsed > high)) return { seconds: fallback, estimated: true };
  return { seconds: elapsed, estimated: false };
}
