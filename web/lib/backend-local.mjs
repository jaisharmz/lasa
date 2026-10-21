function remember(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return null;
  }
  return value;
}

export function createLocalBackend({ canSync = false, demo = true } = {}) {
  let viewer = demo ? remember("lasa-viewer") : null;
  let onState = () => {};

  async function api(path, { method = "GET", body } = {}) {
    const url = new URL(path, location.origin);
    if (demo && viewer) url.searchParams.set("as", viewer);
    const response = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || response.statusText);
    return result;
  }

  async function load() {
    const state = await api("/api/state");
    if (!state.readers.some((person) => person.handle === viewer)) viewer = state.me;
    const following = state.follows.filter((follow) => follow.follower === viewer).map((follow) => follow.target);
    onState({ status: "ready", data: { ...state, me: viewer, following, isAdmin: false } });
  }

  return {
    kind: "local",
    demo,
    canSync,
    async start(callback) {
      onState = callback;
      await load();
      setInterval(() => {
        if (!document.hidden) load();
      }, 60000);
    },
    refresh: load,
    setViewer(handle) {
      viewer = handle;
      remember("lasa-viewer", handle);
      return load();
    },
    async toggleKudos(owner, activity) {
      await api("/api/kudos", { method: "POST", body: { owner, activity } });
      await load();
    },
    async addComment(owner, activity, text) {
      await api("/api/comments", { method: "POST", body: { owner, activity, text } });
      await load();
    },
    async toggleFollow(target) {
      await api("/api/follows", { method: "POST", body: { target } });
      await load();
    },
    async logActivity(input) {
      const activity = await api("/api/activities", { method: "POST", body: input });
      await load();
      return activity;
    },
    async editActivity(owner, id, fields) {
      await api(`/api/activities/${owner}/${id}`, { method: "PATCH", body: fields });
      await load();
    },
    async sync() {
      const result = await api("/api/sync", { method: "POST" });
      await load();
      return result;
    },
    async signOut() {},
    async saveProfile() {
      throw new Error("profiles are fixed in the demo");
    },
  };
}
