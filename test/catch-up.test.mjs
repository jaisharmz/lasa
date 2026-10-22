import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/store.mjs";
import { LocalSink } from "../src/sinks.mjs";
import { catchUp, sync } from "../src/sync.mjs";
import { catchUpActivity, catchUpPlan } from "../src/catch-up.mjs";

const DAY = 86400000;
const NOW = Date.UTC(2026, 9, 22, 7, 0);

function book(overrides = {}) {
  return {
    source: "apple-books",
    sourceId: "ASSET1",
    title: "Walden",
    author: "Henry David Thoreau",
    progress: 0.4,
    openedAt: new Date(NOW - 30 * DAY).toISOString(),
    addedAt: new Date(NOW - 90 * DAY).toISOString(),
    readAt: null,
    finished: false,
    finishedAt: null,
    sample: false,
    format: "ebook",
    device: "Apple Books",
    ...overrides,
  };
}

function setup(t, items, config = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lasa-catchup-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new Store(path.join(root, "data"));
  const sources = [...new Set(items.map((item) => item.source))].map((source) => [source, () => ({ source, available: true, items: items.filter((item) => item.source === source), highlights: [] })]);
  const options = { sink: new LocalSink(store, "ada"), config, statePath: path.join(root, "state.json"), tmpDir: path.join(root, "tmp"), offline: true, log: () => {}, sources };
  return { store, options };
}

test("the first sync catches up a started Apple Books book once, dated when it was last opened", async (t) => {
  const { store, options } = setup(t, [book()]);
  const first = await sync({ ...options, now: new Date(NOW) });
  assert.equal(first.written.length, 1);
  const [activity] = store.all("activities/ada");
  assert.equal(activity.id, "ab-asset1-catchup");
  assert.equal(activity.name, "Read before Läsa");
  assert.equal(activity.catchUp, true);
  assert.equal(activity.estimated, true);
  assert.equal(activity.progressStart, 0);
  assert.equal(activity.progressEnd, 0.4);
  assert.equal(activity.pages, 120);
  assert.equal(activity.end, new Date(NOW - 30 * DAY).toISOString());
  assert.equal(Date.parse(activity.end) - Date.parse(activity.start), activity.seconds * 1000);

  assert.equal((await sync({ ...options, now: new Date(NOW + 600000) })).written.length, 0);
  fs.rmSync(options.statePath);
  assert.equal((await sync({ ...options, now: new Date(NOW + 1200000) })).written.length, 0, "a lost state file does not write it twice");
  assert.equal(store.all("activities/ada").length, 1);
});

test("an unstarted book or a sample gets no catch-up", async (t) => {
  const { store, options } = setup(t, [book({ progress: 0 }), book({ sourceId: "ASSET2", title: "Middlemarch", sample: true })]);
  await sync({ ...options, now: new Date(NOW) });
  assert.equal(store.all("activities/ada").length, 0);
});

test("Kindle is caught up only when asked, and never over an imported Kindle export", async (t) => {
  const kindle = book({ source: "kindle", sourceId: "B0TESTBOOK", asin: "B0TESTBOOK", title: "Middlemarch", addedAt: null, device: "Kindle for Mac" });
  const { store, options } = setup(t, [kindle]);
  assert.equal((await sync({ ...options, now: new Date(NOW) })).written.length, 0);

  const asked = await catchUp({ ...options, include: ["apple-books", "kindle"], now: new Date(NOW) });
  assert.equal(asked.written.length, 1);
  assert.equal(store.all("activities/ada")[0].id, "kd-b0testbook-catchup");

  assert.equal(catchUpPlan(kindle, [{ id: "kx-b0testbook-1760000000", progressStart: null }]), null);
});

test("a book Läsa already logged catches up only to where its first session began, from the day it was added", () => {
  const firstSession = { id: "ab-asset1-1761000000", start: new Date(NOW - 2 * DAY).toISOString(), progressStart: 0.25 };
  const item = book({ progress: 0.5, openedAt: new Date(NOW - DAY).toISOString() });
  const plan = catchUpPlan(item, [firstSession]);
  assert.equal(plan.progress, 0.25);
  const activity = catchUpActivity(item, plan, { book: { key: "walden", pages: 300 }, reader: "ada", now: new Date(NOW) });
  assert.equal(activity.start, item.addedAt);
  assert.ok(Date.parse(activity.end) <= Date.parse(firstSession.start));
  assert.equal(activity.pages, 75);
});
