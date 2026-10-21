import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv } from "../src/csv.mjs";
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
