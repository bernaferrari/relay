/**
 * Production build: main/preload (esbuild) + renderer (vite build).
 */
import { build } from "vite";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleElectron } from "./bundle-electron.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

process.chdir(root);
await bundleElectron({ watch: false });
await build({ configFile: resolve(root, "vite.config.ts") });
console.log("[desktop] build complete → out/");
