const SAFE_LANE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;

/** Must match `@relay/protocol` `browserLaneElectronPartition`. Desktop tests
 * cannot import protocol under Node strip-types. */
export function laneSessionPartition(laneId: string): string {
  const id = laneId.trim();
  if (!SAFE_LANE_ID.test(id)) {
    throw new Error("Lane identifier is not a safe Electron partition");
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
