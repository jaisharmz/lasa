import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { connect } from "../src/connect.mjs";

// Stands in for securetoken.googleapis.com: trades a refresh token for an id token and a rotated refresh token.
function fakeTokenServer(uid) {
  return new Promise((resolve) => {
    const server = http.createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk;
      const refresh = new URLSearchParams(body).get("refresh_token");
      response.writeHead(refresh === "good" ? 200 : 400, { "Content-Type": "application/json" });
      response.end(JSON.stringify(refresh === "good" ? { id_token: "id", refresh_token: "rotated", user_id: uid, expires_in: "3600" } : { error: { message: "INVALID_REFRESH_TOKEN" } }));
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function post(url, payload) {
  return fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).then(async (response) => ({ status: response.status, body: await response.json() }));
}

test("connect checks the token the site posts back and resolves with the account", async () => {
  const tokens = await fakeTokenServer("uid-1");
  const ends = { token: `http://127.0.0.1:${tokens.address().port}/token`, apiKey: "test", app: "http://site.test", projectId: "demo-test" };
  let link;
  const connected = connect({ ends, onUrl: (url) => { link = url; } });
  while (!link) await new Promise((resolve) => setTimeout(resolve, 5));

  const match = /^http:\/\/site\.test\/#\/connect\?port=(\d+)&state=([a-f0-9]{32})$/.exec(link);
  assert.ok(match, link);
  const [, port, state] = match;
  const callback = await fetch(`http://127.0.0.1:${port}/callback`);
  assert.match(await callback.text(), /Connecting this Mac/);

  const stale = await post(`http://127.0.0.1:${port}/token`, { state: "0".repeat(32), refreshToken: "good", uid: "uid-1", handle: "ada" });
  assert.equal(stale.status, 400);
  assert.match(stale.body.error, /stale/);

  const wrongAccount = await post(`http://127.0.0.1:${port}/token`, { state, refreshToken: "good", uid: "someone-else", handle: "ada" });
  assert.equal(wrongAccount.status, 400);

  const ok = await post(`http://127.0.0.1:${port}/token`, { state, refreshToken: "good", uid: "uid-1", handle: "ada", email: "ada@example.com" });
  assert.deepEqual(ok.body, { ok: true, handle: "ada" });
  assert.deepEqual(await connected, { uid: "uid-1", handle: "ada", email: "ada@example.com", refreshToken: "rotated", project: "demo-test" });
  tokens.close();
});
