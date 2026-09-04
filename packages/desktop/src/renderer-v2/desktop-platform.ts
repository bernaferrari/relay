import type { Platform, PlatformStorage } from "@relay/app-v2";

function createDesktopStorage(name = "default"): PlatformStorage {
  const api = window.api;
  return {
    get: (key) => api.storeGet(name, key),
    set: (key, value) => api.storeSet(name, key, value),
    remove: (key) => api.storeDelete(name, key),
  };
}

export function createDesktopPlatform(): Platform {
  const api = window.api;
  const storage = createDesktopStorage("desktop");

  return {
    platform: "desktop",
    version: "0.1.0",
    openExternal: (url) => {
      api.openExternal(url);
    },
    openXcode: () => {
      void api.openXcode();
    },
    notify: (title, body) => {
      api.notify(title, body);
    },
    copyImage: (base64, mime) => api.copyImage(base64, mime),
    async getServerUrl() {
      const stored = await storage.get("serverUrl");
      if (stored?.trim()) return stored.replace(/\/+$/, "");
      return (await api.getServerUrl()).replace(/\/+$/, "");
    },
    async getServerConnection() {
      const url = await Promise.resolve(this.getServerUrl());
      const token = await storage.get("authToken");
      let actorId = await storage.get("actorId");
      if (!actorId) {
        actorId = `human:${crypto.randomUUID()}`;
        await storage.set("actorId", actorId);
      }
      return {
        url,
        auth: token ? { type: "bearer" as const, token } : { type: "none" as const },
        organizationId: (await storage.get("organizationId")) || "local",
        projectId: (await storage.get("projectId")) || "default",
        actorId,
        actorKind: "human" as const,
      };
    },
    async setServerConnection(connection) {
      await Promise.all([
        api.storeSet("desktop", "serverUrl", connection.url.replace(/\/+$/, "")),
        api.storeSet("desktop", "organizationId", connection.organizationId),
        api.storeSet("desktop", "projectId", connection.projectId),
        api.storeSet("desktop", "actorId", connection.actorId),
        connection.auth.type === "none"
          ? api.storeDelete("desktop", "authToken")
          : api.storeSet("desktop", "authToken", connection.auth.token),
      ]);
    },
    setServerUrl(url) {
      return api.storeSet("desktop", "serverUrl", url.replace(/\/+$/, ""));
    },
    storage,
    updates: {
      getState: () => api.updates.getState(),
      check: () => api.updates.check(),
      install: () => api.updates.install(),
      subscribe: (listener) => api.updates.onState(listener),
    },
  };
}
