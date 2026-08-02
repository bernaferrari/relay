import { app, BrowserWindow, dialog } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { registerIpcHandlers } from "./ipc.js";
import { isCompatibleServer, waitForCompatibleServer } from "./server-readiness.js";
import { DesktopUpdater } from "./updates.js";
import { createMainWindow, loadRenderer, resolveAppIconPath } from "./windows.js";

const DEFAULT_SERVER_URL = "http://127.0.0.1:8787";
const PRODUCT_NAME = "Relay";
const PRODUCT_VERSION = "0.1.0";

const debugPort = process.env.RELAY_DEBUG_PORT?.trim();
if (debugPort && /^\d+$/.test(debugPort)) {
  // Development-only inspection of the real Electron renderer. The dev
  // launcher chooses an ephemeral port and publishes it in out/ so automation
  // never needs to guess or expose the endpoint beyond this machine.
  app.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1");
  app.commandLine.appendSwitch("remote-debugging-port", debugPort);
}

function serverProbeOptions() {
  const authorizationToken = (
    process.env.RELAY_AUTH_TOKEN ?? process.env.GROK_DEVICE_AUTH_TOKEN
  )?.trim();
  return {
    product: "relay",
    version: PRODUCT_VERSION,
    ...(authorizationToken ? { authorizationToken } : {}),
  } as const;
}

app.setName(PRODUCT_NAME);
process.title = PRODUCT_NAME;
if (process.platform === "win32") app.setAppUserModelId("com.relay.desktop");

let serverUrl =
  (process.env.RELAY_URL ?? process.env.GROK_DEVICE_URL)?.trim() || DEFAULT_SERVER_URL;
let serverChild: ChildProcess | null = null;
const updates = new DesktopUpdater();

async function isServerCompatible(url: string): Promise<boolean> {
  return await isCompatibleServer(url, serverProbeOptions());
}

function resolveServerEntry(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  // In development, the app bundle may retain a previously packaged server.
  // Prefer the workspace server so newly connected devices and source changes
  // are never hidden behind a stale Resources/server/index.cjs.
  const workspaceCandidates = [
    resolve(here, "../../../server/src/index.ts"),
    resolve(here, "../../server/src/index.ts"),
    resolve(process.cwd(), "packages/server/src/index.ts"),
    resolve(process.cwd(), "../server/src/index.ts"),
    resolve(here, "../server/index.cjs"),
  ];
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, "server/index.cjs"), ...workspaceCandidates]
    : [...workspaceCandidates, join(process.resourcesPath, "server/index.cjs")];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

/**
 * Prefer an already-running server (user ran `relay serve`).
 * Otherwise spawn packages/server via tsx/node when possible.
 */
async function ensureServer(): Promise<string> {
  const preferred =
    (process.env.RELAY_URL ?? process.env.GROK_DEVICE_URL)?.trim() || DEFAULT_SERVER_URL;

  if (await isServerCompatible(preferred)) {
    console.log(`[desktop] using existing server at ${preferred}`);
    return preferred;
  }

  const entry = resolveServerEntry();
  if (!entry) {
    throw new Error(
      `Relay could not find its local service and nothing is listening at ${preferred}. Reinstall Relay, or run \`pnpm dev:serve\` when working from source.`,
    );
  }

  const url = new URL(preferred);
  const host = url.hostname || "127.0.0.1";
  const port = url.port || "8787";

  const runner =
    app.isPackaged && entry.endsWith(".cjs")
      ? { cmd: process.execPath, args: [entry] }
      : existsSync(join(process.cwd(), "node_modules/tsx/dist/cli.mjs"))
        ? {
            cmd: process.execPath,
            args: [join(process.cwd(), "node_modules/tsx/dist/cli.mjs"), entry],
          }
        : existsSync(join(dirname(entry), "../../node_modules/tsx/dist/cli.mjs"))
          ? {
              cmd: process.execPath,
              args: [resolve(dirname(entry), "../../node_modules/tsx/dist/cli.mjs"), entry],
            }
          : { cmd: "npx", args: ["tsx", entry] };

  console.log(`[desktop] spawning server: ${runner.cmd} ${runner.args.join(" ")} --port ${port}`);

  serverChild = spawn(runner.cmd, [...runner.args, "--port", port, "--host", host], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...(runner.cmd === process.execPath && process.versions.electron
        ? { ELECTRON_RUN_AS_NODE: "1" }
        : {}),
    },
    detached: false,
  });

  serverChild.stdout?.on("data", (buf: Buffer) => {
    console.log(`[server] ${buf.toString().trimEnd()}`);
  });
  serverChild.stderr?.on("data", (buf: Buffer) => {
    console.error(`[server] ${buf.toString().trimEnd()}`);
  });
  serverChild.on("exit", (code, signal) => {
    console.warn(`[desktop] server process exited code=${code} signal=${signal}`);
    serverChild = null;
  });

  const child = serverChild;
  const failedToStart = new Promise<never>((_resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      reject(
        new Error(
          `Relay's local service exited before it was ready (code=${code ?? "none"}, signal=${signal ?? "none"}).`,
        ),
      );
    });
  });
  const healthy = await Promise.race([
    waitForCompatibleServer(preferred, serverProbeOptions()),
    failedToStart,
  ]);
  if (!healthy) {
    killServerChild();
    throw new Error(
      `Relay's local service did not become ready at ${preferred}. Check the desktop logs, or run \`pnpm dev:serve\` when working from source.`,
    );
  }
  console.log(`[desktop] server ready at ${preferred}`);
  return preferred;
}

function killServerChild(): void {
  if (!serverChild || serverChild.killed) return;
  try {
    serverChild.kill("SIGTERM");
  } catch {
    // ignore
  }
  serverChild = null;
}

async function bootstrap(): Promise<void> {
  // Single instance lock
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return;
  }

  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  await app.whenReady();

  const iconPath = resolveAppIconPath();
  if (iconPath && process.platform === "darwin") {
    try {
      app.dock?.setIcon(iconPath);
    } catch (error) {
      console.warn(`[desktop] could not set Dock icon from ${iconPath}`, error);
    }
  }

  serverUrl = await ensureServer();

  registerIpcHandlers({
    getServerUrl: () => serverUrl,
    updates,
  });
  updates.start();

  const win = createMainWindow();
  console.log("[desktop] window created");
  await loadRenderer(win);
  console.log("[desktop] renderer loaded");

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const w = createMainWindow();
      void loadRenderer(w);
    }
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  updates.stop();
  killServerChild();
});

bootstrap().catch((err: unknown) => {
  console.error("[desktop] failed to start", err);
  const message = err instanceof Error ? err.message : String(err);
  if (app.isReady()) dialog.showErrorBox("Relay couldn’t start", message);
  app.quit();
});
