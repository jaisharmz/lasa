import { ensureBook } from "./books.mjs";
import { manualActivity } from "../web/lib/activity.mjs";
import { bookKey, slug } from "../web/lib/books.mjs";

export async function logActivity(sink, input, { offline = false } = {}) {
  const title = String(input.title || "").trim();
  let book = input.book ? await sink.book(input.book) : null;
  if (!book && !title) throw new Error("pick a book or give a title");
  if (!book) book = (await sink.book(bookKey(title))) || (await ensureBook(sink, { source: "manual", sourceId: slug(title), title, author: input.author || null }, { offline })).book;
  const activity = manualActivity(input, book, await sink.mine(), sink.handle);
  await sink.saveActivities([activity]);
  return activity;
}
