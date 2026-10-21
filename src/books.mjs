import { bookKey, lookupOpenLibrary, newBook } from "../web/lib/books.mjs";

export async function ensureBook(sink, item, { offline = false } = {}) {
  const existing = await sink.book(bookKey(item.title));
  if (existing) {
    if (existing.sources?.[item.source] !== item.sourceId) await sink.addBookSource(existing, item.source, item.sourceId);
    return { book: existing, created: false };
  }
  const book = newBook(item, offline ? null : await lookupOpenLibrary(item));
  await sink.createBook(book);
  return { book, created: true };
}
