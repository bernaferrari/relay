import type { Platform, PlatformStorage } from "./types";

function normalizedBase(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export function createWebPlatform(
  options: {
    defaultServerUrl?: string;
    storagePrefix?: string;
  } = {},
): Platform {
  const prefix = options.storagePrefix ?? "relay:";
  const fallbackUrl = normalizedBase(
    options.defaultServerUrl ?? import.meta.env.VITE_SERVER_URL ?? "http://127.0.0.1:8787",
  );
  const storage: PlatformStorage = {
    get(key) {
      try {
        return localStorage.getItem(prefix + key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(prefix + key, value);
      } catch {
        // Storage is optional in locked-down browser contexts.
      }
    },
    remove(key) {
      try {
        localStorage.removeItem(prefix + key);
      } catch {
        // Storage is optional in locked-down browser contexts.
      }
    },
  };

  return {
    platform: "web",
    storage,
    openExternal(url) {
      window.open(url, "_blank", "noopener,noreferrer");
    },
    getServerUrl() {
      const stored = storage.get("serverUrl");
      return stored instanceof Promise
        ? stored.then((value) => normalizedBase(value ?? fallbackUrl))
        : normalizedBase(stored ?? fallbackUrl);
    },
    async getServerConnection() {
      const url = await Promise.resolve(this.getServerUrl());
      const token = await Promise.resolve(storage.get("authToken"));
      let actorId = await Promise.resolve(storage.get("actorId"));
      if (!actorId) {
        actorId = `human:${crypto.randomUUID()}`;
        await Promise.resolve(storage.set("actorId", actorId));
      }
      return {
        url,
        auth: token ? { type: "bearer" as const, token } : { type: "none" as const },
        organizationId: (await Promise.resolve(storage.get("organizationId"))) || "local",
        projectId: (await Promise.resolve(storage.get("projectId"))) || "default",
        actorId,
        actorKind: "human" as const,
      };
    },
    async setServerConnection(connection) {
      await Promise.all([
        Promise.resolve(storage.set("serverUrl", normalizedBase(connection.url))),
        Promise.resolve(storage.set("organizationId", connection.organizationId)),
        Promise.resolve(storage.set("projectId", connection.projectId)),
        Promise.resolve(storage.set("actorId", connection.actorId)),
        connection.auth.type === "none"
          ? Promise.resolve(storage.remove?.("authToken"))
          : Promise.resolve(storage.set("authToken", connection.auth.token)),
      ]);
    },
    setServerUrl(url) {
      return storage.set("serverUrl", normalizedBase(url));
    },
  };
}
