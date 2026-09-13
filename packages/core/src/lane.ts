import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AppMap,
  AuthoringTarget,
  CombineProfileTargetInput,
  Lane,
  LaneSaveInput,
} from "@relay/protocol";
import { laneSaveInputSchema, laneSchema } from "@relay/protocol";
import { managedBrowserTargetProfileId } from "./browser-case-profile-target.js";
import { readAppMap } from "./collaboration.js";
import { collaborationStateRoot } from "./collaboration-store.js";
import { readTarget } from "./targets.js";

export const LANE_FIXTURE_PERSIST_ERROR =
  "A Lane with an auth fixture must not persist onto the saved browser environment authenticationFixtureId";
export const LANE_UNSIGNED_PROFILE_ERROR =
  "A Lane with an auth fixture must bind a unique runtime profile, not the unsigned saved environment";

export type LaneExecution = {
  laneId: string;
  appMapId: string;
  expectedRevision: number;
  profileTargets: [CombineProfileTargetInput];
  target: AuthoringTarget;
  targetProfileId?: string;
  engine?: Lane["engine"];
  account?: Lane["account"];
  actorId?: string;
  capture?: Lane["capture"];
};

function lanesFile(): string {
  return join(collaborationStateRoot(), "lanes.json");
}

function optionalTrimmed(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** Canonical fixture reference stored on a Lane account overlay. */
export function laneFixtureReference(lane: Pick<LaneSaveInput, "account">): string | undefined {
  const account = lane.account;
  if (account?.kind !== "fixture") return undefined;
  return (
    optionalTrimmed(account.reference) ?? `authfx:${account.accountId}:${account.accountRevision}`
  );
}

export function laneTargetId(lane: Pick<LaneSaveInput, "target">): string {
  return lane.target.kind === "browser" ? lane.target.browserTargetId : lane.target.serial;
}

export function laneToAuthoringTarget(lane: Pick<LaneSaveInput, "target">): AuthoringTarget {
  if (lane.target.kind === "browser") {
    return {
      kind: "browser",
      platform: "browser",
      targetId: lane.target.browserTargetId,
    };
  }
  return {
    kind: "device",
    platform: lane.target.platform,
    targetId: lane.target.serial,
  };
}

export function laneToProfileTarget(
  lane: Pick<LaneSaveInput, keyof LaneSaveInput>,
): CombineProfileTargetInput {
  const targetId = laneTargetId(lane);
  if (lane.target.kind === "browser") {
    return {
      profileId: targetId,
      target: {
        targetKind: "browser",
        browserTargetId: lane.target.browserTargetId,
        platform: "browser",
      },
      ...(lane.targetProfileId ? { targetProfileId: lane.targetProfileId } : {}),
      ...(lane.engine ? { engine: lane.engine } : {}),
      ...(lane.account ? { account: lane.account } : {}),
    };
  }
  return {
    profileId: targetId,
    target: {
      targetKind: "device",
      serial: lane.target.serial,
      platform: lane.target.platform,
    },
    ...(lane.targetProfileId ? { targetProfileId: lane.targetProfileId } : {}),
  };
}

function unsignedSavedProfileIds(
  appMap: Pick<AppMap, "screenVariants">,
  targetId: string,
): string[] {
  const ids = new Set<string>([managedBrowserTargetProfileId(targetId)]);
  for (const variant of Object.values(appMap.screenVariants ?? {})) {
    const profile = variant.targetProfile;
    if (profile.targetId !== targetId || profile.platform !== "browser") continue;
    if (profile.browserCaseProfile?.authenticationFixtureId) continue;
    ids.add(profile.id);
  }
  return [...ids];
}

function savedEnvironmentFixtureIds(input: {
  appMap?: Pick<AppMap, "screenVariants">;
  targetId: string;
  targetAuthenticationFixtureId?: string;
  unsignedSavedProfileIds: readonly string[];
}): string[] {
  const ids: string[] = [];
  const targetFixture = optionalTrimmed(input.targetAuthenticationFixtureId);
  if (targetFixture) ids.push(targetFixture);
  const unsigned = new Set(input.unsignedSavedProfileIds);
  for (const variant of Object.values(input.appMap?.screenVariants ?? {})) {
    const profile = variant.targetProfile;
    if (profile.targetId !== input.targetId || !unsigned.has(profile.id)) continue;
    const fixture = optionalTrimmed(profile.browserCaseProfile?.authenticationFixtureId);
    if (fixture) ids.push(fixture);
  }
  return ids;
}

/** Refuse any write that would copy a Lane fixture onto a saved environment. */
export function assertLaneDoesNotPersistAuthFixture(input: {
  lane: Pick<LaneSaveInput, "account">;
  nextAuthenticationFixtureId?: string;
}): void {
  const fixture = laneFixtureReference(input.lane);
  if (!fixture) return;
  if (optionalTrimmed(input.nextAuthenticationFixtureId) === fixture) {
    throw new Error(LANE_FIXTURE_PERSIST_ERROR);
  }
}

export function assertLaneDoesNotBindUnsignedEnvironment(input: {
  lane: Pick<LaneSaveInput, "account" | "target" | "targetProfileId">;
  unsignedSavedProfileIds: readonly string[];
}): void {
  if (input.lane.account?.kind !== "fixture") return;
  const profileId = optionalTrimmed(input.lane.targetProfileId);
  if (!profileId || input.unsignedSavedProfileIds.includes(profileId)) {
    throw new Error(LANE_UNSIGNED_PROFILE_ERROR);
  }
}

function assertLaneEnvironmentSafety(input: {
  lane: LaneSaveInput;
  appMap: Pick<AppMap, "screenVariants">;
  targetAuthenticationFixtureId?: string;
}): void {
  const targetId = laneTargetId(input.lane);
  const unsigned =
    input.lane.target.kind === "browser" ? unsignedSavedProfileIds(input.appMap, targetId) : [];
  assertLaneDoesNotBindUnsignedEnvironment({
    lane: input.lane,
    unsignedSavedProfileIds: unsigned,
  });
  for (const saved of savedEnvironmentFixtureIds({
    appMap: input.appMap,
    targetId,
    targetAuthenticationFixtureId: input.targetAuthenticationFixtureId,
    unsignedSavedProfileIds: unsigned,
  })) {
    assertLaneDoesNotPersistAuthFixture({
      lane: input.lane,
      nextAuthenticationFixtureId: saved,
    });
  }
}

function executionFrom(lane: Lane, expectedRevision: number): LaneExecution {
  const profileTarget = laneToProfileTarget(lane);
  return {
    laneId: lane.id,
    appMapId: lane.appMapId,
    expectedRevision,
    profileTargets: [profileTarget],
    target: laneToAuthoringTarget(lane),
    ...(lane.targetProfileId ? { targetProfileId: lane.targetProfileId } : {}),
    ...(lane.engine ? { engine: lane.engine } : {}),
    ...(lane.account ? { account: lane.account } : {}),
    ...(lane.actorId ? { actorId: lane.actorId } : {}),
    ...(lane.capture ? { capture: lane.capture } : {}),
  };
}

async function readAllLanes(): Promise<Lane[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(lanesFile(), "utf8"));
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      const lane = laneSchema.safeParse(item);
      return lane.success ? [lane.data] : [];
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function writeLanes(lanes: readonly Lane[]): Promise<void> {
  await mkdir(collaborationStateRoot(), { recursive: true, mode: 0o700 });
  await writeFile(lanesFile(), `${JSON.stringify(lanes, null, 2)}\n`, { mode: 0o600 });
}

export async function listLanes(projectId: string): Promise<Lane[]> {
  return (await readAllLanes()).filter((lane) => lane.projectId === projectId);
}

export async function readLane(projectId: string, id: string): Promise<Lane | null> {
  return (await listLanes(projectId)).find((lane) => lane.id === id) ?? null;
}

async function savedTargetFixtureId(lane: LaneSaveInput): Promise<string | undefined> {
  if (lane.target.kind !== "browser") return undefined;
  const target = await readTarget(lane.target.browserTargetId);
  return optionalTrimmed(target?.browser?.environment?.authenticationFixtureId);
}

export async function saveLane(input: LaneSaveInput & { projectId: string }): Promise<Lane> {
  const parsed = laneSaveInputSchema.parse({
    id: input.id,
    appMapId: input.appMapId,
    target: input.target,
    ...(input.targetProfileId ? { targetProfileId: input.targetProfileId } : {}),
    ...(input.engine ? { engine: input.engine } : {}),
    ...(input.account ? { account: input.account } : {}),
    ...(input.actorId ? { actorId: input.actorId } : {}),
    ...(input.capture ? { capture: input.capture } : {}),
  });
  const appMap = await readAppMap(input.projectId, parsed.appMapId);
  if (!appMap) throw new Error(`App Map ${parsed.appMapId} was not found`);
  assertLaneEnvironmentSafety({
    lane: parsed,
    appMap,
    targetAuthenticationFixtureId: await savedTargetFixtureId(parsed),
  });
  const at = Date.now();
  const existing = (await readAllLanes()).find(
    (item) => item.projectId === input.projectId && item.id === parsed.id,
  );
  const lane = laneSchema.parse({
    ...parsed,
    projectId: input.projectId,
    createdAt: existing?.createdAt ?? at,
    updatedAt: at,
  });
  await writeLanes([
    ...(await readAllLanes()).filter(
      (item) => !(item.projectId === lane.projectId && item.id === lane.id),
    ),
    lane,
  ]);
  return lane;
}

export async function removeLane(projectId: string, laneId: string): Promise<boolean> {
  const lanes = await readAllLanes();
  const current = lanes.find((item) => item.projectId === projectId && item.id === laneId);
  if (!current) return false;
  await writeLanes(lanes.filter((item) => item !== current));
  return true;
}

/** Resolve a Lane into one profileTargets entry and the current App Map revision. */
export async function resolveLaneExecution(input: {
  projectId: string;
  lane?: Lane;
  laneId?: string;
}): Promise<LaneExecution> {
  const lane =
    input.lane ?? (input.laneId ? await readLane(input.projectId, input.laneId) : undefined);
  if (!lane)
    throw new Error(input.laneId ? `Lane ${input.laneId} was not found` : "Lane is required");
  const appMap = await readAppMap(input.projectId, lane.appMapId);
  if (!appMap) throw new Error(`App Map ${lane.appMapId} was not found`);
  assertLaneEnvironmentSafety({
    lane,
    appMap,
    targetAuthenticationFixtureId: await savedTargetFixtureId(lane),
  });
  return executionFrom(lane, appMap.revision);
}
