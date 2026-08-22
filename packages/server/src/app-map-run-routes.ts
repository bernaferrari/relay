import type http from "node:http";
import {
  AppMapCombineWorldError,
  AppMapCompileError,
  AppMapTestCompileError,
  activeReviewedDocumentOriginsForAppMap,
  RunMatrixError,
  buildTargetProfiles,
  compileAppMapConnection,
  compileAppMapFlow,
  compileAppMapTest,
  createAppMapTestExecutionIntent,
  currentOperationContext,
  enqueueJob,
  listDevices,
  listDeviceLeases,
  listTargets,
  loadFrozenRawAccessibilityEvidence,
  prepareCaseStackMatrix,
  preflightCompiledAppMapTestOffline,
  readAppMap,
  readProjectVariables,
  referencedRuntimeInputs,
  redactRunMatrix,
  resolveJobDevicePlatform,
  saveAppMapCombine,
  sensitiveInputNames,
  upsertAppMapCombineFromTest,
  type Recipe,
} from "@relay/core";
import type {
  AppMap,
  AppMapCompiledRuntimeTargetProfile,
  OperationInput,
  TargetProfile,
} from "@relay/protocol";
import { assertTargetControl, targetLeaseBelongsToCaller } from "./access-control.js";
import { executeCombineStart } from "./combine-start-route.js";
import { applyAppMapMutation } from "./app-map-route-mutations.js";
import { HttpError, json, matchPath, parseJsonBody } from "./http.js";
import { defaultJobRouteRuntime } from "./job-routes.js";
import type { RequestContext } from "./security.js";

type ObservedTarget = {
  serial: string;
  connectionState?: string;
  booted?: boolean | null;
  developerMode?: "enabled" | "disabled";
  developerServicesAvailable?: boolean;
};

/** Small host seam for proving that a blocked Test run is entirely offline.
 * Normal callers use the production runtime; tests can make any device or
 * enqueue call fail loudly if preflight ordering regresses. */
export type AppMapTestRunRouteRuntime = {
  listDevices: typeof listDevices;
  assertTargetControl: typeof assertTargetControl;
  createAppMapTestExecutionIntent: typeof createAppMapTestExecutionIntent;
  enqueueJob: typeof enqueueJob;
};

const defaultTestRunRuntime: AppMapTestRunRouteRuntime = {
  listDevices,
  assertTargetControl,
  createAppMapTestExecutionIntent,
  enqueueJob,
};

/** Resolve a run's profile from the saved App Map before it can touch a
 * target. A profile ID is an evidence identity, not a display-label hint: all
 * matching saved copies must bind to this exact target/platform. */
export function frozenTestRunTargetProfile(input: {
  map: AppMap;
  targetProfileId: string;
  target: Pick<OperationInput<"app-map.test.run">["target"], "targetId" | "platform">;
}): AppMapCompiledRuntimeTargetProfile {
  const targetProfileId = input.targetProfileId.trim();
  const profiles = Object.values(input.map.screenVariants)
    .map((variant) => variant.targetProfile)
    .filter((profile) => profile.id === targetProfileId);
  if (!profiles.length) {
    throw new HttpError(409, `Target profile ${targetProfileId} is not saved in this App Map`, {
      code: "TARGET_PROFILE_NOT_SAVED",
      targetProfileId,
      recovery:
        "Choose a saved evidence profile for this App Map before running the Test on a target.",
    });
  }
  const mismatched = profiles.filter(
    (profile) =>
      profile.targetId !== input.target.targetId || profile.platform !== input.target.platform,
  );
  if (mismatched.length) {
    const candidates = [
      ...new Set(profiles.map((profile) => `${profile.platform}:${profile.targetId}`)),
    ]
      .sort()
      .join(", ");
    throw new HttpError(
      409,
      `Target profile ${targetProfileId} does not bind to ${input.target.platform}:${input.target.targetId}`,
      {
        code: "TARGET_PROFILE_TARGET_MISMATCH",
        targetProfileId,
        target: { targetId: input.target.targetId, platform: input.target.platform },
        savedTargets: candidates,
        recovery:
          "Choose the target recorded by this evidence profile, or choose a profile captured for the selected target.",
      },
    );
  }
  const identity = (profile: (typeof profiles)[number]) =>
    [
      profile.id,
      profile.targetId,
      profile.platform,
      profile.viewport ? `${profile.viewport.width}x${profile.viewport.height}` : "",
    ].join("\u0000");
  if (new Set(profiles.map(identity)).size !== 1) {
    throw new HttpError(409, `Target profile ${targetProfileId} has conflicting saved identities`, {
      code: "TARGET_PROFILE_AMBIGUOUS",
      targetProfileId,
      recovery:
        "Repair or recapture the conflicting saved evidence profile before using it to scope a Test run.",
    });
  }
  const profile = profiles[0]!;
  return {
    id: profile.id,
    targetId: profile.targetId,
    platform: profile.platform,
    ...(profile.viewport ? { viewport: structuredClone(profile.viewport) } : {}),
  };
}

/** The job must carry the exact saved evidence-profile identity, not the
 * generic profile reconstructed from a connected device. In particular a
 * viewport-suffixed Android profile is a distinct frozen-origin namespace. */
export function queuedAppMapTestTargetProfile(input: {
  runtimeTargetProfile: AppMapCompiledRuntimeTargetProfile | undefined;
  observedTargetProfile: TargetProfile | undefined;
  target: Pick<OperationInput<"app-map.test.run">["target"], "kind" | "targetId" | "platform">;
}): TargetProfile | undefined {
  const saved = input.runtimeTargetProfile;
  if (!saved) return input.observedTargetProfile;
  if (saved.targetId !== input.target.targetId || saved.platform !== input.target.platform) {
    throw new HttpError(
      409,
      `Saved runtime profile ${saved.id} does not bind to ${input.target.platform}:${input.target.targetId}`,
      {
        code: "TARGET_PROFILE_TARGET_MISMATCH",
        targetProfileId: saved.id,
        target: { targetId: input.target.targetId, platform: input.target.platform },
      },
    );
  }
  const observed = input.observedTargetProfile;
  if (observed && (observed.targetId !== saved.targetId || observed.platform !== saved.platform)) {
    throw new HttpError(
      409,
      `Observed target profile does not match saved runtime profile ${saved.id}`,
      {
        code: "TARGET_PROFILE_TARGET_MISMATCH",
        targetProfileId: saved.id,
        observedTarget: { targetId: observed.targetId, platform: observed.platform },
      },
    );
  }
  return {
    id: saved.id,
    targetId: saved.targetId,
    platform: saved.platform,
    source: input.target.kind,
    name: observed?.name ?? saved.targetId,
    ...(observed?.model ? { model: observed.model } : {}),
    ...(observed?.osVersion ? { osVersion: observed.osVersion } : {}),
    ...(saved.viewport ? { viewport: structuredClone(saved.viewport) } : {}),
    capabilities: observed ? [...observed.capabilities] : [],
    observedAt: observed?.observedAt ?? Date.now(),
  };
}

function frozenEvidenceTargetProfileForTarget(input: {
  target: Pick<OperationInput<"app-map.test.run">["target"], "targetId" | "platform">;
  profiles: AppMapCompiledRuntimeTargetProfile[] | undefined;
}): AppMapCompiledRuntimeTargetProfile | undefined {
  const profiles = [
    ...new Map(
      (input.profiles ?? []).map((profile) => [
        [
          profile.id,
          profile.targetId,
          profile.platform,
          profile.viewport ? `${profile.viewport.width}x${profile.viewport.height}` : "",
        ].join("\u0000"),
        profile,
      ]),
    ).values(),
  ];
  if (!profiles.length) return undefined;
  const matching = profiles.filter(
    (profile) =>
      profile.targetId === input.target.targetId && profile.platform === input.target.platform,
  );
  if (matching.length === 1) return structuredClone(matching[0]!);
  const savedTargets = [
    ...new Set(profiles.map((profile) => `${profile.platform}:${profile.targetId}`)),
  ]
    .sort()
    .join(", ");
  if (matching.length > 1) {
    throw new HttpError(
      409,
      `Choose one frozen evidence profile for ${input.target.platform}:${input.target.targetId}`,
      {
        code: "TARGET_PROFILE_SELECTION_REQUIRED",
        target: input.target,
        targetProfileCandidates: matching.map((profile) => structuredClone(profile)),
        recovery:
          "Select one saved evidence profile for this target, then retry the exact Test revision.",
      },
    );
  }
  throw new HttpError(
    409,
    `No frozen evidence profile binds to ${input.target.platform}:${input.target.targetId}`,
    {
      code: "TARGET_PROFILE_TARGET_MISMATCH",
      target: input.target,
      savedTargets,
      recovery:
        "Choose a target captured by this App Map, or capture a saved evidence profile for the selected target before running.",
    },
  );
}

/**
 * Return the actionable state for an explicit device serial. This helper is
 * called only after discovery has completed successfully. An empty inventory
 * therefore means that there is no local device to run against; remote/test
 * targets remain supported through an explicit active lease, which is checked
 * by the route before this helper is used.
 */
export function explicitTargetAvailability(
  serial: string,
  devices: ObservedTarget[],
): "connected" | "not-ready" | "missing" {
  if (devices.length === 0) return "missing";
  const device = devices.find((candidate) => candidate.serial === serial);
  if (!device) return "missing";
  if (device.connectionState === "offline" || device.connectionState === "unauthorized") {
    return "not-ready";
  }
  if (device.booted === false) return "not-ready";
  if (device.developerMode === "disabled" || device.developerServicesAvailable === false) {
    return "not-ready";
  }
  return "connected";
}

export type AppMapRunRouteContext = {
  method: string;
  pathname: string;
  request: http.IncomingMessage;
  response: http.ServerResponse;
  scope: RequestContext;
  runtime?: Partial<AppMapTestRunRouteRuntime>;
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
      let upserted;
      try {
        upserted = upsertAppMapCombineFromTest({
          map,
          testId: test.id,
          selected: body.in,
          ...(body.lens ? { lens: body.lens } : {}),
        });
      } catch (error) {
        if (error instanceof AppMapCombineWorldError) {
          throw new HttpError(409, error.message, { code: error.code });
        }
        throw error;
      }
      const saved = await applyAppMapMutation(
        input.scope,
        map.id,
        body.expectedRevision,
        undefined,
        (current, context) => saveAppMapCombine(current, upserted.combine, context),
      );
      let compiled;
      try {
        compiled = compileAppMapTest(saved, saved.tests[test.id] ?? test, {
          forceRecaptureSurfaceScreenIds: body.surfaceCapture?.forceRecaptureScreenIds,
          entryCheckpointScreenId:
            body.startup?.mode === "verified-checkpoint" ? body.startup.screenId : undefined,
          reviewedDocumentOrigins: await activeReviewedDocumentOriginsForAppMap(saved),
        });
      } catch (error) {
        if (error instanceof AppMapTestCompileError) {
          throw new HttpError(409, error.message, {
            code: error.code,
            testId: error.testId,
            stepId: error.stepId,
            diagnostics: error.diagnostics,
          });
        }
        throw new HttpError(409, error instanceof Error ? error.message : String(error));
      }
      const started = await executeCombineStart(input.scope, defaultJobRouteRuntime, {
        appMapId: saved.id,
        combineId: upserted.combine.id,
        serial: body.target.kind === "device" ? body.target.targetId : undefined,
        browserTargetId: body.target.kind === "browser" ? body.target.targetId : undefined,
        platform: body.target.platform === "browser" ? undefined : body.target.platform,
        targetKind: body.target.kind,
        selected: body.in,
        capture: upserted.capture,
        executionMode: body.executionMode ?? "pilot",
        cell: body.cell,
        defaultTargetProfileId: body.targetProfileId,
        title: upserted.combine.name,
      });
      const job = started.jobs[0];
      if (!job) throw new HttpError(500, "Combine start returned no jobs");
      json(input.response, 202, {
        planIdentity: {
          appMapId: compiled.plan.appMapId,
          appMapRevision: compiled.plan.appMapRevision,
          testId: compiled.plan.test.id,
          rootRecipeId: compiled.plan.rootRecipeId,
        },
        plan: compiled.plan,
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
    let compiled;
    try {
      const reviewedDocumentOrigins = await activeReviewedDocumentOriginsForAppMap(map);
      compiled = compileAppMapTest(map, test, {
        forceRecaptureSurfaceScreenIds: body.surfaceCapture?.forceRecaptureScreenIds,
        entryCheckpointScreenId:
          body.startup?.mode === "verified-checkpoint" ? body.startup.screenId : undefined,
        reviewedDocumentOrigins,
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
    const inferredRuntimeTargetProfile = explicitlySelectedRuntimeTargetProfile
      ? undefined
      : frozenEvidenceTargetProfileForTarget({
          target: requestedTarget,
          profiles: compiled.plan.rawAccessibilityTargetProfiles,
        });
    const runtimeTargetProfile =
      explicitlySelectedRuntimeTargetProfile ?? inferredRuntimeTargetProfile;
    const plan = {
      ...compiled.plan,
      ...(runtimeTargetProfile
        ? { runtimeTargetProfile: structuredClone(runtimeTargetProfile) }
        : {}),
    };
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
          recovery:
            "Review the frozen evidence findings, select or recapture the required profile, then retry this exact Test revision.",
        },
      );
    }

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
      if (!activeLease) {
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
      artifacts: [
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

  // A stale physical serial should not produce a lease-recovery message. A
  // valid existing lease remains authoritative for remote and test-double
  // targets, so only preflight when this actor does not already hold one.
  let observedDevices: Awaited<ReturnType<typeof listDevices>> | undefined;
  if (body.serial?.trim()) {
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
      ? await prepareCaseStackMatrix({
          variables: definitions.value,
          caseStacks: plan.caseStacks,
          runtimeValues: body.variables,
        })
      : undefined;
  } catch (error) {
    if (error instanceof RunMatrixError) {
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
  const safeMatrix = matrix ? redactRunMatrix(matrix, definitions.value) : undefined;
  const targetProfile = (
    await buildTargetProfiles({
      devices: observedDevices ?? (await listDevices().catch(() => [])),
      targets: await listTargets(),
    })
  ).find((profile) => profile.targetId === targetId);
  const platform = body.platform ?? (await resolveJobDevicePlatform(body.serial));
  const jobs = cases.map((item) => {
    const variables = { ...constantVariables, ...item.values };
    return enqueueJob({
      recipe: recipeSnapshot.id,
      title: cases.length > 1 ? `${recipeSnapshot.title} · ${item.name}` : recipeSnapshot.title,
      recipeSnapshot,
      recipeGraph,
      serial: body.serial,
      platform,
      targetKind: body.targetKind,
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
