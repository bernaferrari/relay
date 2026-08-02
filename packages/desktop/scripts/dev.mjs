/**
 * Dev: esbuild (main/preload) + Vite+ (renderer) + Electron.
 * Avoids electron-vite, which is incompatible with vite-plus-core.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { createServer } from "vite";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleElectron } from "./bundle-electron.mjs";
import { prepareMacOSDevApp } from "./macos-dev-app.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const inspectionManifest = resolve(root, "out/desktop-inspection.json");

function resolveElectronCli() {
  try {
    return fileURLToPath(import.meta.resolve("electron/cli.js"));
  } catch {
    const candidates = [
      resolve(root, "node_modules/electron/cli.js"),
      resolve(root, "../../node_modules/electron/cli.js"),
    ];
    for (const c of candidates) {
      if (existsSync(c)) return c;
    }
    throw new Error("electron package not found — run pnpm install");
  }
}

/**
 * Each desktop development session owns its Relay server. Reusing :8787 is
 * handy for production and the CLI, but it can silently attach Electron to a
 * server started before the current source changes were compiled.
 */
async function reserveLoopbackPort() {
  return await new Promise((resolvePort, reject) => {
    const listener = createNetServer();
    listener.once("error", reject);
    listener.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = listener.address();
      if (!address || typeof address === "string") {
        listener.close();
        reject(new Error("Could not reserve a loopback port for Relay"));
        return;
      }
      const { port } = address;
      listener.close((error) => (error ? reject(error) : resolvePort(port)));
    });
  });
}

async function main() {
  process.chdir(root);

  const watchers = await bundleElectron({ watch: true });

  const server = await createServer({
    configFile: resolve(root, "vite.config.ts"),
    server: {
      strictPort: false,
    },
  });
  await server.listen();
  const urls = server.resolvedUrls?.local ?? [];
  const rendererUrl = urls[0] ?? "http://127.0.0.1:5173/";
  console.log(`[desktop] renderer ${rendererUrl}`);

  const relayPort = await reserveLoopbackPort();
  const relayUrl = `http://127.0.0.1:${relayPort}`;
  console.log(`[desktop] Relay server ${relayUrl}`);

  // The dev app exposes Chromium's loopback-only DevTools Protocol so visual
  // inspection drives the real Electron renderer (preload, IPC, and all), not
  // a browser approximation. A fresh port avoids collisions between sessions.
  const debugPort = await reserveLoopbackPort();
  const debugUrl = `http://127.0.0.1:${debugPort}`;
  console.log(`[desktop] inspector ${debugUrl}`);

  const electronCliPath = resolveElectronCli();
  const executable =
    process.platform === "darwin" ? prepareMacOSDevApp(electronCliPath, root) : process.execPath;
  const args = process.platform === "darwin" ? ["."] : [electronCliPath, "."];
  if (process.platform === "darwin") {
    console.log(`[desktop] macOS app ${resolve(root, "out/Relay.app")}`);
  }
  const child = spawn(executable, args, {
    cwd: root,
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: rendererUrl,
      RELAY_DESKTOP_ROOT: root,
      RELAY_URL: relayUrl,
      RELAY_DEBUG_PORT: String(debugPort),
    },
    stdio: "inherit",
  });
  mkdirSync(dirname(inspectionManifest), { recursive: true });
  writeFileSync(
    inspectionManifest,
    `${JSON.stringify(
      {
        version: 1,
        pid: child.pid,
        debugUrl,
        rendererUrl,
        relayUrl,
        startedAt: Date.now(),
      },
      null,
      2,
    )}\n`,
  );
  console.log(`[desktop] inspection manifest ${inspectionManifest}`);

  let shuttingDown = false;
  const waitForExit = (timeoutMs) =>
    new Promise((resolveExit) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolveExit();
        return;
      }
      const timer = setTimeout(resolveExit, timeoutMs);
      child.once("exit", () => {
        clearTimeout(timer);
        resolveExit();
      });
    });
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    await waitForExit(3_000);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await waitForExit(1_000);
    }
    rmSync(inspectionManifest, { force: true });
    await Promise.all([server.close(), watchers.mainCtx.dispose(), watchers.preloadCtx.dispose()]);
  };
  process.on("SIGINT", () => void shutdown().finally(() => process.exit(0)));
  process.on("SIGTERM", () => void shutdown().finally(() => process.exit(0)));

  child.on("exit", (code, signal) => {
    rmSync(inspectionManifest, { force: true });
    console.log(`[desktop] app exited code=${code ?? "none"} signal=${signal ?? "none"}`);
    if (!shuttingDown) void shutdown().finally(() => process.exit(code ?? 0));
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
