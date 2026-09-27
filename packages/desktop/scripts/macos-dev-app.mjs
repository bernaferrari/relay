import { existsSync, renameSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { writeDevAppEntry } from "./dev-app-entry.mjs";
import { compileMacosIcon } from "./compile-macos-icon.mjs";

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`;
    throw new Error(`${command} ${args.join(" ")} failed: ${detail}`);
  }
}

/**
 * Electron 44 ships no postinstall script. `require("electron")` downloads the
 * binary on first use, but dev launches the app bundle directly and never
 * loads that entry. Fetch it when the bundle is absent.
 */
export function ensureElectronBinary(electronCliPath) {
  const electronRoot = dirname(electronCliPath);
  const electronApp = resolve(electronRoot, "dist/Electron.app");
  const executable = resolve(electronApp, "Contents/MacOS/Electron");
  if (existsSync(executable)) return electronApp;

  const installScript = resolve(electronRoot, "install.js");
  if (!existsSync(installScript)) {
    throw new Error(`Electron.app not found at ${electronApp}`);
  }
  console.log("[desktop] Electron binary missing — downloading");
  const result = spawnSync(process.execPath, [installScript], { stdio: "inherit" });
  if (result.status !== 0 || !existsSync(executable)) {
    throw new Error(`Electron.app not found at ${electronApp}. Re-run: node ${installScript}`);
  }
  return electronApp;
}

/**
 * Build a project-local macOS app bundle for development. APFS clone-copying
 * preserves Electron's complete, working bundle without physically duplicating
 * its frameworks, then Relay supplies its own identity and icon.
 */
export async function prepareMacOSDevApp(electronCliPath, desktopRoot, environment = {}) {
  const electronApp = ensureElectronBinary(electronCliPath);
  const relayApp = resolve(desktopRoot, "out/Relay.app");
  const plist = resolve(relayApp, "Contents/Info.plist");
  const electronExecutable = resolve(relayApp, "Contents/MacOS/Electron");
  const relayExecutable = resolve(relayApp, "Contents/MacOS/Relay");

  rmSync(relayApp, { force: true, recursive: true });
  run("/bin/cp", ["-cR", electronApp, relayApp]);
  run("/usr/bin/plutil", ["-replace", "CFBundleDisplayName", "-string", "Relay", plist]);
  run("/usr/bin/plutil", ["-replace", "CFBundleName", "-string", "Relay", plist]);
  run("/usr/bin/plutil", ["-replace", "CFBundleExecutable", "-string", "Relay", plist]);
  run("/usr/bin/plutil", ["-replace", "CFBundleIdentifier", "-string", "dev.relay.desktop", plist]);
  run("/usr/bin/plutil", ["-replace", "CFBundleIconFile", "-string", "Relay.icns", plist]);
  renameSync(electronExecutable, relayExecutable);
  await compileMacosIcon(relayApp, desktopRoot);
  writeDevAppEntry(resolve(relayApp, "Contents/Resources"), desktopRoot, environment);
  run("/usr/bin/touch", [relayApp]);

  return relayExecutable;
}
