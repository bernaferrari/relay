import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRelayExtensionModules, relayExtensionModuleSpecifiers } from "./server-extensions.js";

test("extension specifiers parse a comma separated explicit host list", () => {
  assert.deepEqual(relayExtensionModuleSpecifiers(" @acme/one, ./local-extension.mjs,,"), [
    "@acme/one",
    "./local-extension.mjs",
  ]);
  assert.deepEqual(relayExtensionModuleSpecifiers(undefined), []);
});

test("relative extension modules load from the host cwd and register once", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-extension-test-"));
  try {
    const marker = join(directory, "registered.txt");
    await writeFile(
      join(directory, "extension.mjs"),
      `import { writeFile } from "node:fs/promises";\nexport async function registerRelayExtension() { await writeFile(${JSON.stringify(marker)}, "yes"); }\n`,
    );
    await loadRelayExtensionModules(["./extension.mjs"], { cwd: directory });
    assert.equal(await readFile(marker, "utf8"), "yes");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("extension modules fail closed when they do not expose registration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-extension-test-"));
  try {
    await writeFile(join(directory, "extension.mjs"), "export const value = 1;\n");
    await assert.rejects(
      loadRelayExtensionModules(["./extension.mjs"], { cwd: directory }),
      /must export registerRelayExtension/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
