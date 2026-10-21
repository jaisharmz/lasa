import { emulatorProject, firebaseConfig, hostedUrl } from "../web/firebase-config.mjs";

export function endpoints({ emulators = process.env.LASA_EMULATORS === "1" } = {}) {
  const projectId = emulators ? emulatorProject : firebaseConfig.projectId;
  return {
    emulators,
    projectId,
    apiKey: emulators ? "demo-key" : firebaseConfig.apiKey,
    token: emulators ? "http://127.0.0.1:9099/securetoken.googleapis.com/v1/token" : "https://securetoken.googleapis.com/v1/token",
    root: `projects/${projectId}/databases/(default)/documents`,
    base: emulators ? "http://127.0.0.1:8080/v1" : "https://firestore.googleapis.com/v1",
    app: emulators ? "http://127.0.0.1:7797" : hostedUrl,
  };
}

export function quote(segment) {
  return /^[A-Za-z_][A-Za-z_0-9]*$/.test(segment) ? segment : `\`${segment.replace(/[`\\]/g, "\\$&")}\``;
}

export function encode(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (typeof value === "string") return { stringValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  return { mapValue: { fields: encodeFields(value) } };
}

export function encodeFields(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined).map(([key, value]) => [key, encode(value)]));
}

export function decode(value) {
  if ("nullValue" in value) return null;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("stringValue" in value) return value.stringValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(decode);
  if ("mapValue" in value) return decodeFields(value.mapValue.fields || {});
  return null;
}

export function decodeFields(fields) {
  return Object.fromEntries(Object.entries(fields || {}).map(([key, value]) => [key, decode(value)]));
}

export class FirebaseClient {
  constructor({ refreshToken, ends = endpoints() }) {
    this.refreshToken = refreshToken;
    this.ends = ends;
    this.cached = null;
  }

  async idToken() {
    if (this.cached && this.cached.expires > Date.now() + 60000) return this.cached.token;
    const response = await fetch(`${this.ends.token}?key=${this.ends.apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: this.refreshToken }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(`sign-in expired or revoked (${body.error?.message || response.status}); run lasa login`);
    this.refreshToken = body.refresh_token || this.refreshToken;
    this.cached = { token: body.id_token, uid: body.user_id, expires: Date.now() + Number(body.expires_in) * 1000 };
    return this.cached.token;
  }

  name(path) {
    return `${this.ends.root}/${path}`;
  }

  async call(url, { method = "GET", body } = {}) {
    const response = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${await this.idToken()}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (response.status === 404) return null;
    const result = await response.json();
    if (!response.ok) {
      const error = new Error(result.error?.message || result[0]?.error?.message || `firestore ${response.status}`);
      error.status = result.error?.status;
      throw error;
    }
    return result;
  }

  async get(path) {
    const document = await this.call(`${this.ends.base}/${this.name(path)}`);
    return document ? decodeFields(document.fields) : null;
  }

  async commit(writes) {
    for (let index = 0; index < writes.length; index += 400) {
      await this.call(`${this.ends.base}/${this.ends.root}:commit`, { method: "POST", body: { writes: writes.slice(index, index + 400) } });
    }
  }

  async query(collectionId, equals) {
    const filters = Object.entries(equals).map(([field, value]) => ({ fieldFilter: { field: { fieldPath: field }, op: "EQUAL", value: encode(value) } }));
    const where = filters.length === 1 ? filters[0] : { compositeFilter: { op: "AND", filters } };
    const rows = await this.call(`${this.ends.base}/${this.ends.root}:runQuery`, { method: "POST", body: { structuredQuery: { from: [{ collectionId }], where } } });
    return (rows || []).filter((row) => row.document).map((row) => ({ id: row.document.name.split("/").pop(), ...decodeFields(row.document.fields) }));
  }

  update(path, fields, fieldPaths, currentDocument) {
    const write = { update: { name: this.name(path), fields: encodeFields(fields) }, updateMask: { fieldPaths } };
    if (currentDocument) write.currentDocument = currentDocument;
    return write;
  }
}
