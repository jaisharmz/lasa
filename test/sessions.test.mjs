import { test } from "node:test";
import assert from "node:assert/strict";
import { advance, estimateSeconds, sessionName } from "../src/sessions.mjs";

const at = (minutes) => new Date(Date.UTC(2026, 9, 20, 20, 0) + minutes * 60000);
const item = (progress, extra = {}) => ({ source: "apple-books", sourceId: "ABC123", title: "Walden", progress, readAt: null, openedAt: null, device: "Apple Books", ...extra });

test("the first sync is a baseline, not a session", () => {
  const { changes, baseline } = advance(null, [item(0.2)], at(0));
  assert.equal(baseline, 1);
  assert.equal(changes.length, 0);
});

test("progress between two close polls becomes a session that starts at the earlier poll", () => {
  const first = advance(null, [item(0.2)], at(0));
  const { changes } = advance(first.state, [item(0.25)], at(10));
  assert.equal(changes.length, 1);
  assert.equal(changes[0].start, at(0).toISOString());
  assert.equal(changes[0].end, at(10).toISOString());
  assert.equal(changes[0].progressStart, 0.2);
  assert.equal(changes[0].progressEnd, 0.25);
});

test("the open date wins as the start when the book was opened after the last poll", () => {
  const first = advance(null, [item(0.2)], at(0));
  const { changes } = advance(first.state, [item(0.22, { openedAt: at(4).toISOString() })], at(10));
  assert.equal(changes[0].start, at(4).toISOString());
});

test("reading again within 30 minutes extends the same session", () => {
  const first = advance(null, [item(0.2)], at(0));
  const second = advance(first.state, [item(0.25)], at(10));
  const third = advance(second.state, [item(0.3)], at(20));
  assert.equal(third.changes.length, 1);
  assert.equal(third.changes[0].extended, true);
  assert.equal(third.changes[0].id, second.changes[0].id);
  assert.equal(third.changes[0].progressStart, 0.2);
  assert.equal(third.changes[0].progressEnd, 0.3);
});

test("reading after a long gap starts a new session with an unknown start", () => {
  const first = advance(null, [item(0.2)], at(0));
  const second = advance(first.state, [item(0.25)], at(10));
  const quiet = advance(second.state, [item(0.25)], at(30));
  const later = advance(quiet.state, [item(0.3)], at(240));
  assert.equal(later.changes[0].extended, false);
  assert.notEqual(later.changes[0].id, second.changes[0].id);
  assert.equal(later.changes[0].start, null);
});

test("no progress, or going backwards, is not reading", () => {
  const first = advance(null, [item(0.4)], at(0));
  assert.equal(advance(first.state, [item(0.4)], at(10)).changes.length, 0);
  assert.equal(advance(first.state, [item(0.1)], at(10)).changes.length, 0);
});

test("time is measured when it is plausible and estimated when it is not", () => {
  assert.deepEqual(estimateSeconds({ start: at(0).toISOString(), end: at(30).toISOString(), pages: 20 }), { seconds: 1800, estimated: false });
  assert.equal(estimateSeconds({ start: null, end: at(30).toISOString(), pages: 20 }).estimated, true);
  assert.equal(estimateSeconds({ start: at(0).toISOString(), end: at(600).toISOString(), pages: 10 }).estimated, true);
});

test("sessions are named for the time of day they started", () => {
  assert.equal(sessionName(new Date(2026, 9, 20, 7).toISOString()), "Morning Read");
  assert.equal(sessionName(new Date(2026, 9, 20, 22).toISOString()), "Night Read");
  assert.equal(sessionName(new Date(2026, 9, 20, 2).toISOString()), "Late Night Read");
});
