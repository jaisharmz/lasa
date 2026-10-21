#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { importKindleExport, readState, sync } from "../src/sync.mjs";
import { logActivity } from "../src/manual.mjs";
import { serve } from "../src/server.mjs";
import { buildDemo } from "../src/demo.mjs";
import { FirebaseClient, endpoints } from "../src/firebase.mjs";
import { connect } from "../src/connect.mjs";
import { FirestoreSink } from "../src/sinks.mjs";
import { readAppleBooks } from "../src/sources/apple-books.mjs";
import { readKindleMac } from "../src/sources/kindle-mac.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCAL = path.join(ROOT, ".lasa");
const CONFIG = path.join(LOCAL, "config.json");
const STATE = path.join(LOCAL, "state.json");
const TMP = path.join(LOCAL, "tmp");
const AGENT = path.join(os.homedir(), "Library", "LaunchAgents", "com.lasa.sync.plist");

const USAGE = `Läsa, Strava for reading

  lasa login                              connect this Mac to your Läsa account (opens the site)
  lasa logout | whoami
  lasa sync [--dry-run] [--offline]       new reading in Kindle for Mac and Apple Books becomes sessions
  lasa import <kindle-export.zip|dir> [--dry-run]
                                          backfill real Kindle sessions from Amazon's data export
  lasa log "<title>" --minutes 30 [--pages 20] [--author "..."] [--at "2026-10-20 21:00"]
                                          a paper book, or anything else, by hand
  lasa invite <email> [...]               let more Google accounts in (admins only)
  lasa access open|invite                 open sign-up to everyone, or back to invite-only (admins only)
  lasa serve [--port 7795]                the app on this Mac, with a Sync button for this Mac
  lasa demo [--port 7796]                 the app on made-up readers, no account needed
  lasa deploy                             publish the site and security rules to Firebase
  lasa status                             what sync can see on this machine
  lasa agent install|uninstall|print [--minutes 10]
                                          run sync in the background with launchd

  --emulators points login, sync, log and serve at local Firebase emulators.
`;

const { values: flags, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "dry-run": { type: "boolean" },
    offline: { type: "boolean" },
    emulators: { type: "boolean" },
    "no-open": { type: "boolean" },
    port: { type: "string" },
    minutes: { type: "string" },
    pages: { type: "string" },
    author: { type: "string" },
    at: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

const [command, ...rest] = positionals;
const ends = endpoints({ emulators: Boolean(flags.emulators) || process.env.LASA_EMULATORS === "1" });
const CREDENTIALS = path.join(LOCAL, ends.emulators ? "credentials-emulators.json" : "credentials.json");
const stamp = process.stdout.isTTY ? (line) => console.log(line) : (line) => console.log(`${new Date().toISOString()} ${line}`);

function readJson(file, fallback) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback;
}

function config() {
  return readJson(CONFIG, {});
}

function credentials() {
  return readJson(CREDENTIALS, null);
}

function signedIn() {
  const saved = credentials();
  if (!saved) {
    console.error("this Mac isn't connected yet; run `node bin/lasa.mjs login`");
    process.exit(1);
  }
  const client = new FirebaseClient({ refreshToken: saved.refreshToken, ends });
  return { saved, client, sink: new FirestoreSink(client, saved) };
}

function preview() {
  const saved = credentials();
  if (saved) return signedIn().sink;
  return { handle: "you", mine: async () => [], book: async () => null };
}

async function login() {
  const saved = await connect({
    ends,
    again: "run lasa login again",
    onUrl: (url) => {
      console.log(`opening ${url}`);
      console.log("sign in there and press Connect");
      if (!flags["no-open"]) spawn("open", [url], { stdio: "ignore", detached: true }).unref();
    },
  });
  fs.mkdirSync(LOCAL, { recursive: true });
  fs.writeFileSync(CREDENTIALS, JSON.stringify(saved, null, 2) + "\n", { mode: 0o600 });
  return saved;
}

async function changeAccess(change) {
  const { client, saved } = signedIn();
  const current = (await client.get("config/access")) || { mode: "open", emails: [], admins: [saved.email] };
  const next = change(current);
  await client.commit([client.update("config/access", next, ["mode", "emails", "admins"])]);
  return next;
}

function agentPlist(minutes) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.lasa.sync</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${path.join(ROOT, "bin", "lasa.mjs")}</string>
    <string>sync</string>
  </array>
  <key>StartInterval</key><integer>${minutes * 60}</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${path.join(LOCAL, "sync.log")}</string>
  <key>StandardErrorPath</key><string>${path.join(LOCAL, "sync.log")}</string>
</dict>
</plist>
`;
}

async function main() {
  if (!command || flags.help) return console.log(USAGE);

  if (command === "login") {
    const saved = await login();
    return console.log(`this Mac syncs as @${saved.handle} (${saved.email}). next: node bin/lasa.mjs sync`);
  }

  if (command === "logout") {
    if (fs.existsSync(CREDENTIALS)) fs.unlinkSync(CREDENTIALS);
    return console.log("this Mac is disconnected");
  }

  if (command === "whoami") {
    const saved = credentials();
    return console.log(saved ? `@${saved.handle} (${saved.email}) on ${saved.project}` : "not connected; run lasa login");
  }

  if (command === "sync") {
    const sink = flags["dry-run"] ? preview() : signedIn().sink;
    await sync({ sink, config: config(), statePath: STATE, tmpDir: TMP, dryRun: flags["dry-run"], offline: flags.offline, log: stamp });
    return;
  }

  if (command === "import") {
    if (!rest[0]) throw new Error("give the path to the export zip or folder");
    const sink = flags["dry-run"] ? preview() : signedIn().sink;
    await importKindleExport({ sink, config: config(), input: path.resolve(rest[0]), tmpDir: TMP, dryRun: flags["dry-run"], offline: flags.offline });
    return;
  }

  if (command === "log") {
    const { sink } = signedIn();
    const end = flags.at ? new Date(flags.at) : new Date();
    if (Number.isNaN(end.getTime())) throw new Error("--at needs a date like \"2026-10-20 21:00\"");
    const activity = await logActivity(sink, { title: rest[0], author: flags.author, minutes: flags.minutes, pages: flags.pages, end: end.toISOString(), visibility: config().visibility }, { offline: flags.offline });
    return console.log(`${activity.name}: ${Math.round(activity.seconds / 60)} min, ${activity.pages} pages`);
  }

  if (command === "invite") {
    if (!rest.length) throw new Error("give one or more email addresses");
    const next = await changeAccess((current) => ({ ...current, emails: [...new Set([...current.emails, ...rest.map((email) => email.toLowerCase())])] }));
    return console.log(`invited: ${next.emails.join(", ")} (${next.mode === "open" ? "open sign-up" : "invite-only"})`);
  }

  if (command === "access") {
    if (!["open", "invite"].includes(rest[0])) throw new Error("lasa access open|invite");
    const next = await changeAccess((current) => ({ ...current, mode: rest[0] }));
    return console.log(next.mode === "open" ? "anyone with a Google account can sign up" : "invite-only");
  }

  if (command === "serve") {
    const runSync = credentials() ? (log) => sync({ sink: signedIn().sink, config: config(), statePath: STATE, tmpDir: TMP, log }) : null;
    serve({ port: Number(flags.port) || (ends.emulators ? 7797 : 7795), emulators: ends.emulators, runSync });
    return;
  }

  if (command === "demo") {
    const { store, activities } = buildDemo(path.join(LOCAL, "demo"));
    console.log(`demo: ${activities} sessions`);
    serve({ store, port: Number(flags.port) || 7796, demo: true });
    return;
  }

  if (command === "deploy") {
    const result = spawnSync("npx", ["--yes", "firebase-tools@latest", "deploy", "--only", "hosting,firestore", "--project", ends.projectId], { cwd: ROOT, stdio: "inherit" });
    process.exit(result.status ?? 1);
  }

  if (command === "status") {
    const saved = credentials();
    console.log(`account: ${saved ? `@${saved.handle} (${saved.email})` : "not connected (lasa login)"}`);
    for (const [name, read] of [["apple-books", readAppleBooks], ["kindle", readKindleMac]]) {
      try {
        const result = read({ tmpDir: TMP });
        const started = result.items.filter((item) => item.progress > 0).length;
        console.log(`${name}: ${result.available ? `${result.items.length} books, ${started} started` : "not found"}`);
      } catch (error) {
        console.log(`${name}: unreadable (${error.message})`);
      }
    }
    const state = readState(STATE);
    console.log(`tracked: ${Object.keys(state.books).length} books, last sync ${state.syncedAt || "never"}, ${Object.keys(state.open).length} open session(s)`);
    console.log(`agent: ${fs.existsSync(AGENT) ? AGENT : "not installed"}`);
    return;
  }

  if (command === "agent") {
    const action = rest[0];
    const minutes = Number(flags.minutes) || 10;
    const domain = `gui/${process.getuid()}`;
    if (action === "print") return console.log(agentPlist(minutes));
    if (action === "install") {
      signedIn();
      fs.mkdirSync(path.dirname(AGENT), { recursive: true });
      fs.writeFileSync(AGENT, agentPlist(minutes));
      spawnSync("launchctl", ["bootout", domain, AGENT]);
      const loaded = spawnSync("launchctl", ["bootstrap", domain, AGENT], { encoding: "utf8" });
      if (loaded.status !== 0) throw new Error(`launchctl: ${loaded.stderr.trim()}`);
      return console.log(`sync runs every ${minutes} min; log in .lasa/sync.log`);
    }
    if (action === "uninstall") {
      spawnSync("launchctl", ["bootout", domain, AGENT]);
      if (fs.existsSync(AGENT)) fs.unlinkSync(AGENT);
      return console.log("agent removed");
    }
    throw new Error("lasa agent install|uninstall|print");
  }

  console.log(USAGE);
  process.exit(1);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
