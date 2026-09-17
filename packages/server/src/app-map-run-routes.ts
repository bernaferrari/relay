import type http from "node:http";
import {
  AppMapCombineWorldError,
  AppMapCompileError,
  currentOperationContext,
  bindRegisteredWebDeploymentToProof,
  accountFixtureIdsFromListed,
  bindRequestedBrowserIdentity,
  listBrowserAuthenticationFixtures,
  unsignedBrowserLaneId,
  invokedBrowserLaneId,
  rememberedBrowserAuthenticationHealth,
  claimedFixtureStartBlocker,
  claimedBrowserJobStartBlocker,
  accountReloginFindingsReport,
  CasePlanError,
  buildTargetProfiles,
  compileAppMapConnection,
  compileAppMapFlow,
  findActiveCombineCampaignForCombine,
  listDevices,
  listDeviceLeases,
  listTargets,
  loadFrozenRawAccessibilityEvidence,
  prepareCaseStackPlan,
  preflightCompiledAppMapTestOffline,
  prepareRegisteredBuildForProof,
  readBuild,
  readAppMap,
  readProjectVariables,
  referencedRuntimeInputs,
  redactCasePlan,
  resolveJobDevicePlatform,
  savedAppMapTargetProfileIdsForTarget,
  saveAppMapCombine,
  sensitiveInputNames,
  unsupportedBrowserCaseProfileFields,
  upsertAppMapCombineFromTest,
  type Recipe,
} from "@relay/core";
import type { OperationInput } from "@relay/protocol";
import { assertTargetControl, targetLeaseBelongsToCaller } from "./access-control.js";
import { executeCombineStart } from "./combine-start-route.js";
import { applyAppMapMutation } from "./app-map-route-mutations.js";
import { HttpError, json, matchPath, parseJsonBody } from "./http.js";
import { parseLaneAwareTestRunBody } from "./lane-run-route.js";
import { defaultJobRouteRuntime } from "./job-routes.js";
import { queuedAppMapTestTargetProfile } from "./app-map-test-target-profile.js";
import { prepareAppMapCompanionTestRun } from "./app-map-test-run-prepare.js";
import { defaultTestRunRuntime, type AppMapRunRouteContext } from "./app-map-test-run-runtime.js";
import { assertRepeatWorkflowMutation } from "./repeat-workflow-receipt.js";
import {
  assertReviewedBrowserTargetProfile,
  explicitTargetAvailability,
  frozenEvidenceTargetProfileForTarget,
  offlinePreflightProfileRecovery,
} from "./app-map-run-target-admission.js";
import { appMapProofExecutionAdmission } from "./app-map-proof-execution-admission.js";

export {
  frozenTestRunTargetProfile,
  queuedAppMapTestTargetProfile,
} from "./app-map-test-target-profile.js";
export type {
  AppMapRunRouteContext,
  AppMapTestRunRouteRuntime,
} from "./app-map-test-run-runtime.js";
export {
  explicitTargetAvailability,
  frozenEvidenceTargetProfileForTarget,
  offlinePreflightProfileRecovery,
} from "./app-map-run-target-admission.js";

export async function handleAppMapRunRoute(input: AppMapRunRouteContext): Promise<boolean> {
  if (input.method !== "POST") return false;
  const runtime = { ...defaultTestRunRuntime, ...input.runtime };
  const testMatch = matchPath(input.pathname, "/app-maps/:appMapId/tests/:testId/run");
  if (testMatch) {
    const body = await parseLaneAwareTestRunBody(
      input.request,
      input.scope.projectId,
      testMatch.appMapId!,
    );
    if (body.repeatRecovery?.workflowMutation) {
      await assertRepeatWorkflowMutation({
        scope: input.scope,
        mutation: body.repeatRecovery.workflowMutation,
      });
    }
    const map = await readAppMap(input.scope.projectId, testMatch.appMapId!);
    if (!map) throw new HttpError(404, `App Map ${testMatch.appMapId} not found`);
    if (map.revision !== body.expectedRevision) {
      throw new HttpError(
        409,
        `Expected App Map revision ${body.expectedRevision}, current revision is ${map.revision}`,
        {
          code: "revision-conflict",
          currentRevision: map.revision,
          recovery: "Reload the Test and run its current saved revision.",
        },
      );
    }
    const test = map.tests[testMatch.testId!];
    if (!test) throw new HttpError(404, `Test ${testMatch.testId} not found`);

    if (body.in) {
      const repeatEntry = Object.entries(body.in);
      if (
        body.repeatRecovery &&
        (repeatEntry.length === 0 || (body.lens !== "visual" && body.lens !== "smoke"))
      ) {
        throw new HttpError(
          400,
          "Repeat recovery requires dimensions and an explicit visual or smoke evidence lens",
        );
      }
      let upserted;
      try {
        upserted = upsertAppMapCombineFromTest({
          map,
          testId: test.id,
          selected: body.in,
          variableIds: body.repeatRecovery?.resolved.dimensions.map((dimension) => dimension.id),
          strategy: body.strategy,
          ...(body.repeatRecovery?.spec.pilot ||
          body.repeatRecovery?.spec.resume ||
          body.repeatRecovery?.spec.dimensions.some((dimension) => !Array.isArray(dimension.values))
            ? {
                repeatPolicy: {
                  ...(body.repeatRecovery.spec.pilot
                    ? { pilot: structuredClone(body.repeatRecovery.spec.pilot) }
                    : {}),
                  ...(body.repeatRecovery.spec.resume
                    ? { resume: body.repeatRecovery.spec.resume }
                    : {}),
                  valueModes: Object.fromEntries(
                    body.repeatRecovery.spec.dimensions.flatMap((dimension) =>
                      Array.isArray(dimension.values)
                        ? []
                        : [[dimension.id, dimension.values] as const],
                    ),
                  ),
                },
              }
            : {}),
          ...(body.lens ? { lens: body.lens } : {}),
        });
      } catch (error) {
        if (error instanceof AppMapCombineWorldError) {
          throw new HttpError(409, error.message, { code: error.code });
        }
        throw error;
      }
      const activeRepeat = await findActiveCombineCampaignForCombine(
        input.scope.projectId,
        map.id,
        upserted.combine.id,
      );
      if (activeRepeat) {
        throw new HttpError(409, "This Repeat already has unfinished work", {
          code: "ACTIVE_REPEAT_EXISTS",
          repeatId: activeRepeat.id,
          recovery:
            "Return to the Test to inspect, continue, or stop the existing Repeat before starting another pilot.",
        });
      }
      const saved = await applyAppMapMutation(
        input.scope,
        map.id,
        body.expectedRevision,
        undefined,
        (current, context) => saveAppMapCombine(current, upserted.combine, context),
      );
      const started = await executeCombineStart(
        input.scope,
        { ...defaultJobRouteRuntime, ...input.combineRuntime },
        {
          appMapId: saved.id,
          combineId: upserted.combine.id,
          serial: body.target.kind === "device" ? body.target.targetId : undefined,
          browserTargetId: body.target.kind === "browser" ? body.target.targetId : undefined,
          platform: body.target.platform === "browser" ? undefined : body.target.platform,
          targetKind: body.target.kind,
          selected: body.in,
          strategy: body.strategy,
          ...(body.pilotCase ? { pilotCase: body.pilotCase } : {}),
          capture: upserted.capture,
          ...(body.surfaceCapture ? { surfaceCapture: body.surfaceCapture } : {}),
          executionMode: body.executionMode ?? "pilot",
          cell: body.cell,
          defaultTargetProfileId: body.targetProfileId,
          title: upserted.combine.name,
          ...(body.laneId?.trim() ? { laneId: body.laneId.trim() } : {}),
          ...(body.sourceRevision ? { sourceRevision: body.sourceRevision } : {}),
          ...(body.repeatRecovery
            ? {
                repeatRecovery: {
                  schemaVersion: 1,
                  requestedAppMapRevision: body.expectedRevision,
                  testId: test.id,
                  testPlanDigest: body.repeatRecovery.testPlanDigest,
                  target: structuredClone(body.target),
                  spec: structuredClone(body.repeatRecovery.spec),
                  resolved: structuredClone(body.repeatRecovery.resolved),
                  evidence: body.lens === "smoke" ? "smoke" : "visual",
                  ...(body.sourceRevision
                    ? { sourceRevision: structuredClone(body.sourceRevision) }
                    : {}),
                  ...(body.surfaceCapture
                    ? {
                        capture: {
                          fullSurfaceScreenIds: [...body.surfaceCapture.forceRecaptureScreenIds],
                        },
                      }
                    : {}),
                },
              }
            : {}),
        },
      );
      const job = started.jobs[0];
      if (!job) throw new HttpError(500, "Combine start returned no jobs");
      json(input.response, 202, {
        planIdentity: {
          appMapId: started.plan.appMapId,
          appMapRevision: started.plan.appMapRevision,
          testId: started.plan.test.id,
          rootRecipeId: started.plan.rootRecipeId,
        },
        plan: started.plan,
        job,
        jobs: started.jobs,
        combine: { id: upserted.combine.id, revision: saved.revision },
        ...(started.campaign
          ? {
              campaign: {
                id: started.campaign.id,
                selectedCellIds: started.selectedCellIds,
              },
            }
          : {}),
        ...(started.nativeCompanion ? { nativeCompanion: started.nativeCompanion } : {}),
      });
      return true;
    }

    const targetProfileId = body.targetProfileId?.trim() || undefined;
    const prepared = await prepareAppMapCompanionTestRun({
      map,
      test,
      target: body.target,
      ...(targetProfileId ? { targetProfileId } : {}),
      projectId: input.scope.projectId,
      compileOptions: {
        forceRecaptureSurfaceScreenIds: body.surfaceCapture?.forceRecaptureScreenIds,
        entryCheckpointScreenId:
          body.startup?.mode === "verified-checkpoint" ? body.startup.screenId : undefined,
        startupMode:
          body.startup?.mode === "cold" || body.startup?.mode === "warm"
            ? body.startup.mode
            : "warm",
      },
    });
    const compiled = prepared.compiled;
    const runtimeTargetProfile = prepared.runtimeTargetProfile;
    const executionTarget = prepared.executionTarget;
    const targetId = executionTarget.targetId.trim();
    const requestedTarget = { targetId, platform: executionTarget.platform };
    if (body.account || body.engine) {
      const savedBrowser = runtimeTargetProfile?.browserCaseProfile;
      const listed = await listBrowserAuthenticationFixtures({
        projectId: input.scope.projectId,
        targetId,
      });
      const bound = bindRequestedBrowserIdentity({
        requested: {
          ...(body.engine ? { engine: body.engine } : {}),
          ...(body.account ? { account: body.account } : {}),
        },
        saved: {
          ...(savedBrowser?.engine ? { engine: savedBrowser.engine } : {}),
          ...(savedBrowser?.authenticationFixtureId
            ? { authenticationFixtureId: savedBrowser.authenticationFixtureId }
            : {}),
        },
        platform: executionTarget.platform,
        accountFixtureIds: accountFixtureIdsFromListed(listed),
      });
      if (bound.status === "blocked") {
        throw new HttpError(409, bound.reason, {
          code: "REQUESTED_ACCOUNT_MISMATCH",
          recovery:
            "Use the exact saved account fixture revision, or capture a matching runtime profile before running.",
        });
      }
    }
    const savedFixtureReference =
      runtimeTargetProfile?.browserCaseProfile?.authenticationFixtureId?.trim();
    const accountBlocker = await claimedFixtureStartBlocker({
      projectId: input.scope.projectId,
      targetId,
      ...(body.account ? { account: body.account } : {}),
      ...(savedFixtureReference ? { savedFixtureReference } : {}),
    });
    if (accountBlocker) {
      throw new HttpError(409, accountBlocker, {
        code: "ACCOUNT_NEEDS_RELOGIN",
        recovery: "Open Sign-ins, complete OAuth, then Refresh.",
        findings: accountReloginFindingsReport({ detail: accountBlocker }),
      });
    }
    const plan = compiled.plan;
    const preflight = preflightCompiledAppMapTestOffline(
      plan,
      await loadFrozenRawAccessibilityEvidence(plan),
      runtimeTargetProfile ? { targetProfileId: runtimeTargetProfile.id } : {},
    );
    if (preflight.summary.blockers) {
      throw new HttpError(
        409,
        "Offline Test preflight is blocked; Relay did not control the target",
        {
          code: "TEST_OFFLINE_PREFLIGHT_BLOCKED",
          ...(runtimeTargetProfile ? { runtimeTargetProfile } : {}),
          preflight,
          recovery: offlinePreflightProfileRecovery({
            runtimeTargetProfile,
            explicit: Boolean(targetProfileId),
            candidates: savedAppMapTargetProfileIdsForTarget(
              prepared.executionMap,
              requestedTarget,
            ),
            target: requestedTarget,
          }),
        },
      );
    }

    const proofEvidencePolicy = appMapProofExecutionAdmission({
      authority: input.proofExecutionAuthority,
      preflight,
    });

    // Freeze and validate every executable byte before Relay asks the target
    // controller for a lease. A malformed graph or intent is an offline
    // review problem, never a reason to touch the selected target first.
    const recipeGraph: Record<string, Recipe> = Object.fromEntries(
      Object.values(compiled.graph).map((recipe) => [recipe.id, structuredClone(recipe)]),
    );
    const recipeSnapshot = recipeGraph[plan.rootRecipeId];
    if (!recipeSnapshot) throw new HttpError(500, "Compiled Test has no root recipe");
    const operation = currentOperationContext();
    if (!operation) throw new HttpError(500, "App Map execution context is unavailable");
    const queuedAt = Date.now();
    let executionIntent;
    try {
      executionIntent = runtime.createAppMapTestExecutionIntent({
        plan,
        recipeGraph,
        preflight,
        ...(body.laneId?.trim() ? { laneId: body.laneId.trim() } : {}),
      });
    } catch (error) {
      throw new HttpError(
        409,
        "Offline Test execution intent is invalid; Relay did not control the target",
        {
          code: "TEST_OFFLINE_PREFLIGHT_BLOCKED",
          detail: error instanceof Error ? error.message : String(error),
          recovery: "Review the frozen Test plan and evidence, then start a new scoped Test run.",
        },
      );
    }

    let observedDevices: Awaited<ReturnType<typeof listDevices>> | undefined;
    if (executionTarget.kind === "device") {
      const operation = currentOperationContext();
      const activeLease = operation
        ? (await listDeviceLeases(input.scope.projectId)).some(
            (lease) =>
              lease.deviceSerial === targetId &&
              targetLeaseBelongsToCaller(input.scope, lease, operation.actorId) &&
              lease.status === "leased" &&
              lease.expiresAt > Date.now(),
          )
        : false;
      // A durable Proof must bind to a fresh target observation on every
      // admission. An actor-owned lease proves control authority, not that the
      // device still has the reviewed OS/runtime identity.
      if (!activeLease || input.proofExecutionAuthority) {
        try {
          observedDevices = await runtime.listDevices();
        } catch (error) {
          throw new HttpError(503, "Relay cannot verify the selected device", {
            code: "TARGET_DISCOVERY_UNAVAILABLE",
            targetId,
            detail: error instanceof Error ? error.message : String(error),
            recovery:
              "Reconnect the device or restart Relay, then refresh the target list before retrying.",
            recoveryAction: {
              operationId: "target.devices.list",
              cli: { argv: ["device", "list"] },
            },
          });
        }
        const availability = explicitTargetAvailability(targetId, observedDevices);
        if (availability === "missing") {
          throw new HttpError(409, `Target ${targetId} is not connected`, {
            code: "TARGET_NOT_CONNECTED",
            targetId,
            recovery: "Connect the device, unlock it, and refresh the target list before retrying.",
            recoveryAction: {
              operationId: "target.devices.list",
              cli: { argv: ["device", "list"] },
            },
          });
        }
        if (availability === "not-ready") {
          throw new HttpError(409, `Target ${targetId} is not ready for control`, {
            code: "TARGET_NOT_READY",
            targetId,
            recovery:
              "Unlock or authorize the device, then refresh the target list before retrying.",
            recoveryAction: {
              operationId: "target.devices.list",
              cli: { argv: ["device", "list"] },
            },
          });
        }
      }
    }
    const observedTargetProfile = (
      await buildTargetProfiles({
        devices: observedDevices ?? (await runtime.listDevices().catch(() => [])),
        targets: await listTargets(),
      })
    ).find(
      (profile) =>
        profile.targetId === targetId &&
        profile.platform === executionTarget.platform &&
        profile.source === executionTarget.kind,
    );
    const targetProfile = queuedAppMapTestTargetProfile({
      runtimeTargetProfile,
      observedTargetProfile,
      target: executionTarget,
    });
    const selectedSurface = plan.testFamily?.targetSurface;
    const isReviewedRoute = plan.testFamily?.mode === "reviewed-route-variant";
    if (isReviewedRoute && selectedSurface?.platform === "browser") {
      assertReviewedBrowserTargetProfile({
        targetId,
        targetSurface: selectedSurface,
        observedBrowser: targetProfile?.browserCaseProfile,
        routeVariantId: plan.testFamily?.selectedRouteVariant?.id,
      });
    }
    let buildProvenance: Awaited<ReturnType<typeof prepareRegisteredBuildForProof>> | undefined;
    let webBuildBinding:
      | {
          id: string;
          platform: "web";
          artifactDigest: `sha256:${string}`;
          sourceSha: string;
          configuration: string;
          environmentRevision: string;
        }
      | undefined;
    const sourceRevision = body.sourceRevision;
    const buildId = sourceRevision?.buildId;
    if (input.proofExecutionAuthority && executionTarget.kind === "browser") {
      const authority = input.proofExecutionAuthority;
      if (
        !sourceRevision ||
        !sourceRevision.buildId ||
        !authority.buildId ||
        sourceRevision.buildId !== authority.buildId ||
        (authority.sourceSha !== undefined && sourceRevision.sha !== authority.sourceSha) ||
        (authority.artifactDigest !== undefined &&
          sourceRevision.artifactDigest !== authority.artifactDigest)
      ) {
        throw new HttpError(
          409,
          "Browser Proof execution is missing its exact frozen deployment identity",
          {
            code: "PROOF_INSUFFICIENT_EVIDENCE",
            targetId,
            recovery:
              "Create a new Proof with a provider-verified web deployment bound to the exact tested revision.",
          },
        );
      }
    }
    if (buildId) {
      const build = await runtime.readBuild(input.scope.projectId, buildId);
      if (!build) {
        throw new HttpError(409, `Registered Proof build ${buildId} was not found`, {
          code: "PROOF_BUILD_NOT_FOUND",
          buildId,
        });
      }
      if (executionTarget.kind === "browser") {
        try {
          const bound = bindRegisteredWebDeploymentToProof({
            build,
            changeTestedSha: sourceRevision!.sha,
          });
          if (
            sourceRevision!.buildId !== bound.id ||
            sourceRevision!.artifactDigest !== bound.artifactDigest ||
            (input.proofExecutionAuthority?.buildId !== undefined &&
              input.proofExecutionAuthority.buildId !== bound.id) ||
            (input.proofExecutionAuthority?.sourceSha !== undefined &&
              input.proofExecutionAuthority.sourceSha !== bound.sourceSha) ||
            (input.proofExecutionAuthority?.artifactDigest !== undefined &&
              input.proofExecutionAuthority.artifactDigest !== bound.artifactDigest)
          ) {
            throw new Error("browser deployment does not match the frozen Proof build identity");
          }
          webBuildBinding = bound;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new HttpError(409, message, {
            code: "PROOF_BUILD_INVALID",
            buildId,
            targetId,
            recovery:
              "Bind a provider-verified deployment URL and digest to the exact Proof tested SHA before retrying.",
          });
        }
      } else {
        const targetKind = observedDevices?.find((device) => device.serial === targetId)?.kind;
        try {
          buildProvenance = await runtime.prepareBuildForProof({
            build,
            target: { kind: "device", platform: executionTarget.platform, serial: targetId },
            targetKind,
            sourceSha: sourceRevision!.sha,
            artifactDigest: sourceRevision!.artifactDigest ?? "",
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new HttpError(409, message, {
            code: message.startsWith("PROOF_INSUFFICIENT_EVIDENCE")
              ? "PROOF_INSUFFICIENT_EVIDENCE"
              : "PROOF_BUILD_INVALID",
            buildId,
            targetId,
            recovery: "Install and verify the exact registered build before retrying this Proof.",
          });
        }
      }
    }
    if (input.proofExecutionAuthority && executionTarget.kind === "browser" && !webBuildBinding) {
      throw new HttpError(409, "Browser Proof execution requires a verified deployment binding", {
        code: "PROOF_INSUFFICIENT_EVIDENCE",
        targetId,
        recovery:
          "Bind a provider-verified deployment URL and digest to the exact Proof tested SHA before retrying.",
      });
    }
    const queuedSourceRevision = webBuildBinding
      ? {
          vcs: "git" as const,
          sha: webBuildBinding.sourceSha,
          artifactDigest: webBuildBinding.artifactDigest,
          buildId: webBuildBinding.id,
        }
      : sourceRevision;
    await runtime.assertTargetControl(input.scope, targetId);
    const planIdentity = {
      appMapId: plan.appMapId,
      appMapRevision: plan.appMapRevision,
      testId: plan.test.id,
      rootRecipeId: plan.rootRecipeId,
    };
    const unsignedLaneId = unsignedBrowserLaneId({
      laneId: body.laneId,
      authenticationFixtureId: targetProfile?.browserCaseProfile?.authenticationFixtureId,
      accountKind: body.account?.kind,
      targetKind: executionTarget.kind,
    });
    const laneId = invokedBrowserLaneId({
      laneId: body.laneId,
      unsignedLaneId,
    });
    const fixtureReference = targetProfile?.browserCaseProfile?.authenticationFixtureId?.trim();
    const authenticationHealth = fixtureReference
      ? await rememberedBrowserAuthenticationHealth(fixtureReference)
      : undefined;
    const job = runtime.enqueueJob({
      recipe: recipeSnapshot.id,
      title: recipeSnapshot.title,
      recipeSnapshot,
      recipeGraph,
      serial: executionTarget.kind === "device" ? targetId : undefined,
      platform: executionTarget.kind === "device" ? executionTarget.platform : undefined,
      targetKind: executionTarget.kind,
      browserTargetId: executionTarget.kind === "browser" ? targetId : undefined,
      ...(targetProfile ? { targetProfile } : {}),
      ...(laneId ? { laneId } : {}),
      ...(unsignedLaneId ? { unsignedLaneId } : {}),
      ...(authenticationHealth ? { authenticationHealth } : {}),
      ...(queuedSourceRevision ? { sourceRevision: queuedSourceRevision } : {}),
      ...(proofEvidencePolicy ? { evidencePolicy: proofEvidencePolicy } : {}),
      artifacts: [
        ...(input.proofExecutionAuthority?.humanInterventionEvidence
          ? [
              {
                kind: "proof-human-intervention-evidence",
                capturedAt: input.proofExecutionAuthority.humanInterventionEvidence.recordedAt,
                data: structuredClone(input.proofExecutionAuthority.humanInterventionEvidence),
              },
            ]
          : []),
        ...(buildProvenance
          ? [
              {
                kind: "proof-build-provenance",
                capturedAt: buildProvenance.observation.observedAt,
                data: structuredClone(buildProvenance),
              },
            ]
          : []),
        ...(webBuildBinding
          ? [
              {
                kind: "proof-web-deployment-binding",
                capturedAt: queuedAt,
                data: {
                  ...structuredClone(webBuildBinding),
                  schemaVersion: 1,
                  buildId: webBuildBinding.id,
                  target: { kind: "browser", id: targetId, platform: "browser" },
                  observation: {
                    status: "verified",
                    observedAt: queuedAt,
                    artifactDigest: webBuildBinding.artifactDigest,
                  },
                },
              },
            ]
          : []),
        ...(body.workflowRequestId
          ? [
              {
                kind: "app-map-test-workflow-request",
                capturedAt: queuedAt,
                data: { schemaVersion: 1, requestId: body.workflowRequestId },
              },
            ]
          : []),
        {
          kind: "app-map-test-execution-intent",
          capturedAt: queuedAt,
          data: executionIntent,
        },
        {
          kind: "app-map-test-plan",
          capturedAt: queuedAt,
          data: plan,
        },
        {
          kind: "app-map-test-preflight",
          capturedAt: queuedAt,
          data: {
            schemaVersion: 1,
            ...(runtimeTargetProfile
              ? { runtimeTargetProfile: structuredClone(runtimeTargetProfile) }
              : {}),
            report: structuredClone(preflight),
          },
        },
      ],
      projectId: input.scope.projectId,
      ownerId: operation.actorId,
    });
    json(input.response, 202, {
      planIdentity,
      plan,
      job,
      ...(compiled.nativeCompanion ? { nativeCompanion: compiled.nativeCompanion } : {}),
    });
    return true;
  }
  const flowMatch = matchPath(input.pathname, "/app-maps/:appMapId/flows/:flowId/run");
  const connectionMatch = matchPath(
    input.pathname,
    "/app-maps/:appMapId/connections/:connectionId/run",
  );
  if (!flowMatch && !connectionMatch) return false;
  const appMapId = (flowMatch ?? connectionMatch)!.appMapId!;
  const operationKind = flowMatch ? "flow" : "connection";

  const body = (await parseJsonBody(input.request)) as Omit<
    OperationInput<"app-map.flow.run"> | OperationInput<"app-map.connection.run">,
    "appMapId" | "flowId" | "connectionId"
  >;
  const targetId = body.browserTargetId?.trim() || body.serial?.trim();
  if (!targetId) throw new HttpError(400, "Choose a target before running this flow");
  const targetKind = body.browserTargetId ? ("browser" as const) : (body.targetKind ?? "device");

  // A stale physical serial should not produce a lease-recovery message. A
  // valid existing lease remains authoritative for remote and test-double
  // targets, so only preflight when this actor does not already hold one.
  let observedDevices: Awaited<ReturnType<typeof listDevices>> | undefined;
  const observedTargets = await listTargets();
  const observedBrowserTarget = observedTargets.find(
    (target) => target.id === targetId && target.kind === "browser",
  );
  if (targetKind === "browser" && !observedBrowserTarget) {
    throw new HttpError(409, `Managed browser target ${targetId} is unavailable`, {
      code: "TARGET_NOT_CONNECTED",
      targetId,
      recovery: "Restore or recreate the managed browser target before running this flow.",
    });
  }
  if (targetKind === "browser" && observedBrowserTarget) {
    const browserProfile = buildTargetProfiles({ devices: [], targets: [observedBrowserTarget] })[0]
      ?.browserCaseProfile;
    const unsupported = browserProfile ? unsupportedBrowserCaseProfileFields(browserProfile) : [];
    if (unsupported.length) {
      throw new HttpError(
        409,
        `Managed browser target ${targetId} requires unavailable host resolvers: ${unsupported.join(", ")}`,
        {
          code: "BROWSER_PROFILE_UNSUPPORTED",
          targetId,
          unsupported,
          recovery:
            "Remove unsupported fixture references or install their host resolvers before running this flow.",
        },
      );
    }
  }
  if (targetKind === "device" && body.serial?.trim()) {
    const operation = currentOperationContext();
    const activeLease = operation
      ? (await listDeviceLeases(input.scope.projectId)).some(
          (lease) =>
            lease.deviceSerial === targetId &&
            targetLeaseBelongsToCaller(input.scope, lease, operation.actorId) &&
            lease.status === "leased" &&
            lease.expiresAt > Date.now(),
        )
      : false;
    if (!activeLease) {
      try {
        observedDevices = await listDevices();
      } catch (error) {
        throw new HttpError(503, "Relay cannot verify the selected device", {
          code: "TARGET_DISCOVERY_UNAVAILABLE",
          targetId,
          detail: error instanceof Error ? error.message : String(error),
          recovery:
            "Reconnect the device or restart Relay, then refresh the target list before retrying.",
          recoveryAction: { operationId: "target.devices.list", cli: { argv: ["device", "list"] } },
        });
      }
      const availability = explicitTargetAvailability(targetId, observedDevices);
      if (availability === "missing") {
        throw new HttpError(409, `Target ${targetId} is not connected`, {
          code: "TARGET_NOT_CONNECTED",
          targetId,
          recovery: "Connect the device, unlock it, and refresh the target list before retrying.",
          recoveryAction: { operationId: "target.devices.list", cli: { argv: ["device", "list"] } },
        });
      }
      if (availability === "not-ready") {
        throw new HttpError(409, `Target ${targetId} is not ready for control`, {
          code: "TARGET_NOT_READY",
          targetId,
          recovery: "Unlock or authorize the device, then refresh the target list before retrying.",
          recoveryAction: { operationId: "target.devices.list", cli: { argv: ["device", "list"] } },
        });
      }
    }
  }
  await assertTargetControl(input.scope, targetId);

  const map = await readAppMap(input.scope.projectId, appMapId);
  if (!map) throw new HttpError(404, `App Map ${appMapId} not found`);

  let plan;
  try {
    const throughConnectionId = flowMatch
      ? (body as OperationInput<"app-map.flow.run">).throughConnectionId?.trim()
      : undefined;
    plan = flowMatch
      ? compileAppMapFlow(
          map,
          flowMatch.flowId!,
          throughConnectionId ? { throughConnectionId } : {},
        )
      : compileAppMapConnection(map, connectionMatch!.connectionId!);
  } catch (error) {
    if (error instanceof AppMapCompileError) {
      throw new HttpError(
        error.code === "missing-flow" || error.code === "missing-connection" ? 404 : 409,
        error.message,
        {
          code: error.code,
          recovery:
            error.code === "draft-connection"
              ? "Finish or remove the draft connection, then run the flow again."
              : "Capture and approve the destination screen, then run the flow again.",
        },
      );
    }
    throw error;
  }

  const recipeGraph: Record<string, Recipe> = Object.fromEntries(
    Object.values(plan.recipes).map((compiled) => [
      compiled.id,
      {
        id: compiled.id,
        title: compiled.title,
        ...(compiled.description ? { description: compiled.description } : {}),
        ...(compiled.parameters.length ? { parameters: compiled.parameters } : {}),
        source: "custom" as const,
        steps: compiled.steps,
        createdAt: map.createdAt,
        updatedAt: map.updatedAt,
      },
    ]),
  );
  const recipeSnapshot = recipeGraph[plan.rootRecipeId]!;
  const operation = currentOperationContext();
  if (!operation) throw new HttpError(500, "App Map execution context is unavailable");
  const definitions = await readProjectVariables(input.scope.projectId);
  let matrix;
  try {
    matrix = plan.caseStacks.length
      ? await prepareCaseStackPlan({
          variables: definitions.value,
          caseStacks: plan.caseStacks,
          runtimeValues: body.variables,
        })
      : undefined;
  } catch (error) {
    if (error instanceof CasePlanError) {
      throw new HttpError(409, error.message, {
        code: error.code,
        recovery:
          error.code === "missing-private-value"
            ? "Set your private value locally or pass it in this run request."
            : error.code === "generation-failed"
              ? "Check the generation provider or add a fallback value to this variable."
              : "Open the Case Stack and adjust its variables or coverage strategy.",
      });
    }
    throw error;
  }
  const constantVariables = referencedRuntimeInputs(recipeGraph, definitions.value, body.variables);
  const cases = matrix?.cases ?? [
    { id: "default", name: "Default", index: 0, values: {}, provenance: [] },
  ];
  const safeMatrix = matrix ? redactCasePlan(matrix, definitions.value) : undefined;
  const targetProfile = (
    await buildTargetProfiles({
      devices: observedDevices ?? (await listDevices().catch(() => [])),
      targets: observedTargets,
    })
  ).find(
    (profile) =>
      profile.targetId === targetId &&
      profile.source === targetKind &&
      (targetKind === "browser" ||
        profile.platform === body.platform ||
        body.platform === undefined),
  );
  const platform =
    targetKind === "browser"
      ? undefined
      : (body.platform ?? (await resolveJobDevicePlatform(body.serial)));
  const flowAccount = await claimedBrowserJobStartBlocker({
    projectId: input.scope.projectId,
    targetId,
    browserCaseProfile: targetProfile?.browserCaseProfile,
    targetProfile,
  });
  if (flowAccount.blocker) {
    throw new HttpError(409, flowAccount.blocker, {
      code: "ACCOUNT_NEEDS_RELOGIN",
      recovery: "Open Sign-ins, complete OAuth, then Refresh.",
      findings: accountReloginFindingsReport({ detail: flowAccount.blocker }),
    });
  }
  const jobs = cases.map((item) => {
    const variables = { ...constantVariables, ...item.values };
    return runtime.enqueueJob({
      recipe: recipeSnapshot.id,
      title: cases.length > 1 ? `${recipeSnapshot.title} · ${item.name}` : recipeSnapshot.title,
      recipeSnapshot,
      recipeGraph,
      serial: body.serial,
      platform,
      targetKind,
      browserTargetId: body.browserTargetId,
      ...(targetProfile ? { targetProfile } : {}),
      ...(flowAccount.authenticationHealth
        ? { authenticationHealth: flowAccount.authenticationHealth }
        : {}),
      variables,
      sensitiveInputNames: sensitiveInputNames(definitions.value, variables),
      ...(matrix
        ? { batchId: matrix.id, caseIndex: item.index, caseCount: matrix.cases.length }
        : {}),
      artifacts: [
        {
          kind: operationKind === "flow" ? "app-map-flow-plan" : "app-map-connection-plan",
          capturedAt: Date.now(),
          data: plan,
        },
        ...(safeMatrix
          ? [
              {
                kind: "frozen-inputs",
                capturedAt: safeMatrix.createdAt,
                data: safeMatrix.cases[item.index],
              },
            ]
          : []),
      ],
      projectId: input.scope.projectId,
      ownerId: operation.actorId,
    });
  });
  json(input.response, 202, {
    job: jobs[0]!,
    jobs,
    plan,
    ...(safeMatrix ? { matrix: safeMatrix } : {}),
  });
  return true;
}
