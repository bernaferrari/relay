#!/usr/bin/env node
/**
 * Build Relay's safe, pixel-only iOS preview producer.
 *
 * The output is intentionally local: it is tied to the host's Go toolchain and
 * is never committed beside source or device credentials. Relay will never
 * fall back to go-ios's unsafe `screenshot --stream` implementation when this
 * binary is absent.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildReviewedIosPreviewBinary } from "./ios-preview-sidecar.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "packages", "ios-preview-producer");
const configured = process.env.RELAY_IOS_PREVIEW_PRODUCER_BIN?.trim();
const output = configured || join(root, ".relay", "bin", "relay-ios-preview");

if (!existsSync(join(source, "go.mod"))) {
  throw new Error(`iOS preview producer source is missing: ${source}`);
}

const artifact = await buildReviewedIosPreviewBinary({ root, source, output });
process.stdout.write(`${JSON.stringify({ status: "built", output, artifact })}\n`);
