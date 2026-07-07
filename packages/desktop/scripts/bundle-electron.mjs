/**
 * Bundle Electron main + preload with esbuild (Vite+ has no electron-vite support).
 */
import * as esbuild from "esbuild";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const shared = {
  bundle: true,
  platform: "node",
  target: "node22",
  sourcemap: true,
  logLevel: "info",
  external: ["electron"],
};

export async function bundleElectron({ watch = false } = {}) {
  mkdirSync(resolve(root, "out/main"), { recursive: true });
  mkdirSync(resolve(root, "out/preload"), { recursive: true });

  const main = {
    ...shared,
    entryPoints: [resolve(root, "src/main/index.ts")],
    outfile: resolve(root, "out/main/index.js"),
    format: "esm",
    banner: {
      // electron main often needs import.meta.url for path resolution
      js: "",
    },
  };

  const preload = {
    ...shared,
    entryPoints: [resolve(root, "src/preload/index.ts")],
    outfile: resolve(root, "out/preload/index.js"),
    format: "cjs",
  };

  if (watch) {
    const mainCtx = await esbuild.context(main);
    const preloadCtx = await esbuild.context(preload);
    await Promise.all([mainCtx.watch(), preloadCtx.watch()]);
    console.log("[desktop] watching main + preload");
    return { mainCtx, preloadCtx };
  }

  await Promise.all([esbuild.build(main), esbuild.build(preload)]);
  console.log("[desktop] built main + preload");
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const watch = process.argv.includes("--watch");
  await bundleElectron({ watch });
  if (!watch) process.exit(0);
}
