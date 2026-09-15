import {
  activeReviewedDocumentOriginsForAppMap,
  AppMapTargetProfileError,
  AppMapTestCompileError,
  assertRecordedCompanionForRun,
  companionExecutionTarget,
  compileAppMapTest,
  frozenRawAccessibilityTargetProfiles,
  readAppMap,
  resolveAppMapTestForTargetProfile,
  type AppMapTestCompileOptions,
  type CompiledAppMapTestForProfile,
} from "@relay/core";
import type { AppMap, AppMapCompiledRuntimeTargetProfile, AppMapScenarioTest, AuthoringTarget } from "@relay/protocol";
import { frozenEvidenceTargetProfileForTarget } from "./app-map-run-target-admission.js";
import { frozenTestRunTargetProfile } from "./app-map-test-target-profile.js";
import { HttpError } from "./http.js";

function savedIdentityFromProfile(profile: {
  platform?: string;
  browserCaseProfile?: { engine?: string; authenticationFixtureId?: string };
}): { engine?: string; authenticationFixtureId?: string; platform?: string } {
  const browser = profile.browserCaseProfile;
  return {
    ...(browser?.engine ? { engine: browser.engine } : {}),
    ...(browser?.authenticationFixtureId
      ? { authenticationFixtureId: browser.authenticationFixtureId }
      : {}),
    ...(profile.platform ? { platform: profile.platform } : {}),
  };
}

export function savedBrowserIdentityForProfile(
  map: {
    screenVariants?: Record<
      string,
      {
        targetProfile?: {
          id?: string;
          platform?: string;
          browserCaseProfile?: { engine?: string; authenticationFixtureId?: string };
        };
      }
    >;
  },
  ...profileIds: Array<string | undefined>
): { engine?: string; authenticationFixtureId?: string; platform?: string } {
  const wanted = new Set(
    profileIds.map((id) => id?.trim()).filter((id): id is string => Boolean(id)),
  );
  if (!wanted.size) return {};
  for (const variant of Object.values(map.screenVariants ?? {})) {
    const profile = variant.targetProfile;
    if (!profile?.id || !wanted.has(profile.id)) continue;
    return savedIdentityFromProfile(profile);
  }
  return {};
}

export function combineStartControlTargetIds(input: {
  profileTargets?: Array<{ target: { browserTargetId?: string; serial?: string } }>;
  selectedCells: Array<{ executionTarget: { targetId: string } }>;
  fallbackTargetId?: string;
}): string[] {
  if (input.profileTargets?.length) {
    return input.profileTargets
      .map((item) => item.target.browserTargetId ?? item.target.serial)
      .filter((id): id is string => Boolean(id?.trim()));
  }
  const fromCells = [
    ...new Set(
      input.selectedCells.map((cell) => cell.executionTarget.targetId.trim()).filter(Boolean),
    ),
  ];
  return fromCells.length ? fromCells : input.fallbackTargetId ? [input.fallbackTargetId] : [];
}

export function httpErrorFromAppMapTargetProfile(error: AppMapTargetProfileError): HttpError {
  return new HttpError(409, error.message, {
    code: error.code,
    ...(error.targetProfileId ? { targetProfileId: error.targetProfileId } : {}),
    recovery:
      error.code === "COMPANION_MAP_MISSING" || error.code === "COMPANION_TEST_MISSING"
        ? "Open the linked native App Map and confirm the companion Test still exists. Do not invent Grok Settings navigation."
        : "Choose a saved evidence profile, or ios/android to follow a linked native companion.",
  });
}

export async function prepareAppMapCompanionTestRun(input: {
  map: AppMap;
  test: AppMapScenarioTest;
  target: AuthoringTarget;
  targetProfileId?: string;
  projectId: string;
  compileOptions: Omit<AppMapTestCompileOptions, "runtimeTargetProfile" | "reviewedDocumentOrigins">;
}): Promise<{
  compiled: CompiledAppMapTestForProfile;
  executionMap: AppMap;
  executionTarget: AuthoringTarget;
  runtimeTargetProfile?: AppMapCompiledRuntimeTargetProfile;
}> {
  try {
    const resolved = await resolveAppMapTestForTargetProfile({
      map: input.map,
      test: input.test,
      ...(input.targetProfileId ? { targetProfileId: input.targetProfileId } : {}),
      readAppMap: (id) => readAppMap(input.projectId, id),
    });
    assertRecordedCompanionForRun({
      testId: input.test.id,
      ...(input.targetProfileId ? { targetProfileId: input.targetProfileId } : {}),
      ...(resolved.nativeCompanion ? { nativeCompanion: resolved.nativeCompanion } : {}),
    });
    const executionTarget = companionExecutionTarget({
      requested: input.target,
      ...(resolved.runtimeTargetProfile ? { profile: resolved.runtimeTargetProfile } : {}),
      ...(resolved.nativeCompanion ? { nativeCompanion: resolved.nativeCompanion } : {}),
    });
    const explicitlySelectedRuntimeTargetProfile =
      input.targetProfileId && resolved.runtimeTargetProfile
        ? frozenTestRunTargetProfile({
            map: resolved.map,
            targetProfileId: resolved.runtimeTargetProfile.id,
            target: executionTarget,
          })
        : undefined;
    const inferredRuntimeTargetProfile = explicitlySelectedRuntimeTargetProfile
      ? undefined
      : frozenEvidenceTargetProfileForTarget({
          target: executionTarget,
          profiles: frozenRawAccessibilityTargetProfiles(resolved.map),
        });
    const runtimeTargetProfile =
      explicitlySelectedRuntimeTargetProfile ?? inferredRuntimeTargetProfile;
    const sameMap = resolved.map.id === input.map.id;
    const compiled = compileAppMapTest(resolved.map, resolved.test, {
      ...(sameMap
        ? input.compileOptions
        : input.compileOptions.startupMode
          ? { startupMode: input.compileOptions.startupMode }
          : {}),
      reviewedDocumentOrigins: await activeReviewedDocumentOriginsForAppMap(resolved.map),
      ...(runtimeTargetProfile ? { runtimeTargetProfile } : {}),
    });
    return {
      compiled: resolved.nativeCompanion
        ? { ...compiled, nativeCompanion: resolved.nativeCompanion }
        : compiled,
      executionMap: resolved.map,
      executionTarget,
      ...(runtimeTargetProfile ? { runtimeTargetProfile } : {}),
    };
  } catch (error) {
    if (error instanceof AppMapTargetProfileError) throw httpErrorFromAppMapTargetProfile(error);
    if (error instanceof AppMapTestCompileError) {
      throw new HttpError(409, error.message, {
        code: error.code,
        testId: error.testId,
        stepId: error.stepId,
        diagnostics: error.diagnostics,
        recovery:
          error.code === "unresolved-navigation"
            ? "Teach or author every missing reviewed return transition, then compile the Test again."
            : "Open the Test editor and resolve its blocking compile diagnostics.",
      });
    }
    throw error;
  }
}
