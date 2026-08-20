#!/usr/bin/env node
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildIosPreviewSidecar } from "./ios-preview-sidecar.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = process.env.RELAY_IOS_PREVIEW_SIDECAR_DIR?.trim()
  ? process.env.RELAY_IOS_PREVIEW_SIDECAR_DIR.trim()
  : join(root, "packages", "desktop", "out", "ios-preview");
const arch = process.env.RELAY_IOS_PREVIEW_SIDECAR_ARCH?.trim() || process.arch;

const manifest = await buildIosPreviewSidecar({ root, outputDir, arch });
process.stdout.write(
  `${JSON.stringify({
    status: "built",
    outputDir,
    source: manifest.source,
    artifacts: manifest.artifacts.map(({ arch, buildBytes, buildSha256 }) => ({
      arch,
      buildBytes,
      buildSha256,
    })),
  })}\n`,
);
