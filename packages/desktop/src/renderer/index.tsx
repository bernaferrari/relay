import { render } from "solid-js/web";
import {
  AppBaseProviders,
  AppInterface,
  type Platform,
  type PlatformStorage,
} from "@grok-device/app";
import "@grok-device/ui/styles";
import "./styles.css";

function createDesktopStorage(name = "default"): PlatformStorage {
  const api = window.api;
  return {
    get: (key) => api.storeGet(name, key),
    set: (key, value) => api.storeSet(name, key, value),
    remove: (key) => api.storeDelete(name, key),
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
    setServerUrl(url) {
      return api.storeSet("desktop", "serverUrl", url.replace(/\/+$/, ""));
    },
    storage,
  };
}

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element #root not found");
}

const platform = createDesktopPlatform();

render(
  () => (
    <AppBaseProviders platform={platform}>
      <AppInterface />
    </AppBaseProviders>
  ),
  root,
);
