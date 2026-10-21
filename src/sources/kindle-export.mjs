import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readExport, wanted } from "../../web/lib/kindle-export.mjs";

export { exportActivity, exportTitles, mergeSessions, readingSessions } from "../../web/lib/kindle-export.mjs";

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

function unzip(file, target) {
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  execFileSync("unzip", ["-q", "-o", file, "-d", target]);
  for (const nested of walk(target).filter((name) => name.endsWith(".zip"))) {
    execFileSync("unzip", ["-q", "-o", nested, "-d", nested.replace(/\.zip$/, "")]);
  }
  return target;
}

export function loadKindleExport(input, tmpDir) {
  const root = input.endsWith(".zip") ? unzip(input, path.join(tmpDir, "kindle-export")) : input;
  const files = walk(root)
    .filter((file) => !file.endsWith(".zip") && wanted(file, fs.statSync(file).size))
    .map((file) => ({ name: file, text: fs.readFileSync(file, "utf8") }));
  return readExport(files);
}
