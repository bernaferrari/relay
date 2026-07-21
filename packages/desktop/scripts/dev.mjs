/**
 * Dev: esbuild (main/preload) + Vite+ (renderer) + Electron.
 * Avoids electron-vite, which is incompatible with vite-plus-core.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "vite";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleElectron } from "./bundle-electron.mjs";
import { prepareMacOSDevApp } from "./macos-dev-app.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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

async function main() {
  process.chdir(root);

  await bundleElectron({ watch: true });

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
    },
    stdio: "inherit",
  });

  const shutdown = async () => {
    if (!child.killed) child.kill("SIGTERM");
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  child.on("exit", (code, signal) => {
    console.log(`[desktop] app exited code=${code ?? "none"} signal=${signal ?? "none"}`);
    void server.close().finally(() => process.exit(code ?? 0));
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
