import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export function openCopy(file, tmpDir) {
  fs.mkdirSync(tmpDir, { recursive: true });
  const copy = path.join(tmpDir, path.basename(file));
  for (const suffix of ["", "-wal", "-shm"]) {
    if (fs.existsSync(file + suffix)) fs.copyFileSync(file + suffix, copy + suffix);
    else fs.rmSync(copy + suffix, { force: true });
  }
  return new DatabaseSync(copy);
}

export function newestFile(dir, prefix, suffix = ".sqlite") {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter((name) => name.startsWith(prefix) && name.endsWith(suffix))
    .map((name) => path.join(dir, name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files[0] || null;
}
