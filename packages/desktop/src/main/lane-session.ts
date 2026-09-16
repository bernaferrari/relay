const SAFE_LANE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;

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

export function laneTabSessionKey(laneId: string, targetId: string): string {
  const id = laneId.trim();
  if (!SAFE_LANE_ID.test(id)) {
    throw new Error("Lane identifier is not a safe Electron partition");
  }
  return `lane:${id}`;
}

/** Playwright headed Chrome user-data is a filesystem profile. Electron uses
 * `persist:lane:<id>`. Same Lane id does not share cookies across those stores. */
export function laneWindowNeedsNavigation(currentUrl: string, requestedUrl: string): boolean {
  if (!currentUrl || currentUrl === "about:blank") return true;
  try {
    return new URL(currentUrl).href !== new URL(requestedUrl).href;
  } catch {
    return currentUrl !== requestedUrl;
  }
}
