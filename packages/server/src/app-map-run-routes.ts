import type http from "node:http";
import {
  AppMapCombineWorldError,
  AppMapCompileError,
  AppMapTestCompileError,
  activeReviewedDocumentOriginsForAppMap,
  bindRegisteredWebDeploymentToProof,
  CasePlanError,
  buildTargetProfiles,
  compileAppMapConnection,
  compileAppMapFlow,
  compileAppMapTest,
  findActiveCombineCampaignForCombine,
  frozenRawAccessibilityTargetProfiles,
  createAppMapTestExecutionIntent,
  currentOperationContext,
  enqueueJob,
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
import { defaultJobRouteRuntime, type JobRouteRuntime } from "./job-routes.js";
import {
  frozenTestRunTargetProfile,
  queuedAppMapTestTargetProfile,
} from "./app-map-test-target-profile.js";
import type { RequestContext } from "./security.js";
import { assertRepeatWorkflowMutation } from "./repeat-workflow-receipt.js";
import {
  explicitTargetAvailability,
  frozenEvidenceTargetProfileForTarget,
  offlinePreflightProfileRecovery,
} from "./app-map-run-target-admission.js";
import {
  appMapProofExecutionAdmission,
  type AppMapProofExecutionAuthority,
} from "./app-map-proof-execution-admission.js";

export {
  frozenTestRunTargetProfile,
  queuedAppMapTestTargetProfile,
} from "./app-map-test-target-profile.js";

/** Small host seam for proving that a blocked Test run is entirely offline.
 * Normal callers use the production runtime; tests can make any device or
 * enqueue call fail loudly if preflight ordering regresses. */
export type AppMapTestRunRouteRuntime = {
  listDevices: typeof listDevices;
  assertTargetControl: typeof assertTargetControl;
  createAppMapTestExecutionIntent: typeof createAppMapTestExecutionIntent;
  enqueueJob: typeof enqueueJob;
  readBuild: typeof readBuild;
  prepareBuildForProof: typeof prepareRegisteredBuildForProof;
};

const defaultTestRunRuntime: AppMapTestRunRouteRuntime = {
  listDevices,
  assertTargetControl,
  createAppMapTestExecutionIntent,
  enqueueJob,
  readBuild,
  prepareBuildForProof: prepareRegisteredBuildForProof,
};

export {
  explicitTargetAvailability,
  frozenEvidenceTargetProfileForTarget,
  offlinePreflightProfileRecovery,
} from "./app-map-run-target-admission.js";
export type AppMapRunRouteContext = {
  method: string;
  pathname: string;
  request: http.IncomingMessage;
  response: http.ServerResponse;
  scope: RequestContext;
  /** Proof-only admission membrane. The canonical Test preflight must match
   * the risk authority frozen by the calling Verification Cell before any
   * target lease or job enqueue is attempted. */
  proofExecutionAuthority?: AppMapProofExecutionAuthority & {
    /** Proof execution also freezes the exact build/deployment identity. */
    buildId?: string;
    sourceSha?: string;
    artifactDigest?: string;
  };
  runtime?: Partial<AppMapTestRunRouteRuntime>;
  combineRuntime?: Partial<JobRouteRuntime>;
};

export async function handleAppMapRunRoute(input: AppMapRunRouteContext): Promise<boolean> {
  if (input.method !== "POST") return false;
  const runtime = { ...defaultTestRunRuntime, ...input.runtime };
  const testMatch = matchPath(input.pathname, "/app-maps/:appMapId/tests/:testId/run");
  if (testMatch) {
    const body = (await parseJsonBody(input.request)) as Omit<
      OperationInput<"app-map.test.run">,
      "appMapId" | "testId"
    >;
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
      });
      return true;
    }

    const targetId = body.target.targetId.trim();
    const requestedTarget = { targetId, platform: body.target.platform };
    const targetProfileId = body.targetProfileId?.trim() || undefined;
    const explicitlySelectedRuntimeTargetProfile = targetProfileId
      ? frozenTestRunTargetProfile({ map, targetProfileId, target: requestedTarget })
      : undefined;
    const inferredRuntimeTargetProfile = explicitlySelectedRuntimeTargetProfile
      ? undefined
      : frozenEvidenceTargetProfileForTarget({
          target: requestedTarget,
          profiles: frozenRawAccessibilityTargetProfiles(map),
        });
    const runtimeTargetProfile =
      explicitlySelectedRuntimeTargetProfile ?? inferredRuntimeTargetProfile;
    let compiled;
    try {
      const reviewedDocumentOrigins = await activeReviewedDocumentOriginsForAppMap(map);
      compiled = compileAppMapTest(map, test, {
        forceRecaptureSurfaceScreenIds: body.surfaceCapture?.forceRecaptureScreenIds,
        entryCheckpointScreenId:
          body.startup?.mode === "verified-checkpoint" ? body.startup.screenId : undefined,
        reviewedDocumentOrigins,
        runtimeTargetProfile,
      });
    } catch (error) {
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
      throw new HttpError(409, error instanceof Error ? error.message : String(error));
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
            candidates: savedAppMapTargetProfileIdsForTarget(map, requestedTarget),
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
      executionIntent = runtime.createAppMapTestExecutionIntent({ plan, recipeGraph, preflight });
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
    if (body.target.kind === "device") {
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
        profile.platform === body.target.platform &&
        profile.source === body.target.kind,
    );
    const targetProfile = queuedAppMapTestTargetProfile({
      runtimeTargetProfile,
      observedTargetProfile,
      target: body.target,
    });
    const selectedSurface = plan.testFamily?.targetSurface;
    if (
      plan.testFamily?.mode === "reviewed-route-variant" &&
      selectedSurface?.platform === "browser"
    ) {
      const observedBrowser = targetProfile?.browserCaseProfile;
      if (
        !observedBrowser ||
        observedBrowser.engine !== selectedSurface.browserEngine ||
        (selectedSurface.viewport !== undefined &&
          (observedBrowser.viewport.width !== selectedSurface.viewport.width ||
            observedBrowser.viewport.height !== selectedSurface.viewport.height))
      ) {
        throw new HttpError(
          409,
          `Managed browser target ${targetId} no longer matches reviewed route ${plan.testFamily?.selectedRouteVariant?.id ?? "surface"}`,
          {
            code: "TARGET_PROFILE_TARGET_MISMATCH",
            targetProfileId: selectedSurface.targetProfileId,
            recovery:
              "Restore the reviewed browser engine and viewport, or review a new route variant before running this Test.",
          },
        );
      }
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
    if (input.proofExecutionAuthority && body.target.kind === "browser") {
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
      if (body.target.kind === "browser") {
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
            target: { kind: "device", platform: body.target.platform, serial: targetId },
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
    if (input.proofExecutionAuthority && body.target.kind === "browser" && !webBuildBinding) {
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
    const job = runtime.enqueueJob({
      recipe: recipeSnapshot.id,
      title: recipeSnapshot.title,
      recipeSnapshot,
      recipeGraph,
      serial: body.target.kind === "device" ? targetId : undefined,
      platform: body.target.kind === "device" ? body.target.platform : undefined,
      targetKind: body.target.kind,
      browserTargetId: body.target.kind === "browser" ? targetId : undefined,
      ...(targetProfile ? { targetProfile } : {}),
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
    json(input.response, 202, { planIdentity, plan, job });
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
  const jobs = cases.map((item) => {
    const variables = { ...constantVariables, ...item.values };
    return enqueueJob({
      recipe: recipeSnapshot.id,
      title: cases.length > 1 ? `${recipeSnapshot.title} · ${item.name}` : recipeSnapshot.title,
      recipeSnapshot,
      recipeGraph,
      serial: body.serial,
      platform,
      targetKind,
      browserTargetId: body.browserTargetId,
      ...(targetProfile ? { targetProfile } : {}),
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
