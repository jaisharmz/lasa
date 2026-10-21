import fs from "node:fs";
import { Store } from "./store.mjs";
import { sessionName } from "./sessions.mjs";

const READERS = [
  { handle: "ada", name: "Ada Lovelace", color: 18, bio: "Night reader. Long novels only.", minutesPerPage: 1.4, chance: 0.85, hours: [21, 23], device: "Kindle · Ada's Paperwhite", source: "kindle", books: ["count-of-monte-cristo", "middlemarch", "crime-and-punishment"] },
  { handle: "alan", name: "Alan Turing", color: 210, bio: "Mornings, coffee, one chapter.", minutesPerPage: 1.9, chance: 0.65, hours: [6, 8], device: "Apple Books", source: "apple-books", books: ["meditations", "walden", "frankenstein", "count-of-monte-cristo"] },
  { handle: "grace", name: "Grace Hopper", color: 140, bio: "Reads on the train and before bed.", minutesPerPage: 1.15, chance: 0.75, hours: [18, 21], device: "Kindle for Mac", source: "kindle", books: ["frankenstein", "moby-dick", "pride-and-prejudice", "walden"] },
];

const BOOKS = [
  { key: "count-of-monte-cristo", title: "The Count of Monte Cristo", author: "Alexandre Dumas", pages: 1276, year: 1844 },
  { key: "middlemarch", title: "Middlemarch", author: "George Eliot", pages: 880, year: 1871 },
  { key: "crime-and-punishment", title: "Crime and Punishment", author: "Fyodor Dostoyevsky", pages: 545, year: 1866 },
  { key: "meditations", title: "Meditations", author: "Marcus Aurelius", pages: 254, year: 180 },
  { key: "walden", title: "Walden", author: "Henry David Thoreau", pages: 352, year: 1854 },
  { key: "frankenstein", title: "Frankenstein", author: "Mary Shelley", pages: 280, year: 1818 },
  { key: "moby-dick", title: "Moby-Dick", author: "Herman Melville", pages: 635, year: 1851 },
  { key: "pride-and-prejudice", title: "Pride and Prejudice", author: "Jane Austen", pages: 432, year: 1813 },
];

const QUOTES = {
  "count-of-monte-cristo": "All human wisdom is contained in these two words, \"Wait and Hope.\"",
  meditations: "The happiness of your life depends upon the quality of your thoughts.",
  walden: "I went to the woods because I wished to live deliberately.",
  frankenstein: "Beware; for I am fearless, and therefore powerful.",
  "moby-dick": "Call me Ishmael.",
  "pride-and-prejudice": "I declare after all there is no enjoyment like reading!",
};

const COMMENTS = [
  "That pace though",
  "Monte Cristo at midnight is a choice",
  "You're going to finish before me at this rate",
  "Ok I'm starting this one next",
  "No spoilers past chapter 40 please",
  "Reading Walden on a weekday is the most Walden thing possible",
  "Streak is looking dangerous",
  "Save me a seat at the Château d'If",
];

function random(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildDemo(dir, { days = 63, now = new Date(), seed = 7 } = {}) {
  fs.rmSync(dir, { recursive: true, force: true });
  const store = new Store(dir);
  const next = random(seed);
  const pages = Object.fromEntries(BOOKS.map((book) => [book.key, book.pages]));
  for (const book of BOOKS) store.saveBook({ ...book, fullTitle: book.title, pagesEstimated: false, cover: null, sources: {} });

  const activities = [];
  for (const reader of READERS) {
    const { minutesPerPage, chance, hours, device, source, books, ...profile } = reader;
    store.saveReader({ ...profile, joined: new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10), goal: { month: { hours: 20 } } });
    let shelf = 0;
    let progress = reader.handle === "alan" ? 0.42 : 0.08;
    for (let back = days; back >= 0; back--) {
      if (shelf >= books.length || next() > chance) continue;
      const usual = hours[0] + Math.floor(next() * (hours[1] - hours[0] + 1));
      const times = next() < 0.2 ? [usual, 12 + Math.floor(next() * 2)].sort((a, b) => a - b) : [usual];
      for (const hour of times) {
        if (shelf >= books.length) break;
        const date = new Date(now);
        date.setDate(date.getDate() - back);
        date.setHours(hour, Math.floor(next() * 60), 0, 0);
        const book = books[shelf];
        const minutes = Math.round(12 + next() * next() * 95);
        if (date.getTime() + minutes * 60000 > now.getTime()) continue;
        const pace = minutesPerPage * (0.8 + next() * 0.4);
        const read = Math.max(3, Math.round(minutes / pace));
        const progressStart = progress;
        progress = Math.min(1, progress + read / pages[book]);
        const end = new Date(date.getTime() + minutes * 60000);
        const id = `${source === "apple-books" ? "ab" : "kd"}-${book.slice(0, 16)}-${Math.floor(date.getTime() / 1000)}`;
        const activity = {
          id,
          reader: reader.handle,
          book,
          name: sessionName(date.toISOString()),
          start: date.toISOString(),
          end: end.toISOString(),
          seconds: minutes * 60,
          estimated: false,
          pages: Math.round((progress - progressStart) * pages[book]),
          progressStart,
          progressEnd: progress,
          finished: progress >= 1,
          source,
          device,
          format: "ebook",
          note: "",
          highlights: QUOTES[book] && next() < 0.08 ? [{ text: QUOTES[book], note: null, at: end.toISOString() }] : [],
        };
        if (activity.finished) {
          activity.name = `Finished ${BOOKS.find((entry) => entry.key === book).title}`;
          shelf++;
          progress = 0;
        }
        store.saveActivity(activity);
        activities.push(activity);
      }
    }
  }

  for (const activity of activities) {
    for (const reader of READERS) {
      if (reader.handle === activity.reader) continue;
      if (next() < (activity.finished ? 0.95 : 0.45)) store.write(`kudos/${activity.reader}/${activity.id}/${reader.handle}.json`, { owner: activity.reader, activity: activity.id, reader: reader.handle, at: activity.end });
      if (next() < (activity.finished ? 0.6 : 0.06)) {
        const at = new Date(Date.parse(activity.end) + Math.floor(next() * 3) * 3600000 + 600000);
        if (at > now) continue;
        const text = activity.finished ? "Congrats on finishing!" : COMMENTS[Math.floor(next() * COMMENTS.length)];
        store.write(`comments/${activity.reader}/${activity.id}/${at.getTime()}-${reader.handle}.json`, { owner: activity.reader, activity: activity.id, reader: reader.handle, text, at: at.toISOString() });
      }
    }
  }
  return { store, readers: READERS.map((reader) => reader.handle), activities: activities.length };
}
