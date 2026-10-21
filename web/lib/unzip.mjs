import { unzip } from "https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js";

export function unzipBytes(bytes, keep) {
  return new Promise((resolve, reject) => {
    unzip(bytes, { filter: (entry) => keep({ name: entry.name, originalSize: entry.originalSize }) }, (error, entries) => (error ? reject(error) : resolve(entries)));
  });
}
