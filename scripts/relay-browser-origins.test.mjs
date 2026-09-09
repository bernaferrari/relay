import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  persistConfiguredBrowserOrigins,
  resolveBrowserOrigins,
} from "./relay-browser-origins.mjs";

test("preserves and resolves an exact launcher allowlist", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "relay-browser-origins-"));
  assert.deepEqual(
    persistConfiguredBrowserOrigins(stateDir, "http://localhost:3000, http://127.0.0.1:3000"),
    ["http://localhost:3000", "http://127.0.0.1:3000"],
  );
  assert.deepEqual(resolveBrowserOrigins(stateDir, undefined), [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ]);
  assert.match(
    readFileSync(join(stateDir, "server-browser-origins.json"), "utf8"),
    /schemaVersion/,
  );
});

test("rejects wildcard and non-origin values", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "relay-browser-origins-"));
  assert.throws(() => persistConfiguredBrowserOrigins(stateDir, "*"), /exact HTTP\(S\) origin/u);
  assert.throws(
    () => persistConfiguredBrowserOrigins(stateDir, "http://localhost:3000/path"),
    /exact HTTP\(S\) origin/u,
  );
  assert.throws(() => persistConfiguredBrowserOrigins(stateDir, "file:///tmp/app"), /HTTP\(S\)/u);
});

test("explicitly empty configuration clears a previously persisted allowlist", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "relay-browser-origins-"));
  persistConfiguredBrowserOrigins(stateDir, "http://localhost:3000");
  assert.deepEqual(resolveBrowserOrigins(stateDir, ""), []);
  assert.deepEqual(resolveBrowserOrigins(stateDir, undefined), []);
});
