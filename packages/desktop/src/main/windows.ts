import { app, BrowserWindow, nativeTheme, screen } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { clampWindowBounds, parseWindowState, type PersistedWindowState } from "./window-state.js";

const root = dirname(fileURLToPath(import.meta.url));

/**
 * Native window flash before the renderer paints. Matches ui-react
 * `--background` (light oklch(1 0 0), dark oklch(0.145 0 0)).
 */
export const DARK_BG = "#252525";
export const LIGHT_BG = "#ffffff";
const DEFAULT_WINDOW_SIZE = { width: 1100, height: 760 };
const WINDOW_STATE_DEBOUNCE_MS = 250;

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

function windowStatePath(): string {
  return join(app.getPath("userData"), "window-state.json");
}

function loadWindowState(): PersistedWindowState | null {
  const path = windowStatePath();
  try {
    if (!existsSync(path)) return null;
    const state = parseWindowState(readFileSync(path, "utf8"));
    if (!state) console.warn(`[desktop] ignored invalid window state at ${path}`);
    return state;
  } catch (error) {
    console.warn(`[desktop] could not restore window state from ${path}`, error);
    return null;
  }
}

function persistWindowState(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  const path = windowStatePath();
  const state: PersistedWindowState = {
    version: 1,
    // Maximizing must not replace the user's preferred normal window size.
    bounds: win.getNormalBounds(),
    maximized: win.isMaximized(),
  };
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(state, null, 2), "utf8");
  } catch (error) {
    console.warn(`[desktop] could not persist window state to ${path}`, error);
  }
}

function trackWindowState(win: BrowserWindow): void {
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const clearSaveTimer = () => {
    if (!saveTimer) return;
    clearTimeout(saveTimer);
    saveTimer = undefined;
  };
  const save = () => {
    clearSaveTimer();
    persistWindowState(win);
  };
  const scheduleSave = () => {
    clearSaveTimer();
    saveTimer = setTimeout(save, WINDOW_STATE_DEBOUNCE_MS);
    saveTimer.unref();
  };

  win.on("move", scheduleSave);
  win.on("resize", scheduleSave);
  win.on("maximize", scheduleSave);
  win.on("unmaximize", scheduleSave);
  win.once("close", save);
  win.once("closed", clearSaveTimer);
}

export function createMainWindow(): BrowserWindow {
  const savedState = loadWindowState();
  const savedBounds = savedState
    ? clampWindowBounds(
        savedState.bounds,
        screen.getAllDisplays().map((display) => display.workArea),
      )
    : null;
  const win = new BrowserWindow({
    ...(savedBounds ?? DEFAULT_WINDOW_SIZE),
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

  if (savedState?.maximized) win.maximize();
  trackWindowState(win);

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
