import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildIosPreviewSidecar } from "../../../scripts/ios-preview-sidecar.mjs";

const desktopRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workspaceRoot = resolve(desktopRoot, "../..");

/**
 * Build Relay's reviewed iOS pixel producer before electron-builder copies it
 * into Contents/Resources. The result is exactly one target-native Mach-O plus
 * a content-addressed manifest; electron-builder can then sign that same
 * executable with its matching app target.
 */
export async function bundleIosPreviewSidecar({ arch = process.arch } = {}) {
  const outputDir = resolve(desktopRoot, "out", "ios-preview");
  const manifest = await buildIosPreviewSidecar({ root: workspaceRoot, outputDir, arch });
  console.log(`[desktop] bundled safe iOS preview sidecar (${arch})`);
  return manifest;
}
