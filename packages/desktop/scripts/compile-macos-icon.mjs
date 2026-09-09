import { execFile } from "node:child_process";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Compile Icon Composer appearances into the bundle's native resource files. */
export async function compileMacosIcon(appPath, projectDir) {
  if (process.platform !== "darwin") return;
  const temporary = await mkdtemp(join(tmpdir(), "relay-icon-"));
  try {
    await execFileAsync("xcrun", [
      "actool",
      resolve(projectDir, "resources/Relay.icon"),
      "--compile",
      temporary,
      "--platform",
      "macosx",
      "--minimum-deployment-target",
      "13.0",
      "--app-icon",
      "Relay",
      "--output-partial-info-plist",
      join(temporary, "info.plist"),
    ]);
    const resources = resolve(appPath, "Contents/Resources");
    await Promise.all([
      copyFile(join(temporary, "Assets.car"), join(resources, "Assets.car")),
      copyFile(join(temporary, "Relay.icns"), join(resources, "Relay.icns")),
    ]);
    // electron-builder and Electron's template may leave CFBundleIconFile set
    // to its generic `icon.icns`. CFBundleIconName is the authoritative key
    // for the compiled asset catalog and must point at the actool app-icon
    // name; keep the ICNS fallback aligned for older Finder/tool versions.
    const plist = resolve(appPath, "Contents/Info.plist");
    const setPlistString = async (key, value) => {
      try {
        await execFileAsync("/usr/bin/plutil", ["-replace", key, "-string", value, plist]);
      } catch {
        await execFileAsync("/usr/bin/plutil", ["-insert", key, "-string", value, plist]);
      }
    };
    await setPlistString("CFBundleIconName", "Relay");
    await setPlistString("CFBundleIconFile", "Relay.icns");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
