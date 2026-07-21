import { copyFileSync, existsSync, renameSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`;
    throw new Error(`${command} ${args.join(" ")} failed: ${detail}`);
  }
}

/**
 * Build a project-local macOS app bundle for development. APFS clone-copying
 * preserves Electron's complete, working bundle without physically duplicating
 * its frameworks, then Relay supplies its own identity and icon.
 */
export function prepareMacOSDevApp(electronCliPath, desktopRoot) {
  const electronRoot = dirname(electronCliPath);
  const electronApp = resolve(electronRoot, "dist/Electron.app");
  const relayApp = resolve(desktopRoot, "out/Relay.app");
  const plist = resolve(relayApp, "Contents/Info.plist");
  const icon = resolve(desktopRoot, "resources/relay-icon.icns");
  const electronExecutable = resolve(relayApp, "Contents/MacOS/Electron");
  const relayExecutable = resolve(relayApp, "Contents/MacOS/Relay");

  if (!existsSync(electronApp)) throw new Error(`Electron.app not found at ${electronApp}`);
  if (!existsSync(icon)) throw new Error(`Relay macOS icon not found at ${icon}`);

  rmSync(relayApp, { force: true, recursive: true });
  run("/bin/cp", ["-cR", electronApp, relayApp]);
  run("/usr/bin/plutil", ["-replace", "CFBundleDisplayName", "-string", "Relay", plist]);
  run("/usr/bin/plutil", ["-replace", "CFBundleName", "-string", "Relay", plist]);
  run("/usr/bin/plutil", ["-replace", "CFBundleExecutable", "-string", "Relay", plist]);
  run("/usr/bin/plutil", ["-replace", "CFBundleIdentifier", "-string", "dev.relay.desktop", plist]);
  run("/usr/bin/plutil", ["-replace", "CFBundleIconFile", "-string", "Relay.icns", plist]);
  renameSync(electronExecutable, relayExecutable);
  copyFileSync(icon, resolve(relayApp, "Contents/Resources/Relay.icns"));
  run("/usr/bin/touch", [relayApp]);

  return relayExecutable;
}
