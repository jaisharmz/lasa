import fs from "node:fs";
import path from "node:path";

export { bookKey, shortTitle, slug } from "../web/lib/books.mjs";

function safe(part) {
  if (!/^[\w-]+$/.test(String(part))) throw new Error(`bad id: ${part}`);
  return part;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function listJson(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listJson(full));
    else if (entry.name.endsWith(".json")) files.push(full);
  }
  return files;
}

export class Store {
  constructor(dir) {
    this.dir = dir;
  }

  path(...parts) {
    return path.join(this.dir, ...parts);
  }

  write(relative, value) {
    const file = this.path(relative);
    const text = JSON.stringify(value, null, 2) + "\n";
    if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === text) return null;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return relative;
  }

  remove(relative) {
    const file = this.path(relative);
    if (!fs.existsSync(file)) return null;
    fs.unlinkSync(file);
    return relative;
  }

  all(subdir) {
    return listJson(this.path(subdir)).map(readJson);
  }

  reader(handle) {
    const file = this.path("readers", `${safe(handle)}.json`);
    return fs.existsSync(file) ? readJson(file) : null;
  }

  saveReader(reader) {
    return this.write(`readers/${reader.handle}.json`, reader);
  }

  book(key) {
    const file = this.path("books", `${safe(key)}.json`);
    return fs.existsSync(file) ? readJson(file) : null;
  }

  saveBook(book) {
    return this.write(`books/${book.key}.json`, book);
  }

  activity(reader, id) {
    const file = this.path("activities", safe(reader), `${safe(id)}.json`);
    return fs.existsSync(file) ? readJson(file) : null;
  }

  saveActivity(activity) {
    return this.write(`activities/${activity.reader}/${activity.id}.json`, activity);
  }

  toggleKudos(owner, activityId, reader) {
    if (!this.activity(owner, activityId)) throw new Error("no such activity");
    const relative = `kudos/${owner}/${activityId}/${reader}.json`;
    if (fs.existsSync(this.path(relative))) return { given: false, file: this.remove(relative) };
    return { given: true, file: this.write(relative, { owner, activity: activityId, reader, at: new Date().toISOString() }) };
  }

  addComment(owner, activityId, reader, text) {
    if (!this.activity(owner, activityId)) throw new Error("no such activity");
    const at = new Date();
    const comment = { owner, activity: activityId, reader, text: String(text).trim().slice(0, 2000), at: at.toISOString() };
    const file = this.write(`comments/${owner}/${activityId}/${at.getTime()}-${reader}.json`, comment);
    return { comment, file };
  }

  toggleFollow(follower, target) {
    if (!this.reader(target)) throw new Error("no such reader");
    const relative = `follows/${safe(follower)}/${safe(target)}.json`;
    if (fs.existsSync(this.path(relative))) return { following: false, file: this.remove(relative) };
    return { following: true, file: this.write(relative, { follower, target, at: new Date().toISOString() }) };
  }

  load() {
    return {
      follows: this.all("follows"),
      readers: this.all("readers"),
      books: this.all("books"),
      activities: this.all("activities").sort((a, b) => b.end.localeCompare(a.end)),
      kudos: this.all("kudos"),
      comments: this.all("comments").sort((a, b) => a.at.localeCompare(b.at)),
    };
  }
}
