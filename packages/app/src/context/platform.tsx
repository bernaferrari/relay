import { createSimpleContext } from "@relay/ui/context/helper";
import type { ServerConnection } from "@relay/protocol";
import { normalizeLocalBase } from "../lib/api";

export type PlatformName = "web" | "desktop";

export type PlatformStorage = {
  get(key: string): string | null | Promise<string | null>;
  set(key: string, value: string): void | Promise<void>;
  remove?(key: string): void | Promise<void>;
};

/**
 * Host-owned update state. The product UI only renders this data; checking,
 * download, signature verification, and installation remain in the desktop
 * main process.
 */
export type DesktopUpdateState = {
  phase: "unsupported" | "disabled" | "idle" | "checking" | "available" | "downloaded" | "error";
  version?: string;
  releaseName?: string;
  releaseNotes?: string;
  releaseDate?: string;
  error?: string;
};

export type PlatformUpdates = {
  getState(): Promise<DesktopUpdateState>;
  check(): Promise<void>;
  install(): Promise<void>;
  subscribe(listener: (state: DesktopUpdateState) => void): () => void;
};

export type Platform = {
  platform: PlatformName;
  /** Open a URL externally (browser / OS handler) */
  openExternal?(url: string): void | Promise<void>;
  /** System notification */
  notify?(title: string, body?: string): void | Promise<void>;
  /** Copy a captured image without adding it to a journey or run. */
  copyImage?(base64: string, mime: string): void | Promise<void>;
  /** Current server base URL (no trailing slash) */
  getServerUrl(): string | Promise<string>;
  /** Canonical authenticated, project-scoped server connection. */
  getServerConnection?(): ServerConnection | Promise<ServerConnection>;
  /** Persist the complete connection; hosts should use secure storage for auth. */
  setServerConnection?(connection: ServerConnection): void | Promise<void>;
  /** Persist preferred server URL (optional) */
  setServerUrl?(url: string): void | Promise<void>;
  /** Key/value storage (defaults to localStorage on web) */
  storage: PlatformStorage;
  /** Optional app version label */
  version?: string;
  /** Optional fetch override */
  fetch?: typeof fetch;
  /** Present only in packaged desktop hosts that support signed self-updates. */
  updates?: PlatformUpdates;
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
  const prefix = opts?.storagePrefix ?? "relay:";
  const defaultUrl = normalizeLocalBase(
    opts?.defaultServerUrl ?? envServerUrl() ?? "http://127.0.0.1:8787",
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
    async copyImage(base64, mime) {
      if (!("clipboard" in navigator) || typeof ClipboardItem === "undefined") {
        throw new Error("Image clipboard is unavailable in this browser");
      }
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      const image = new Blob([bytes], { type: mime });
      await navigator.clipboard.write([new ClipboardItem({ [mime]: image })]);
    },
    getServerUrl() {
      const stored = storage.get("serverUrl");
      if (stored instanceof Promise) {
        return stored.then((value) => value ?? defaultUrl);
      }
      return normalizeLocalBase(stored ?? defaultUrl);
    },
    async getServerConnection() {
      const url = await Promise.resolve(this.getServerUrl());
      const token = await Promise.resolve(storage.get("authToken"));
      const organizationId = (await Promise.resolve(storage.get("organizationId"))) || "local";
      const projectId = (await Promise.resolve(storage.get("projectId"))) || "default";
      return {
        url,
        auth: token ? { type: "bearer" as const, token } : { type: "none" as const },
        organizationId,
        projectId,
      };
    },
    async setServerConnection(connection) {
      await Promise.all([
        Promise.resolve(storage.set("serverUrl", normalizeLocalBase(connection.url))),
        Promise.resolve(storage.set("organizationId", connection.organizationId)),
        Promise.resolve(storage.set("projectId", connection.projectId)),
        connection.auth.type === "none"
          ? Promise.resolve(storage.remove?.("authToken"))
          : Promise.resolve(storage.set("authToken", connection.auth.token)),
      ]);
    },
    setServerUrl(url) {
      storage.set("serverUrl", normalizeLocalBase(url));
    },
    storage,
  };
}
