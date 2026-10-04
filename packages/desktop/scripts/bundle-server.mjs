import * as esbuild from "esbuild";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyAndroidAppInventory } from "../../../scripts/build-android-app-inventory.mjs";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(desktopRoot, "../..");

/** Bundle the local control plane with the desktop artifact. Electron runs this
 * file as a plain Node child, so a packaged Relay app never reaches into the
 * monorepo or invokes npx. */
export async function bundleServer() {
  const outDir = resolve(desktopRoot, "out/server");
  await mkdir(outDir, { recursive: true });
  await rm(resolve(outDir, "index.mjs"), { force: true });
  await rm(resolve(outDir, "index.mjs.map"), { force: true });
  await rm(resolve(outDir, "node_modules"), { force: true, recursive: true });
  await esbuild.build({
    entryPoints: [resolve(workspaceRoot, "packages/server/src/index.ts")],
    outfile: resolve(outDir, "index.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    // Chromium's optional BiDi bridge is initialized only for BiDi-over-CDP.
    // Relay uses Playwright's regular Chromium transport, so keep those optional
    // requires lazy without making the whole Playwright runtime external.
    external: [
      "fsevents",
      "chromium-bidi/lib/cjs/bidiMapper/BidiMapper",
      "chromium-bidi/lib/cjs/cdp/CdpConnection",
    ],
    banner: {
      js: 'const __relayImportMetaUrl = require("node:url").pathToFileURL(__filename).href;',
    },
    define: { "import.meta.url": "__relayImportMetaUrl" },
    sourcemap: true,
    logLevel: "info",
  });
  await copyFile(
    resolve(
      workspaceRoot,
      "packages/server/node_modules/@yume-chan/fetch-scrcpy-server/server.bin",
    ),
    resolve(outDir, "server.bin"),
  );
  const inventory = await verifyAndroidAppInventory();
  const inventorySource = resolve(workspaceRoot, "packages/core/android-helpers/app-inventory");
  const inventoryTarget = resolve(outDir, "android-helpers/app-inventory");
  await mkdir(inventoryTarget, { recursive: true });
  await copyFile(
    resolve(inventorySource, inventory.assetName),
    resolve(inventoryTarget, inventory.assetName),
  );
  const inventoryManifest = inventory.assetName.replace(/\.apk$/u, ".manifest.json");
  await copyFile(
    resolve(inventorySource, inventoryManifest),
    resolve(inventoryTarget, inventoryManifest),
  );
  // Playwright derives its package root from the generated bundle directory
  // and reads this metadata during module initialization.
  const playwrightPackage = JSON.parse(
    await readFile(resolve(desktopRoot, "node_modules/playwright-core/package.json"), "utf8"),
  );
  await writeFile(
    resolve(outDir, "../package.json"),
    `${JSON.stringify({ ...playwrightPackage, type: "module" }, null, 2)}\n`,
  );
  await copyFile(
    resolve(desktopRoot, "node_modules/playwright-core/browsers.json"),
    resolve(outDir, "../browsers.json"),
  );
  console.log("[desktop] bundled local server");
}
