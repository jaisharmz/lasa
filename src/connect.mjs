import crypto from "node:crypto";
import http from "node:http";
import { FirebaseClient } from "./firebase.mjs";

function callbackPage() {
  return `<!doctype html><meta charset="utf-8"><title>Läsa</title>
<body style="font:16px -apple-system,system-ui,sans-serif;display:grid;place-items:center;height:90vh;color:#242428">
<p id="status">Connecting this Mac…</p>
<script>
const payload = location.hash.slice(1);
history.replaceState(null, "", "/callback");
fetch("/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: decodeURIComponent(payload) })
  .then((response) => response.json())
  .then((result) => { document.getElementById("status").textContent = result.ok ? "This Mac is connected to @" + result.handle + ". You can close this tab." : "Couldn't connect: " + result.error; });
</script>`;
}

// Serves the page the site redirects to after Connect, checks the token it posts, and resolves with the account.
// The site holds the sign-in; this side only ever sees the refresh token, and only on 127.0.0.1.
export function connect({ ends, onUrl, timeoutMs = 600000, again = "connect again" }) {
  const state = crypto.randomBytes(16).toString("hex");
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (request, response) => {
      try {
        if (request.method === "GET" && request.url.startsWith("/callback")) {
          response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          return response.end(callbackPage());
        }
        if (request.method === "POST" && request.url === "/token") {
          let body = "";
          for await (const chunk of request) body += chunk;
          const payload = JSON.parse(body);
          if (payload.state !== state) throw new Error(`this link is stale; ${again}`);
          const client = new FirebaseClient({ refreshToken: payload.refreshToken, ends });
          await client.idToken();
          if (client.cached.uid !== payload.uid) throw new Error("the account didn't match");
          const account = { uid: payload.uid, handle: payload.handle, email: payload.email, refreshToken: client.refreshToken, project: ends.projectId };
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ ok: true, handle: account.handle }));
          server.close();
          clearTimeout(timer);
          return resolve(account);
        }
        response.writeHead(404);
        response.end();
      } catch (error) {
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: false, error: error.message }));
      }
    });
    const timer = setTimeout(() => {
      server.close();
      reject(new Error(`no answer from the browser in ${Math.round(timeoutMs / 60000)} minutes; ${again}`));
    }, timeoutMs);
    timer.unref();
    server.listen(0, "127.0.0.1", () => {
      onUrl(`${ends.app}/#/connect?port=${server.address().port}&state=${state}`);
    });
  });
}
