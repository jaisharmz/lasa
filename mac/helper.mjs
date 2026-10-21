// The sync engine inside Läsa for Mac, built into one executable (mac/build.sh) and run by the app once per job.
// It writes one JSON object per line to stdout. It never stores the sign-in: the app keeps the account in the
// Keychain and passes it on stdin, and a rotated refresh token comes back in the "done" event.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import pkg from "../package.json" with { type: "json" };
import { connect } from "../src/connect.mjs";
import { FirebaseClient, endpoints } from "../src/firebase.mjs";
import { FirestoreSink, LocalSink } from "../src/sinks.mjs";
import { Store } from "../src/store.mjs";
import { readSources, readState, sync } from "../src/sync.mjs";

const DENIED_HINT = "allow Läsa to read other apps' data";
const CLI_AGENT = path.join(os.homedir(), "Library", "LaunchAgents", "com.lasa.sync.plist");

const { values: flags, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    data: { type: "string" },
    emulators: { type: "boolean" },
    offline: { type: "boolean" },
  },
});
const [command] = positionals;
const ends = endpoints({ emulators: Boolean(flags.emulators) });

function emit(event, fields = {}) {
  process.stdout.write(JSON.stringify({ event, ...fields }) + "\n");
}

function folder() {
  if (!flags.data) throw new Error("--data <folder> is required");
  fs.mkdirSync(flags.data, { recursive: true });
  const config = path.join(flags.data, "config.json");
  return {
    config: fs.existsSync(config) ? JSON.parse(fs.readFileSync(config, "utf8")) : {},
    statePath: path.join(flags.data, "state.json"),
    tmpDir: path.join(flags.data, "tmp"),
  };
}

async function readAccount() {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  const account = text.trim() ? JSON.parse(text) : {};
  if (!account.refreshToken || !account.uid || !account.handle) throw new Error("this Mac isn't connected to Läsa");
  return account;
}

function report(sources) {
  return sources.map(({ source, available, denied, items, books, error }) => ({
    source,
    available: Boolean(available),
    denied: Boolean(denied),
    books: items ? items.length : books,
    started: items ? items.filter((item) => item.progress > 0).length : undefined,
    error: error || null,
  }));
}

function tracked(statePath) {
  const state = readState(statePath);
  return { tracked: Object.keys(state.books).length, syncedAt: state.syncedAt || null };
}

function offline(error) {
  const code = error.cause?.code || error.code;
  return error.message === "fetch failed" || ["ENOTFOUND", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ENETUNREACH"].includes(code);
}

async function main() {
  if (command === "version") return emit("version", { version: pkg.version, node: process.version });

  if (command === "connect") {
    const account = await connect({ ends, again: "press Connect in Läsa again", onUrl: (url) => emit("url", { url }) });
    return emit("connected", { account });
  }

  if (command === "status") {
    const { config, statePath, tmpDir } = folder();
    const sources = readSources({ config, tmpDir, deniedHint: DENIED_HINT });
    return emit("status", { sources: report(sources), ...tracked(statePath), cliAgent: fs.existsSync(CLI_AGENT) });
  }

  if (command === "sync") {
    const { config, statePath, tmpDir } = folder();
    const account = await readAccount();
    const client = new FirebaseClient({ refreshToken: account.refreshToken, ends });
    // LASA_LOCAL_SINK writes sessions to a folder instead of Firestore, for tests.
    const sink = process.env.LASA_LOCAL_SINK ? new LocalSink(new Store(process.env.LASA_LOCAL_SINK), account.handle) : new FirestoreSink(client, account);
    const result = await sync({ sink, config, statePath, tmpDir, offline: flags.offline, deniedHint: DENIED_HINT, log: (line) => emit("log", { line }) });
    return emit("done", {
      written: result.written.length,
      baseline: result.baseline,
      sessions: result.written.map((activity) => ({ name: activity.name, book: activity.book, minutes: Math.round(activity.seconds / 60), pages: activity.pages })),
      sources: report(result.sources),
      ...tracked(statePath),
      refreshToken: client.refreshToken !== account.refreshToken ? client.refreshToken : undefined,
    });
  }

  throw new Error(`unknown command: ${command || "(none)"}; use version, connect, status or sync`);
}

main().catch((error) => {
  emit("error", { message: error.message.replace("run lasa login", "reconnect in Läsa"), auth: /sign-in expired|isn't connected/.test(error.message), offline: offline(error) });
  process.exitCode = 1;
});
