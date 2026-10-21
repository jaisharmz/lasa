import { initializeApp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";
import { GoogleAuthProvider, connectAuthEmulator, getAuth, getRedirectResult, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";
import {
  FieldPath, addDoc, collection, connectFirestoreEmulator, deleteDoc, deleteField, doc, getDoc, initializeFirestore,
  onSnapshot, persistentLocalCache, persistentMultipleTabManager, query, setDoc, updateDoc, where, writeBatch,
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";
import { emulatorProject, firebaseConfig } from "../firebase-config.mjs";
import { manualActivity, monthKey } from "./activity.mjs";
import { bookKey, lookupOpenLibrary, newBook, slug } from "./books.mjs";
import { hue } from "./format.mjs";

export function createFirebaseBackend({ emulators = false, canSync = false } = {}) {
  const app = initializeApp(emulators ? { ...firebaseConfig, projectId: emulatorProject, apiKey: "demo-key" } : firebaseConfig);
  const auth = getAuth(app);
  const db = initializeFirestore(app, emulators ? {} : { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  if (emulators) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
  }

  const raw = { users: new Map(), books: new Map(), kudos: new Map(), comments: new Map(), follows: new Map(), logs: new Map() };
  let user = null;
  let access = null;
  let stops = [];
  let onState = () => {};
  let pending = null;

  const uidOf = (handle) => [...raw.users.values()].find((profile) => profile.handle === handle)?.uid;
  const handleOf = (uid) => raw.users.get(uid)?.handle || uid.slice(0, 8);

  function build() {
    const activities = [...raw.logs.values()]
      .flatMap((log) => Object.values(log.activities || {}).map((activity) => ({ ...activity, uid: log.uid, reader: handleOf(log.uid), visibility: log.visibility })))
      .sort((a, b) => b.end.localeCompare(a.end));
    return {
      me: handleOf(user.uid),
      email: user.email,
      readers: [...raw.users.values()],
      books: [...raw.books.values()],
      activities,
      kudos: [...raw.kudos.values()].map((kudos) => ({ owner: handleOf(kudos.owner), activity: kudos.activity, reader: handleOf(kudos.giver), at: kudos.at })),
      comments: [...raw.comments.values()].map((comment) => ({ id: comment.id, owner: handleOf(comment.owner), activity: comment.activity, reader: handleOf(comment.author), text: comment.text, at: comment.at })).sort((a, b) => a.at.localeCompare(b.at)),
      following: [...raw.follows.values()].filter((follow) => follow.follower === user.uid).map((follow) => handleOf(follow.target)),
      isAdmin: Boolean(access),
      demo: false,
    };
  }

  function emit() {
    clearTimeout(pending);
    pending = setTimeout(() => onState({ status: "ready", data: build() }), 30);
  }

  function watch(target, map, keyed = (snapshot) => snapshot.id) {
    stops.push(onSnapshot(target, (snapshot) => {
      for (const change of snapshot.docChanges()) {
        if (change.type === "removed") map.delete(keyed(change.doc));
        else map.set(keyed(change.doc), { id: change.doc.id, ...change.doc.data() });
      }
      emit();
    }, (error) => onState({ status: "error", error: error.message })));
  }

  function stop() {
    for (const unsubscribe of stops) unsubscribe();
    stops = [];
    for (const map of Object.values(raw)) map.clear();
  }

  async function begin() {
    let profile;
    try {
      profile = await getDoc(doc(db, "users", user.uid));
    } catch (error) {
      if (error.code === "permission-denied") return onState({ status: "not-invited", email: user.email });
      throw error;
    }
    try {
      const settings = await getDoc(doc(db, "config", "access"));
      access = settings.exists() ? settings.data() : { mode: "open", emails: [], admins: [] };
    } catch {
      access = null;
    }
    if (!profile.exists()) return onState({ status: "onboarding", name: user.displayName || "", email: user.email });
    watch(collection(db, "users"), raw.users);
    watch(collection(db, "books"), raw.books);
    watch(collection(db, "kudos"), raw.kudos);
    watch(collection(db, "comments"), raw.comments);
    watch(collection(db, "follows"), raw.follows);
    watch(query(collection(db, "logs"), where("visibility", "==", "everyone")), raw.logs);
    watch(query(collection(db, "logs"), where("uid", "==", user.uid), where("visibility", "==", "private")), raw.logs);
  }

  function logRef(start, visibility) {
    return doc(db, "logs", `${user.uid}_${monthKey(start)}_${visibility}`);
  }

  async function saveActivity(activity) {
    const visibility = activity.visibility === "private" ? "private" : "everyone";
    const { uid, ...fields } = activity;
    await setDoc(logRef(activity.start, visibility), { uid: user.uid, month: monthKey(activity.start), visibility, activities: { [activity.id]: { ...fields, reader: handleOf(user.uid), visibility } } }, { merge: true });
  }

  async function createBook(item) {
    const book = newBook(item, await lookupOpenLibrary(item));
    try {
      await setDoc(doc(db, "books", book.key), book);
    } catch (error) {
      if (error.code !== "permission-denied" || !(await getDoc(doc(db, "books", book.key))).exists()) throw error;
    }
    return book;
  }

  async function ensureBook(input) {
    if (input.book && raw.books.has(input.book)) return raw.books.get(input.book);
    const title = String(input.title || "").trim();
    if (!title) throw new Error("pick a book or give a title");
    const key = bookKey(title);
    if (raw.books.has(key)) return raw.books.get(key);
    return createBook({ source: "manual", sourceId: slug(title), title, author: input.author || null });
  }

  async function importActivities({ books, activities }, progress = () => {}) {
    const missing = books.filter((entry) => !raw.books.has(entry.key));
    const unsourced = books.filter((entry) => raw.books.has(entry.key) && !raw.books.get(entry.key).sources?.[entry.source]);
    const queue = [...missing];
    let looked = 0;
    async function worker() {
      for (let entry = queue.shift(); entry; entry = queue.shift()) {
        await createBook({ source: entry.source, sourceId: entry.sourceId, title: entry.title, author: null });
        progress(`Looking up books: ${++looked} of ${missing.length}`);
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, missing.length) }, worker));

    const logs = new Map();
    for (const { uid, ...activity } of activities) {
      const visibility = activity.visibility === "private" ? "private" : "everyone";
      const id = `${user.uid}_${monthKey(activity.start)}_${visibility}`;
      if (!logs.has(id)) logs.set(id, { uid: user.uid, month: monthKey(activity.start), visibility, activities: {} });
      logs.get(id).activities[activity.id] = { ...activity, reader: handleOf(user.uid), visibility };
    }
    const entries = [...logs];
    for (let index = 0; index < entries.length; index += 40) {
      const batch = writeBatch(db);
      for (const [id, log] of entries.slice(index, index + 40)) batch.set(doc(db, "logs", id), log, { merge: true });
      await batch.commit();
      progress(`Saving sessions: ${Math.min(index + 40, entries.length)} of ${entries.length} months`);
    }
    for (let index = 0; index < unsourced.length; index += 400) {
      const batch = writeBatch(db);
      for (const entry of unsourced.slice(index, index + 400)) batch.update(doc(db, "books", entry.key), new FieldPath("sources", entry.source), entry.sourceId);
      await batch.commit();
    }
  }

  return {
    kind: "firebase",
    demo: false,
    canSync,
    start(callback) {
      onState = callback;
      getRedirectResult(auth).catch((error) => onState({ status: "error", error: error.message }));
      onAuthStateChanged(auth, async (signedIn) => {
        stop();
        user = signedIn;
        if (!user) return onState({ status: "signed-out" });
        onState({ status: "loading" });
        try {
          await begin();
        } catch (error) {
          onState({ status: "error", error: error.message });
        }
      });
    },
    async signIn() {
      const provider = new GoogleAuthProvider();
      if (emulators) return signInWithRedirect(auth, provider);
      try {
        await signInWithPopup(auth, provider);
      } catch (error) {
        if (error.code === "auth/popup-closed-by-user") return;
        if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment", "auth/cancelled-popup-request"].includes(error.code)) return signInWithRedirect(auth, provider);
        throw error;
      }
    },
    async signOut() {
      await signOut(auth);
    },
    refreshToken() {
      return auth.currentUser?.refreshToken;
    },
    uid() {
      return auth.currentUser?.uid;
    },
    async claimProfile({ handle, name }) {
      const clean = String(handle || "").trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9-]{1,23}$/.test(clean)) throw new Error("handles are 2 to 24 lowercase letters, digits or dashes");
      const taken = await getDoc(doc(db, "handles", clean));
      if (taken.exists() && taken.data().uid !== user.uid) throw new Error(`@${clean} is taken`);
      const batch = writeBatch(db);
      if (!taken.exists()) batch.set(doc(db, "handles", clean), { uid: user.uid });
      batch.set(doc(db, "users", user.uid), { uid: user.uid, handle: clean, name: String(name || clean).trim().slice(0, 80), color: hue(clean), bio: "", joined: new Date().toLocaleDateString("en-CA"), goal: { month: { hours: 20 } } });
      await batch.commit();
      stop();
      await begin();
    },
    async saveProfile({ name, bio, goalHours }) {
      const { id, ...current } = raw.users.get(user.uid);
      await setDoc(doc(db, "users", user.uid), { ...current, name: String(name).trim().slice(0, 80) || current.name, bio: String(bio || "").trim().slice(0, 300), goal: { month: { hours: Math.max(1, Math.min(300, Number(goalHours) || 20)) } } });
    },
    async toggleKudos(ownerHandle, activity) {
      const owner = uidOf(ownerHandle);
      const id = `${owner}_${activity}_${user.uid}`;
      if (raw.kudos.has(id)) await deleteDoc(doc(db, "kudos", id));
      else await setDoc(doc(db, "kudos", id), { owner, activity, giver: user.uid, at: new Date().toISOString() });
    },
    async addComment(ownerHandle, activity, text) {
      await addDoc(collection(db, "comments"), { owner: uidOf(ownerHandle), activity, author: user.uid, text: String(text).trim().slice(0, 2000), at: new Date().toISOString() });
    },
    async toggleFollow(handle) {
      const target = uidOf(handle);
      const id = `${user.uid}_${target}`;
      if (raw.follows.has(id)) await deleteDoc(doc(db, "follows", id));
      else await setDoc(doc(db, "follows", id), { follower: user.uid, target, at: new Date().toISOString() });
    },
    async logActivity(input) {
      const book = await ensureBook(input);
      const mine = build().activities.filter((activity) => activity.uid === user.uid);
      const activity = manualActivity(input, book, mine, handleOf(user.uid));
      await saveActivity(activity);
      return activity;
    },
    importActivities,
    async editActivity(ownerHandle, id, fields) {
      const activity = build().activities.find((entry) => entry.uid === user.uid && entry.id === id);
      if (!activity) throw new Error("only the reader can edit a session");
      const visibility = fields.visibility === "private" ? "private" : "everyone";
      const updated = { ...activity, name: String(fields.name ?? activity.name).trim().slice(0, 120) || activity.name, note: String(fields.note ?? activity.note ?? "").trim().slice(0, 2000), visibility };
      await saveActivity(updated);
      if (visibility !== activity.visibility) await updateDoc(logRef(activity.start, activity.visibility), new FieldPath("activities", id), deleteField());
    },
    async sync() {
      const response = await fetch("/api/sync", { method: "POST" });
      return response.json();
    },
    async loadAccess() {
      const settings = await getDoc(doc(db, "config", "access"));
      return settings.exists() ? settings.data() : { mode: "open", emails: [], admins: [] };
    },
    async saveAccess({ mode, emails, admins }) {
      const clean = (list) => [...new Set(list.map((email) => String(email).trim().toLowerCase()).filter((email) => email.includes("@")))];
      await setDoc(doc(db, "config", "access"), { mode: mode === "open" ? "open" : "invite", emails: clean(emails), admins: clean(admins) });
    },
  };
}
