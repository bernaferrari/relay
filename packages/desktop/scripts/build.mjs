/**
 * Production build: main/preload (esbuild) + renderer (vite build).
 */
import { build } from "vite";
import { rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleElectron } from "./bundle-electron.mjs";
import { bundleIosPreviewSidecar } from "./bundle-ios-preview-sidecar.mjs";
import { bundleServer } from "./bundle-server.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

process.chdir(root);
await Promise.all([bundleElectron({ watch: false }), bundleServer(), bundleIosPreviewSidecar()]);
// A checkout may still contain output from the retired Solid renderer. It is
// never a supported build artifact and must not survive a production build.
rmSync(resolve(root, "out/renderer"), { recursive: true, force: true });
await build({ configFile: resolve(root, "vite.config.ts") });
console.log("[desktop] build complete → out/");
