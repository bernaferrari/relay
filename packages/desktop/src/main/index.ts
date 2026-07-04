import { app, BrowserWindow } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { registerIpcHandlers } from "./ipc.js";
import { createMainWindow, loadRenderer } from "./windows.js";

const DEFAULT_SERVER_URL = "http://127.0.0.1:8787";
const HEALTH_TIMEOUT_MS = 800;

let serverUrl = process.env.GROK_DEVICE_URL?.trim() || DEFAULT_SERVER_URL;
let serverChild: ChildProcess | null = null;

async function isServerHealthy(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const res = await fetch(`${url.replace(/\/+$/, "")}/health`, {
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function resolveServerEntry(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  // monorepo: packages/desktop/out/main → packages/server/src/index.ts
  // or packages/desktop/src/main during unbundled runs
  const candidates = [
    resolve(here, "../../../server/src/index.ts"),
    resolve(here, "../../server/src/index.ts"),
    resolve(process.cwd(), "packages/server/src/index.ts"),
    resolve(process.cwd(), "../server/src/index.ts"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

async function waitForHealthy(url: string, attempts = 30, delayMs = 200): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    if (await isServerHealthy(url)) return true;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}

/**
 * Prefer an already-running server (user ran `grok-device serve`).
 * Otherwise spawn packages/server via tsx/node when possible.
 */
async function ensureServer(): Promise<string> {
  const preferred = process.env.GROK_DEVICE_URL?.trim() || DEFAULT_SERVER_URL;

  if (await isServerHealthy(preferred)) {
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

  const runner = existsSync(join(process.cwd(), "node_modules/tsx/dist/cli.mjs"))
    ? { cmd: process.execPath, args: [join(process.cwd(), "node_modules/tsx/dist/cli.mjs"), entry] }
    : existsSync(join(dirname(entry), "../../node_modules/tsx/dist/cli.mjs"))
      ? {
          cmd: process.execPath,
          args: [resolve(dirname(entry), "../../node_modules/tsx/dist/cli.mjs"), entry],
        }
      : { cmd: "npx", args: ["tsx", entry] };

  console.log(`[desktop] spawning server: ${runner.cmd} ${runner.args.join(" ")} --port ${port}`);

  serverChild = spawn(runner.cmd, [...runner.args, "--port", port, "--host", host], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
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

  const ok = await waitForHealthy(preferred);
  if (!ok) {
    console.warn(
      `[desktop] server did not become healthy at ${preferred} — connect manually with GROK_DEVICE_URL or \`pnpm dev:serve\``,
    );
  } else {
    console.log(`[desktop] server ready at ${preferred}`);
  }
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

  serverUrl = await ensureServer();

  registerIpcHandlers({
    getServerUrl: () => serverUrl,
  });

  const win = createMainWindow();
  await loadRenderer(win);

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
  killServerChild();
});

bootstrap().catch((err: unknown) => {
  console.error("[desktop] failed to start", err);
  app.quit();
});
