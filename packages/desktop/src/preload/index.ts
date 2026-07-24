import { contextBridge, ipcRenderer } from "electron";
import type { ElectronAPI } from "./types";

const api: ElectronAPI = {
  storeGet: (name, key) => ipcRenderer.invoke("store-get", name, key),
  storeSet: (name, key, value) => ipcRenderer.invoke("store-set", name, key, value),
  storeDelete: (name, key) => ipcRenderer.invoke("store-delete", name, key),

  openExternal: (url) => {
    void ipcRenderer.invoke("open-external", url);
  },

  notify: (title, body) => {
    void ipcRenderer.invoke("notify", title, body);
  },

  copyImage: (base64, mime) => ipcRenderer.invoke("clipboard-write-image", base64, mime),

  getServerUrl: () => ipcRenderer.invoke("get-server-url"),

  getWindowFocused: () => ipcRenderer.invoke("get-window-focused"),

  setBackgroundColor: (color) => ipcRenderer.invoke("set-background-color", color),

  updates: {
    getState: () => ipcRenderer.invoke("updates:get-state"),
    check: () => ipcRenderer.invoke("updates:check"),
    install: () => ipcRenderer.invoke("updates:install"),
    onState: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, state: Parameters<typeof listener>[0]) =>
        listener(state);
      ipcRenderer.on("updates:state", handler);
      return () => ipcRenderer.removeListener("updates:state", handler);
    },
  },
};

contextBridge.exposeInMainWorld("api", api);
