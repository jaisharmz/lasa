import os from "node:os";
import path from "node:path";
import { newestFile, openCopy } from "../sqlite.mjs";

export const APPLE_BOOKS_DIR = process.env.LASA_APPLE_BOOKS_DIR || path.join(os.homedir(), "Library/Containers/com.apple.iBooksX/Data/Documents");
const CORE_DATA_EPOCH = 978307200;

function fromCoreData(seconds) {
  return seconds ? new Date((seconds + CORE_DATA_EPOCH) * 1000).toISOString() : null;
}

export function readAppleBooks({ tmpDir, documents = APPLE_BOOKS_DIR }) {
  const libraryFile = newestFile(path.join(documents, "BKLibrary"), "BKLibrary-");
  if (!libraryFile) return { source: "apple-books", available: false, items: [], highlights: [] };

  const library = openCopy(libraryFile, path.join(tmpDir, "apple-books"));
  const columns = new Set(library.prepare("pragma table_info(ZBKLIBRARYASSET)").all().map((column) => column.name));
  const rows = library.prepare(`
    select ZASSETID as id, ZTITLE as title, ZAUTHOR as author, ZREADINGPROGRESS as progress,
      ZLASTOPENDATE as opened, ZLASTENGAGEDDATE as engaged,
      ZISFINISHED as finished, ZDATEFINISHED as finishedAt, ZISSAMPLE as sample,
      ZISSTOREAUDIOBOOK as audiobook, ${columns.has("ZCREATIONDATE") ? "ZCREATIONDATE" : "null"} as added
    from ZBKLIBRARYASSET
    where ZTITLE is not null and ZASSETID is not null`).all();
  library.close();

  const items = rows.map((row) => {
    const openedAt = fromCoreData(row.opened);
    const engagedAt = fromCoreData(row.engaged);
    const engagedLater = engagedAt && openedAt && Date.parse(engagedAt) - Date.parse(openedAt) > 60000;
    return {
      source: "apple-books",
      sourceId: row.id,
      title: row.title,
      author: row.author ? row.author.replace(/;\s*$/, "") : null,
      progress: Math.max(0, Math.min(1, row.progress || 0)),
      openedAt,
      addedAt: fromCoreData(row.added),
      readAt: engagedLater ? engagedAt : null,
      finished: Boolean(row.finished),
      finishedAt: fromCoreData(row.finishedAt),
      sample: Boolean(row.sample),
      format: row.audiobook ? "audiobook" : "ebook",
      device: "Apple Books",
    };
  });

  const highlights = [];
  const annotationFile = newestFile(path.join(documents, "AEAnnotation"), "AEAnnotation_");
  if (annotationFile) {
    const annotations = openCopy(annotationFile, path.join(tmpDir, "apple-books"));
    const annotationRows = annotations.prepare(`
      select ZANNOTATIONASSETID as id, ZANNOTATIONSELECTEDTEXT as text, ZANNOTATIONNOTE as note,
        ZANNOTATIONCREATIONDATE as created
      from ZAEANNOTATION
      where ZANNOTATIONDELETED = 0 and ZANNOTATIONSELECTEDTEXT is not null and length(ZANNOTATIONSELECTEDTEXT) > 0`).all();
    annotations.close();
    for (const row of annotationRows) {
      highlights.push({ source: "apple-books", sourceId: row.id, text: row.text.trim(), note: row.note || null, at: fromCoreData(row.created) });
    }
  }

  return { source: "apple-books", available: true, items, highlights };
}
