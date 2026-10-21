import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openCopy } from "../sqlite.mjs";

export const KINDLE_DIR = path.join(os.homedir(), "Library/Containers/com.amazon.Lassen/Data/Library");

function asinOf(bookId) {
  const match = /^A:([^-]+)-/.exec(bookId || "");
  return match ? match[1] : bookId;
}

function recentReads(libraryDir, tmpDir) {
  const ksdk = path.join(libraryDir, "KSDK");
  if (!fs.existsSync(ksdk)) return new Map();
  const reads = new Map();
  for (const account of fs.readdirSync(ksdk).filter((name) => name.startsWith("amzn1.account."))) {
    const file = path.join(ksdk, account, "ksdk_annotation_v1.db");
    if (!fs.existsSync(file)) continue;
    const db = openCopy(file, path.join(tmpDir, "kindle", account));
    const rows = db.prepare(`
      select serialized_payload as payload, modified_time as modified
      from server_view where annotation_id = 'kindle.most_recent_read'`).all();
    db.close();
    for (const row of rows) {
      const payload = JSON.parse(row.payload);
      const asin = payload.book_data?.asin;
      const position = payload.position?.shortPosition;
      if (!asin || typeof position !== "number") continue;
      const read = { position, at: new Date(Number(row.modified)).toISOString(), device: payload.device_name };
      if (!reads.has(asin) || reads.get(asin).at < read.at) reads.set(asin, read);
    }
  }
  return reads;
}

export function readKindleMac({ tmpDir, libraryDir = KINDLE_DIR }) {
  const bookData = path.join(libraryDir, "Protected", "BookData.sqlite");
  if (!fs.existsSync(bookData)) return { source: "kindle", available: false, items: [], highlights: [] };

  const db = openCopy(bookData, path.join(tmpDir, "kindle"));
  const rows = db.prepare(`
    select ZBOOKID as id, ZDISPLAYTITLE as title, ZRAWCURRENTPOSITION as position,
      ZRAWMAXPOSITION as maxPosition, ZRAWLASTACCESSTIME as accessed, ZMIMETYPE as mime
    from ZBOOK
    where ZRAWMAXPOSITION > 0 and ZDISPLAYTITLE is not null`).all();
  db.close();

  const reads = recentReads(libraryDir, tmpDir);
  const items = rows.map((row) => {
    const asin = asinOf(row.id);
    const accessedAt = row.accessed ? new Date(row.accessed * 1000).toISOString() : null;
    const recent = reads.get(asin);
    const useRecent = recent && (!accessedAt || recent.at > accessedAt || !row.position);
    const position = useRecent ? recent.position : row.position || 0;
    const device = useRecent && recent.device && recent.device !== "Local" ? `Kindle · ${recent.device}` : "Kindle for Mac";
    return {
      source: "kindle",
      sourceId: asin,
      asin,
      title: row.title,
      author: null,
      progress: Math.max(0, Math.min(1, position / row.maxPosition)),
      position,
      maxPosition: row.maxPosition,
      openedAt: accessedAt,
      readAt: recent && (!accessedAt || recent.at > accessedAt) ? recent.at : null,
      finished: position / row.maxPosition >= 0.985,
      sample: false,
      format: row.mime === "application/pdf" ? "pdf" : "ebook",
      device,
    };
  });

  return { source: "kindle", available: true, items, highlights: [] };
}
