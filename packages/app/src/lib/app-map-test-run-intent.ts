import type { AppMap, AppMapScenarioTest, AppMapTestStartup } from "@relay/protocol";
import type { DeviceInfo } from "./api-types";

export type AppMapTestRunIntent = {
  generation: number;
  appMapId: string;
  testId: string;
  testUpdatedAt: number;
  expectedRevision: number;
  target?:
    | { kind: "browser"; platform: "browser"; targetId: string }
    | { kind: "device"; platform: "android" | "ios"; targetId: string };
  targetProfileId?: string;
  surfaceCapture?: { forceRecaptureScreenIds: string[] };
  startup: AppMapTestStartup;
};

export function createAppMapTestRunIntent(input: {
  generation: number;
  appMap: AppMap;
  test: AppMapScenarioTest;
  device?: DeviceInfo;
  targetProfileId?: string;
  freshSurfaceScreenIds?: readonly string[];
  startup: AppMapTestStartup;
}): AppMapTestRunIntent {
  const target = input.device
    ? input.device.platform === "browser"
      ? ({ kind: "browser", platform: "browser", targetId: input.device.serial } as const)
      : input.device.platform
        ? ({
            kind: "device",
            platform: input.device.platform,
            targetId: input.device.serial,
          } as const)
        : undefined
    : undefined;
  return {
    generation: input.generation,
    appMapId: input.appMap.id,
    testId: input.test.id,
    testUpdatedAt: input.test.updatedAt,
    expectedRevision: input.appMap.revision,
    ...(target ? { target } : {}),
    ...(input.targetProfileId?.trim() ? { targetProfileId: input.targetProfileId.trim() } : {}),
    ...(input.freshSurfaceScreenIds?.length
      ? { surfaceCapture: { forceRecaptureScreenIds: [...input.freshSurfaceScreenIds] } }
      : {}),
    startup: structuredClone(input.startup),
  };
}

/** Compare the execution-relevant facts only. A new generation makes the
 * identity monotonic even when a user switches away and back to the same Test
 * before an older compile response arrives. */
export function sameAppMapTestRunIntent(
  left: AppMapTestRunIntent,
  right: AppMapTestRunIntent,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function appMapTestCompileInput(intent: AppMapTestRunIntent): {
  appMapId: string;
  testId: string;
  entryCheckpointScreenId?: string;
  targetProfileId?: string;
  forceRecaptureScreenIds?: string[];
} {
  return {
    appMapId: intent.appMapId,
    testId: intent.testId,
    ...(intent.startup.mode === "verified-checkpoint"
      ? { entryCheckpointScreenId: intent.startup.screenId }
      : {}),
    ...(intent.targetProfileId ? { targetProfileId: intent.targetProfileId } : {}),
    ...(intent.surfaceCapture
      ? { forceRecaptureScreenIds: [...intent.surfaceCapture.forceRecaptureScreenIds] }
      : {}),
  };
}
