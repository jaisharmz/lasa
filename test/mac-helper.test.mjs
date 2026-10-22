import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const HELPER = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "mac", "helper.mjs");
const CORE_DATA_EPOCH = 978307200;

function fakeAppleBooks(dir, progress, openedMs) {
  fs.mkdirSync(path.join(dir, "BKLibrary"), { recursive: true });
  const db = new DatabaseSync(path.join(dir, "BKLibrary", "BKLibrary-1-test.sqlite"));
  db.exec(`create table if not exists ZBKLIBRARYASSET (ZASSETID text, ZTITLE text, ZAUTHOR text, ZREADINGPROGRESS real, ZLASTOPENDATE real,
    ZLASTENGAGEDDATE real, ZMODIFICATIONDATE real, ZISFINISHED integer, ZDATEFINISHED real, ZISSAMPLE integer, ZISSTOREAUDIOBOOK integer)`);
  db.exec("delete from ZBKLIBRARYASSET");
  const opened = openedMs / 1000 - CORE_DATA_EPOCH;
  db.prepare("insert into ZBKLIBRARYASSET values (?, ?, ?, ?, ?, null, ?, 0, null, 0, 0)").run("ASSET1", "Walden", "Henry David Thoreau", progress, opened, opened);
  db.close();
}

// Runs the helper the way the app does and returns its JSON events.
function run(root, args, { input = "", env = {} } = {}) {
  const result = spawnSync(process.execPath, [HELPER, ...args, "--data", path.join(root, "data")], {
    input,
    encoding: "utf8",
    env: { ...process.env, LASA_APPLE_BOOKS_DIR: path.join(root, "books"), LASA_KINDLE_DIR: path.join(root, "kindle"), ...env },
  });
  return { status: result.status, events: result.stdout.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) };
}

test("status reports each source, and a container macOS refuses reads as denied, not missing", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lasa-helper-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fakeAppleBooks(path.join(root, "books"), 0.1, Date.now());
  const missing = run(root, ["status"]);
  assert.equal(missing.status, 0);
  assert.deepEqual(missing.events[0].sources.map(({ source, available, denied, books }) => ({ source, available, denied, books })), [
    { source: "apple-books", available: true, denied: false, books: 1 },
    { source: "kindle", available: false, denied: false, books: 0 },
  ]);

  fs.mkdirSync(path.join(root, "kindle"));
  fs.chmodSync(path.join(root, "kindle"), 0o000);
  const kindle = run(root, ["status"]).events[0].sources.find((source) => source.source === "kindle");
  fs.chmodSync(path.join(root, "kindle"), 0o755);
  if (process.getuid() !== 0) {
    assert.equal(kindle.denied, true);
    assert.match(kindle.error, /allow Läsa to read other apps' data/);
  }
});

test("sync takes the account on stdin, records a baseline, then turns reading into a session", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lasa-helper-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const env = { LASA_LOCAL_SINK: path.join(root, "store") };
  const input = JSON.stringify({ uid: "uid-1", handle: "ada", refreshToken: "unused-by-the-local-sink" });

  assert.equal(run(root, ["sync", "--offline"], { env }).events[0].message, "this Mac isn't connected to Läsa");

  fakeAppleBooks(path.join(root, "books"), 0.1, Date.now() - 86400000);
  const first = run(root, ["sync", "--offline"], { input, env });
  assert.equal(first.status, 0);
  const firstDone = first.events.find((event) => event.event === "done");
  assert.equal(firstDone.baseline, 1);
  assert.equal(firstDone.written, 1);
  assert.equal(firstDone.tracked, 1);
  assert.equal(firstDone.refreshToken, undefined);
  assert.ok(first.events.some((event) => event.event === "log" && /baseline recorded/.test(event.line)));

  fakeAppleBooks(path.join(root, "books"), 0.2, Date.now() - 60000);
  const second = run(root, ["sync", "--offline"], { input, env }).events.find((event) => event.event === "done");
  assert.equal(second.written, 1);
  assert.equal(second.sessions[0].book, "walden");
  const saved = fs.readdirSync(path.join(root, "store", "activities", "ada"));
  assert.equal(saved.length, 2);
});
