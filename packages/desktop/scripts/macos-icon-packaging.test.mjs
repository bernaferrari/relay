import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scripts = dirname(fileURLToPath(import.meta.url));
const desktop = resolve(scripts, "..");

test("macOS packaging compiles the native Relay icon before signing", () => {
  const packageJson = JSON.parse(readFileSync(resolve(desktop, "package.json"), "utf8"));
  assert.equal(packageJson.build.afterPack, "./scripts/after-pack-macos-icon.mjs");
  const compiler = readFileSync(resolve(scripts, "compile-macos-icon.mjs"), "utf8");
  assert.match(compiler, /Assets\.car/u);
  assert.match(compiler, /Relay\.icns/u);
  assert.match(compiler, /resources\/Relay\.icon/u);
  assert.match(compiler, /CFBundleIconName/u);
  assert.match(compiler, /setPlistString\("CFBundleIconName", "Relay"\)/u);
  assert.match(compiler, /CFBundleIconFile/u);
});

test("Relay leaves native macOS appearance selection to the Dock", () => {
  const main = readFileSync(resolve(desktop, "src/main/index.ts"), "utf8");
  assert.doesNotMatch(main, /app\.dock\?\.setIcon/u);
  const dev = readFileSync(resolve(scripts, "macos-dev-app.mjs"), "utf8");
  assert.match(dev, /await compileMacosIcon\(relayApp, desktopRoot\)/u);
});
