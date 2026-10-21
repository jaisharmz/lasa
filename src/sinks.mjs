import { monthKey } from "../web/lib/activity.mjs";
import { encodeFields, quote } from "./firebase.mjs";

export class LocalSink {
  constructor(store, handle) {
    this.store = store;
    this.handle = handle;
  }

  async book(key) {
    return this.store.book(key);
  }

  async createBook(book) {
    this.store.saveBook(book);
  }

  async addBookSource(book, source, sourceId) {
    this.store.saveBook({ ...book, sources: { ...book.sources, [source]: sourceId } });
  }

  async mine() {
    return this.store.all(`activities/${this.handle}`);
  }

  async saveActivities(list) {
    for (const activity of list) this.store.saveActivity({ ...activity, reader: this.handle });
  }
}

export class FirestoreSink {
  constructor(client, { uid, handle }) {
    this.client = client;
    this.uid = uid;
    this.handle = handle;
    this.books = new Map();
  }

  async book(key) {
    if (!this.books.has(key)) this.books.set(key, await this.client.get(`books/${key}`));
    return this.books.get(key);
  }

  async createBook(book) {
    try {
      await this.client.commit([{ update: { name: this.client.name(`books/${book.key}`), fields: encodeFields(book) }, currentDocument: { exists: false } }]);
    } catch (error) {
      if (error.status !== "ALREADY_EXISTS" && error.status !== "FAILED_PRECONDITION") throw error;
    }
    this.books.set(book.key, book);
  }

  async addBookSource(book, source, sourceId) {
    await this.client.commit([this.client.update(`books/${book.key}`, { sources: { [source]: sourceId } }, [`sources.${quote(source)}`])]);
    this.books.set(book.key, { ...book, sources: { ...book.sources, [source]: sourceId } });
  }

  async mine() {
    const logs = await this.client.query("logs", { uid: this.uid });
    return logs.flatMap((log) => Object.values(log.activities || {}).map((activity) => ({ ...activity, visibility: log.visibility })));
  }

  async saveActivities(list) {
    const groups = new Map();
    for (const activity of list) {
      const visibility = activity.visibility === "private" ? "private" : "everyone";
      const month = monthKey(activity.start);
      const id = `${this.uid}_${month}_${visibility}`;
      if (!groups.has(id)) groups.set(id, { month, visibility, activities: {} });
      groups.get(id).activities[activity.id] = { ...activity, reader: this.handle, visibility };
    }
    const writes = [...groups].map(([id, group]) => this.client.update(
      `logs/${id}`,
      { uid: this.uid, month: group.month, visibility: group.visibility, activities: group.activities },
      ["uid", "month", "visibility", ...Object.keys(group.activities).map((key) => `activities.${quote(key)}`)],
    ));
    await this.client.commit(writes);
  }
}
