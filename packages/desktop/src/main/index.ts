import { app, BrowserWindow } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { registerIpcHandlers } from "./ipc.js";
import { DesktopUpdater } from "./updates.js";
import { createMainWindow, loadRenderer, resolveAppIconPath } from "./windows.js";

const DEFAULT_SERVER_URL = "http://127.0.0.1:8787";
const HEALTH_TIMEOUT_MS = 800;
const PRODUCT_NAME = "Relay";
const PRODUCT_VERSION = "0.1.0";

app.setName(PRODUCT_NAME);
process.title = PRODUCT_NAME;
if (process.platform === "win32") app.setAppUserModelId("com.relay.desktop");

let serverUrl =
  (process.env.RELAY_URL ?? process.env.GROK_DEVICE_URL)?.trim() || DEFAULT_SERVER_URL;
let serverChild: ChildProcess | null = null;
const updates = new DesktopUpdater();

async function isServerCompatible(url: string): Promise<boolean> {
  const healthUrl = new URL(`${url.replace(/\/+$/, "")}/health`);
  const request = healthUrl.protocol === "https:" ? httpsRequest : httpRequest;

  return await new Promise((resolveHealthy) => {
    const req = request(
      healthUrl,
      {
        method: "GET",
        headers: {
          "X-Relay-Actor-Id": "system:desktop-main",
          "X-Relay-Actor-Kind": "system",
          "X-Relay-Operation-Id": "system.health.get",
          "X-Relay-Request-Id": randomUUID(),
          "X-Relay-Command-At": String(Date.now()),
          "Idempotency-Key": randomUUID(),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.byteLength;
          if (bytes <= 64 * 1024) chunks.push(chunk);
        });
        response.on("end", () => {
          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
            resolveHealthy(false);
            return;
          }
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
              product?: unknown;
              version?: unknown;
            };
            resolveHealthy(body.product === "relay" && body.version === PRODUCT_VERSION);
          } catch {
            resolveHealthy(false);
          }
        });
      },
    );
    req.setTimeout(HEALTH_TIMEOUT_MS, () => {
      req.destroy();
      resolveHealthy(false);
    });
    req.on("error", () => resolveHealthy(false));
    req.end();
  });
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

async function waitForHealthy(url: string, attempts = 30, delayMs = 200): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    if (await isServerCompatible(url)) return true;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
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
    console.warn(
      `[desktop] no server at ${preferred} and could not locate packages/server — UI may fail until you run \`pnpm dev:serve\``,
    );
    return preferred;
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

  void waitForHealthy(preferred).then((ok) => {
    if (!ok) {
      console.warn(
        `[desktop] server did not become healthy at ${preferred} — connect manually with RELAY_URL or \`pnpm dev:serve\``,
      );
      return;
    }
    console.log(`[desktop] server ready at ${preferred}`);
  });
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
  app.quit();
});
