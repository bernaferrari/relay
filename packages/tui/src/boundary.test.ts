import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const sourceDirectory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = resolve(sourceDirectory, "..");
const forbiddenImport = /\b(?:from\s+|import\s*\(\s*)["']@relay\/(?:core|server)(?:\/[^"']*)?["']/;

test("TUI production source does not import Relay core or server", async () => {
  const sourceFiles = (await readdir(sourceDirectory)).filter(
    (name) => name.endsWith(".ts") && !name.endsWith(".test.ts"),
  );

  for (const sourceFile of sourceFiles) {
    const source = await readFile(join(sourceDirectory, sourceFile), "utf8");
    assert.doesNotMatch(source, forbiddenImport, sourceFile);
  }
});

test("TUI manifest does not depend on Relay core or server", async () => {
  const manifest = JSON.parse(await readFile(join(packageDirectory, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };

  assert.equal(dependencies["@relay/core"], undefined);
  assert.equal(dependencies["@relay/server"], undefined);
});
