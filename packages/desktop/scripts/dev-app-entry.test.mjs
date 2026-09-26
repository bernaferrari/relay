import assert from "node:assert/strict";
import { test } from "node:test";
import { realpathSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { writeDevAppEntry } from "./dev-app-entry.mjs";

test("app entry opens the workspace main without arguments or inherited cwd/env", () => {
  const root = mkdtempSync(join(tmpdir(), "relay launch ' "));
  try {
    mkdirSync(join(root, "out/main"), { recursive: true });
    writeFileSync(
      join(root, "out/main/index.js"),
      "console.log(JSON.stringify({cwd:process.cwd(),url:process.env.ELECTRON_RENDERER_URL}))",
    );
    writeDevAppEntry(join(root, "Resources"), root, {
      ELECTRON_RENDERER_URL: "data:text/plain,renderer",
    });
    const result = spawnSync(process.execPath, [join(root, "Resources/app/index.cjs")], {
      cwd: tmpdir(),
      env: {},
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      cwd: realpathSync(root),
      url: "data:text/plain,renderer",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cold entry starts development services and waits before quitting the launcher", () => {
  const root = mkdtempSync(join(tmpdir(), "relay-cold-launch-"));
  try {
    mkdirSync(join(root, "out"), { recursive: true });
    mkdirSync(join(root, "scripts"));
    writeFileSync(
      join(root, "scripts/dev.mjs"),
      `import { writeFileSync } from 'node:fs'; writeFileSync('out/desktop-inspection.json', '{}');`,
    );
    writeDevAppEntry(join(root, "Resources"), root, {
      RELAY_DEV_NODE: process.execPath,
      ELECTRON_RENDERER_URL: "invalid-url",
    });
    const electron = join(root, "Resources/app/node_modules/electron");
    mkdirSync(electron, { recursive: true });
    writeFileSync(
      join(electron, "index.js"),
      `module.exports = { app: { whenReady: async () => {}, quit: () => { console.log('opened'); process.exit(0); } }, dialog: { showErrorBox: () => process.exit(1) } };`,
    );
    const result = spawnSync(process.execPath, [join(root, "Resources/app/index.cjs")], {
      cwd: tmpdir(),
      env: {},
      encoding: "utf8",
      timeout: 5000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "opened");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("built preview opens Relay without a dev server or inherited renderer URL", () => {
  const root = mkdtempSync(join(tmpdir(), "relay-built-preview-"));
  try {
    mkdirSync(join(root, "out/main"), { recursive: true });
    writeFileSync(join(root, "out/main/index.js"), "console.log('built Relay')");
    writeDevAppEntry(join(root, "Resources"), root, { ELECTRON_RENDERER_URL: "" });
    const result = spawnSync(process.execPath, [join(root, "Resources/app/index.cjs")], {
      cwd: tmpdir(),
      env: { ELECTRON_RENDERER_URL: "http://stale-renderer.invalid" },
      encoding: "utf8",
      timeout: 5000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "built Relay");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
