import {
  activeReviewedDocumentOriginsForAppMap,
  AppMapTargetProfileError,
  AppMapTestCompileError,
  assertRecordedCompanionForRun,
  companionExecutionTarget,
  compileAppMapTest,
  frozenRawAccessibilityTargetProfiles,
  loadFrozenRawAccessibilityEvidence,
  preflightCompiledAppMapTestOffline,
  readAppMap,
  resolveAppMapTestForTargetProfile,
  type AppMapTestCompileOptions,
  type CompiledAppMapTestForProfile,
  type NativeDeviceFacts,
} from "@relay/core";
import type {
  AppMap,
  AppMapCompiledRuntimeTargetProfile,
  AppMapScenarioTest,
  AuthoringTarget,
  OfflineTestPreflightReport,
} from "@relay/protocol";
import { frozenEvidenceTargetProfileForTarget } from "./app-map-run-target-admission.js";
import { frozenTestRunTargetProfile } from "./app-map-test-target-profile.js";
import { HttpError } from "./http.js";
import { freshNativeRunProfileFacts } from "./app-map-test-native-profile-admission.js";

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
  observedDevice?: NativeDeviceFacts;
  nativeProfileObservation?: {
    observeViewport: Parameters<typeof freshNativeRunProfileFacts>[0]["observeViewport"];
    validateInputs: (
      compiled: CompiledAppMapTestForProfile,
      preflight: OfflineTestPreflightReport,
    ) => Promise<void>;
  };
  compileOptions: Omit<
    AppMapTestCompileOptions,
    "runtimeTargetProfile" | "reviewedDocumentOrigins"
  >;
}): Promise<{
  compiled: CompiledAppMapTestForProfile;
  executionMap: AppMap;
  executionTarget: AuthoringTarget;
  runtimeTargetProfile?: AppMapCompiledRuntimeTargetProfile;
  observedDevice?: NativeDeviceFacts;
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
    const compileOptions = {
      ...(resolved.map.id === input.map.id
        ? input.compileOptions
        : input.compileOptions.startupMode
          ? { startupMode: input.compileOptions.startupMode }
          : {}),
      reviewedDocumentOrigins: await activeReviewedDocumentOriginsForAppMap(resolved.map),
    };
    const profiles = frozenRawAccessibilityTargetProfiles(resolved.map);
    const observedDevice =
      !input.targetProfileId && input.nativeProfileObservation
        ? await freshNativeRunProfileFacts({
            target: executionTarget,
            profiles,
            observedDevice: input.observedDevice,
            originApplication: resolved.test.originApplication,
            observeViewport: input.nativeProfileObservation.observeViewport,
            validateOffline: async () => {
              const preliminary = compileAppMapTest(resolved.map, resolved.test, compileOptions);
              const preflight = preflightCompiledAppMapTestOffline(
                preliminary.plan,
                await loadFrozenRawAccessibilityEvidence(preliminary.plan),
              );
              if (
                preflight.findings.some(
                  (finding) =>
                    finding.severity === "blocker" &&
                    finding.code !== "raw-evidence-variant-selection-required",
                )
              )
                throw new HttpError(
                  409,
                  "Offline Test preflight is blocked; Relay did not inspect the target",
                  {
                    code: "TEST_OFFLINE_PREFLIGHT_BLOCKED",
                    preflight,
                    recovery: "Open the Test editor and resolve its blocking evidence findings.",
                  },
                );
              await input.nativeProfileObservation!.validateInputs(preliminary, preflight);
            },
          })
        : input.observedDevice;
    const inferredRuntimeTargetProfile = explicitlySelectedRuntimeTargetProfile
      ? undefined
      : frozenEvidenceTargetProfileForTarget({
          target: executionTarget,
          profiles,
          observedDevice,
        });
    const runtimeTargetProfile =
      explicitlySelectedRuntimeTargetProfile ?? inferredRuntimeTargetProfile;
    const compiled = compileAppMapTest(resolved.map, resolved.test, {
      ...compileOptions,
      ...(runtimeTargetProfile ? { runtimeTargetProfile } : {}),
    });
    return {
      compiled: resolved.nativeCompanion
        ? { ...compiled, nativeCompanion: resolved.nativeCompanion }
        : compiled,
      executionMap: resolved.map,
      executionTarget,
      ...(observedDevice ? { observedDevice } : {}),
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
