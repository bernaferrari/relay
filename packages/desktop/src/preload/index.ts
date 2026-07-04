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

  getServerUrl: () => ipcRenderer.invoke("get-server-url"),

  getWindowFocused: () => ipcRenderer.invoke("get-window-focused"),

  setBackgroundColor: (color) => ipcRenderer.invoke("set-background-color", color),
};

contextBridge.exposeInMainWorld("api", api);
