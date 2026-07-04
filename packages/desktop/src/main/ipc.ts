import {
  app,
  BrowserWindow,
  Notification,
  ipcMain,
  shell,
  type IpcMainInvokeEvent,
} from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const storeCache = new Map<string, Record<string, string>>();

function storeDir(): string {
  return join(app.getPath("userData"), "stores");
}

function storeFile(name: string): string {
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, "_");
  return join(storeDir(), `${safe}.json`);
}

function loadStore(name: string): Record<string, string> {
  const cached = storeCache.get(name);
  if (cached) return cached;
  let data: Record<string, string> = {};
  try {
    const path = storeFile(name);
    if (existsSync(path)) {
      const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        data = Object.fromEntries(
          Object.entries(raw as Record<string, unknown>).map(([k, v]) => [
            k,
            typeof v === "string" ? v : JSON.stringify(v),
          ]),
        );
      }
    }
  } catch {
    data = {};
  }
  storeCache.set(name, data);
  return data;
}

function persistStore(name: string): void {
  mkdirSync(storeDir(), { recursive: true });
  writeFileSync(storeFile(name), JSON.stringify(loadStore(name), null, 2), "utf8");
}

export type IpcDeps = {
  getServerUrl: () => Promise<string> | string;
};

export function registerIpcHandlers(deps: IpcDeps): void {
  ipcMain.handle("store-get", (_event: IpcMainInvokeEvent, name: string, key: string) => {
    const store = loadStore(name);
    return store[key] ?? null;
  });

  ipcMain.handle(
    "store-set",
    (_event: IpcMainInvokeEvent, name: string, key: string, value: string) => {
      const store = loadStore(name);
      store[key] = value;
      persistStore(name);
    },
  );

  ipcMain.handle("store-delete", (_event: IpcMainInvokeEvent, name: string, key: string) => {
    const store = loadStore(name);
    delete store[key];
    persistStore(name);
  });

  ipcMain.handle("open-external", (_event: IpcMainInvokeEvent, url: string) => {
    void shell.openExternal(url);
  });

  ipcMain.on("open-external", (_event, url: string) => {
    void shell.openExternal(url);
  });

  ipcMain.handle("notify", (_event: IpcMainInvokeEvent, title: string, body?: string) => {
    if (Notification.isSupported()) {
      new Notification({ title, body }).show();
    }
  });

  ipcMain.on("notify", (_event, title: string, body?: string) => {
    if (Notification.isSupported()) {
      new Notification({ title, body }).show();
    }
  });

  ipcMain.handle("get-server-url", () => deps.getServerUrl());

  ipcMain.handle("get-window-focused", (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win?.isFocused() ?? false;
  });

  ipcMain.handle("set-background-color", (event: IpcMainInvokeEvent, color: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.setBackgroundColor(color);
  });
}
