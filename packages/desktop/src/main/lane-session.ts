import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SAFE_LANE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
/** Must match `@relay/protocol` `GROK_LAB_ELECTRON_PARTITION_DIR`. */
export const GROK_LAB_ELECTRON_PARTITION_DIR = "lane%3Agrok-lab";

/** Must match `@relay/protocol` `browserLaneElectronPartition`. Desktop tests
 * cannot import protocol under Node strip-types. */
export function laneSessionPartition(laneId: string): string {
  const id = laneId.trim();
  if (!SAFE_LANE_ID.test(id)) {
    throw new Error("Lane identifier is not a safe Electron partition");
  }
  if (id.includes("__lane_")) {
    throw new Error("Electron partition cannot reuse Playwright user-data");
  }
  return `persist:lane:${id}`;
}

/** Lane windows and their cookies stay on http(s). file:, javascript:, and data: are not pages. */
export function laneHttpUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Lane tabs only open http(s) URLs");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Lane tabs only open http(s) URLs");
  }
  return parsed;
}

export function laneTabSessionKey(laneId: string, targetId: string): string {
  const id = laneId.trim();
  if (!SAFE_LANE_ID.test(id)) {
    throw new Error("Lane identifier is not a safe Electron partition");
  }
  return `lane:${id}`;
}

/** Playwright headed Chrome user-data is a filesystem profile. Electron uses
 * `persist:lane:<id>`. Same Lane id does not share cookies across those stores. */
export function defaultDesktopElectronPartitionRoots(): string[] {
  const home = homedir();
  return [
    join(home, "Library/Application Support/Electron/Partitions"),
    join(home, "Library/Application Support/Grok Bot/Partitions"),
  ];
}

/** Probe existing dirs only. Never mkdir persist:lane:grok-lab. */
export function electronGrokLabPartitionPresentOnDisk(roots?: readonly string[]): boolean {
  const dirs = roots ?? defaultDesktopElectronPartitionRoots();
  return dirs.some((root) => existsSync(join(root, GROK_LAB_ELECTRON_PARTITION_DIR)));
}

export function assertElectronGrokLabTabAllowed(input: {
  laneId: string;
  partitionPresent?: boolean;
}): void {
  if (input.laneId.trim() !== "grok-lab") return;
  if (input.partitionPresent === true) return;
  throw new Error(
    "Electron persist:lane:grok-lab is absent. Playwright SuperGrok is not that store. Do not invent the partition.",
  );
}

export function laneWindowNeedsNavigation(currentUrl: string, requestedUrl: string): boolean {
  if (!currentUrl || currentUrl === "about:blank") return true;
  try {
    return new URL(currentUrl).href !== new URL(requestedUrl).href;
  } catch {
    return currentUrl !== requestedUrl;
  }
}
