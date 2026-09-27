import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("desktop loads the product renderer", () => {
  const windows = readFileSync(join(root, "main/windows.ts"), "utf8");
  const entry = readFileSync(join(root, "renderer/index.tsx"), "utf8");
  const vite = readFileSync(join(root, "../vite.config.ts"), "utf8");
  const manifest = JSON.parse(readFileSync(join(root, "../package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
  };
  assert.match(windows, /renderer\/index\.html/);
  assert.match(vite, /src\/renderer\/public/);
  assert.match(entry, /from ["']@relay\/app["']/);
  assert.equal(manifest.dependencies?.["@relay/app"], "workspace:*");
});
