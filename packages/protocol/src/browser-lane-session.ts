const SAFE_LANE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;

export function assertSafeBrowserLaneId(laneId: string): string {
  const id = laneId.trim();
  if (!SAFE_LANE_ID.test(id)) {
    throw new Error("Lane identifier is not a safe browser session key");
  }
  return id;
}

/** In-app tab identity. Same Lane → same jar. A Sign-in without a Lane
 * still isolates on target + fixture. Do not invent a second profile object. */
export function browserLaneTabSessionKey(input: {
  laneId?: string;
  targetId: string;
  authenticationFixtureId?: string;
}): string {
  const lane = input.laneId?.trim();
  if (lane) return `lane:${assertSafeBrowserLaneId(lane)}`;
  const fixture = input.authenticationFixtureId?.trim();
  const target = input.targetId.trim();
  if (fixture) return `signin:${target}:${fixture}`;
  return `lane:${target}:signed-out`;
}

/** Electron `session.fromPartition` key. Same Lane shares cookies across tabs. */
export function browserLaneElectronPartition(laneId: string): string {
  return `persist:lane:${assertSafeBrowserLaneId(laneId)}`;
}

export function browserLaneHostIdentity(input: {
  laneId: string;
  targetId: string;
  authenticationFixtureId?: string;
}): {
  laneId: string;
  tabSessionKey: string;
  electronPartition: string;
} {
  const laneId = assertSafeBrowserLaneId(input.laneId);
  return {
    laneId,
    tabSessionKey: browserLaneTabSessionKey({
      laneId,
      targetId: input.targetId,
      authenticationFixtureId: input.authenticationFixtureId,
    }),
    electronPartition: browserLaneElectronPartition(laneId),
  };
}
