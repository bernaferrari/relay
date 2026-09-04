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
import { desktopRendererBuildConfigs } from "./renderer-build.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

process.chdir(root);
await Promise.all([bundleElectron({ watch: false }), bundleServer(), bundleIosPreviewSidecar()]);
if (process.env.RELAY_BUILD_LEGACY !== "1") {
  // Do not leave a previous compatibility build looking like a shipped
  // renderer after a normal Product V2 build.
  rmSync(resolve(root, "out/renderer"), { recursive: true, force: true });
}
for (const configFile of desktopRendererBuildConfigs()) {
  await build({ configFile: resolve(root, configFile) });
}
if (process.env.RELAY_BUILD_LEGACY === "1") {
  console.log("[desktop] legacy Solid renderer included by RELAY_BUILD_LEGACY=1");
}
console.log("[desktop] build complete → out/");
