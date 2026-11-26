import { homedir } from "node:os";
import { join } from "node:path";
import {
  assertSafeBrowserLaneId,
  browserLaneElectronPartition,
} from "@relay/protocol/browser-lane-session";

export function laneSessionPartition(laneId: string): string {
  return browserLaneElectronPartition(laneId);
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

export function laneTabSessionKey(laneId: string, _targetId: string): string {
  return `lane:${assertSafeBrowserLaneId(laneId)}`;
}

/** Playwright headed Chrome user-data is a filesystem profile. Electron uses
 * `persist:lane:<id>`. Same Lane id does not share cookies across those stores. */
export function defaultDesktopElectronPartitionRoots(): string[] {
  const home = homedir();
  return [join(home, "Library/Application Support/Electron/Partitions")];
}

export function laneWindowNeedsNavigation(currentUrl: string, requestedUrl: string): boolean {
  if (!currentUrl || currentUrl === "about:blank") return true;
  try {
    return new URL(currentUrl).href !== new URL(requestedUrl).href;
  } catch {
    return currentUrl !== requestedUrl;
  }
}
