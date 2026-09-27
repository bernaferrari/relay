import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ensureElectronBinary } from "./macos-dev-app.mjs";

test("ensureElectronBinary runs Electron's installer when the app bundle is missing", () => {
  const root = mkdtempSync(join(tmpdir(), "relay-electron-"));
  try {
    const cli = join(root, "cli.js");
    writeFileSync(cli, "");
    writeFileSync(
      join(root, "install.js"),
      `const { mkdirSync, writeFileSync } = require("node:fs");
       const { dirname, join } = require("node:path");
       const executable = join(__dirname, "dist/Electron.app/Contents/MacOS/Electron");
       mkdirSync(dirname(executable), { recursive: true });
       writeFileSync(executable, "");`,
    );

    const app = ensureElectronBinary(cli);

    assert.equal(app, join(root, "dist/Electron.app"));
    assert.equal(existsSync(join(app, "Contents/MacOS/Electron")), true);
    // A second call must not need the installer again.
    writeFileSync(join(root, "install.js"), "process.exit(1)");
    assert.equal(ensureElectronBinary(cli), app);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
