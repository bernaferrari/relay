#!/usr/bin/env node
/**
 * Build Relay's pixels-only iOS point-tap helper (CoreDevice Universal HID).
 *
 * Local artifact: never committed. Point taps fail closed if the binary is
 * missing — they must not fall back to XCTest or `ios ui`.
 */
import { existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "packages", "ios-hid-tap");
const configured = process.env.RELAY_IOS_HID_TAP_BIN?.trim();
const output = configured || join(root, ".relay", "bin", "relay-ios-hid-tap");

if (!existsSync(join(source, "go.mod"))) {
  throw new Error(`iOS HID tap source is missing: ${source}`);
}

mkdirSync(dirname(output), { recursive: true });
const result = spawnSync("go", ["build", "-o", output, "."], {
  cwd: source,
  stdio: "inherit",
  env: process.env,
});
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
process.stdout.write(`${JSON.stringify({ status: "built", output })}\n`);
