import http from "node:http";
import type { SourceRevision, BrowserAuthenticationHealth } from "@relay/protocol";
import type {
  AppMapCapturePolicy,
  AppMapCombine,
  AppMapCombineCellRuntimeProfile,
  AppMapCombineCellTargetBinding,
  AppMapCompiledTest,
  AppMapNativeCompanionCompile,
  CombineCampaign,
  RepeatCampaignExecutionIdentity,
} from "@relay/protocol";
import { executionTargetRefKey } from "@relay/protocol";
import {
  AppMapCombineWorldError,
  KeyedSerialQueue,
  activeReviewedDocumentOriginsForAppMap,
  applyFullSurfaceDestinationBindings,
  combineCampaignCaseFromPreparedCell,
  combineProfileTargetExecutionCaseId,
  savedAppMapTargetProfileIdsForTarget,
  inheritSavedRuntimeProfileId,
  unrecordedPreparedCombineReason,
  buildTargetProfiles,
  createCombineCampaign,
  currentOperationContext,
  findActiveCombineCampaignForCombine,
  findActiveRepeatCampaigns,
  accountFixtureIdsFromListed,
  attachBrowserAuthenticationHealth,
  bindRequestedBrowserIdentity,
  overlayRequestedBrowserAccountOnTargetProfile,
  combineStartAdmissionLaneId,
  listBrowserAuthenticationFixtures,
  planAccountStartBlocker,
  accountReloginFindingsReport,
  persistAccountReloginPlanResult,
  prepareAppMapCombineCells,
  preparedCellsFixtureStartBlocker,
  mutatingShareStartBlocker,
  combineCellShareAccountId,
  queueablePreparedCombineCells,
  readAppMap,
  snapshotPlayerMap,
  listTargets,
  resolveCombineCellSelector,
  stagePreparedAppMapCombineCells,
  summarizeJob,
} from "@relay/core";
import {
  assertPreparedCombineCells,
  requireSingleTestUseAppMapTestRun,
} from "./app-map-combine-runtime-contract.js";
import {
  combineStartControlTargetIds,
  savedBrowserIdentityForProfile,
} from "./app-map-test-run-prepare.js";
import { queuedAppMapTestTargetProfile } from "./app-map-test-target-profile.js";
import { HttpError, json, parseJsonBody } from "./http.js";
import { applyLaneToCombineStartOrThrow } from "./lane-run-route.js";
import type { JobRouteRuntime } from "./job-routes.js";
import {
  admitAndStageLocalCombineCampaign,
  localCampaignAdmissionRequestForActiveWorkItems,
  localCampaignAdmissionWorkItemsForCombine,
  type LocalCombineCampaignAdmission,
  type LocalCombineCampaignAdmissionRequest,
} from "./local-combine-campaign-admission.js";
import type { RequestContext } from "./security.js";
import { compensateCombineStartFailure } from "./combine-start-compensation.js";
import { ephemeralCombineFromTest } from "./combine-start-ad-hoc.js";
import { assertCombineInputDataSets, freezeCombineRunInputs } from "./combine-run-inputs.js";

type CombineStartRequest = {
  appMapId?: string;
  expectedRevision?: number;
  testId?: string;
  combineId?: string;
  variableIds?: string[];
  selected?: Record<string, string[]>;
  selectedCellIds?: string[];
  cellRuntimeProfiles?: AppMapCombineCellRuntimeProfile[];
  /** Explicit local execution target for every selected Test × world cell. */
  cellTargetBindings?: AppMapCombineCellTargetBinding[];
  laneId?: string;
  profileTargets?: {
    profileId: string;
    targetProfileId?: string;
    engine?: "chromium" | "firefox" | "webkit";
    account?:
      | { kind: "fixture"; accountId: string; accountRevision: string; reference?: string }
      | { kind: "signed-out"; attested: true };
    target: {
      targetKind?: "device" | "browser";
      serial?: string;
      platform?: "android" | "ios" | "browser";
      browserTargetId?: string;
    };
  }[];
  /** Required whenever a Combine uses explicit per-cell target bindings. */
  localAdmission?: LocalCombineCampaignAdmissionRequest;
  strategy?: "zip" | "cartesian" | "pairwise";
  serial?: string;
  platform?: "android" | "ios";
  targetKind?: "device" | "browser";
  browserTargetId?: string;
  title?: string;
  seed?: number;
  variables?: Record<string, string>;
  projectId?: string;
  capture?: AppMapCapturePolicy;
  surfaceCapture?: { forceRecaptureScreenIds: string[] };
  executionMode?: "all" | "pilot";
  pilotCaseIndex?: number;
  pilotCase?: Record<string, string>;
  cell?: string;
  defaultTargetProfileId?: string;
  sourceRevision?: SourceRevision;
  repeatRecovery?: Omit<
    RepeatCampaignExecutionIdentity,
    "executionAppMapRevision" | "rootRecipeId" | "pilotJobId" | "selectedCaseIds"
  >;
};

export type CombineStartResult = {
  batch: {
    id: string;
    recipeId: string;
    composedRecipeId: string;
    title: string;
    worlds: string[];
    createdAt: number;
  };
  matrix: unknown;
  cells: unknown;
  jobs: ReturnType<typeof summarizeJob>[];
  selectedCellIds: string[];
  plan: AppMapCompiledTest;
  admission?: {
    preflight: LocalCombineCampaignAdmission["preflight"];
    targetPreflights: LocalCombineCampaignAdmission["targetPreflights"];
  };
  campaign?: CombineCampaign;
  nativeCompanion?: AppMapNativeCompanionCompile;
};

export type CombineStartRouteContext = {
  request: http.IncomingMessage;
  response: http.ServerResponse;
  scope: RequestContext;
  runtime: JobRouteRuntime;
};

/**
 * Start one saved or ad-hoc Combine only after all cells, local capacity, and
 * leases are durable and compensable. It lives apart from generic job routes
 * because its campaign record is a transaction boundary, not a single job.
 */
export async function handleCombineStartRoute(context: CombineStartRouteContext): Promise<void> {
  const body = (await parseJsonBody(context.request)) as CombineStartRequest;
  json(context.response, 202, await executeCombineStart(context.scope, context.runtime, body));
}

export async function executeCombineStart(
  scope: RequestContext,
  runtime: JobRouteRuntime,
  raw: CombineStartRequest,
): Promise<CombineStartResult> {
  const body = await applyLaneToCombineStartOrThrow(scope.projectId, raw);
  const combineId = body.combineId?.trim();
  const appMapId = body.appMapId?.trim();
  const repeatTestId = body.repeatRecovery?.testId.trim();
  const unsignedLaneId = combineStartAdmissionLaneId(body);
  if (repeatTestId && appMapId) {
    return combineStartLocks.run(`${scope.projectId}:${appMapId}:test:${repeatTestId}`, () =>
      executeCombineStartUnlocked(scope, runtime, body),
    );
  }
  if (combineId && appMapId) {
    const laneLock = unsignedLaneId ? `:lane:${unsignedLaneId}` : "";
    return combineStartLocks.run(
      `${scope.projectId}:${appMapId}:combine:${combineId}${laneLock}`,
      () => executeCombineStartUnlocked(scope, runtime, body),
    );
  }
  return executeCombineStartUnlocked(scope, runtime, body);
}

const combineStartLocks = new KeyedSerialQueue();

async function executeCombineStartUnlocked(
  scope: RequestContext,
  runtime: JobRouteRuntime,
  body: CombineStartRequest,
): Promise<CombineStartResult> {
  if (!body.appMapId?.trim()) {
    throw new HttpError(400, "appMapId is required");
  }
  if (!body.testId?.trim() && !body.combineId?.trim()) {
    throw new HttpError(400, "combineId or testId is required");
  }
  if (!scope.localTrusted) {
    throw new HttpError(403, "Option matrix jobs require a project-owned store");
  }
  if (body.cellTargetBindings !== undefined && !Array.isArray(body.cellTargetBindings)) {
    throw new HttpError(400, "cellTargetBindings must be an array");
  }
  const hasExplicitCellTargets = body.cellTargetBindings !== undefined;
  const targetId = body.browserTargetId ?? body.serial;
  if (!targetId && !hasExplicitCellTargets && !body.profileTargets?.length) {
    throw new HttpError(400, "serial or browserTargetId is required");
  }
  const loaded = await readAppMap(scope.projectId, body.appMapId.trim());
  if (!loaded) throw new HttpError(404, `App Map ${body.appMapId} not found`);
  if (body.expectedRevision !== undefined && loaded.revision !== body.expectedRevision) {
    throw new HttpError(409, "The Test changed since this Run was prepared", {
      code: "TEST_REVISION_CONFLICT",
      recovery: "Reload the Test, review the saved changes, then start this Run again.",
    });
  }
  const combine = body.combineId?.trim() ? loaded.combines?.[body.combineId.trim()] : undefined;
  if (body.combineId?.trim() && !combine) {
    throw new HttpError(404, `Combination ${body.combineId} not found`);
  }
  if (body.repeatRecovery) {
    const activeRepeats = await findActiveRepeatCampaigns(
      scope.projectId,
      loaded.id,
      body.repeatRecovery.testId,
    );
    const active = activeRepeats[0];
    if (active) {
      throw new HttpError(409, "This Repeat already has unfinished work", {
        code: "ACTIVE_REPEAT_EXISTS",
        repeatId: active.id,
        recovery:
          "Return to the Test to inspect, continue, or stop the existing Repeat before starting another pilot.",
      });
    }
  }
  const unsignedLaneId = combineStartAdmissionLaneId(body);
  const invokedLaneId = body.laneId?.trim() || undefined;
  const fixtureHealthByReference = new Map<string, BrowserAuthenticationHealth>();
  if (combine) {
    const active = await findActiveCombineCampaignForCombine(
      scope.projectId,
      loaded.id,
      combine.id,
      unsignedLaneId,
    );
    if (active) {
      throw new HttpError(409, "This Repeat already has unfinished work", {
        code: "ACTIVE_REPEAT_EXISTS",
        repeatId: active.id,
        recovery:
          "Return to the Test to inspect, continue, or stop the existing Repeat before starting another pilot.",
      });
    }
  }
  const runTestOnce =
    Boolean(body.testId?.trim()) &&
    !combine &&
    !body.variableIds?.length &&
    !body.profileTargets?.length;
  if (runTestOnce) {
    requireSingleTestUseAppMapTestRun(body.appMapId.trim(), body.testId!.trim());
  }
  const targetKind = body.targetKind ?? (body.browserTargetId ? "browser" : "device");
  const requestedPlatform = body.browserTargetId ? ("browser" as const) : body.platform;
  if (
    !hasExplicitCellTargets &&
    !body.profileTargets?.length &&
    targetKind === "device" &&
    !requestedPlatform
  ) {
    throw new HttpError(400, "platform is required so Relay can bind each cell before discovery.");
  }
  const scopedCombine = combine
    ? body.capture
      ? {
          ...combine,
          captures: Object.fromEntries(combine.testIds.map((id) => [id, body.capture!])),
        }
      : combine
    : ephemeralCombineFromTest({
        mapId: loaded.id,
        organizationId: loaded.organizationId,
        projectId: loaded.projectId,
        testId: body.testId!.trim(),
        variableIds: body.variableIds ?? Object.keys(body.selected ?? {}),
        selected: body.selected,
        strategy: body.strategy,
        capture: body.capture,
        cellRuntimeProfiles: body.cellRuntimeProfiles,
      });
  const forceRecaptureScreenIds = body.surfaceCapture?.forceRecaptureScreenIds ?? [];
  const map = applyFullSurfaceDestinationBindings(
    loaded,
    scopedCombine.testIds,
    forceRecaptureScreenIds,
  );
  let staged: ReturnType<typeof stagePreparedAppMapCombineCells> | undefined;
  let admission: LocalCombineCampaignAdmission | undefined;
  let persistedCampaignId: string | undefined;
  try {
    await assertCombineInputDataSets(scope.projectId, map, scopedCombine, body);
    const reviewedDocumentOrigins = await activeReviewedDocumentOriginsForAppMap(map);
    const prepareInput = {
      map,
      combine: scopedCombine,
      selected: body.selected ?? scopedCombine.selected,
      strategy: body.strategy ?? scopedCombine.strategy,
      seed: body.seed,
      cellRuntimeProfiles: body.cellRuntimeProfiles ?? scopedCombine.cellRuntimeProfiles,
      cellTargetBindings: body.cellTargetBindings,
      selectedCellIds: body.selectedCellIds,
      defaultTargetProfileId: body.defaultTargetProfileId,
      readAppMap: (id: string) => readAppMap(scope.projectId, id),
      ...(targetId && !body.profileTargets?.length
        ? {
            target: {
              targetId,
              platform: requestedPlatform ?? "browser",
            },
          }
        : {}),
      compileOptions: {
        reviewedDocumentOrigins,
        ...(forceRecaptureScreenIds.length
          ? { forceRecaptureSurfaceScreenIds: forceRecaptureScreenIds }
          : {}),
      },
      ...(invokedLaneId ? { laneId: invokedLaneId } : {}),
    };
    const prepared = assertPreparedCombineCells(
      await (body.profileTargets?.length
        ? (() => {
            const profilePrepared = body.profileTargets!.map(async (profileTarget) => {
              const target = profileTarget.target;
              const profileTargetId = target.browserTargetId ?? target.serial;
              if (!profileTargetId) throw new HttpError(400, "Each profile target needs an id");
              const runtimeProfileIds = savedAppMapTargetProfileIdsForTarget(map, {
                targetId: profileTargetId,
                platform: target.platform ?? "browser",
              });
              const targetProfileId = inheritSavedRuntimeProfileId({
                savedIds: runtimeProfileIds,
                platform: target.platform ?? "browser",
                targetId: profileTargetId,
                explicitProfileId: profileTarget.targetProfileId,
              });
              if (!targetProfileId) {
                throw new HttpError(
                  409,
                  `Environment profile ${profileTarget.profileId} has no unique saved runtime profile for ${profileTargetId}.`,
                  {
                    code: "APP_MAP_COMBINE_RUNTIME_PROFILE_REQUIRED",
                    targetProfileIds: runtimeProfileIds,
                    recovery:
                      "Capture or explicitly bind one saved runtime profile for this target.",
                  },
                );
              }
              if (profileTarget.account || profileTarget.engine) {
                const saved = savedBrowserIdentityForProfile(
                  map,
                  targetProfileId,
                  profileTarget.profileId,
                  profileTarget.targetProfileId,
                );
                const listed = await listBrowserAuthenticationFixtures({
                  projectId: scope.projectId,
                  targetId: profileTargetId,
                });
                const bound = bindRequestedBrowserIdentity({
                  requested: {
                    ...(profileTarget.engine ? { engine: profileTarget.engine } : {}),
                    ...(profileTarget.account ? { account: profileTarget.account } : {}),
                  },
                  saved,
                  platform:
                    target.platform ??
                    (target.browserTargetId || profileTarget.engine || profileTarget.account
                      ? "browser"
                      : saved.platform),
                  accountFixtureIds: accountFixtureIdsFromListed(listed),
                  listedFixtures: listed,
                  listedFixtureAuthority: true,
                });
                if (bound.status === "blocked") {
                  throw new HttpError(409, bound.reason, {
                    code: "REQUESTED_ACCOUNT_MISMATCH",
                    recovery:
                      "Use the exact saved account fixture revision, or capture a matching runtime profile before running.",
                  });
                }
                const attached = await attachBrowserAuthenticationHealth(listed);
                for (const fixture of attached) {
                  fixtureHealthByReference.set(fixture.reference, fixture.health);
                }
                const claimedReference =
                  (profileTarget.account?.kind === "fixture"
                    ? profileTarget.account.reference
                    : undefined) ?? saved.authenticationFixtureId;
                const accountBlocker = planAccountStartBlocker({
                  account: profileTarget.account,
                  savedFixtureReference: saved.authenticationFixtureId,
                  fixtures: attached,
                  readyCount: attached.filter(
                    (fixture) =>
                      fixture.reference === claimedReference && fixture.health.status === "ready",
                  ).length,
                });
                if (accountBlocker) {
                  const persisted = await persistAccountReloginPlanResult({
                    projectId: scope.projectId,
                    ownerId: currentOperationContext()?.actorId,
                    appMapId: map.id,
                    combineId: scopedCombine.id,
                    appMapRevision: map.revision,
                    testIds: scopedCombine.testIds,
                    targetProfileId: profileTarget.profileId,
                    detail: accountBlocker,
                    ...(profileTarget.account ? { account: profileTarget.account } : {}),
                    target:
                      target.platform === "ios" || target.platform === "android"
                        ? {
                            kind: "device" as const,
                            id: profileTargetId,
                            platform: target.platform,
                          }
                        : {
                            kind: "browser" as const,
                            id: profileTargetId,
                            platform: "browser",
                          },
                  }).catch(() => undefined);
                  throw new HttpError(409, accountBlocker, {
                    code: "ACCOUNT_NEEDS_RELOGIN",
                    recovery: "Open Sign-ins, complete OAuth, then Refresh.",
                    findings:
                      persisted?.findings ??
                      accountReloginFindingsReport({ detail: accountBlocker }),
                    ...(persisted ? { batchId: persisted.batchId } : {}),
                  });
                }
              }
              return prepareAppMapCombineCells({
                ...prepareInput,
                cellRuntimeProfiles: prepareInput.cellRuntimeProfiles?.map((profile) => ({
                  ...profile,
                  targetProfileId,
                })),
                defaultTargetProfileId: targetProfileId,
                target: {
                  targetId: profileTargetId,
                  platform: target.platform ?? "browser",
                },
              }).then((result) => ({ result, profileTarget }));
            });
            return Promise.all(profilePrepared).then((groups) => {
              const first = groups[0]!.result;
              const cells = groups.flatMap(({ result, profileTarget }) =>
                result.cells.map((cell) => ({
                  ...cell,
                  executionCaseId: combineProfileTargetExecutionCaseId(cell.cellId, profileTarget),
                })),
              );
              const selectedIds = new Set(
                groups.flatMap(({ result, profileTarget }) =>
                  result.selectedCells.map((cell) =>
                    combineProfileTargetExecutionCaseId(cell.cellId, profileTarget),
                  ),
                ),
              );
              const selectedCells = cells.filter((cell) => selectedIds.has(cell.executionCaseId));
              return {
                ...first,
                cells,
                selectedCells,
                selectedCellIds: selectedCells.map((cell) => cell.cellId),
                cellStates: groups.flatMap(({ result }) => result.cellStates),
              };
            });
          })()
        : prepareAppMapCombineCells(prepareInput)),
    );
    let selectedCells = prepared.selectedCells;
    if (body.cell?.trim()) {
      try {
        const selected = new Set(resolveCombineCellSelector(prepared.cells, body.cell));
        selectedCells = prepared.cells.filter((cell) => selected.has(cell.cellId));
      } catch (error) {
        if (error instanceof AppMapCombineWorldError) {
          throw new HttpError(409, error.message, { code: error.code });
        }
        throw error;
      }
      if (!selectedCells.length) {
        throw new HttpError(409, `Unknown Combine cell ${body.cell.trim()}.`);
      }
    }
    if (body.pilotCase) {
      const expectedIds = scopedCombine.variableIds;
      const actualIds = Object.keys(body.pilotCase);
      if (
        actualIds.length !== expectedIds.length ||
        actualIds.some((id) => !expectedIds.includes(id))
      ) {
        throw new HttpError(409, "The specified pilot does not name every Repeat dimension", {
          code: "REPEAT_PILOT_CASE_INVALID",
        });
      }
      const pilot = selectedCells.find((cell) =>
        expectedIds.every((id) => cell.values[id] === body.pilotCase![id]),
      );
      if (!pilot) {
        throw new HttpError(409, "The specified pilot is not in the selected Repeat scope", {
          code: "REPEAT_PILOT_CASE_NOT_SELECTED",
        });
      }
      selectedCells = [pilot, ...selectedCells.filter((cell) => cell.cellId !== pilot.cellId)];
    }
    const namedCells = Boolean(body.cell?.trim()) || Boolean(body.selectedCellIds?.length);
    await freezeCombineRunInputs({
      projectId: scope.projectId,
      cells: [...prepared.selectedCells, ...selectedCells],
      variables: body.variables,
      seed: prepared.matrix.seed,
    });
    const isPilotRun = body.executionMode !== "all" && !namedCells;
    const selectedToQueue = queueablePreparedCombineCells(
      isPilotRun ? selectedCells.slice(0, 1) : selectedCells,
    );
    if (!selectedToQueue.length) {
      const reason = (isPilotRun ? selectedCells.slice(0, 1) : selectedCells)
        .map((cell) => unrecordedPreparedCombineReason(cell))
        .find(Boolean);
      throw new HttpError(
        reason ? 409 : 400,
        reason ?? "No selected Combine cells to queue",
        reason ? { code: "UNSUPPORTED_PLATFORM" } : {},
      );
    }
    const cellAccountBlocker = await preparedCellsFixtureStartBlocker({
      projectId: scope.projectId,
      cells: selectedToQueue,
    });
    if (cellAccountBlocker) {
      const blocked =
        selectedToQueue.find((cell) =>
          cell.selectedRuntimeTargetProfile.browserCaseProfile?.authenticationFixtureId?.trim(),
        ) ?? selectedToQueue[0]!;
      const persisted = await persistAccountReloginPlanResult({
        projectId: scope.projectId,
        ownerId: currentOperationContext()?.actorId,
        appMapId: map.id,
        combineId: scopedCombine.id,
        appMapRevision: map.revision,
        testIds: scopedCombine.testIds,
        targetProfileId: blocked.targetProfileId,
        detail: cellAccountBlocker,
        target:
          blocked.executionTarget.platform === "ios" ||
          blocked.executionTarget.platform === "android"
            ? {
                kind: "device" as const,
                id: blocked.executionTarget.targetId,
                platform: blocked.executionTarget.platform,
              }
            : {
                kind: "browser" as const,
                id: blocked.executionTarget.targetId,
                platform: "browser",
              },
      }).catch(() => undefined);
      throw new HttpError(409, cellAccountBlocker, {
        code: "ACCOUNT_NEEDS_RELOGIN",
        recovery: "Open Sign-ins, complete OAuth, then Refresh.",
        findings:
          persisted?.findings ?? accountReloginFindingsReport({ detail: cellAccountBlocker }),
        ...(persisted ? { batchId: persisted.batchId } : {}),
      });
    }
    const accountVariableId = Object.values(map.variables).find(
      (variable) => variable.kind === "account",
    )?.id;
    const sharingBlocker = mutatingShareStartBlocker(
      map,
      selectedToQueue.map((cell) => {
        const accountId = combineCellShareAccountId({
          values: cell.values,
          accountVariableId,
          authenticationFixtureId:
            cell.selectedRuntimeTargetProfile.browserCaseProfile?.authenticationFixtureId,
        });
        return {
          testId: cell.testId,
          ...(accountId ? { accountId } : {}),
        };
      }),
    );
    if (sharingBlocker) {
      throw new HttpError(409, sharingBlocker, { code: "unsafe-starting-state" });
    }
    if (hasExplicitCellTargets && !body.localAdmission) {
      throw new HttpError(
        409,
        "Per-cell Combine target bindings require a local deadline admission request.",
        {
          code: "LOCAL_COMBINE_ADMISSION_REQUIRED",
          recovery:
            "Provide localAdmission with a current observed p50 or p95 duration and deadline. Relay will not queue multi-target work on assumed capacity.",
        },
      );
    }
    const observedTargetProfiles = buildTargetProfiles({
      devices: await runtime.listDevices().catch(() => []),
      targets: await listTargets(),
    });
    const requestedFixture = body.profileTargets
      ?.map((target) => (target.account?.kind === "fixture" ? target.account.reference : undefined))
      .find((reference): reference is string => Boolean(reference));
    const authenticationHealth = requestedFixture
      ? fixtureHealthByReference.get(requestedFixture)
      : undefined;
    const stageCells = (acceptedAdmission?: LocalCombineCampaignAdmission) =>
      stagePreparedAppMapCombineCells({
        cells: selectedToQueue,
        playerMapSnapshot: snapshotPlayerMap(map),
        referenceReviewMode: scopedCombine.referenceReviewMode ?? "human",
        combineId: scopedCombine.id,
        title: body.title ?? scopedCombine.name,
        ...(targetId
          ? {
              targetId,
              platform: requestedPlatform,
              targetKind,
              browserTargetId: body.browserTargetId,
            }
          : {}),
        targetForCell: (cell) => cell.executionTarget,
        operationContextForCell: acceptedAdmission?.operationContextForCell,
        unsignedLaneId,
        ...(invokedLaneId ? { laneId: invokedLaneId } : {}),
        ...(authenticationHealth ? { authenticationHealth } : {}),
        queuedTargetProfile: (cell, executionTarget) => {
          const queued = queuedAppMapTestTargetProfile({
            runtimeTargetProfile: cell.selectedRuntimeTargetProfile,
            observedTargetProfile: observedTargetProfiles.find(
              (profile) =>
                profile.targetId === executionTarget.targetId &&
                profile.source ===
                  (executionTarget.kind === "local-browser" ? "browser" : "device"),
            ),
            target: {
              kind: executionTarget.kind === "local-browser" ? "browser" : "device",
              targetId: executionTarget.targetId,
              platform: executionTarget.platform,
            },
          });
          const profileTarget = body.profileTargets?.find(
            (item) =>
              (cell.executionCaseId ?? cell.cellId) ===
              combineProfileTargetExecutionCaseId(cell.cellId, item),
          );
          return overlayRequestedBrowserAccountOnTargetProfile(queued, profileTarget?.account);
        },
        projectId: scope.projectId,
        ownerId: currentOperationContext()!.actorId,
        sourceRevision: body.sourceRevision,
      });
    if (body.localAdmission) {
      const admissionRequest = isPilotRun
        ? localCampaignAdmissionRequestForActiveWorkItems({
            request: body.localAdmission,
            activeWorkItems: localCampaignAdmissionWorkItemsForCombine(selectedToQueue),
            knownWorkItems: localCampaignAdmissionWorkItemsForCombine(prepared.selectedCells),
          })
        : body.localAdmission;
      const admitted = await admitAndStageLocalCombineCampaign({
        scope,
        cells: selectedToQueue,
        request: admissionRequest,
        runtime: {
          listDevices: runtime.listDevices,
          listDeviceLeases: runtime.listDeviceLeases,
          listTargetWorkers: runtime.listTargetWorkers,
          assertTargetControl: runtime.assertTargetControl,
          admitTargetControl: runtime.admitTargetControl,
          releaseDeviceLease: runtime.releaseDeviceLease,
          ...(runtime.verifyCampaignDurationCohortEvidence
            ? {
                verifyCampaignDurationCohortEvidence: runtime.verifyCampaignDurationCohortEvidence,
              }
            : {}),
        },
        stage: stageCells,
      });
      admission = admitted.admission;
      staged = admitted.staged;
    } else {
      const targetIds = combineStartControlTargetIds({
        ...(body.profileTargets ? { profileTargets: body.profileTargets } : {}),
        selectedCells: selectedToQueue,
        ...(targetId ? { fallbackTargetId: targetId } : {}),
      });
      if (!targetIds.length) throw new HttpError(400, "serial or browserTargetId is required");
      for (const selectedTargetId of targetIds)
        await runtime.assertTargetControl(scope, selectedTargetId);
      if (
        targetKind === "device" ||
        body.profileTargets?.some((item) => item.target.targetKind !== "browser")
      ) {
        try {
          await runtime.listDevices();
        } catch (error) {
          throw new HttpError(503, "Relay cannot verify the selected device", {
            code: "TARGET_DISCOVERY_UNAVAILABLE",
            targetId,
            detail: error instanceof Error ? error.message : String(error),
          });
        }
      }
      staged = stageCells();
    }
    let campaign;
    if (combine || body.profileTargets?.length) {
      const jobByCell = new Map(
        staged.jobs.map((job, index) => [
          selectedToQueue[index]?.executionCaseId ?? selectedToQueue[index]?.cellId,
          job,
        ]),
      );
      const cases = prepared.cells.map((cell, index) => {
        const executionId = cell.executionCaseId ?? cell.cellId;
        const job = jobByCell.get(executionId);
        const isPilot =
          isPilotRun &&
          executionId === (selectedToQueue[0]?.executionCaseId ?? selectedToQueue[0]?.cellId);
        const profileTarget = body.profileTargets?.find(
          (item) => executionId === combineProfileTargetExecutionCaseId(cell.cellId, item),
        );
        return {
          ...combineCampaignCaseFromPreparedCell(cell, {
            index,
            phase: isPilot ? "pilot" : "coverage",
            status: job ? "queued" : "pending",
            jobId: job?.id,
          }),
          ...(profileTarget?.account ? { account: structuredClone(profileTarget.account) } : {}),
          ...(profileTarget?.engine ? { engine: profileTarget.engine } : {}),
        };
      });
      const at = Date.now();
      if (body.repeatRecovery && (!isPilotRun || staged.jobs.length !== 1)) {
        throw new HttpError(409, "Repeat recovery identity requires exactly one pilot job");
      }
      const repeat = body.repeatRecovery
        ? {
            ...structuredClone(body.repeatRecovery),
            executionAppMapRevision: map.revision,
            rootRecipeId: selectedToQueue[0]!.plan.rootRecipeId,
            pilotJobId: staged.jobs[0]!.id,
            selectedCaseIds: prepared.selectedCells.map(
              (cell) => cell.executionCaseId ?? cell.cellId,
            ),
          }
        : undefined;
      campaign = {
        schemaVersion: 1 as const,
        id: staged.batchId,
        projectId: scope.projectId,
        ownerId: currentOperationContext()!.actorId,
        appMapId: map.id,
        combineId: scopedCombine.id,
        sourceRevision: map.revision,
        latestRevision: map.revision,
        ...(new Set(prepared.cells.map((cell) => executionTargetRefKey(cell.executionTarget)))
          .size === 1
          ? {
              target:
                prepared.cells[0]!.executionTarget.kind === "local-browser"
                  ? {
                      kind: "browser" as const,
                      id: prepared.cells[0]!.executionTarget.targetId,
                      platform: "browser" as const,
                    }
                  : {
                      kind: "device" as const,
                      id: prepared.cells[0]!.executionTarget.targetId,
                      platform: prepared.cells[0]!.executionTarget.platform,
                    },
            }
          : {}),
        status: isPilotRun ? ("pilot-running" as const) : ("running" as const),
        createdAt: at,
        updatedAt: at,
        cases,
        lineage: [
          {
            kind: "created" as const,
            at,
            appMapRevision: map.revision,
            actorId: currentOperationContext()!.actorId,
          },
        ],
        execution: {
          referenceReviewMode: scopedCombine.referenceReviewMode ?? "human",
          selected: body.selected ?? scopedCombine.selected,
          selectedCellIds: isPilotRun
            ? prepared.selectedCellIds
            : selectedToQueue.map((cell) => cell.cellId),
          ...(body.profileTargets?.length
            ? {
                selectedExecutionCaseIds: isPilotRun
                  ? prepared.selectedCells.map((cell) => cell.executionCaseId ?? cell.cellId)
                  : selectedToQueue.map((cell) => cell.executionCaseId ?? cell.cellId),
              }
            : {}),
          strategy: body.strategy ?? scopedCombine.strategy,
          seed: prepared.matrix.seed,
          title: body.title?.trim() || scopedCombine.name,
          ...(invokedLaneId ? { laneId: invokedLaneId } : {}),
          ...(unsignedLaneId ? { unsignedLaneId } : {}),
          ...(repeat ? { repeat } : {}),
          ...(admission
            ? {
                localAdmission: {
                  request: structuredClone(body.localAdmission!),
                  preflight: structuredClone(admission.preflight),
                  targetPreflights: structuredClone(admission.targetPreflights),
                  targets: structuredClone(admission.targets),
                },
              }
            : {}),
        },
      };
      await createCombineCampaign(campaign);
      persistedCampaignId = campaign.id;
    }
    const acceptedAdmission = admission;
    // A lease claim becomes durable only after every queued job is visible
    // and still held behind the scheduler stage. The following dispatch is
    // a no-throw transfer of that already validated batch.
    await acceptedAdmission?.commit();
    staged.activate();
    await acceptedAdmission?.finalize();
    admission = undefined;
    const queued = { batchId: staged.batchId, jobs: staged.dispatch() };
    staged = undefined;
    // From this point the campaign owns normal job cancellation/finalization
    // rather than this admission transaction's compensation path.
    persistedCampaignId = undefined;
    return {
      batch: {
        id: queued.batchId,
        recipeId: selectedToQueue[0]!.recipeSnapshot.id,
        composedRecipeId: selectedToQueue[0]!.recipeSnapshot.id,
        title: body.title ?? scopedCombine.name,
        worlds: prepared.cells.map((cell) => cell.worldLabel),
        createdAt: Date.now(),
      },
      matrix: prepared.matrix,
      cells: prepared.cellStates,
      jobs: queued.jobs.map((job) => summarizeJob(job)),
      selectedCellIds: selectedToQueue.map((cell) => cell.cellId),
      plan: selectedToQueue[0]!.plan,
      ...(selectedToQueue[0]!.nativeCompanion
        ? { nativeCompanion: selectedToQueue[0]!.nativeCompanion }
        : {}),
      ...(acceptedAdmission
        ? {
            admission: {
              preflight: acceptedAdmission.preflight,
              targetPreflights: acceptedAdmission.targetPreflights,
            },
          }
        : {}),
      ...(campaign ? { campaign } : {}),
    };
  } catch (error) {
    return await compensateCombineStartFailure({
      error,
      scope,
      map,
      targetId,
      requestedPlatform,
      staged,
      admission,
      persistedCampaignId,
    });
  }
}
