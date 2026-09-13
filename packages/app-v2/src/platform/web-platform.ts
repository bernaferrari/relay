import type { Platform, PlatformStorage } from "./types";

/** Vite same-origin prefix. The Cursor browser cannot call :8787 (CORS). */
export const LOCAL_VITE_RELAY_PROXY = "/relay";

function normalizedBase(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function isLoopbackRelayApi(url: string): boolean {
  try {
    const parsed = new URL(url, "http://127.0.0.1");
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const host = parsed.hostname;
    return (host === "127.0.0.1" || host === "localhost") && parsed.port === "8787";
  } catch {
    return false;
  }
}

export function sameOriginRelayProxyUrl(pageOrigin?: string): string {
  const origin = pageOrigin?.trim().replace(/\/+$/, "");
  return origin ? `${origin}${LOCAL_VITE_RELAY_PROXY}` : LOCAL_VITE_RELAY_PROXY;
}

/** Direct :8787 is for desktop and curl. Local Vite uses `/relay` so a browser
 * tab never has to survive a cross-origin loopback call. */
export function resolveWebServerUrl(input: {
  stored?: string | null;
  configured?: string | null;
  development: boolean;
  pageOrigin?: string;
}): string {
  const configured = input.configured?.trim() || undefined;
  const stored = input.stored?.trim() || undefined;
  const candidate = configured ?? stored;
  if (input.development && (!candidate || isLoopbackRelayApi(candidate))) {
    return sameOriginRelayProxyUrl(input.pageOrigin);
  }
  if (candidate) return normalizedBase(candidate);
  return "http://127.0.0.1:8787";
}

export function createWebPlatform(
  options: {
    defaultServerUrl?: string;
    storagePrefix?: string;
    development?: boolean;
    pageOrigin?: string;
  } = {},
): Platform {
  const prefix = options.storagePrefix ?? "relay:";
  const development = options.development ?? import.meta.env.DEV;
  const pageOrigin = () =>
    options.pageOrigin ?? (typeof window !== "undefined" ? window.location.origin : undefined);
  const configured = () => options.defaultServerUrl ?? import.meta.env.VITE_SERVER_URL;
  const resolve = (stored?: string | null) =>
    resolveWebServerUrl({
      stored,
      configured: configured(),
      development,
      pageOrigin: pageOrigin(),
    });
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
        ? stored.then((value) => resolve(value))
        : resolve(stored);
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
