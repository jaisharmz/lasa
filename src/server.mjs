import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logActivity } from "./manual.mjs";
import { LocalSink } from "./sinks.mjs";

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "web");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
};

function send(response, status, body, type = "application/json; charset=utf-8") {
  response.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  response.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function readBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error("body too large");
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

async function demoApi(store, me, request, response, url) {
  if (url.pathname === "/api/state" && request.method === "GET") {
    return send(response, 200, { ...store.load(), me, demo: true });
  }
  if (url.pathname === "/api/kudos" && request.method === "POST") {
    const body = await readBody(request);
    if (body.owner === me) return send(response, 400, { error: "kudos are for other readers" });
    return send(response, 200, store.toggleKudos(body.owner, body.activity, me));
  }
  if (url.pathname === "/api/comments" && request.method === "POST") {
    const body = await readBody(request);
    if (!String(body.text || "").trim()) return send(response, 400, { error: "empty comment" });
    return send(response, 200, store.addComment(body.owner, body.activity, me, body.text));
  }
  if (url.pathname === "/api/follows" && request.method === "POST") {
    const body = await readBody(request);
    if (body.target === me) return send(response, 400, { error: "you can't follow yourself" });
    return send(response, 200, store.toggleFollow(me, body.target));
  }
  if (url.pathname === "/api/activities" && request.method === "POST") {
    return send(response, 200, await logActivity(new LocalSink(store, me), await readBody(request), { offline: true }));
  }
  const edit = /^\/api\/activities\/([\w-]+)\/([\w-]+)$/.exec(url.pathname);
  if (edit && request.method === "PATCH") {
    if (edit[1] !== me) return send(response, 403, { error: "only the reader can edit a session" });
    const activity = store.activity(edit[1], edit[2]);
    if (!activity) return send(response, 404, { error: "no such session" });
    const body = await readBody(request);
    const updated = {
      ...activity,
      name: String(body.name ?? activity.name).trim().slice(0, 120) || activity.name,
      note: String(body.note ?? activity.note).trim().slice(0, 2000),
      visibility: body.visibility === "private" ? "private" : "everyone",
    };
    store.saveActivity(updated);
    return send(response, 200, updated);
  }
  if (url.pathname === "/api/sync" && request.method === "POST") return send(response, 200, { log: ["demo mode: nothing to sync"] });
  return null;
}

export function serve({ store = null, port = 7795, host = "127.0.0.1", demo = false, emulators = false, runSync = null, demoReader = "ada", log = console.log }) {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    try {
      if (url.pathname === "/backend.json") {
        return send(response, 200, demo ? { backend: "local", demo: true } : { backend: "firebase", sync: Boolean(runSync), emulators });
      }
      if (demo && url.pathname.startsWith("/api/")) {
        const requested = url.searchParams.get("as");
        const me = requested && store.reader(requested) ? requested : demoReader;
        const handled = await demoApi(store, me, request, response, url);
        if (handled !== null) return handled;
      }
      if (!demo && url.pathname === "/api/sync" && request.method === "POST") {
        if (!runSync) return send(response, 200, { log: ["run lasa login on this Mac first"] });
        const lines = [];
        try {
          await runSync((line) => lines.push(line));
        } catch (error) {
          lines.push(error.message);
        }
        return send(response, 200, { log: lines });
      }
      if (url.pathname.startsWith("/api/")) return send(response, 404, { error: "not found" });

      const file = path.normalize(path.join(WEB, url.pathname === "/" ? "index.html" : url.pathname));
      if (!file.startsWith(WEB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(response, 404, "not found", "text/plain");
      return send(response, 200, fs.readFileSync(file), TYPES[path.extname(file)] || "application/octet-stream");
    } catch (error) {
      return send(response, 400, { error: error.message });
    }
  });

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(`port ${port} is already in use; Läsa may already be running at http://localhost:${port}, or pass --port`);
      process.exit(1);
    }
    throw error;
  });
  server.listen(port, host, () => log(`Läsa on http://localhost:${port}${demo ? " (demo)" : emulators ? " (emulators)" : ""}`));
  return server;
}
