import { createSimpleContext } from "@grok-device/ui/context/helper";

export type PlatformName = "web" | "desktop";

export type PlatformStorage = {
  get(key: string): string | null | Promise<string | null>;
  set(key: string, value: string): void | Promise<void>;
  remove?(key: string): void | Promise<void>;
};

export type Platform = {
  platform: PlatformName;
  /** Open a URL externally (browser / OS handler) */
  openExternal?(url: string): void | Promise<void>;
  /** System notification */
  notify?(title: string, body?: string): void | Promise<void>;
  /** Current server base URL (no trailing slash) */
  getServerUrl(): string | Promise<string>;
  /** Persist preferred server URL (optional) */
  setServerUrl?(url: string): void | Promise<void>;
  /** Key/value storage (defaults to localStorage on web) */
  storage: PlatformStorage;
  /** Optional app version label */
  version?: string;
  /** Optional fetch override */
  fetch?: typeof fetch;
};

export const { use: usePlatform, provider: PlatformProvider } = createSimpleContext({
  name: "Platform",
  gate: false,
  init: (props: { value: Platform }) => props.value,
});

function envServerUrl(): string | undefined {
  try {
    const value = import.meta.env?.VITE_SERVER_URL;
    return typeof value === "string" && value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Browser / web platform implementation. */
export function createWebPlatform(opts?: {
  defaultServerUrl?: string;
  storagePrefix?: string;
}): Platform {
  const prefix = opts?.storagePrefix ?? "grok-device:";
  const defaultUrl = opts?.defaultServerUrl ?? envServerUrl() ?? "http://localhost:8787";

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
        /* ignore */
      }
    },
    remove(key) {
      try {
        localStorage.removeItem(prefix + key);
      } catch {
        /* ignore */
      }
    },
  };

  return {
    platform: "web",
    openExternal(url) {
      window.open(url, "_blank", "noopener,noreferrer");
    },
    async notify(title, body) {
      if (!("Notification" in window)) return;
      const permission =
        Notification.permission === "default"
          ? await Notification.requestPermission().catch(() => "denied" as const)
          : Notification.permission;
      if (permission !== "granted") return;
      new Notification(title, { body: body ?? "" });
    },
    getServerUrl() {
      const stored = storage.get("serverUrl");
      if (stored instanceof Promise) {
        return stored.then((value) => value ?? defaultUrl);
      }
      return stored ?? defaultUrl;
    },
    setServerUrl(url) {
      storage.set("serverUrl", url.replace(/\/+$/, ""));
    },
    storage,
  };
}
