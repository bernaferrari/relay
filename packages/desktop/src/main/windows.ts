import { BrowserWindow, nativeTheme } from "electron";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

/** Grok dark background (matches @grok-device/ui theme/themes/grok.json). */
export const DARK_BG = "#050507";
export const LIGHT_BG = "#f6f6f8";

export function defaultBackgroundColor(): string {
  return nativeTheme.shouldUseDarkColors ? DARK_BG : LIGHT_BG;
}

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 800,
    minHeight: 560,
    show: false,
    title: "Specimen",
    backgroundColor: defaultBackgroundColor(),
    autoHideMenuBar: true,
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hidden" as const,
          trafficLightPosition: { x: 13, y: 14 },
        }
      : {}),
    webPreferences: {
      preload: join(root, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const fallbackShow = setTimeout(() => win.show(), 8000);
  const reveal = () => {
    clearTimeout(fallbackShow);
    win.show();
  };
  win.once("ready-to-show", reveal);
  win.webContents.on("did-fail-load", reveal);

  return win;
}

export async function loadRenderer(win: BrowserWindow): Promise<void> {
  // electron-vite injects ELECTRON_RENDERER_URL in dev
  if (process.env.ELECTRON_RENDERER_URL) {
    await win.loadURL(process.env.ELECTRON_RENDERER_URL);
    if (process.env.GROK_DEVICE_DEVTOOLS === "1") {
      win.webContents.openDevTools({ mode: "detach" });
    }
    return;
  }
  await win.loadFile(join(root, "../renderer/index.html"));
}
