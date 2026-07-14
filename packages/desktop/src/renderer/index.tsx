import { render } from "solid-js/web";
import {
  AppBaseProviders,
  AppInterface,
  type Platform,
  type PlatformStorage,
  type ThemeAppliedDetail,
} from "@relay/app";
/* App CSS pulls AgentBoard-shaped @relay/ui/styles/tailwind + v2 */
import "@relay/app/index.css";
import "./styles.css";

function createDesktopStorage(name = "default"): PlatformStorage {
  const api = window.api;
  return {
    get: (key: string) => api.storeGet(name, key),
    set: (key: string, value: string) => api.storeSet(name, key, value),
    remove: (key: string) => api.storeDelete(name, key),
  };
}

function createDesktopPlatform(): Platform {
  const api = window.api;
  const storage = createDesktopStorage("desktop");

  return {
    platform: "desktop",
    version: "0.1.0",
    openExternal: (url) => {
      api.openExternal(url);
    },
    notify: (title, body) => {
      api.notify(title, body);
    },
    async getServerUrl() {
      const stored = await storage.get("serverUrl");
      if (stored?.trim()) return stored.replace(/\/+$/, "");
      return (await api.getServerUrl()).replace(/\/+$/, "");
    },
    async getServerConnection() {
      const url = await Promise.resolve(this.getServerUrl());
      const token = await storage.get("authToken");
      return {
        url,
        auth: token ? { type: "bearer" as const, token } : { type: "none" as const },
        organizationId: (await storage.get("organizationId")) || "local",
        projectId: (await storage.get("projectId")) || "default",
      };
    },
    async setServerConnection(connection) {
      await Promise.all([
        api.storeSet("desktop", "serverUrl", connection.url.replace(/\/+$/, "")),
        api.storeSet("desktop", "organizationId", connection.organizationId),
        api.storeSet("desktop", "projectId", connection.projectId),
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

function onThemeApplied(detail: ThemeAppliedDetail) {
  void window.api.setBackgroundColor(detail.background);
  // Keep the hidden native titlebar surface in sync with the product canvas.
  document.documentElement.style.setProperty("--desktop-bg", detail.background);
}

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element #root not found");
}

const platform = createDesktopPlatform();

render(
  () => (
    <AppBaseProviders platform={platform} onThemeApplied={onThemeApplied}>
      <AppInterface />
    </AppBaseProviders>
  ),
  root,
);
