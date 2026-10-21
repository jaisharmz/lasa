import { clock, day, duration, escape, hours, html, hue, initials, longDate, pace, percent, raw, when } from "./lib/format.mjs";
import { achievements, bookProgress, daily, dayKey, leaderboard, minutesPerPage, records, startOfMonth, startOfWeek, streaks, totals, weekly } from "./lib/stats.mjs";
import { createLocalBackend } from "./lib/backend-local.mjs";
import { compareImport, exportFiles, planImport, readExport, summarize } from "./lib/kindle-export.mjs";

const app = document.getElementById("app");
const toastBox = document.getElementById("toast");
const TIMER_KEY = "lasa-timer";
const ui = { editing: null, feedLimit: 20, scope: null, access: null, stale: false, import: { stage: "idle", private: true } };
const EXPORT_PAGE = "https://www.amazon.com/hz/privacy-central/data-requests/preview.html";
let backend = null;
let session = { status: "loading" };
let data = null;
let viewer = null;
let ticker = null;

const ICONS = {
  thumb: "M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z",
  comment: "M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z",
  flag: "M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6z",
  fire: "M13.5.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5.67zM11.71 19c-1.78 0-3.22-1.4-3.22-3.14 0-1.62 1.05-2.76 2.81-3.12 1.77-.36 3.6-1.21 4.62-2.58.39 1.29.59 2.65.59 4.04 0 2.65-2.15 4.8-4.8 4.8z",
  lock: "M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z",
  trophy: "M19 5h-2V3H7v2H5c-1.1 0-2 .9-2 2v1c0 2.55 1.92 4.63 4.39 4.94.63 1.5 1.98 2.63 3.61 2.96V19H7v2h10v-2h-4v-3.1c1.63-.33 2.98-1.46 3.61-2.96C19.08 12.63 21 10.55 21 8V7c0-1.1-.9-2-2-2zM5 8V7h2v3.82C5.84 10.4 5 9.3 5 8zm14 0c0 1.3-.84 2.4-2 2.82V7h2v1z",
};

function icon(name) {
  return raw(`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`);
}

function remember(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key));
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return null;
  }
  return value;
}

function toast(text) {
  toastBox.textContent = text;
  toastBox.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => toastBox.classList.remove("show"), 4000);
}

function groupBy(list, key) {
  const map = new Map();
  for (const item of list) {
    const value = key(item);
    if (!map.has(value)) map.set(value, []);
    map.get(value).push(item);
  }
  return map;
}

function index(next) {
  data = next;
  viewer = data.me;
  data.readerMap = new Map(data.readers.map((person) => [person.handle, person]));
  data.bookMap = new Map(data.books.map((entry) => [entry.key, entry]));
  data.kudosBy = groupBy(data.kudos, (kudos) => `${kudos.owner}/${kudos.activity}`);
  data.commentsBy = groupBy(data.comments, (comment) => `${comment.owner}/${comment.activity}`);
  data.byReader = groupBy(data.activities, (activity) => activity.reader);
  data.byBook = groupBy(data.activities, (activity) => activity.book);
  data.followingSet = new Set(data.following || []);
}

function typing() {
  return app.contains(document.activeElement) && document.activeElement.matches("input, textarea, select");
}

function onState(next) {
  session = next;
  if (next.status === "ready") index(next.data);
  if (next.status === "ready" && typing()) {
    ui.stale = true;
    return;
  }
  route();
}

function circle() {
  const handles = new Set([viewer, ...(data.following || [])]);
  return handles.size > 1 ? data.readers.filter((person) => handles.has(person.handle)) : data.readers;
}

function reader(handle) {
  return data.readerMap.get(handle) || { handle, name: handle, color: hue(handle) };
}

function book(key) {
  return data.bookMap.get(key) || { key, title: key, author: null, pages: 300 };
}

function activitiesOf(handle) {
  return data.byReader.get(handle) || [];
}

function ref(activity) {
  return `${activity.reader}/${activity.id}`;
}

function avatar(person, size = "", link = true) {
  const style = `--hue:${person.color ?? hue(person.handle)}`;
  if (!link) return html`<span class="avatar ${size}" style="${style}" title="${person.name}">${initials(person.name)}</span>`;
  return html`<a class="avatar ${size}" href="#/r/${person.handle}" style="${style}" title="${person.name}">${initials(person.name)}</a>`;
}

function generatedCover(entry, size = "") {
  return html`<div class="cover gen ${size}" style="--hue:${hue(entry.title)}" aria-hidden="true"><span class="cover-title">${entry.title}</span><span class="cover-author">${entry.author || ""}</span></div>`;
}

function cover(entry, size = "") {
  if (!entry.cover) return generatedCover(entry, size);
  return html`<img class="cover ${size}" src="${entry.cover}" alt="" loading="lazy" data-title="${entry.title}" data-author="${entry.author || ""}" data-size="${size}">`;
}

function notFound(text) {
  return html`<div class="card empty">${text} <a href="#/">Back to the feed</a></div>`;
}

function segment(from, to, kind) {
  return html`<span class="seg ${kind}" style="left:${(from * 100).toFixed(2)}%;width:${Math.max(0, (to - from) * 100).toFixed(2)}%"></span>`;
}

function trackLabel(value, text) {
  const side = value < 0.05 ? "left" : value > 0.95 ? "right" : "";
  return html`<span class="${side}" style="left:${(value * 100).toFixed(2)}%">${text}</span>`;
}

function track(activity, big = false) {
  if (activity.progressEnd == null) return "";
  const from = activity.progressStart ?? 0;
  const to = activity.progressEnd;
  const ranges = activitiesOf(activity.reader)
    .filter((other) => other.book === activity.book && other.progressEnd != null && other.end < activity.end)
    .map((other) => [other.progressStart ?? 0, other.progressEnd])
    .sort((a, b) => a[0] - b[0]);
  const earlier = [];
  for (const [low, high] of ranges) {
    const last = earlier[earlier.length - 1];
    if (last && low <= last[1] + 0.005) last[1] = Math.max(last[1], high);
    else earlier.push([low, high]);
  }
  const ticks = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((tenth) => html`<span class="tick" style="left:${tenth * 10}%"></span>`);
  const labels = to - from > 0.12
    ? [trackLabel(from, percent(from)), trackLabel(to, percent(to))]
    : trackLabel((from + to) / 2, `${percent(from)} → ${percent(to)}`);
  return html`<div class="track ${big ? "big" : ""}" title="${percent(from)} to ${percent(to)} of the book">
    <div class="track-bar"><div class="track-fill">${earlier.map(([low, high]) => segment(low, high, ""))}${segment(from, to, "now")}${ticks}</div><span class="pin start" style="left:${from * 100}%"></span><span class="pin ${activity.finished ? "flag" : "end"}" style="left:${to * 100}%"></span></div>
    <div class="track-labels">${labels}</div>
  </div>`;
}

function statRow(activity, big = false) {
  const perPage = minutesPerPage(activity);
  const approx = activity.estimated ? html`<span class="approx" title="Estimated from pages read">~</span>` : "";
  const items = [
    ["Time", html`${approx}${duration(activity.seconds)}`],
    ["Pages", activity.pages || "–"],
    ["Pace", perPage ? html`${pace(perPage)}<small> /pg</small>` : "–"],
  ];
  if (big && activity.pages) items.push(["Pages / hr", Math.round(activity.pages / (activity.seconds / 3600))]);
  if (activity.progressEnd != null) items.push(["Progress", `+${percent(activity.progressEnd - (activity.progressStart ?? 0))}`]);
  return html`<dl class="stats ${big ? "big" : ""}">${items.map(([label, value]) => html`<div><dt>${label}</dt><dd>${value}</dd></div>`)}</dl>`;
}

function social(activity) {
  const kudos = data.kudosBy.get(ref(activity)) || [];
  const comments = data.commentsBy.get(ref(activity)) || [];
  const given = kudos.some((entry) => entry.reader === viewer);
  const mine = activity.reader === viewer;
  return html`<div class="activity-foot">
    <div class="social">
      ${kudos.length ? html`<span class="faces">${kudos.slice(0, 5).map((entry) => avatar(reader(entry.reader), "xs"))}</span>` : ""}
      <span>${kudos.length ? `${kudos.length} kudos` : mine ? "No kudos yet" : "Be the first to give kudos"}</span>
      ${comments.length ? html`<a href="#/a/${ref(activity)}">${comments.length} comment${comments.length === 1 ? "" : "s"}</a>` : ""}
    </div>
    <div class="actions">
      ${mine ? "" : html`<button class="kudos-button ${given ? "given" : ""}" data-action="kudos" data-owner="${activity.reader}" data-id="${activity.id}" aria-pressed="${given}">${icon("thumb")}<span>${given ? "Given" : "Kudos"}</span></button>`}
      <a class="button ghost kudos-button" href="#/a/${ref(activity)}" title="Comment">${icon("comment")}</a>
    </div>
  </div>`;
}

function activityCard(activity) {
  const person = reader(activity.reader);
  const entry = book(activity.book);
  return html`<article class="card activity">
    <div class="activity-head">${avatar(person)}<div class="who"><a href="#/r/${person.handle}">${person.name}</a><span><time datetime="${activity.start}">${when(activity.start)}</time> <span class="device">· ${activity.device}${activity.visibility === "private" ? html` · <span class="private">${icon("lock")} Only you</span>` : ""}</span></span></div></div>
    <div class="activity-main">
      <a href="#/b/${entry.key}">${cover(entry)}</a>
      <div class="info">
        <h3><a href="#/a/${ref(activity)}">${activity.name}</a></h3>
        <p class="book-line"><a href="#/b/${entry.key}">${entry.title}</a>${entry.author ? ` · ${entry.author}` : ""}</p>
        ${activity.note ? html`<p class="note">${activity.note}</p>` : ""}
        ${statRow(activity)}
      </div>
    </div>
    ${track(activity)}
    ${(activity.highlights || []).slice(0, 1).map((highlight) => html`<blockquote class="highlight">${highlight.text}</blockquote>`)}
    ${social(activity)}
  </article>`;
}

function boardRows(rows, metric) {
  const max = Math.max(1, ...rows.map((row) => row[metric]));
  const value = (row) => (metric === "pages" ? `${row.pages.toLocaleString()} pg` : metric === "count" ? `${row.count} sessions` : hours(row.seconds));
  const sub = (row) => (metric === "seconds" ? `${row.pages.toLocaleString()} pg` : hours(row.seconds));
  return rows.map((row, index) => html`<div class="board-row ${row.reader.handle === viewer ? "me" : ""}">
    <span class="rank">${index + 1}</span>${avatar(row.reader, "sm")}
    <div><div class="name">${row.reader.name}</div><div class="bar"><span style="width:${((row[metric] / max) * 100).toFixed(1)}%"></span></div></div>
    <span class="value">${value(row)}<small>${sub(row)}</small></span>
  </div>`);
}

function clubCard(now) {
  const from = startOfWeek(now);
  const rows = leaderboard(circle(), data.activities, from.getTime(), Infinity);
  return html`<section class="card"><div class="card-title"><h2>Club this week</h2><a class="muted" href="#/club">Leaderboard</a></div><div class="board">${boardRows(rows, "seconds")}</div></section>`;
}

function challengeCard(now) {
  const from = startOfMonth(now);
  const to = new Date(from);
  to.setMonth(to.getMonth() + 1);
  const month = from.toLocaleString(undefined, { month: "long" });
  const daysLeft = Math.ceil((to - now) / 86400000);
  const rows = circle()
    .map((person) => {
      const goal = person.goal?.month?.hours || 20;
      const sum = totals(activitiesOf(person.handle).filter((activity) => Date.parse(activity.start) >= from.getTime() && Date.parse(activity.start) < to.getTime()));
      return { person, goal, sum, share: Math.min(1, sum.seconds / 3600 / goal) };
    })
    .sort((a, b) => b.share - a.share);
  return html`<section class="card challenge">
    <div class="challenge-badge"><span class="medal">${icon("trophy")}</span><div><h2>${month} Reading Challenge</h2><small>Hit your monthly hours · ${daysLeft} day${daysLeft === 1 ? "" : "s"} left</small></div></div>
    ${rows.map((row) => html`<div class="challenge-row"><div class="line"><a href="#/r/${row.person.handle}">${row.person.name}</a><span>${hours(row.sum.seconds)} of ${row.goal}h${row.share >= 1 ? " ✓" : ""}</span></div><div class="bar"><span style="width:${(row.share * 100).toFixed(1)}%"></span></div></div>`)}
  </section>`;
}

function feedView() {
  const now = new Date();
  const me = reader(viewer);
  const mine = activitiesOf(viewer);
  const weekFrom = startOfWeek(now);
  const week = totals(mine.filter((activity) => Date.parse(activity.start) >= weekFrom.getTime()));
  const streak = streaks(mine, now);
  const shelf = bookProgress(mine);
  const readDays = new Set(mine.map((activity) => dayKey(activity.start)));
  const dots = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekFrom);
    date.setDate(date.getDate() + index);
    return { key: dayKey(date), letter: "MTWTFSS"[index], today: dayKey(date) === dayKey(now) };
  });
  const latest = mine[0];
  const scope = ui.scope || (data.following?.length ? "following" : "everyone");
  const shown = scope === "following" ? data.activities.filter((activity) => activity.reader === viewer || data.followingSet.has(activity.reader)) : data.activities;
  return html`<div class="layout">
    <aside class="left">
      <section class="card profile-card">
        ${avatar(me, "lg")}
        <h2><a href="#/r/${me.handle}">${me.name}</a></h2>
        ${streak.current ? html`<span class="flame">${icon("fire")} ${streak.current}-day streak</span>` : html`<small>Read today to start a streak</small>`}
        <div class="counts"><div><b>${mine.length}</b><span>Sessions</span></div><div><b>${shelf.length}</b><span>Books</span></div><div><b>${shelf.filter((entry) => entry.finishedAt).length}</b><span>Finished</span></div></div>
      </section>
      <section class="card pad stack">
        <div class="card-title" style="padding:0"><h2>This week</h2><small>${hours(week.seconds)} · ${week.pages} pages</small></div>
        <div class="week-dots">${dots.map((dot) => html`<span class="${readDays.has(dot.key) ? "on" : ""} ${dot.today ? "today" : ""}" title="${dot.key}">${dot.letter}</span>`)}</div>
        ${latest ? html`<small>Latest: <a href="#/a/${ref(latest)}">${latest.name}</a>, ${when(latest.start)}</small>` : html`<small>Nothing yet. <a class="inline" href="#/import">Import your Kindle history</a>, or press Record.</small>`}
      </section>
    </aside>
    <section class="feed">
      <div class="tabs feed-tabs"><a href="#/" class="${scope === "following" ? "on" : ""}" data-action="scope" data-scope="following">Following</a><a href="#/" class="${scope === "everyone" ? "on" : ""}" data-action="scope" data-scope="everyone">Everyone</a></div>
      ${scope === "following" && !data.following?.length ? html`<div class="card empty">Follow readers from their profiles to fill this feed.</div>` : ""}
      ${shown.length ? shown.slice(0, ui.feedLimit).map(activityCard) : html`<div class="card empty">No reading here yet. Read a few pages in Kindle or Apple Books and sync your Mac, or press Record.</div>`}
      ${shown.length > ui.feedLimit ? html`<button class="ghost" data-action="more">Show more</button>` : ""}
    </section>
    <aside class="right">${clubCard(now)}${challengeCard(now)}</aside>
  </div>`;
}

function progressChart(activity) {
  const sessions = activitiesOf(activity.reader).filter((other) => other.book === activity.book && other.progressEnd != null).sort((a, b) => a.start.localeCompare(b.start));
  if (sessions.length < 2) return "";
  const first = Date.parse(sessions[0].start);
  const last = Math.max(Date.parse(sessions[sessions.length - 1].end), first + 86400000);
  const width = 800;
  const height = 190;
  const left = 40;
  const right = 12;
  const top = 12;
  const bottom = 24;
  const x = (time) => (left + ((time - first) / (last - first)) * (width - left - right)).toFixed(1);
  const y = (progress) => (top + (1 - progress) * (height - top - bottom)).toFixed(1);
  let line = `M${x(first)},${y(sessions[0].progressStart ?? 0)}`;
  for (const session of sessions) line += ` L${x(Date.parse(session.start))},${y(session.progressStart ?? 0)} L${x(Date.parse(session.end))},${y(session.progressEnd)}`;
  const area = `${line} L${x(Date.parse(sessions[sessions.length - 1].end))},${y(0)} L${x(first)},${y(0)} Z`;
  const marked = activity.progressEnd != null;
  const now = marked ? `<path class="line now" d="M${x(Date.parse(activity.start))},${y(activity.progressStart ?? 0)} L${x(Date.parse(activity.end))},${y(activity.progressEnd)}"/><circle class="dot" cx="${x(Date.parse(activity.end))}" cy="${y(activity.progressEnd)}" r="5"/>` : "";
  const grid = [0, 0.25, 0.5, 0.75, 1].map((value) => `<line class="grid" x1="${left}" x2="${width - right}" y1="${y(value)}" y2="${y(value)}"/><text x="${left - 6}" y="${Number(y(value)) + 4}" text-anchor="end">${value * 100}%</text>`).join("");
  const dates = `<text x="${left}" y="${height - 6}">${escape(day(sessions[0].start))}</text><text x="${width - right}" y="${height - 6}" text-anchor="end">${escape(day(sessions[sessions.length - 1].end))}</text>`;
  const svg = `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Progress through the book over time">${grid}<path class="area" d="${area}"/><path class="line" d="${line}"/>${now}${dates}</svg>`;
  return html`<section class="card"><div class="card-title"><h2>Progress through ${book(activity.book).title}</h2><small>${sessions.length} sessions${marked ? " · this one in orange" : ""}</small></div><div class="pad">${raw(svg)}</div></section>`;
}

function activityView(owner, id) {
  const activity = activitiesOf(owner).find((entry) => entry.id === id);
  if (!activity) return notFound("That session isn't here. It may not have synced yet.");
  const person = reader(owner);
  const entry = book(activity.book);
  const kudos = data.kudosBy.get(ref(activity)) || [];
  const comments = data.commentsBy.get(ref(activity)) || [];
  const mine = owner === viewer;
  const editing = ui.editing === ref(activity);
  const heading = editing
    ? html`<form class="stack" data-form="edit" data-owner="${owner}" data-id="${id}"><label>Title<input name="name" value="${activity.name}" maxlength="120" required></label><label>Notes<textarea name="note" rows="3" maxlength="2000">${activity.note}</textarea></label><label>Who can see it<select name="visibility"><option value="everyone" ${activity.visibility !== "private" ? "selected" : ""}>Everyone</option><option value="private" ${activity.visibility === "private" ? "selected" : ""}>Only me</option></select></label><div class="actions"><button>Save</button><button type="button" class="ghost" data-action="cancel-edit">Cancel</button></div></form>`
    : html`<h1 style="font-size:26px">${activity.name}</h1>${activity.note ? html`<p class="note">${activity.note}</p>` : ""}`;
  return html`<div class="stack" style="max-width:860px;margin:0 auto">
    <section class="card activity">
      <div class="activity-head">${avatar(person)}<div class="who"><a href="#/r/${person.handle}">${person.name}</a><span><time datetime="${activity.start}">${when(activity.start)}</time> · ${activity.device}</span></div>${mine && !editing ? html`<button class="ghost" style="margin-left:auto" data-action="edit" data-ref="${ref(activity)}">Edit</button>` : ""}</div>
      ${heading}
      <div class="activity-main">
        <a href="#/b/${entry.key}">${cover(entry, "md")}</a>
        <div class="info"><p class="book-line"><a href="#/b/${entry.key}">${entry.title}</a>${entry.author ? ` · ${entry.author}` : ""}</p>${statRow(activity, true)}</div>
      </div>
      ${track(activity, true)}
      ${activity.estimated ? html`<small>~ The time is estimated from pages read, because the app reported progress but not when reading began.</small>` : ""}
      ${(activity.highlights || []).map((highlight) => html`<blockquote class="highlight">${highlight.text}${highlight.note ? html`<br><small>${highlight.note}</small>` : ""}</blockquote>`)}
      ${social(activity)}
    </section>
    ${progressChart(activity)}
    <section class="card pad stack">
      <h2>Comments</h2>
      ${kudos.length ? html`<p class="muted">Kudos from ${kudos.map((entry) => reader(entry.reader).name).join(", ")}</p>` : ""}
      <div class="comments">${comments.map((comment) => html`<div class="comment">${avatar(reader(comment.reader), "sm")}<div class="bubble"><b>${reader(comment.reader).name} <small>${when(comment.at)}</small></b><span>${comment.text}</span></div></div>`)}</div>
      <form class="comment-form" data-form="comment" data-owner="${owner}" data-id="${id}"><textarea name="text" rows="1" placeholder="Add a comment" required maxlength="2000"></textarea><button>Post</button></form>
    </section>
  </div>`;
}

function weekChart(weeks) {
  const width = 560;
  const height = 170;
  const top = 20;
  const bottom = 24;
  const max = Math.max(3600, ...weeks.map((week) => week.seconds));
  const step = width / weeks.length;
  const barWidth = step * 0.62;
  let bars = "";
  let labels = "";
  weeks.forEach((week, index) => {
    const barHeight = (week.seconds / max) * (height - top - bottom);
    const x = index * step + (step - barWidth) / 2;
    const current = index === weeks.length - 1;
    bars += `<rect class="barfill ${current ? "now" : ""}" x="${x.toFixed(1)}" y="${(height - bottom - Math.max(barHeight, week.seconds ? 2 : 0)).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${Math.max(barHeight, week.seconds ? 2 : 0).toFixed(1)}" rx="2"><title>Week of ${escape(day(week.from))}: ${escape(duration(week.seconds))}, ${week.pages} pages</title></rect>`;
    if ((index % 4 === 0 && index < weeks.length - 3) || current) labels += current
      ? `<text x="${width}" y="${height - 6}" text-anchor="end">This week</text>`
      : `<text x="${(x + barWidth / 2).toFixed(1)}" y="${height - 6}" text-anchor="middle">${escape(day(week.from))}</text>`;
  });
  const grid = `<line class="grid" x1="0" x2="${width}" y1="${top}" y2="${top}"/><text x="0" y="${top - 6}">${escape(hours(max))}</text><line class="grid" x1="0" x2="${width}" y1="${height - bottom}" y2="${height - bottom}"/>`;
  return raw(`<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Hours read per week">${grid}${bars}${labels}</svg>`);
}

function heatmap(mine, now) {
  const days = daily(mine);
  const start = startOfWeek(now);
  start.setDate(start.getDate() - 7 * 19);
  const cells = [];
  for (let index = 0; index < 140; index++) {
    const date = new Date(start);
    date.setDate(date.getDate() + index);
    const value = days.get(dayKey(date));
    const minutes = value ? value.seconds / 60 : 0;
    const level = date > now ? "future" : !minutes ? "" : minutes < 15 ? "l1" : minutes < 30 ? "l2" : minutes < 60 ? "l3" : "l4";
    cells.push(html`<span class="${level}" title="${day(date)}: ${value ? `${duration(value.seconds)}, ${value.pages} pages` : "no reading"}"></span>`);
  }
  const legend = ["var(--track)", "var(--heat-1)", "var(--heat-2)", "var(--heat-3)", "var(--heat-4)"].map((color) => html`<span style="background:${color}"></span>`);
  return html`<div class="heat">${cells}</div><div class="heat-legend">Less ${legend} More</div>`;
}

function readingItem(entry) {
  const info = book(entry.book);
  return html`<a class="reading-item" href="#/b/${info.key}">${cover(info)}<div class="info"><span class="title">${info.title}</span><div class="bar"><span style="width:${(entry.progress * 100).toFixed(1)}%"></span></div><small>${percent(entry.progress)} · ${duration(entry.seconds)} over ${entry.sessions} session${entry.sessions === 1 ? "" : "s"}</small></div></a>`;
}

function recordRows(best) {
  const rows = [
    ["Longest session", best.longest, (activity) => duration(activity.seconds)],
    ["Most pages in a session", best.mostPages, (activity) => `${activity.pages} pages`],
    ["Fastest pace (10+ pages)", best.fastest, (activity) => `${pace(minutesPerPage(activity))} /pg`],
  ];
  const links = rows.filter(([, activity]) => activity).map(([label, activity, format]) => html`<a href="#/a/${ref(activity)}"><span>${label}</span><b>${format(activity)}</b></a>`);
  const bestDay = best.bestDay ? html`<div class="row"><span>Most pages in a day</span><b>${best.bestDay.pages} pages <small>${day(`${best.bestDay.day}T12:00:00`)}</small></b></div>` : "";
  return links.length ? [links, bestDay] : html`<p class="empty">Records appear after a few sessions</p>`;
}

function profileView(handle) {
  const person = data.readerMap.get(handle);
  if (!person) return notFound("No reader by that name.");
  const now = new Date();
  const mine = activitiesOf(handle);
  const streak = streaks(mine, now);
  const periods = [
    ["This week", startOfWeek(now)],
    ["This month", startOfMonth(now)],
    ["This year", new Date(now.getFullYear(), 0, 1)],
    ["All time", new Date(0)],
  ].map(([label, from]) => [label, totals(mine.filter((activity) => Date.parse(activity.start) >= from.getTime()))]);
  const trophies = achievements(mine, now);
  const shelf = bookProgress(mine);
  const reading = shelf.filter((entry) => !entry.finishedAt);
  const finished = shelf.filter((entry) => entry.finishedAt);
  return html`<div class="stack">
    <section class="card hero">${avatar(person, "xl", false)}<div><h1>${person.name}</h1>${person.bio ? html`<p>${person.bio}</p>` : ""}<div class="meta">${streak.current ? html`<span class="flame">${icon("fire")} ${streak.current}-day streak</span>` : ""}<span>Longest streak: ${streak.longest} day${streak.longest === 1 ? "" : "s"}</span>${person.joined ? html`<span>Joined ${longDate(`${person.joined}T12:00:00`)}</span>` : ""}</div></div>
      <div class="hero-actions">${handle === viewer ? html`<a class="button ghost" href="#/settings">Edit profile</a>` : html`<button class="${data.followingSet.has(handle) ? "ghost" : ""}" data-action="follow" data-handle="${handle}">${data.followingSet.has(handle) ? "Following" : "Follow"}</button>`}</div></section>
    <section class="card tiles">${periods.map(([label, sum]) => html`<div class="tile"><h4>${label}</h4><b>${hours(sum.seconds)}</b><span>${sum.pages.toLocaleString()} pages · ${sum.count} sessions</span></div>`)}</section>
    <div class="two">
      <section class="card"><div class="card-title"><h2>Weekly reading</h2><small>last 16 weeks</small></div><div class="pad">${weekChart(weekly(mine, 16, now))}</div></section>
      <section class="card"><div class="card-title"><h2>Reading log</h2><small>last 20 weeks</small></div><div class="pad stack">${heatmap(mine, now)}</div></section>
    </div>
    <div class="two">
      <section class="card"><h2>Currently reading</h2>${reading.length ? html`<div class="reading-list">${reading.slice(0, 6).map(readingItem)}</div>` : html`<p class="empty">Nothing in progress</p>`}</section>
      <section class="card"><h2>Personal records</h2><div class="records">${recordRows(records(mine))}</div></section>
    </div>
    <section class="card"><div class="card-title"><h2>Trophy case</h2><small>${trophies.filter((trophy) => trophy.earned).length} of ${trophies.length}</small></div><div class="trophies">${trophies.map((trophy) => html`<div class="trophy ${trophy.earned ? "" : "locked"}" title="${trophy.text}"><span class="medal">${icon("trophy")}</span><b>${trophy.name}</b><small>${trophy.text}</small></div>`)}</div></section>
    ${finished.length ? html`<section class="card"><h2>Finished</h2><div class="shelf">${finished.map((entry) => html`<a href="#/b/${entry.book}" title="${book(entry.book).title}, finished ${day(entry.finishedAt)}">${cover(book(entry.book), "md")}</a>`)}</div></section>` : ""}
    <h2 style="margin-top:8px">Recent sessions</h2>
    <div class="feed">${mine.length ? mine.slice(0, 10).map(activityCard) : html`<div class="card empty">No sessions yet</div>`}</div>
  </div>`;
}

function bookView(key) {
  const entry = data.bookMap.get(key);
  if (!entry) return notFound("That book isn't in the club yet.");
  const sessions = data.byBook.get(key) || [];
  const rows = data.readers
    .map((person) => {
      const mine = sessions.filter((activity) => activity.reader === person.handle);
      if (!mine.length) return null;
      const [progress] = bookProgress(mine);
      const timed = mine.filter((activity) => activity.pages && !activity.estimated);
      const timedPages = timed.reduce((sum, activity) => sum + activity.pages, 0);
      const timedSeconds = timed.reduce((sum, activity) => sum + activity.seconds, 0);
      const days = progress.finishedAt ? Math.max(1, Math.ceil((Date.parse(progress.finishedAt) - Date.parse(progress.firstAt)) / 86400000)) : null;
      return { person, ...progress, pace: timedPages ? timedSeconds / 60 / timedPages : null, days };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.finishedAt && b.finishedAt) return a.finishedAt.localeCompare(b.finishedAt);
      if (a.finishedAt || b.finishedAt) return a.finishedAt ? -1 : 1;
      return b.progress - a.progress;
    });
  return html`<div class="stack">
    <section class="card hero">${cover(entry, "lg")}<div><h1>${entry.title}</h1><p class="muted">${entry.author || "Unknown author"}</p><div class="meta"><span>${entry.pages} pages${entry.pagesEstimated ? " (estimated)" : ""}</span>${entry.year ? html`<span>${entry.year}</span>` : ""}${entry.openLibrary ? html`<a href="${entry.openLibrary}" target="_blank" rel="noopener">Open Library ↗</a>` : ""}</div></div></section>
    <section class="card"><div class="card-title"><h2>Leaderboard</h2><small>first to finish, then furthest along</small></div><div class="table-wrap"><table class="table">
      <thead><tr><th>#</th><th>Reader</th><th>Progress</th><th class="num">Time</th><th class="num">Sessions</th><th class="num">Pace</th><th class="num">Finished</th></tr></thead>
      <tbody>${rows.map((row, index) => html`<tr class="${row.person.handle === viewer ? "me" : ""}"><td>${index + 1}</td><td><span class="who-cell">${avatar(row.person, "sm")}<a href="#/r/${row.person.handle}">${row.person.name}</a></span></td><td style="min-width:110px"><div class="bar"><span style="width:${(row.progress * 100).toFixed(1)}%"></span></div><small>${percent(row.progress)}</small></td><td class="num">${duration(row.seconds)}</td><td class="num">${row.sessions}</td><td class="num">${row.pace ? `${pace(row.pace)} /pg` : "–"}</td><td class="num">${row.finishedAt ? html`${day(row.finishedAt)}<br><small>in ${row.days} day${row.days === 1 ? "" : "s"}</small>` : "–"}</td></tr>`)}</tbody>
    </table></div></section>
    <section class="card"><div class="card-title"><h2>Sessions</h2><small>${sessions.length}</small></div><div class="records">${sessions.slice(0, 50).map((activity) => html`<a href="#/a/${ref(activity)}"><span class="who-cell">${avatar(reader(activity.reader), "xs", false)} ${activity.name}</span><span class="muted">${day(activity.start)} · ${duration(activity.seconds)} · ${activity.pages} pg</span></a>`)}</div></section>
  </div>`;
}

function booksView() {
  const entries = data.books
    .map((entry) => {
      const sessions = data.byBook.get(entry.key) || [];
      const readers = data.readers.map((person) => {
        const mine = sessions.filter((activity) => activity.reader === person.handle);
        return mine.length ? { person, ...bookProgress(mine)[0] } : null;
      }).filter(Boolean);
      return { entry, sessions, readers, seconds: totals(sessions).seconds, last: sessions[0]?.end || "" };
    })
    .filter((row) => row.sessions.length)
    .sort((a, b) => b.last.localeCompare(a.last));
  if (!entries.length) return notFound("No books yet.");
  return html`<div class="stack"><h1>Books</h1><div class="book-grid">${entries.map(({ entry, sessions, readers, seconds }) => html`<a class="card book-tile" href="#/b/${entry.key}">
    ${cover(entry)}
    <div><div class="title">${entry.title}</div><small>${entry.author || ""}</small></div>
    <div class="mini-readers">${readers.map((row) => html`<div class="mini-reader">${avatar(row.person, "xs", false)}<div class="bar"><span style="width:${(row.progress * 100).toFixed(1)}%"></span></div><span>${row.finishedAt ? "Done" : percent(row.progress)}</span></div>`)}</div>
    <small>${hours(seconds)} read · ${sessions.length} sessions</small>
  </a>`)}</div></div>`;
}

function clubView(query) {
  const now = new Date();
  const ranges = { week: ["This week", startOfWeek(now)], month: ["This month", startOfMonth(now)], year: ["This year", new Date(now.getFullYear(), 0, 1)], all: ["All time", new Date(0)] };
  const metrics = { seconds: "Time", pages: "Pages", count: "Sessions" };
  const range = ranges[query.get("range")] ? query.get("range") : "week";
  const metric = metrics[query.get("by")] ? query.get("by") : "seconds";
  const rows = leaderboard(data.readers, data.activities, ranges[range][1].getTime(), Infinity).sort((a, b) => b[metric] - a[metric]);
  const tabs = Object.entries(ranges).map(([key, [label]]) => html`<a class="${key === range ? "on" : ""}" href="#/club?range=${key}&by=${metric}">${label}</a>`);
  const metricTabs = Object.entries(metrics).map(([key, label]) => html`<a class="${key === metric ? "on" : ""}" href="#/club?range=${range}&by=${key}">${label}</a>`);
  return html`<div class="layout" style="grid-template-columns:minmax(0,1fr) 300px">
    <section class="card">
      <div class="card-title"><h2>Club leaderboard</h2><small>${data.readers.length} readers</small></div>
      <div class="tabs">${tabs}</div><div class="tabs" style="padding-top:8px">${metricTabs}</div>
      <div class="board" style="padding-top:12px">${boardRows(rows, metric)}</div>
      <div class="table-wrap"><table class="table"><thead><tr><th>Reader</th><th class="num">Time</th><th class="num">Pages</th><th class="num">Sessions</th><th class="num">Books</th><th class="num">Streak</th></tr></thead><tbody>
        ${rows.map((row) => html`<tr class="${row.reader.handle === viewer ? "me" : ""}"><td><span class="who-cell">${avatar(row.reader, "sm")}<a href="#/r/${row.reader.handle}">${row.reader.name}</a></span></td><td class="num">${duration(row.seconds)}</td><td class="num">${row.pages.toLocaleString()}</td><td class="num">${row.count}</td><td class="num">${row.books}</td><td class="num">${streaks(activitiesOf(row.reader.handle), now).current}d</td></tr>`)}
      </tbody></table></div>
    </section>
    <aside class="right">${challengeCard(now)}</aside>
  </div>`;
}

function timerState() {
  return remember(TIMER_KEY) || { running: false, startedAt: null, elapsed: 0, book: "", title: "", author: "", finishing: false };
}

function elapsed(timer) {
  return timer.elapsed + (timer.running ? (Date.now() - timer.startedAt) / 1000 : 0);
}

function bookOptions(selected) {
  const mine = bookProgress(activitiesOf(viewer)).map((entry) => book(entry.book));
  const others = data.books.filter((entry) => !mine.some((own) => own.key === entry.key));
  const option = (entry) => html`<option value="${entry.key}" ${selected === entry.key ? "selected" : ""}>${entry.title}</option>`;
  return html`<option value="">Choose a book</option>
    ${mine.length ? html`<optgroup label="Your books">${mine.map(option)}</optgroup>` : ""}
    ${others.length ? html`<optgroup label="In the club">${others.map(option)}</optgroup>` : ""}
    <option value="__new" ${selected === "__new" ? "selected" : ""}>Another book…</option>`;
}

function recordView() {
  const timer = timerState();
  const seconds = elapsed(timer);
  const started = timer.running || timer.elapsed > 0;
  const finish = timer.finishing
    ? html`<form class="stack" data-form="finish">
        <div class="form-grid">
          <label>Pages read<input name="pages" type="number" min="0" inputmode="numeric" placeholder="e.g. 24"></label>
          <label>Or: where you are now (%)<input name="percent" type="number" min="0" max="100" step="0.1" placeholder="e.g. 48"></label>
          <label class="wide">Title<input name="name" maxlength="120" placeholder="Leave empty for an automatic one"></label>
          <label class="wide">Notes<textarea name="note" rows="2" maxlength="2000"></textarea></label>
        </div>
        <div class="actions"><button>Save session</button><button type="button" class="ghost" data-action="timer-resume">Keep reading</button><button type="button" class="ghost" data-action="timer-discard">Discard</button></div>
      </form>`
    : "";
  return html`<div class="stack">
    <section class="card recorder">
      <h1 style="text-align:center">Record a reading session</h1>
      <label>Book<select data-change="timer-book">${bookOptions(timer.book)}</select></label>
      ${timer.book === "__new" ? html`<div class="form-grid"><label>Title<input data-input="timer-title" value="${timer.title}" placeholder="Title"></label><label>Author<input data-input="timer-author" value="${timer.author}" placeholder="Author"></label></div>` : ""}
      <div class="clock ${timer.running ? "running" : ""}" id="clock">${clock(seconds)}</div>
      ${timer.finishing ? "" : html`<div class="record-buttons">
        ${timer.running ? html`<button data-action="timer-pause">Pause</button>` : html`<button data-action="timer-start">${started ? "Resume" : "Start"}</button>`}
        ${started ? html`<button class="ghost" data-action="timer-finish">Finish</button>` : ""}
      </div>`}
      ${finish}
    </section>
    <section class="card recorder">
      <h2>Log a past session</h2>
      <form class="form-grid" data-form="manual">
        <label class="wide">Book<select name="book" data-change="manual-book">${bookOptions("")}</select></label>
        <label class="manual-new" hidden>Title<input name="title" placeholder="Title"></label>
        <label class="manual-new" hidden>Author<input name="author" placeholder="Author"></label>
        <label>Finished at<input name="end" type="datetime-local" required value="${new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}"></label>
        <label>Minutes<input name="minutes" type="number" min="1" required inputmode="numeric"></label>
        <label>Pages read<input name="pages" type="number" min="0" inputmode="numeric"></label>
        <label>Where you are now (%)<input name="percent" type="number" min="0" max="100" step="0.1"></label>
        <label class="wide">Notes<textarea name="note" rows="2" maxlength="2000"></textarea></label>
        <div class="actions wide"><button>Save session</button></div>
      </form>
    </section>
  </div>`;
}

function saveTimer(change) {
  const timer = { ...timerState(), ...change };
  remember(TIMER_KEY, timer);
  return timer;
}

function timerAction(action) {
  const timer = timerState();
  if (action === "timer-start" || action === "timer-resume") {
    if (!timer.book) return toast("Choose a book first");
    if (timer.book === "__new" && !timer.title.trim()) return toast("Give the book a title");
    saveTimer({ running: true, startedAt: Date.now(), finishing: false });
  }
  if (action === "timer-pause") saveTimer({ running: false, elapsed: elapsed(timer), startedAt: null });
  if (action === "timer-finish") saveTimer({ running: false, elapsed: elapsed(timer), startedAt: null, finishing: true });
  if (action === "timer-discard") remember(TIMER_KEY, null);
  route();
}

function startTicker() {
  ticker = setInterval(() => {
    const element = document.getElementById("clock");
    const timer = timerState();
    if (element && timer.running) element.textContent = clock(elapsed(timer));
  }, 500);
}

function suggestHandle(name, email) {
  return String(name || email || "reader").split(/[\s@]/)[0].toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 24) || "reader";
}

function gateView() {
  if (session.status === "error") return html`<section class="card gate"><h1>Something went wrong</h1><p class="muted">${session.error}</p><button data-action="reload">Try again</button></section>`;
  if (session.status === "signed-out") {
    return html`<section class="card gate">
      <div class="logo big">LÄSA</div>
      <h1>Strava for reading</h1>
      <p class="muted">Reading in Kindle and Apple Books becomes sessions in a feed with friends, with kudos, comments, streaks, and a leaderboard for every book.</p>
      <button data-action="sign-in">Sign in with Google</button>
      <small>Free. A Google account is all it takes.</small>
    </section>`;
  }
  if (session.status === "not-invited") {
    return html`<section class="card gate"><h1>Läsa is invite-only right now</h1><p class="muted">You're signed in as ${session.email}. Ask the person who invited you to add this address, then reload.</p><button class="ghost" data-action="sign-out">Sign out</button></section>`;
  }
  if (session.status === "onboarding") {
    return html`<section class="card gate">
      <h1>Pick your handle</h1>
      <p class="muted">Friends see it on your sessions and profile.</p>
      <form class="stack" data-form="claim">
        <label>Name<input name="name" value="${session.name}" maxlength="80" required></label>
        <label>Handle<input name="handle" value="${suggestHandle(session.name, session.email)}" pattern="[a-z0-9][a-z0-9\\-]{1,23}" title="2 to 24 lowercase letters, digits or dashes" required></label>
        <button>Start reading</button>
      </form>
    </section>`;
  }
  return html`<p class="empty">Loading…</p>`;
}

function accessSection() {
  const access = ui.access;
  if (!access) return html`<section class="card pad"><h2>Access</h2><p class="muted">Loading…</p></section>`;
  return html`<section class="card pad stack">
    <h2>Access</h2>
    <form class="stack" data-form="access">
      <label>Who can sign in<select name="mode"><option value="open" ${access.mode !== "invite" ? "selected" : ""}>Anyone with a Google account</option><option value="invite" ${access.mode === "invite" ? "selected" : ""}>Only invited emails</option></select></label>
      <label>Invited emails, one per line<textarea name="emails" rows="4">${(access.emails || []).join("\n")}</textarea></label>
      <label>Admins, one per line<textarea name="admins" rows="2">${(access.admins || []).join("\n")}</textarea></label>
      <div class="actions"><button>Save access</button></div>
    </form>
  </section>`;
}

function settingsView() {
  const me = reader(viewer);
  return html`<div class="stack narrow">
    <section class="card pad stack">
      <h2>Profile</h2>
      <form class="form-grid" data-form="profile">
        <label>Name<input name="name" value="${me.name}" maxlength="80" required></label>
        <label>Monthly goal (hours)<input name="goalHours" type="number" min="1" max="300" value="${me.goal?.month?.hours || 20}"></label>
        <label class="wide">Bio<textarea name="bio" rows="2" maxlength="300">${me.bio || ""}</textarea></label>
        <div class="actions wide"><button>Save profile</button></div>
      </form>
    </section>
    <section class="card pad stack">
      <h2>Kindle history</h2>
      <p>Amazon keeps every Kindle reading session, from any Kindle, phone, tablet or computer. Ask Amazon for your Kindle data, then drop the zip it sends you into Läsa. It works in this browser on any computer, with nothing to install.</p>
      <div class="actions"><a class="button" href="#/import">Import Kindle history</a></div>
    </section>
    <section class="card pad stack">
      <h2>Kindle for Mac and Apple Books</h2>
      <p>To keep sessions coming as you read, a small program on your Mac reads Kindle for Mac and Apple Books progress. In a copy of the Läsa repository, run:</p>
      <pre class="code">node bin/lasa.mjs login
node bin/lasa.mjs sync</pre>
      <p class="muted">Login opens this site to connect the Mac to @${viewer}. The first sync records where every book stands, and reading after that becomes sessions.</p>
    </section>
    ${data.isAdmin ? accessSection() : ""}
    ${backend.demo ? "" : html`<section class="card pad stack"><h2>Account</h2><p class="muted">Signed in as ${data.email || ""}.</p><div class="actions"><button class="ghost" data-action="sign-out">Sign out</button></div></section>`}
  </div>`;
}

function connectView(query) {
  const port = query.get("port") || "";
  const state = query.get("state") || "";
  if (!/^\d{4,5}$/.test(port) || !/^[a-f0-9]{32}$/.test(state)) return notFound("This link didn't come from lasa login on your Mac. Run node bin/lasa.mjs login again.");
  return html`<section class="card gate">
    <h1>Connect this Mac</h1>
    <p>The Läsa program on your Mac asked to sync as <b>@${viewer}</b>. It adds sessions from Kindle for Mac and Apple Books to your account.</p>
    <p class="muted">Only connect a Mac you are using right now.</p>
    <div class="actions"><button data-action="connect" data-port="${port}" data-state="${state}">Connect</button><a class="button ghost" href="#/">Cancel</a></div>
  </section>`;
}

function importSteps() {
  return html`<section class="card pad stack">
    <h2>Getting the zip from Amazon</h2>
    <ol class="steps">
      <li>Open Amazon's <a class="inline" href="${EXPORT_PAGE}" target="_blank" rel="noopener">Request Your Information</a> page and sign in. Outside the US, use the same page on your own Amazon site.</li>
      <li>Choose <b>Kindle</b> in the list of data and submit the request, then confirm it from the email Amazon sends.</li>
      <li>Amazon emails a download link when the data is ready, which takes anywhere from a few days to a few weeks. Download the zip and drop it above as it is, without unzipping.</li>
    </ol>
    <p class="muted">The zip holds a record of every reading session: when it started and ended, how long you read and how many pages you turned. Läsa reads the zip in this browser and saves only the sessions and book titles, never the file. Sessions read within 15 minutes of each other join into one, and anything under two minutes is left out. Importing a newer export later adds only what is new.</p>
  </section>`;
}

function importPreview(state) {
  const { plan } = state;
  const sum = summarize(plan.activities);
  const { added, updated, unchanged } = compareImport(plan.activities, activitiesOf(viewer));
  const count = added.length + updated.length;
  const changes = [
    added.length ? `${added.length.toLocaleString()} new` : "",
    updated.length ? `${updated.length.toLocaleString()} longer than the copy already here` : "",
    unchanged ? `${unchanged.toLocaleString()} already in Läsa` : "",
  ].filter(Boolean).join(", ");
  if (!sum.sessions) {
    return html`<section class="card pad stack"><h2>No sessions to import</h2><p class="muted">${state.names.join(", ")} has ${plan.records.toLocaleString()} reading records, but none add up to two minutes of reading.</p><div class="actions"><button class="ghost" data-action="import-reset">Choose another file</button></div></section>`;
  }
  const untitled = plan.books.filter((entry) => entry.title.startsWith("Kindle book ")).length;
  const [first, last] = [new Date(sum.from).getFullYear(), new Date(sum.to).getFullYear()];
  return html`<section class="card stack import-preview">
    <div class="card-title"><h2>Ready to import</h2><small>${state.names.join(", ")}</small></div>
    <div class="tiles">
      <div class="tile"><h4>Sessions</h4><b>${sum.sessions.toLocaleString()}</b><span>from ${plan.records.toLocaleString()} records</span></div>
      <div class="tile"><h4>Books</h4><b>${sum.books.toLocaleString()}</b><span>${untitled ? `${untitled} without a title` : "all with titles"}</span></div>
      <div class="tile"><h4>Time read</h4><b>${hours(sum.seconds)}</b><span>${duration(sum.seconds / sum.sessions)} a session</span></div>
      <div class="tile"><h4>Dates</h4><b>${first === last ? first : `${first}–${last}`}</b><span>${day(sum.from)}, ${first} to ${day(sum.to)}, ${last}</span></div>
    </div>
    <div class="pad stack">
      <details class="import-books"><summary>The ${plan.books.length.toLocaleString()} books</summary><div class="records">${plan.books.map((entry) => html`<div class="row"><span>${entry.title}</span><span class="muted">${duration(entry.seconds)} · ${entry.sessions} session${entry.sessions === 1 ? "" : "s"}</span></div>`)}</div></details>
      ${count ? html`<p>${changes}.</p>` : ""}
      ${count ? html`<label class="check"><input type="checkbox" data-change="import-private" ${state.private ? "checked" : ""}><span><b>Only me</b><small>New sessions stay private to you. Anyone signed in to Läsa can see sessions shared with everyone. You can change any session later with Edit.</small></span></label>` : ""}
      <div class="actions">
        ${count ? html`<button data-action="import-run" ${backend.importActivities ? "" : "disabled"}>Import ${count.toLocaleString()} session${count === 1 ? "" : "s"}</button>` : html`<p class="muted">Nothing new: every session in this export is already in Läsa.</p>`}
        <button class="ghost" data-action="import-reset">Choose another file</button>
      </div>
      ${backend.importActivities ? "" : html`<small>The demo only previews an import. Sign in on the real site to save it.</small>`}
    </div>
  </section>`;
}

function importView() {
  const state = ui.import;
  let body;
  if (state.stage === "reading") body = html`<section class="card pad"><p>Reading ${state.names.join(", ")}…</p></section>`;
  else if (state.stage === "preview") body = importPreview(state);
  else if (state.stage === "writing") body = html`<section class="card pad stack"><h2>Importing</h2><p class="import-progress">${state.progress || "Starting…"}</p><small>Keep this tab open until it finishes.</small></section>`;
  else if (state.stage === "done") {
    const { count, added, books } = state.result;
    body = html`<section class="card pad stack"><h2>Imported</h2><p>${count.toLocaleString()} session${count === 1 ? "" : "s"} across ${books.toLocaleString()} book${books === 1 ? "" : "s"}.${added && state.private ? " The new ones are visible only to you." : ""}</p><div class="actions"><a class="button" href="#/r/${viewer}">See your profile</a><button class="ghost" data-action="import-reset">Import another file</button></div></section>`;
  } else {
    body = html`<label class="dropzone" data-drop>
      <input type="file" accept=".zip,.csv,.json,application/zip" multiple data-change="import-files">
      <b>Drop your Kindle data zip here</b>
      <span class="muted">or click to choose it. Several zips at once are fine.</span>
    </label>
    ${state.stage === "error" ? html`<p class="import-error">${state.error}</p>` : ""}`;
  }
  return html`<div class="stack narrow">
    <section class="card pad stack">
      <h1>Import your Kindle history</h1>
      <p class="muted">Amazon keeps a record of every session you have read on a Kindle, phone, tablet or computer. Drop the zip it sends you and Läsa adds those sessions to your profile, from any computer and with nothing to install.</p>
    </section>
    ${body}
    ${["idle", "error"].includes(state.stage) ? importSteps() : ""}
  </div>`;
}

async function readImport(list) {
  const chosen = [...list];
  if (!chosen.length) return;
  ui.import = { stage: "reading", names: chosen.map((file) => file.name), private: ui.import.private };
  route();
  try {
    const inputs = await Promise.all(chosen.map(async (file) => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })));
    const { unzipBytes } = inputs.some((input) => /\.zip$/i.test(input.name)) ? await import("./lib/unzip.mjs") : {};
    const unzip = (bytes, keep) => unzipBytes(bytes, keep).catch((error) => {
      throw new Error(`Couldn't open that zip (${error.message}). Download it again from Amazon's email and drop the new copy.`);
    });
    const parsed = readExport(await exportFiles(inputs, unzip));
    if (!parsed.sessionFiles.length) throw new Error("No reading sessions in that file. Läsa looks for Kindle.Devices.ReadingSession.csv, which comes in the Kindle part of Amazon's data. Check that the request included Kindle, or drop the other zips from the same email.");
    const known = new Map(data.books.filter((entry) => entry.sources?.kindle).map((entry) => [entry.sources.kindle, entry]));
    ui.import = { ...ui.import, stage: "preview", plan: planImport(parsed, { reader: viewer, known }) };
  } catch (error) {
    ui.import = { ...ui.import, stage: "error", error: error.message };
  }
  route();
}

async function runImport() {
  const state = ui.import;
  const { added, updated } = compareImport(state.plan.activities, activitiesOf(viewer));
  const visibility = state.private ? "private" : "everyone";
  const activities = [...added.map((activity) => ({ ...activity, visibility })), ...updated];
  const keys = new Set(activities.map((activity) => activity.book));
  const books = state.plan.books.filter((entry) => keys.has(entry.key));
  const show = (progress) => {
    ui.import = { ...ui.import, progress };
    const line = app.querySelector(".import-progress");
    if (line) line.textContent = progress;
  };
  ui.import = { ...state, stage: "writing", progress: "" };
  route();
  try {
    await backend.importActivities({ books, activities }, show);
    ui.import = { ...ui.import, stage: "done", result: { count: activities.length, added: added.length, books: keys.size } };
  } catch (error) {
    ui.import = { ...ui.import, stage: "preview", plan: state.plan };
    toast(`Import stopped: ${error.message}. Sessions saved so far stay, and importing again picks up the rest.`);
  }
  route();
}

function renderViewer() {
  const box = document.getElementById("viewer");
  if (session.status !== "ready") {
    box.innerHTML = "";
    return;
  }
  if (backend.demo) {
    box.innerHTML = html`<select data-change="viewer" title="Demo: view as">${data.readers.map((person) => html`<option value="${person.handle}" ${person.handle === viewer ? "selected" : ""}>Viewing as ${person.name}</option>`)}</select>`.value;
    return;
  }
  box.innerHTML = html`<a href="#/settings" title="Settings">${avatar(reader(viewer), "sm", false)}</a>`.value;
}

function route() {
  clearInterval(ticker);
  ui.stale = false;
  document.body.classList.toggle("gated", session.status !== "ready");
  if (session.status !== "ready") {
    app.innerHTML = gateView().value;
    renderViewer();
    return;
  }
  const [pathPart, queryPart] = location.hash.replace(/^#/, "").split("?");
  const parts = pathPart.split("/").filter(Boolean);
  const query = new URLSearchParams(queryPart || "");
  let view;
  let nav = "";
  if (!parts.length) {
    view = feedView();
    nav = "feed";
  } else if (parts[0] === "a") view = activityView(parts[1], parts[2]);
  else if (parts[0] === "r") view = profileView(parts[1]);
  else if (parts[0] === "b") {
    view = bookView(parts[1]);
    nav = "books";
  } else if (parts[0] === "books") {
    view = booksView();
    nav = "books";
  } else if (parts[0] === "club") {
    view = clubView(query);
    nav = "club";
  } else if (parts[0] === "record") {
    view = recordView();
    startTicker();
  } else if (parts[0] === "settings") {
    view = settingsView();
    if (data.isAdmin && !ui.access && backend.loadAccess) {
      backend.loadAccess().then((access) => {
        ui.access = access;
        if (location.hash.startsWith("#/settings")) route();
      }).catch((error) => toast(error.message));
    }
  } else if (parts[0] === "import") view = importView();
  else if (parts[0] === "connect") view = connectView(query);
  else view = notFound("No such page.");
  app.innerHTML = view.value;
  for (const link of document.querySelectorAll("nav a")) link.classList.toggle("active", link.dataset.nav === nav);
  renderViewer();
}

function percentField(value) {
  return value === "" || value == null ? null : Number(value) / 100;
}

function lines(text) {
  return String(text || "").split(/[\s,]+/).filter(Boolean);
}

document.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;
  if (target.tagName === "A") event.preventDefault();
  try {
    if (action === "kudos") {
      target.disabled = true;
      await backend.toggleKudos(target.dataset.owner, target.dataset.id);
    } else if (action === "follow") {
      target.disabled = true;
      await backend.toggleFollow(target.dataset.handle);
    } else if (action === "scope") {
      ui.scope = target.dataset.scope;
      ui.feedLimit = 20;
      route();
    } else if (action === "more") {
      ui.feedLimit += 20;
      route();
    } else if (action === "sync") {
      target.disabled = true;
      target.textContent = "Syncing…";
      const result = await backend.sync();
      toast((result.log || []).join("\n") || result.error || "Up to date");
    } else if (action === "edit") {
      ui.editing = target.dataset.ref;
      route();
    } else if (action === "cancel-edit") {
      ui.editing = null;
      route();
    } else if (action === "sign-in") {
      await backend.signIn();
    } else if (action === "sign-out") {
      await backend.signOut();
      location.hash = "#/";
    } else if (action === "reload") {
      location.reload();
    } else if (action === "connect") {
      const payload = encodeURIComponent(JSON.stringify({ refreshToken: backend.refreshToken(), uid: backend.uid(), handle: viewer, email: data.email, state: target.dataset.state }));
      location.href = `http://127.0.0.1:${target.dataset.port}/callback#${payload}`;
    } else if (action === "import-run") {
      await runImport();
    } else if (action === "import-reset") {
      ui.import = { stage: "idle", private: ui.import.private };
      route();
    } else if (action.startsWith("timer-")) timerAction(action);
  } catch (error) {
    toast(error.message);
  } finally {
    if (action === "sync") {
      target.disabled = false;
      target.textContent = "Sync";
    }
  }
});

document.addEventListener("submit", async (event) => {
  const form = event.target.closest("form[data-form]");
  if (!form) return;
  event.preventDefault();
  const fields = Object.fromEntries(new FormData(form));
  const button = form.querySelector("button:not([type=button])");
  if (button) button.disabled = true;
  try {
    if (form.dataset.form === "comment") {
      await backend.addComment(form.dataset.owner, form.dataset.id, fields.text);
      form.reset();
    } else if (form.dataset.form === "edit") {
      await backend.editActivity(form.dataset.owner, form.dataset.id, fields);
      ui.editing = null;
    } else if (form.dataset.form === "finish") {
      const timer = timerState();
      const activity = await backend.logActivity({
        book: timer.book === "__new" ? null : timer.book,
        title: timer.book === "__new" ? timer.title : null,
        author: timer.book === "__new" ? timer.author : null,
        seconds: Math.round(elapsed(timer)),
        pages: fields.pages,
        progressEnd: percentField(fields.percent),
        name: fields.name,
        note: fields.note,
        timer: true,
      });
      remember(TIMER_KEY, null);
      location.hash = `#/a/${activity.reader}/${activity.id}`;
    } else if (form.dataset.form === "manual") {
      const activity = await backend.logActivity({
        book: fields.book && fields.book !== "__new" ? fields.book : null,
        title: fields.book === "__new" ? fields.title : null,
        author: fields.book === "__new" ? fields.author : null,
        minutes: fields.minutes,
        pages: fields.pages,
        progressEnd: percentField(fields.percent),
        end: new Date(fields.end).toISOString(),
        note: fields.note,
      });
      location.hash = `#/a/${activity.reader}/${activity.id}`;
    } else if (form.dataset.form === "claim") {
      await backend.claimProfile(fields);
    } else if (form.dataset.form === "profile") {
      await backend.saveProfile(fields);
      toast("Profile saved");
    } else if (form.dataset.form === "access") {
      const access = { mode: fields.mode, emails: lines(fields.emails), admins: lines(fields.admins) };
      await backend.saveAccess(access);
      ui.access = await backend.loadAccess();
      toast("Access saved");
    }
    document.activeElement?.blur();
    route();
  } catch (error) {
    toast(error.message);
  } finally {
    if (button) button.disabled = false;
  }
});

document.addEventListener("change", (event) => {
  const kind = event.target.dataset.change;
  if (kind === "viewer") {
    backend.setViewer(event.target.value).catch((error) => toast(error.message));
  } else if (kind === "timer-book") {
    saveTimer({ book: event.target.value });
    route();
  } else if (kind === "manual-book") {
    for (const label of event.target.form.querySelectorAll(".manual-new")) label.hidden = event.target.value !== "__new";
  } else if (kind === "import-files") {
    readImport(event.target.files);
  } else if (kind === "import-private") {
    ui.import.private = event.target.checked;
  }
});

for (const type of ["dragenter", "dragover", "dragleave", "drop"]) {
  document.addEventListener(type, (event) => {
    if (!location.hash.startsWith("#/import") || !event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    const zone = app.querySelector("[data-drop]");
    zone?.classList.toggle("over", type === "dragenter" || type === "dragover");
    if (type === "drop" && zone && ["idle", "error"].includes(ui.import.stage)) readImport(event.dataTransfer.files);
  });
}

document.addEventListener("input", (event) => {
  const kind = event.target.dataset.input;
  if (kind === "timer-title") saveTimer({ title: event.target.value });
  if (kind === "timer-author") saveTimer({ author: event.target.value });
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && event.target.matches(".comment-form textarea")) {
    event.preventDefault();
    event.target.form.requestSubmit();
  }
});

document.addEventListener("focusout", () => {
  setTimeout(() => {
    if (ui.stale && !typing()) route();
  }, 0);
});

document.addEventListener("error", (event) => {
  const image = event.target;
  if (!(image instanceof HTMLImageElement) || !image.classList.contains("cover")) return;
  image.outerHTML = generatedCover({ title: image.dataset.title, author: image.dataset.author }, image.dataset.size).value;
}, true);

window.addEventListener("hashchange", () => {
  ui.editing = null;
  if (!location.hash.startsWith("#/settings")) ui.access = null;
  route();
  window.scrollTo(0, 0);
});

async function boot() {
  let mode = null;
  try {
    const response = await fetch("/backend.json", { cache: "no-store" });
    if (response.ok) mode = await response.json();
  } catch {
    mode = null;
  }
  if (mode?.backend === "local") backend = createLocalBackend({ demo: mode.demo !== false, canSync: Boolean(mode.sync) });
  else {
    const { createFirebaseBackend } = await import("./lib/backend-firebase.mjs");
    backend = createFirebaseBackend({ emulators: Boolean(mode?.emulators), canSync: Boolean(mode?.sync) });
  }
  document.querySelector("[data-action=sync]").hidden = !backend.canSync;
  await backend.start(onState);
}

boot().catch((error) => {
  app.innerHTML = html`<div class="card empty">Couldn't start: ${error.message}</div>`.value;
});
