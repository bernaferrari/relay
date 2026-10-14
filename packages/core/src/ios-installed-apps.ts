import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultCommandRunner, resolveGoIosBinary, type CommandRunner } from "./ios-app-launch.js";

/** Installation metadata is read-only and does not require an XCTest session. */
export async function listIosInstalledApps(
  serial: string,
  options: { simulator?: boolean; run?: CommandRunner; bin?: string } = {},
): Promise<Array<{ package: string; name: string }>> {
  if (!serial.trim() || serial.startsWith("-") || /\s|\0/u.test(serial))
    throw new Error("A connected iOS device serial is required");
  const run = options.run ?? defaultCommandRunner;
  const result = options.simulator
    ? await run("xcrun", ["simctl", "listapps", serial], 15_000)
    : await run(
        options.bin ?? (await resolveGoIosBinary()),
        ["apps", "--all", "--udid", serial],
        15_000,
      );
  if (result.exitCode !== 0) throw new Error("Relay could not read the installed iOS apps.");
  let inventory: unknown;
  try {
    inventory = JSON.parse(result.stdout);
  } catch (error) {
    if (!options.simulator)
      throw new Error("iOS app inventory returned invalid JSON.", { cause: error });
    const directory = await mkdtemp(join(tmpdir(), "relay-ios-apps-"));
    try {
      const path = join(directory, "apps.plist");
      await writeFile(path, result.stdout);
      const converted = await run("plutil", ["-convert", "json", "-o", "-", path], 5_000);
      if (converted.exitCode !== 0) throw new Error("Simulator app inventory could not be read.");
      inventory = JSON.parse(converted.stdout);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
  if (!inventory || typeof inventory !== "object") throw new Error("Invalid iOS app inventory.");
  const entries = Array.isArray(inventory)
    ? inventory.map((entry) => [undefined, entry] as const)
    : Object.entries(inventory);
  const apps = new Map<string, { package: string; name: string }>();
  let validEntries = 0;
  for (const [key, entry] of entries) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const id = row.CFBundleIdentifier ?? key;
    if (typeof id !== "string" || !id.includes(".")) continue;
    validEntries++;
    if (Array.isArray(row.SBAppTags) && row.SBAppTags.includes("hidden")) continue;
    if (typeof row.CFBundlePackageType === "string" && row.CFBundlePackageType !== "APPL") continue;
    const label = row.CFBundleDisplayName ?? row.CFBundleName;
    apps.set(id, {
      package: id,
      name: typeof label === "string" && label.trim() ? label.trim() : id,
    });
  }
  if (entries.length && !validEntries)
    throw new Error("iOS app inventory omitted bundle identifiers.");
  return [...apps.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.package.localeCompare(b.package),
  );
}
