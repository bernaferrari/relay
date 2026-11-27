/**
 * Flow and Connection proof runs for `handleAppMapRunRoute`. Extracted so the
 * test-run route and the flow/connection runner each stay below the source
 * budget; the dispatcher delegates here once neither Test path matched.
 */
import {
  AppMapCompileError,
  accountReloginFindingsReport,
  currentOperationContext,
  claimedBrowserJobStartBlocker,
  CasePlanError,
  buildTargetProfiles,
  compileAppMapConnection,
  compileAppMapFlow,
  listDevices,
  listDeviceLeases,
  listTargets,
  prepareCaseStackPlan,
  readAppMap,
  readProjectVariables,
  referencedRuntimeInputs,
  redactCasePlan,
  resolveJobDevicePlatform,
  sensitiveInputNames,
  unsupportedBrowserCaseProfileFields,
  type Recipe,
} from "@relay/core";
import type { OperationInput } from "@relay/protocol";
import { assertTargetControl, targetLeaseBelongsToCaller } from "../access-control.js";
import { HttpError, json, matchPath, parseJsonBody } from "../http.js";
import { defaultTestRunRuntime, type AppMapRunRouteContext } from "./app-map-test-run-runtime.js";
import { explicitTargetAvailability } from "./app-map-run-target-admission.js";

export async function handleAppMapFlowOrConnectionRun(
  input: AppMapRunRouteContext,
  runtime: typeof defaultTestRunRuntime,
): Promise<boolean> {
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
  const targetProfile = buildTargetProfiles({
    devices: observedDevices ?? (await listDevices().catch(() => [])),
    targets: observedTargets,
  }).find(
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
