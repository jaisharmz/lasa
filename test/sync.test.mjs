import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../src/store.mjs";
import { LocalSink } from "../src/sinks.mjs";
import { sync } from "../src/sync.mjs";
import { readAppleBooks } from "../src/sources/apple-books.mjs";

const CORE_DATA_EPOCH = 978307200;

function fakeAppleBooks(dir, progress, opened) {
  fs.mkdirSync(path.join(dir, "BKLibrary"), { recursive: true });
  const file = path.join(dir, "BKLibrary", "BKLibrary-1-test.sqlite");
  const db = new DatabaseSync(file);
  db.exec(`create table if not exists ZBKLIBRARYASSET (ZASSETID text, ZTITLE text, ZAUTHOR text, ZREADINGPROGRESS real, ZLASTOPENDATE real,
    ZLASTENGAGEDDATE real, ZMODIFICATIONDATE real, ZISFINISHED integer, ZDATEFINISHED real, ZISSAMPLE integer, ZISSTOREAUDIOBOOK integer)`);
  db.exec("delete from ZBKLIBRARYASSET");
  db.prepare("insert into ZBKLIBRARYASSET values (?, ?, ?, ?, ?, null, ?, 0, null, 0, 0)").run("ASSET1", "Walden", "Henry David Thoreau", progress, opened / 1000 - CORE_DATA_EPOCH, opened / 1000 - CORE_DATA_EPOCH);
  db.close();
}

test("sync turns an Apple Books progress change into an activity file", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lasa-test-"));
  const books = path.join(root, "books");
  const store = new Store(path.join(root, "data"));
  const options = {
    sink: new LocalSink(store, "ada"),
    config: { hide: [] },
    statePath: path.join(root, "state.json"),
    tmpDir: path.join(root, "tmp"),
    offline: true,
    log: () => {},
    sources: [["apple-books", ({ tmpDir }) => readAppleBooks({ tmpDir, documents: books })]],
  };
  const start = Date.UTC(2026, 9, 20, 20, 0);

  fakeAppleBooks(books, 0.1, start - 86400000);
  const first = await sync({ ...options, now: new Date(start) });
  assert.equal(first.baseline, 1);
  assert.equal(first.written.length, 0);

  fakeAppleBooks(books, 0.2, start + 2 * 60000);
  const second = await sync({ ...options, now: new Date(start + 32 * 60000) });
  assert.equal(second.written.length, 1);
  const [activity] = store.all("activities/ada");
  assert.equal(activity.book, "walden");
  assert.equal(activity.pages, 30);
  assert.equal(activity.seconds, 30 * 60);
  assert.equal(activity.estimated, false);
  assert.equal(activity.start, new Date(start + 2 * 60000).toISOString());
  assert.equal(store.book("walden").author, "Henry David Thoreau");

  fs.rmSync(root, { recursive: true, force: true });
});

test("hidden titles never become activities", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lasa-test-"));
  const books = path.join(root, "books");
  const store = new Store(path.join(root, "data"));
  const options = {
    sink: new LocalSink(store, "ada"),
    config: { hide: ["walden"] },
    statePath: path.join(root, "state.json"),
    tmpDir: path.join(root, "tmp"),
    offline: true,
    log: () => {},
    sources: [["apple-books", ({ tmpDir }) => readAppleBooks({ tmpDir, documents: books })]],
  };
  const start = Date.UTC(2026, 9, 20, 20, 0);
  fakeAppleBooks(books, 0.1, start);
  await sync({ ...options, now: new Date(start) });
  fakeAppleBooks(books, 0.3, start);
  const result = await sync({ ...options, now: new Date(start + 600000) });
  assert.equal(result.written.length, 0);
  assert.equal(store.all("activities").length, 0);
  fs.rmSync(root, { recursive: true, force: true });
});
