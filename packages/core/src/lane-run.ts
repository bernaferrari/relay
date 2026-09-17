import type {
  AuthoringTarget,
  CombineProfileTargetInput,
  Lane,
  OperationInput,
} from "@relay/protocol";
import { laneFixtureReference, resolveLaneExecution, type LaneExecution } from "./lane.js";
import { unsignedBrowserLaneId } from "./browser-account-lane.js";

export const LANE_RUN_FIELDS_REQUIRED =
  "expectedRevision and target are required unless laneId is set";
export const LANE_INTERACT_SERIAL_REQUIRED = "serial is required unless laneId is set";

export type LaneAwareTestRunInput = Omit<
  OperationInput<"app-map.test.run">,
  "appMapId" | "testId"
> & {
  appMapId?: string;
  expectedRevision?: number;
  target?: AuthoringTarget;
};

export type LaneAwareCombineStartInput = {
  appMapId?: string;
  laneId?: string;
  serial?: string;
  platform?: "android" | "ios";
  targetKind?: "device" | "browser";
  browserTargetId?: string;
  defaultTargetProfileId?: string;
  profileTargets?: CombineProfileTargetInput[];
  capture?: Lane["capture"];
};

export type LaneInteractResolution = {
  serial: string;
  laneId?: string;
  authenticationFixtureId?: string;
  unsignedLaneId?: string;
};

function assertAppMapMatchesLane(execution: LaneExecution, appMapId: string | undefined): void {
  const requested = appMapId?.trim();
  if (requested && requested !== execution.appMapId) {
    throw new Error(
      `Lane ${execution.laneId} is bound to App Map ${execution.appMapId}, not ${requested}`,
    );
  }
}

function testRunFromLane(execution: LaneExecution): {
  expectedRevision: number;
  target: AuthoringTarget;
  targetProfileId?: string;
  engine?: Lane["engine"];
  account?: Lane["account"];
} {
  return {
    expectedRevision: execution.expectedRevision,
    target: execution.target,
    ...(execution.targetProfileId ? { targetProfileId: execution.targetProfileId } : {}),
    ...(execution.engine ? { engine: execution.engine } : {}),
    ...(execution.account ? { account: execution.account } : {}),
  };
}

export type LaneAppliedTestRun<T extends LaneAwareTestRunInput> = T & {
  expectedRevision: number;
  target: AuthoringTarget;
  targetProfileId?: string;
  engine?: Lane["engine"];
  account?: Lane["account"];
};

/** Fill Test run overlay from a saved Lane. Clients send laneId only. */
export async function applyLaneToTestRun<T extends LaneAwareTestRunInput>(
  projectId: string,
  appMapId: string,
  input: T,
): Promise<LaneAppliedTestRun<T>> {
  if (!input.laneId) {
    if (input.expectedRevision === undefined || input.target === undefined) {
      throw new Error(LANE_RUN_FIELDS_REQUIRED);
    }
    return input as LaneAppliedTestRun<T>;
  }
  const execution = await resolveLaneExecution({ projectId, laneId: input.laneId });
  assertAppMapMatchesLane(execution, appMapId || input.appMapId);
  return { ...input, ...testRunFromLane(execution) };
}

function combineStartFromLane(execution: LaneExecution): {
  serial?: string;
  platform?: "android" | "ios";
  targetKind: "device" | "browser";
  browserTargetId?: string;
  defaultTargetProfileId?: string;
  profileTargets: [CombineProfileTargetInput];
  capture?: Lane["capture"];
} {
  if (execution.target.kind === "browser") {
    return {
      targetKind: "browser",
      browserTargetId: execution.target.targetId,
      profileTargets: execution.profileTargets,
      ...(execution.targetProfileId ? { defaultTargetProfileId: execution.targetProfileId } : {}),
      ...(execution.capture ? { capture: execution.capture } : {}),
    };
  }
  return {
    targetKind: "device",
    serial: execution.target.targetId,
    platform: execution.target.platform,
    profileTargets: execution.profileTargets,
    ...(execution.targetProfileId ? { defaultTargetProfileId: execution.targetProfileId } : {}),
    ...(execution.capture ? { capture: execution.capture } : {}),
  };
}

export type LaneCombineOverlay = {
  serial?: string;
  platform?: "android" | "ios";
  targetKind?: "device" | "browser";
  browserTargetId?: string;
  defaultTargetProfileId?: string;
  profileTargets?: CombineProfileTargetInput[];
  capture?: Lane["capture"];
};

/** Fill Combine/Plan start overlay from a saved Lane. */
export async function applyLaneToCombineStart<T extends LaneAwareCombineStartInput>(
  projectId: string,
  input: T,
): Promise<T & LaneCombineOverlay> {
  if (!input.laneId) return input;
  const execution = await resolveLaneExecution({ projectId, laneId: input.laneId });
  assertAppMapMatchesLane(execution, input.appMapId);
  const overlay = combineStartFromLane(execution);
  return {
    ...input,
    ...overlay,
    ...(input.capture ? { capture: input.capture } : {}),
  };
}

/** Resolve interact serial (and optional fixture overlay) from a saved Lane. */
export async function applyLaneToInteract(input: {
  projectId: string;
  laneId?: string;
  serial?: string;
}): Promise<LaneInteractResolution> {
  if (!input.laneId) {
    const serial = input.serial?.trim();
    if (!serial) throw new Error(LANE_INTERACT_SERIAL_REQUIRED);
    return { serial };
  }
  const execution = await resolveLaneExecution({
    projectId: input.projectId,
    laneId: input.laneId,
  });
  const serial = execution.target.targetId;
  const requested = input.serial?.trim();
  if (requested && requested !== serial) {
    throw new Error(`Lane ${execution.laneId} is bound to ${serial}, not ${requested}`);
  }
  const authenticationFixtureId = laneFixtureReference(execution);
  const unsignedLaneId = unsignedBrowserLaneId({
    laneId: execution.laneId,
    authenticationFixtureId,
    accountKind: execution.account?.kind,
    targetKind: execution.target.kind,
  });
  return {
    serial,
    laneId: execution.laneId,
    ...(authenticationFixtureId ? { authenticationFixtureId } : {}),
    ...(unsignedLaneId ? { unsignedLaneId } : {}),
  };
}
