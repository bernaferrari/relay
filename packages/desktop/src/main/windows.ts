import { BrowserWindow, nativeTheme } from "electron";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

/**
 * Electron chrome plate — AgentBoard applyThemeCss hard plate.
 * Theme tokens paint the renderer; this only fills the native window flash.
 */
export const DARK_BG = "#080808";
export const LIGHT_BG = "#fafafa";

export function defaultBackgroundColor(): string {
  return nativeTheme.shouldUseDarkColors ? DARK_BG : LIGHT_BG;
}

export function resolveAppIconPath(): string | undefined {
  const resourceRoots = [
    process.env.RELAY_DESKTOP_ROOT ? join(process.env.RELAY_DESKTOP_ROOT, "resources") : undefined,
    join(root, "../../resources"),
    process.resourcesPath,
  ];
  const candidates = resourceRoots.flatMap((resourceRoot) =>
    resourceRoot ? [join(resourceRoot, "relay-icon.png")] : [],
  );

  return candidates.find((candidate) => existsSync(candidate));
}

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 800,
    minHeight: 560,
    show: false,
    title: "Relay",
    icon: resolveAppIconPath(),
    backgroundColor: defaultBackgroundColor(),
    autoHideMenuBar: true,
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 12, y: 18 },
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
    if (process.env.RELAY_DEVTOOLS === "1") {
      win.webContents.openDevTools({ mode: "detach" });
    }
    return;
  }
  await win.loadFile(join(root, "../renderer/index.html"));
}
