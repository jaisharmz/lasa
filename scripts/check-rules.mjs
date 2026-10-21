// Run against the emulators: npx firebase-tools emulators:start --only auth,firestore --project demo-lasa
import { FirebaseClient, encodeFields, endpoints } from "../src/firebase.mjs";

const ends = endpoints({ emulators: true });
const run = Date.now().toString(36);
const month = new Date().toISOString().slice(0, 7);
let failures = 0;

async function signIn(email) {
  const idToken = JSON.stringify({ sub: `${email}-${run}`, email, email_verified: true, name: email });
  const response = await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=demo-key", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ postBody: `id_token=${encodeURIComponent(idToken)}&providerId=google.com`, requestUri: "http://localhost", returnSecureToken: true }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(body));
  return { client: new FirebaseClient({ refreshToken: body.refreshToken, ends }), uid: body.localId };
}

async function bypass(method, path, fields) {
  const response = await fetch(`${ends.base}/${ends.root}/${path}`, {
    method,
    headers: { Authorization: "Bearer owner", "Content-Type": "application/json" },
    body: fields ? JSON.stringify({ fields: encodeFields(fields) }) : undefined,
  });
  if (!response.ok && response.status !== 404) throw new Error(`setup ${method} ${path}: ${response.status}`);
}

async function expect(label, allowed, action) {
  try {
    await action();
    console.log(`${allowed ? "ok  " : "FAIL"} ${label}: allowed`);
    if (!allowed) failures++;
  } catch (error) {
    console.log(`${allowed ? "FAIL" : "ok  "} ${label}: denied (${error.status || error.message.slice(0, 60)})`);
    if (allowed) failures++;
  }
}

function logWrite(client, uid, id) {
  return client.commit([client.update(`logs/${uid}_${month}_everyone`, { uid, month, visibility: "everyone", activities: { [id]: { id } } }, ["uid", "month", "visibility", `activities.\`${id}\``])]);
}

const admin = await signIn("admin@example.com");
const member = await signIn("member@example.com");
const stranger = await signIn("stranger@example.com");

console.log("-- no access settings: sign-up is open");
await bypass("DELETE", "config/access");
await expect("stranger reads readers", true, () => stranger.client.query("users", { handle: "nobody" }));
await expect("stranger claims a handle", true, () => stranger.client.commit([stranger.client.update(`handles/s-${run}`, { uid: stranger.uid }, ["uid"])]));
await expect("stranger edits access", false, () => stranger.client.commit([stranger.client.update("config/access", { mode: "invite", emails: [], admins: [] }, ["mode", "emails", "admins"])]));

console.log("-- invite-only");
await bypass("PATCH", "config/access", { mode: "invite", emails: ["member@example.com"], admins: ["admin@example.com"] });
await logWrite(admin.client, admin.uid, "mn-public");
await admin.client.commit([admin.client.update(`logs/${admin.uid}_${month}_private`, { uid: admin.uid, month, visibility: "private", activities: { "mn-secret": { id: "mn-secret" } } }, ["uid", "month", "visibility", "activities.`mn-secret`"])]);
await bypass("PATCH", `books/walden-${run}`, { key: `walden-${run}`, title: "Walden", sources: {} });
const adminLog = `logs/${admin.uid}_${month}_everyone`;

await expect("admin reads access", true, () => admin.client.get("config/access"));
await expect("admin edits access", true, () => admin.client.commit([admin.client.update("config/access", { mode: "invite", emails: ["member@example.com"], admins: ["admin@example.com"] }, ["mode", "emails", "admins"])]));
await expect("member reads another reader's public log", true, () => member.client.get(adminLog).then((doc) => { if (!doc) throw new Error("missing"); }));
await expect("member reads another reader's private log", false, () => member.client.get(`logs/${admin.uid}_${month}_private`));
await expect("member writes into another reader's log", false, () => member.client.commit([member.client.update(adminLog, { uid: admin.uid, month, visibility: "everyone", activities: { "mn-fake": { id: "mn-fake" } } }, ["uid", "month", "visibility", "activities.`mn-fake`"])]));
await expect("member files a log under another reader's uid", false, () => member.client.commit([member.client.update(`logs/${member.uid}_${month}_everyone`, { uid: admin.uid, month, visibility: "everyone", activities: {} }, ["uid", "month", "visibility"])]));
await expect("member writes their own log", true, () => logWrite(member.client, member.uid, "mn-mine"));
await expect("member gives kudos as someone else", false, () => member.client.commit([member.client.update(`kudos/${member.uid}_x_${admin.uid}`, { owner: member.uid, activity: "x", giver: admin.uid, at: "now" }, ["owner", "activity", "giver", "at"])]));
await expect("member gives kudos to themselves", false, () => member.client.commit([member.client.update(`kudos/${member.uid}_x_${member.uid}`, { owner: member.uid, activity: "x", giver: member.uid, at: "now" }, ["owner", "activity", "giver", "at"])]));
await expect("member comments as someone else", false, () => member.client.commit([member.client.update(`comments/forged-${run}`, { owner: admin.uid, activity: "x", author: admin.uid, text: "hi", at: "now" }, ["owner", "activity", "author", "text", "at"])]));
await expect("member edits access", false, () => member.client.commit([member.client.update("config/access", { mode: "open", emails: [], admins: [] }, ["mode", "emails", "admins"])]));
await expect("member reads access", false, () => member.client.get("config/access"));
await expect("member takes another reader's handle", false, () => member.client.commit([member.client.update(`handles/s-${run}`, { uid: member.uid }, ["uid"])]));
await expect("member rewrites a book's title", false, () => member.client.commit([member.client.update(`books/walden-${run}`, { title: "Hacked" }, ["title"])]));
await expect("uninvited reads readers", false, () => stranger.client.query("users", { handle: "nobody" }));
await expect("uninvited reads a public log", false, () => stranger.client.get(adminLog));
await expect("uninvited claims a handle", false, () => stranger.client.commit([stranger.client.update(`handles/s2-${run}`, { uid: stranger.uid }, ["uid"])]));
await expect("uninvited writes a log", false, () => logWrite(stranger.client, stranger.uid, "mn-x"));

console.log("-- open again");
await bypass("PATCH", "config/access", { mode: "open", emails: [], admins: ["admin@example.com"] });
await expect("stranger reads a public log", true, () => stranger.client.get(adminLog));
await expect("stranger still can't read a private log", false, () => stranger.client.get(`logs/${admin.uid}_${month}_private`));
await bypass("DELETE", "config/access");

console.log(failures ? `${failures} failed` : "all passed");
process.exitCode = failures ? 1 : 0;
