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

// existsSync answers false when macOS refuses access to another app's container, which would read as "not
// installed". This throws the refusal instead, so the caller can say what is actually wrong.
export function present(file) {
  try {
    fs.statSync(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return false;
    throw error;
  }
}

export function newestFile(dir, prefix, suffix = ".sqlite") {
  if (!present(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter((name) => name.startsWith(prefix) && name.endsWith(suffix))
    .map((name) => path.join(dir, name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files[0] || null;
}
