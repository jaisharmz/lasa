import { test } from "node:test";
import assert from "node:assert/strict";
import { achievements, bookProgress, leaderboard, records, streaks, weekly } from "../web/lib/stats.mjs";

const session = (dayOffset, extra = {}) => {
  const start = new Date(2026, 9, 20 - dayOffset, 21, 0);
  return { id: `s${dayOffset}`, reader: "ada", book: "walden", start: start.toISOString(), end: new Date(start.getTime() + 1800000).toISOString(), seconds: 1800, pages: 20, progressStart: null, progressEnd: null, ...extra };
};

test("a streak counts back from today, or from yesterday before today's reading", () => {
  const now = new Date(2026, 9, 20, 23, 0);
  assert.equal(streaks([session(0), session(1), session(2), session(4)], now).current, 3);
  assert.equal(streaks([session(1), session(2)], now).current, 2);
  assert.equal(streaks([session(0), session(1), session(2), session(4), session(5), session(6), session(7)], now).longest, 4);
});

test("weekly totals put each session in its Monday-based week", () => {
  const now = new Date(2026, 9, 20, 23, 0);
  const weeks = weekly([session(0), session(1), session(7)], 2, now);
  assert.equal(weeks[1].count, 2);
  assert.equal(weeks[0].count, 1);
});

test("finishing a book sets its progress to 100% and earns the Finisher badge", () => {
  const list = [session(2, { progressEnd: 0.5 }), session(1, { progressEnd: 0.99, finished: true })];
  const [entry] = bookProgress(list);
  assert.equal(entry.progress, 1);
  assert.ok(entry.finishedAt);
  assert.equal(achievements(list).find((badge) => badge.id === "finisher").earned, true);
});

test("records ignore estimated sessions for pace", () => {
  const fast = session(1, { seconds: 600, pages: 40, estimated: true });
  const honest = session(2, { seconds: 1200, pages: 20 });
  assert.equal(records([fast, honest]).fastest.id, "s2");
});

test("the leaderboard ranks readers by time read", () => {
  const readers = [{ handle: "ada" }, { handle: "alan" }];
  const rows = leaderboard(readers, [session(0), session(1, { reader: "alan", seconds: 4000 })], 0, Infinity);
  assert.deepEqual(rows.map((row) => row.reader.handle), ["alan", "ada"]);
});
