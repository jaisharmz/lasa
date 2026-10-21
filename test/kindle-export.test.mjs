import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv } from "../web/lib/csv.mjs";
import { compareImport, exportFiles, planImport, readExport, summarize } from "../web/lib/kindle-export.mjs";
import { loadKindleExport, mergeSessions, readingSessions } from "../src/sources/kindle-export.mjs";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "kindle-export");

test("csv parsing keeps quoted commas and quotes", () => {
  const rows = parseCsv("ASIN,Product Name\nB01,\"Walden, or Life in the Woods\"\nB02,\"The \"\"Odyssey\"\"\"\n");
  assert.equal(rows[0]["Product Name"], "Walden, or Life in the Woods");
  assert.equal(rows[1]["Product Name"], "The \"Odyssey\"");
});

test("an export folder yields sessions and titles", () => {
  const { sessionFiles, sessions, titles } = loadKindleExport(fixtures, "/tmp");
  assert.equal(sessionFiles.length, 1);
  assert.equal(sessions.length, 4);
  assert.equal(titles.get("B073SG4L8T"), "The Divide: Global Inequality from Conquest to Free Markets");
});

test("sessions close together merge and short ones drop", () => {
  const { sessions } = loadKindleExport(fixtures, "/tmp");
  const merged = mergeSessions(sessions);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].parts, 2);
  assert.equal(merged[0].millis, 1500000 + 600000);
  assert.equal(merged[0].flips, 31);
});

test("timestamps without a zone are read as UTC", () => {
  const [session] = readingSessions([{ ASIN: "B1", start_timestamp: "2026-10-01 21:00:00", end_timestamp: "2026-10-01 21:30:00", total_reading_millis: "1800000" }]);
  assert.equal(new Date(session.start).toISOString(), "2026-10-01T21:00:00.000Z");
});

function fixtureFiles() {
  const files = [];
  for (const folder of fs.readdirSync(fixtures)) {
    for (const name of fs.readdirSync(path.join(fixtures, folder))) files.push({ name: `${folder}/${name}`, text: fs.readFileSync(path.join(fixtures, folder, name), "utf8") });
  }
  return files;
}

test("the site and the CLI read an export the same way", () => {
  const fromDisk = loadKindleExport(fixtures, "/tmp");
  const fromBrowser = readExport(fixtureFiles());
  assert.deepEqual(fromBrowser.sessions, fromDisk.sessions);
  assert.deepEqual([...fromBrowser.titles], [...fromDisk.titles]);
});

test("zips inside the zip open, and only the files that matter are decompressed", async () => {
  const bytes = (text) => new TextEncoder().encode(text);
  const [sessions, ownership] = fixtureFiles().sort((a, b) => b.name.localeCompare(a.name));
  const archives = {
    outer: {
      "Kindle.Devices.ReadingSession.zip": { data: bytes("inner"), size: 5 },
      "Digital.Content.Ownership/": { data: new Uint8Array(), size: 0 },
      [ownership.name]: { data: bytes(ownership.text), size: ownership.text.length },
      "__MACOSX/Digital.Content.Ownership/._Digital.Content.Ownership.1.json": { data: bytes("junk"), size: 4 },
      "Kindle.Devices.Telemetry/huge.csv": { data: bytes("x"), size: 60 * 1024 * 1024 },
      "Kindle.KindleDocs/cover.jpg": { data: bytes("x"), size: 1 },
    },
    inner: { [sessions.name]: { data: bytes(sessions.text), size: sessions.text.length } },
  };
  const opened = [];
  const unzip = async (data, keep) => {
    const archive = new TextDecoder().decode(data);
    opened.push(archive);
    return Object.fromEntries(Object.entries(archives[archive]).filter(([entry, { size }]) => keep({ name: entry, originalSize: size })).map(([entry, file]) => [entry, file.data]));
  };
  const files = await exportFiles([{ name: "Kindle.zip", bytes: bytes("outer") }], unzip);
  assert.deepEqual(opened, ["outer", "inner"]);
  assert.deepEqual(files.map((file) => file.name).sort(), [`Kindle.zip/${ownership.name}`, `Kindle.zip/Kindle.Devices.ReadingSession.zip/${sessions.name}`]);
  const { sessions: read, titles } = readExport(files);
  assert.equal(read.length, 4);
  assert.equal(titles.get("B073SG4L8T"), "The Divide: Global Inequality from Conquest to Free Markets");
});

test("an import plan keys sessions by book and start, so a second import finds them", () => {
  const plan = planImport(readExport(fixtureFiles()), { reader: "jai" });
  assert.deepEqual(plan.activities.map((activity) => activity.id), [`kx-b073sg4l8t-${Date.parse("2026-10-01T21:00:00Z") / 1000}`, `kx-b00test123-${Date.parse("2026-10-02T22:00:00Z") / 1000}`]);
  assert.deepEqual(plan.books.map((entry) => [entry.key, entry.sessions]), [["kindle-book-b00test123", 1], ["divide", 1]]);
  assert.equal(plan.records, 4);
  assert.deepEqual(summarize(plan.activities), { sessions: 2, books: 2, seconds: 2100 + 2700, from: "2026-10-01T21:00:00.000Z", to: "2026-10-02T22:45:00.000Z" });
  assert.ok(plan.activities.every((activity) => activity.visibility === "everyone" && activity.source === "kindle-export" && activity.reader === "jai"));
});

test("a newer export adds what is new, lengthens what grew, and keeps the reader's edits", () => {
  const [first, second] = planImport(readExport(fixtureFiles()), { reader: "jai" }).activities;
  const mine = [{ ...first, name: "Train ride", note: "good chapter", visibility: "private", seconds: first.seconds - 600 }, { ...second }];
  const third = { ...second, id: "kx-b00test123-1", start: "2026-10-05T10:00:00.000Z" };
  const { added, updated, unchanged } = compareImport([first, second, third], mine);
  assert.deepEqual(added.map((activity) => activity.id), [third.id]);
  assert.equal(unchanged, 1);
  assert.equal(updated.length, 1);
  assert.deepEqual([updated[0].name, updated[0].note, updated[0].visibility, updated[0].seconds], ["Train ride", "good chapter", "private", first.seconds]);
});

test("other exports' column spellings and a byte order mark still parse", () => {
  const rows = parseCsv("\uFEFF\"Start Timestamp\",\"End Timestamp\",\"Asin\",\"Device Family\",\"Total Reading Millis\"\r\n2026-10-01 21:00:00,2026-10-01 21:30:00,B1,Kindle for Android,1800000\r\n");
  const [session] = readingSessions(rows);
  assert.deepEqual([session.asin, session.millis, session.device, new Date(session.end).toISOString()], ["B1", 1800000, "Kindle for Android", "2026-10-01T21:30:00.000Z"]);
});

test("a session file dropped alone files its books under the ones already tagged with that ASIN", () => {
  const [sessionsOnly] = fixtureFiles().filter((file) => file.name.endsWith(".csv"));
  const known = new Map([["B073SG4L8T", { key: "divide", fullTitle: "The Divide: Global Inequality from Conquest to Free Markets" }]]);
  const plan = planImport(readExport([sessionsOnly]), { reader: "jai", known });
  assert.deepEqual(plan.books.map((entry) => entry.key).sort(), ["divide", "kindle-book-b00test123"]);
});
