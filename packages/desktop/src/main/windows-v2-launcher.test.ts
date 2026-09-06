import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("desktop loads only the Product V2 renderer", () => {
  const windows = readFileSync(join(root, "main/windows.ts"), "utf8");
  const entry = readFileSync(join(root, "renderer-v2/index.tsx"), "utf8");
  const vite = readFileSync(join(root, "../vite.v2.config.ts"), "utf8");
  const manifest = JSON.parse(readFileSync(join(root, "../package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
  };
  assert.match(windows, /renderer-v2\/index\.html/);
  assert.doesNotMatch(windows, /loadFile\([^)]*renderer\/index\.html/);
  assert.match(vite, /src\/renderer-v2\/public/);
  assert.doesNotMatch(vite, /src\/renderer\/public/);
  assert.equal(existsSync(join(root, "renderer")), false);
  assert.match(entry, /@relay\/app-v2/);
  assert.doesNotMatch(entry, /from ["']@relay\/app["']/);
  assert.equal(manifest.dependencies?.["@relay/app-v2"], "workspace:*");
  assert.equal(manifest.dependencies?.["@relay/app"], undefined);
});
