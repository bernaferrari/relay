import type {
  AppMap,
  AppMapCombineCellRuntimeProfile,
  AppMapCombinePreflightIssue,
  AppMapCompiledRuntimeTargetProfile,
  AppMapNativeCompanionCompile,
  AppMapScenarioTest,
  AuthoringTarget,
} from "@relay/protocol";
import {
  AppMapTargetProfileError,
  nativePlatformProfileAlias,
  resolveAppMapTestForTargetProfile,
} from "./app-map-native-companion-compile.js";
import {
  assertRecordedCompanionForRun,
  companionExecutionTarget,
} from "./app-map-native-companion-run.js";
import {
  localExecutionTargetRef,
  type LocalExecutionTarget,
} from "./app-map-combine-cell-target-binding.js";
import { parseUnrecordedNativeRuntimeProfile } from "./app-map-unrecorded-runtime-profile.js";

export type ResolvedCombineCompanionCell = {
  map: AppMap;
  test: AppMapScenarioTest;
  runtimeTargetProfile: AppMapCompiledRuntimeTargetProfile;
  executionTarget: LocalExecutionTarget;
  nativeCompanion: AppMapNativeCompanionCompile;
};

function authoringFromLocal(target: LocalExecutionTarget): AuthoringTarget {
  return target.kind === "local-browser"
    ? { kind: "browser", platform: "browser", targetId: target.targetId }
    : { kind: "device", platform: target.platform, targetId: target.targetId };
}

function combinePlatform(platform: string): "android" | "ios" | "browser" {
  return platform === "android" || platform === "ios" || platform === "browser"
    ? platform
    : "browser";
}

/** Companion cells only. Local grok-web profiles stay on the requested map. */
export async function resolveCombineCellCompanion(input: {
  map: AppMap;
  test: AppMapScenarioTest;
  requestedProfileId?: string;
  requestedTarget: LocalExecutionTarget;
  readAppMap?: (appMapId: string) => Promise<AppMap | null>;
}): Promise<ResolvedCombineCompanionCell | undefined> {
  const requestedProfileId = input.requestedProfileId?.trim() || undefined;
  if (!requestedProfileId) return undefined;
  if (
    parseUnrecordedNativeRuntimeProfile(requestedProfileId, {
      targetId: input.requestedTarget.targetId,
      platform: input.requestedTarget.platform,
    })
  ) {
    return undefined;
  }
  const resolved = await resolveAppMapTestForTargetProfile({
    map: input.map,
    test: input.test,
    targetProfileId: requestedProfileId,
    readAppMap: input.readAppMap ?? (async () => null),
  });
  assertRecordedCompanionForRun({
    testId: input.test.id,
    targetProfileId: requestedProfileId,
    ...(resolved.nativeCompanion ? { nativeCompanion: resolved.nativeCompanion } : {}),
  });
  if (!resolved.nativeCompanion || !resolved.runtimeTargetProfile) return undefined;
  const switched = companionExecutionTarget({
    requested: authoringFromLocal(input.requestedTarget),
    profile: resolved.runtimeTargetProfile,
    nativeCompanion: resolved.nativeCompanion,
  });
  return {
    map: resolved.map,
    test: resolved.test,
    runtimeTargetProfile: resolved.runtimeTargetProfile,
    executionTarget: localExecutionTargetRef({
      targetId: switched.targetId,
      platform: switched.platform,
    }),
    nativeCompanion: resolved.nativeCompanion,
  };
}

export async function bindCompanionCombineCells(input: {
  map: AppMap;
  cells: ReadonlyArray<{ testId: string; values: Record<string, string> }>;
  requestedProfileId: string;
  requestedTarget?: { targetId: string; platform: string };
  readAppMap: (appMapId: string) => Promise<AppMap | null>;
}): Promise<{
  bindings: AppMapCombineCellRuntimeProfile[];
  issues: AppMapCombinePreflightIssue[];
}> {
  if (!nativePlatformProfileAlias(input.requestedProfileId)) {
    return { bindings: [], issues: [] };
  }
  const requestedTarget = localExecutionTargetRef({
    targetId: input.requestedTarget?.targetId?.trim() || "grok-com",
    platform: combinePlatform(input.requestedTarget?.platform ?? "browser"),
  });
  const bindings: AppMapCombineCellRuntimeProfile[] = [];
  const issues: AppMapCombinePreflightIssue[] = [];
  for (const cell of input.cells) {
    const test = input.map.tests[cell.testId];
    if (!test) {
      issues.push({
        code: "missing-test",
        message: `Test “${cell.testId}” is no longer on this map.`,
        testId: cell.testId,
      });
      continue;
    }
    try {
      const resolved = await resolveCombineCellCompanion({
        map: input.map,
        test,
        requestedProfileId: input.requestedProfileId,
        requestedTarget,
        readAppMap: input.readAppMap,
      });
      if (!resolved) continue;
      bindings.push({
        testId: cell.testId,
        values: { ...cell.values },
        targetProfileId: resolved.runtimeTargetProfile.id,
      });
    } catch (error) {
      if (error instanceof AppMapTargetProfileError) {
        issues.push({
          code: "mismatched-binding",
          message: error.message,
          testId: cell.testId,
          ...(error.targetProfileId ? { targetProfileId: error.targetProfileId } : {}),
        });
        continue;
      }
      throw error;
    }
  }
  return { bindings, issues };
}
