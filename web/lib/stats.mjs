const DAY = 86400000;

export function dayKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function startOfDay(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function startOfWeek(value) {
  const date = startOfDay(value);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date;
}

export function startOfMonth(value) {
  const date = startOfDay(value);
  date.setDate(1);
  return date;
}

export function totals(activities) {
  const books = new Set();
  const sum = { seconds: 0, pages: 0, count: 0, books: 0 };
  for (const activity of activities) {
    sum.seconds += activity.seconds;
    sum.pages += activity.pages || 0;
    sum.count += 1;
    books.add(activity.book);
  }
  sum.books = books.size;
  return sum;
}

export function between(activities, from, to) {
  return activities.filter((activity) => {
    const time = Date.parse(activity.start);
    return time >= from && time < to;
  });
}

export function weekly(activities, weeks, now = new Date()) {
  const current = startOfWeek(now);
  const result = [];
  for (let index = weeks - 1; index >= 0; index--) {
    const from = new Date(current);
    from.setDate(from.getDate() - 7 * index);
    const to = new Date(from);
    to.setDate(to.getDate() + 7);
    result.push({ from, ...totals(between(activities, from.getTime(), to.getTime())) });
  }
  return result;
}

export function daily(activities) {
  const days = new Map();
  for (const activity of activities) {
    const key = dayKey(activity.start);
    const day = days.get(key) || { seconds: 0, pages: 0, count: 0 };
    day.seconds += activity.seconds;
    day.pages += activity.pages || 0;
    day.count += 1;
    days.set(key, day);
  }
  return days;
}

// Catch-up entries are estimates of reading done before Läsa, not sittings, so they fill totals and charts but never
// set a streak, a record or a place on a leaderboard.
export function sessionsOnly(activities) {
  return activities.filter((activity) => !activity.catchUp);
}

export function streaks(activities, now = new Date()) {
  const days = new Set(sessionsOnly(activities).map((activity) => dayKey(activity.start)));
  const cursor = startOfDay(now);
  if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let current = 0;
  while (days.has(dayKey(cursor))) {
    current++;
    cursor.setDate(cursor.getDate() - 1);
  }
  let longest = 0;
  let run = 0;
  let previous = null;
  for (const key of [...days].sort()) {
    const date = new Date(`${key}T00:00:00`);
    run = previous && Math.round((date - previous) / DAY) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = date;
  }
  return { current, longest, readToday: days.has(dayKey(now)) };
}

function maxBy(list, score) {
  let best = null;
  let bestScore = -Infinity;
  for (const item of list) {
    const value = score(item);
    if (value > bestScore) {
      best = item;
      bestScore = value;
    }
  }
  return best;
}

export function records(all) {
  const activities = sessionsOnly(all);
  const timed = activities.filter((activity) => !activity.estimated && activity.pages >= 10 && activity.seconds >= 600);
  let bestDay = null;
  for (const [day, value] of daily(activities)) {
    if (!bestDay || value.pages > bestDay.pages) bestDay = { day, ...value };
  }
  return {
    longest: maxBy(activities, (activity) => activity.seconds),
    mostPages: maxBy(activities, (activity) => activity.pages || 0),
    fastest: maxBy(timed, (activity) => activity.pages / activity.seconds),
    bestDay,
  };
}

export function bookProgress(activities) {
  const books = new Map();
  for (const activity of [...activities].sort((a, b) => a.start.localeCompare(b.start))) {
    const entry = books.get(activity.book) || { book: activity.book, seconds: 0, pages: 0, sessions: 0, progress: 0, firstAt: activity.start, lastAt: null, finishedAt: null };
    entry.seconds += activity.seconds;
    entry.pages += activity.pages || 0;
    entry.sessions += 1;
    entry.lastAt = activity.end;
    if (activity.progressEnd != null) entry.progress = Math.max(entry.progress, activity.progressEnd);
    if (activity.finished && !entry.finishedAt) {
      entry.finishedAt = activity.end;
      entry.progress = 1;
    }
    books.set(activity.book, entry);
  }
  return [...books.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

export const BADGES = [
  { id: "first-page", name: "First Page", text: "Log a first reading session", test: (s) => s.count >= 1 },
  { id: "ten-hours", name: "Ten Hours", text: "Read for 10 hours in total", test: (s) => s.seconds >= 36000 },
  { id: "finisher", name: "Finisher", text: "Finish a book", test: (s) => s.finished >= 1 },
  { id: "shelf", name: "Full Shelf", text: "Finish 5 books", test: (s) => s.finished >= 5 },
  { id: "week-streak", name: "Week Streak", text: "Read 7 days in a row", test: (s) => s.longestStreak >= 7 },
  { id: "month-streak", name: "Month Streak", text: "Read 30 days in a row", test: (s) => s.longestStreak >= 30 },
  { id: "century", name: "Century", text: "Read 100 pages in one day", test: (s) => s.bestDayPages >= 100 },
  { id: "marathon", name: "Marathon", text: "Read 2 hours in one sitting", test: (s) => s.longestSession >= 7200 },
  { id: "night-owl", name: "Night Owl", text: "Read past midnight", test: (s) => s.nightOwl },
  { id: "early-bird", name: "Early Bird", text: "Start reading before 7 am", test: (s) => s.earlyBird },
];

export function achievements(activities, now = new Date()) {
  const sum = totals(activities);
  const best = records(activities);
  const summary = {
    count: sum.count,
    seconds: sum.seconds,
    finished: bookProgress(activities).filter((entry) => entry.finishedAt).length,
    longestStreak: streaks(activities, now).longest,
    bestDayPages: best.bestDay?.pages || 0,
    longestSession: best.longest?.seconds || 0,
    nightOwl: sessionsOnly(activities).some((activity) => new Date(activity.end).getHours() < 4 && activity.seconds >= 600),
    earlyBird: sessionsOnly(activities).some((activity) => {
      const hour = new Date(activity.start).getHours();
      return hour >= 4 && hour < 7;
    }),
  };
  return BADGES.map((badge) => ({ ...badge, earned: badge.test(summary) }));
}

export function leaderboard(readers, activities, from, to) {
  return readers
    .map((reader) => ({ reader, ...totals(between(sessionsOnly(activities).filter((activity) => activity.reader === reader.handle), from, to)) }))
    .sort((a, b) => b.seconds - a.seconds || b.pages - a.pages);
}

export function minutesPerPage(activity) {
  return activity.pages ? activity.seconds / 60 / activity.pages : null;
}
