import type http from "node:http";
import {
  installRegisteredBuild,
  IosMutationOutcomeUnknownError,
  appendActivity,
  assertDurableRecoveryFenceReproofEligible,
  captureDurableRecoveryFenceReproof,
  captureScreenshot,
  captureSnapshot,
  cleanupScreenshot,
  currentOperationContext,
  durableWorkerAssignmentStore,
  DurableRecoveryFenceReproofError,
  executionTargetRefFromTargetContext,
  launchRegisteredBuild,
  createDevice,
  listDeviceLeases,
  listDevices,
  listAndroidAppLocales,
  listTargetWorkers,
  preflightLocalCampaignCapacity,
  preflightDevicePool,
  preflightRegisteredBuild,
  openApp,
  recoverTargetRuntime,
  readBuild,
  readDevicePool,
  runWithTargetContext,
  type BuildCommandRunner,
  type DurableWorkerAssignmentStore,
} from "@relay/core";
import { assertTargetControl } from "./access-control.js";
import { HttpError, json, matchPath, parseJsonBody } from "./http.js";
import {
  handleCampaignDurationRoute,
  type CampaignDurationRouteRuntime,
} from "./campaign-duration-routes.js";
import type { LocalAgentDeviceExecutionTargetRef, OperationInput } from "@relay/protocol";
import { iosMutationOutcomeUnknownHttpError } from "./interaction-routes.js";
import { recordAudit, type RequestContext } from "./security.js";

export type TargetRuntimeRouteRuntime = {
  listDevices: typeof listDevices;
  listDeviceLeases: typeof listDeviceLeases;
  listTargetWorkers: typeof listTargetWorkers;
  assertTargetControl: typeof assertTargetControl;
  launchApp: (input: {
    serial: string;
    platform: "android" | "ios";
    app: string;
    relaunch: boolean;
  }) => Promise<void>;
  recoverTarget: (serial: string, reason?: string) => ReturnType<typeof recoverTargetRuntime>;
  /** Fresh evidence is captured only when the caller explicitly asks to
   * release a stale durable execution fence after recovery. */
  captureScreenshot: typeof captureScreenshot;
  captureSnapshot: typeof captureSnapshot;
  cleanupScreenshot: typeof cleanupScreenshot;
  getDurableWorkerAssignments: () => Pick<
    DurableWorkerAssignmentStore,
    "get" | "releaseRecoveryFence"
  >;
  runBuildCommand?: BuildCommandRunner;
  listAndroidAppLocales: typeof listAndroidAppLocales;
  now: () => number;
};

const defaultRuntime: TargetRuntimeRouteRuntime = {
  listDevices,
  listDeviceLeases,
  listTargetWorkers,
  assertTargetControl,
  launchApp: async ({ serial, platform, app, relaunch }) => {
    await runWithTargetContext({ kind: "device", platform, serial }, () =>
      openApp(createDevice(), app, { relaunch }),
    );
  },
  recoverTarget: (serial, reason) =>
    recoverTargetRuntime(
      serial,
      reason ? new Error(`Recovery requested for ${reason}`) : undefined,
    ),
  captureScreenshot,
  captureSnapshot,
  cleanupScreenshot,
  // Keep this lazy: tests and the desktop host may choose RELAY_STATE_DIR
  // after this module has been imported.
  getDurableWorkerAssignments: () => durableWorkerAssignmentStore(),
  listAndroidAppLocales,
  now: () => Date.now(),
};

function requestedRecoveryFenceAssignmentId(body: {
  recoveryFenceAssignmentId?: unknown;
}): string | undefined {
  if (body.recoveryFenceAssignmentId === undefined) return undefined;
  if (
    typeof body.recoveryFenceAssignmentId !== "string" ||
    !body.recoveryFenceAssignmentId.trim() ||
    body.recoveryFenceAssignmentId.trim().length > 256
  ) {
    throw new HttpError(400, "recoveryFenceAssignmentId must be a non-empty identifier");
  }
  return body.recoveryFenceAssignmentId.trim();
}

function localDeviceExecutionTarget(
  serial: string,
  platform: "android" | "ios",
): LocalAgentDeviceExecutionTargetRef {
  const target = executionTargetRefFromTargetContext({ kind: "device", platform, serial });
  if (target.kind !== "local-device") {
    throw new Error("Local target recovery did not resolve a local device identity");
  }
  return target;
}

function recordRecoveryFenceAudit(
  scope: RequestContext,
  input: { assignmentId: string; serial: string; result: "allow" | "deny" },
): void {
  const operation = currentOperationContext();
  recordAudit(scope, {
    action: "target.recovery-fence.release",
    resource: input.assignmentId,
    target: input.serial,
    result: input.result,
    ...(operation ? { actorId: operation.actorId } : {}),
  });
}

export async function handleTargetRuntimeRoute(context: {
  method: string;
  pathname: string;
  request: http.IncomingMessage;
  response: http.ServerResponse;
  scope: RequestContext;
  runtime?: Partial<TargetRuntimeRouteRuntime>;
  campaignDurationRuntime?: CampaignDurationRouteRuntime;
}): Promise<boolean> {
  const { method, pathname, request, response, scope } = context;
  const runtime = { ...defaultRuntime, ...context.runtime };

  if (
    await handleCampaignDurationRoute({
      method,
      pathname,
      request,
      response,
      scope,
      runtime: context.campaignDurationRuntime,
    })
  )
    return true;

  if (method === "GET" && pathname === "/target-workers") {
    json(response, 200, { workers: runtime.listTargetWorkers() });
    return true;
  }

  if (method === "POST" && pathname === "/campaign-capacity/preflight") {
    const body = (await parseJsonBody(request)) as OperationInput<"campaign.capacity.preflight">;
    const checkedAt = runtime.now();
    // Do not turn a failed inventory or lease read into optimistic capacity.
    // The caller needs to retry the read rather than receive a green-looking
    // plan based on absent facts.
    const [devices, leases] = await Promise.all([
      runtime.listDevices(),
      runtime.listDeviceLeases(scope.projectId),
    ]);
    const preflight = preflightLocalCampaignCapacity({
      ...body,
      devices,
      leases,
      workers: runtime.listTargetWorkers(),
      at: checkedAt,
    });
    json(response, 200, { preflight });
    return true;
  }

  if (method === "GET" && pathname === "/device/app/locales") {
    const url = new URL(request.url ?? pathname, "http://relay.local");
    const serial = url.searchParams.get("serial")?.trim() ?? "";
    const packageName = url.searchParams.get("package")?.trim() ?? "";
    if (!serial) throw new HttpError(400, "serial is required");
    if (!packageName) throw new HttpError(400, "package is required");
    const device = (await runtime.listDevices().catch(() => [])).find(
      (candidate) => candidate.serial === serial,
    );
    if (!device) throw new HttpError(409, `Target ${serial} is not connected`);
    if (device.platform !== "android") {
      throw new HttpError(400, "App locale discovery currently requires Android");
    }
    const locales = await runtime.listAndroidAppLocales(serial, packageName);
    json(response, 200, { packageName, locales });
    return true;
  }

  if (method === "POST" && pathname === "/device/app/launch") {
    const body = (await parseJsonBody(request)) as {
      serial?: unknown;
      app?: unknown;
      relaunch?: unknown;
    };
    const serial = typeof body.serial === "string" ? body.serial.trim() : "";
    const app = typeof body.app === "string" ? body.app.trim() : "";
    if (!serial) throw new HttpError(400, "serial is required");
    if (!app) throw new HttpError(400, "app is required");
    await runtime.assertTargetControl(scope, serial);
    const device = (await runtime.listDevices().catch(() => [])).find(
      (candidate) => candidate.serial === serial,
    );
    if (!device) throw new HttpError(409, `Target ${serial} is not connected`);
    // Bringing an app to the foreground is the safe, unsurprising default.
    // Physical iOS devices can reject termination when the requested app is
    // not currently running, which previously made a normal launch fail.
    const relaunch = body.relaunch === true;
    try {
      await runtime.launchApp({ serial, platform: device.platform, app, relaunch });
    } catch (error) {
      // An iOS launch acknowledgement can be lost after the process was told
      // to activate. This is a review boundary, not a reason to recover and
      // issue another launch behind the caller's back.
      if (error instanceof IosMutationOutcomeUnknownError) {
        throw iosMutationOutcomeUnknownHttpError(error);
      }
      const message = error instanceof Error ? error.message : String(error);
      if (
        device.platform === "ios" &&
        /xcrun timed out|devicectl timed out|CoreDevice\.ActionError|Failed to list iOS apps|developer services|ddi/i.test(
          message,
        )
      ) {
        throw new HttpError(503, message, {
          recovery:
            "Apple device communication stalled. Recover the iPad, keep it unlocked, then launch again.",
          recoveryAction: {
            operationId: "target.recover",
            input: { serial, reason: "control" },
            cli: { argv: ["device", "recover", serial, "--input", '{"reason":"control"}'] },
          },
        });
      }
      throw error;
    }
    json(response, 200, {
      launched: { serial, app, platform: device.platform, launchedAt: Date.now() },
    });
    return true;
  }

  if (method === "POST" && pathname === "/device/recover") {
    const body = (await parseJsonBody(request)) as {
      serial?: unknown;
      reason?: unknown;
      recoveryFenceAssignmentId?: unknown;
    };
    const serial = typeof body.serial === "string" ? body.serial.trim() : "";
    const reason = typeof body.reason === "string" ? body.reason.trim() : undefined;
    const recoveryFenceAssignmentId = requestedRecoveryFenceAssignmentId(body);
    if (!serial) throw new HttpError(400, "serial is required");
    if (recoveryFenceAssignmentId && !scope.localTrusted) {
      recordRecoveryFenceAudit(scope, {
        assignmentId: recoveryFenceAssignmentId,
        serial,
        result: "deny",
      });
      throw new HttpError(
        403,
        "Durable recovery-fence release is available only from the local Relay host",
        { code: "DURABLE_RECOVERY_FENCE_LOCAL_ONLY" },
      );
    }
    const assignments = recoveryFenceAssignmentId
      ? runtime.getDurableWorkerAssignments()
      : undefined;
    const assignment = recoveryFenceAssignmentId
      ? assignments!.get(recoveryFenceAssignmentId)
      : undefined;
    // A local host can switch projects. Do not let that convenience turn an
    // interrupted run from another project into a target-release oracle.
    if (recoveryFenceAssignmentId && (!assignment || assignment.projectId !== scope.projectId)) {
      recordRecoveryFenceAudit(scope, {
        assignmentId: recoveryFenceAssignmentId,
        serial,
        result: "deny",
      });
      throw new HttpError(404, "Durable recovery fence assignment not found");
    }
    const device = (await runtime.listDevices().catch(() => [])).find(
      (candidate) => candidate.serial === serial,
    );
    if (!device) throw new HttpError(409, `Target ${serial} is not connected`);
    if (device.platform !== "ios" && device.platform !== "android") {
      throw new HttpError(
        400,
        "Automatic runtime recovery is available for connected devices only",
      );
    }
    const executionTarget = localDeviceExecutionTarget(serial, device.platform);
    if (assignment) {
      try {
        // Check the durable row before acquiring a device lease or starting a
        // repair. A typo or cross-target id must not cause a blind recovery.
        // `captureDurableRecoveryFenceReproof` repeats this check immediately
        // before capture. Keeping the cheap preflight here prevents a target
        // repair when the assignment already cannot be released.
        assertDurableRecoveryFenceReproofEligible({ assignment, executionTarget });
      } catch (error) {
        recordRecoveryFenceAudit(scope, {
          assignmentId: recoveryFenceAssignmentId!,
          serial,
          result: "deny",
        });
        if (error instanceof DurableRecoveryFenceReproofError) {
          throw new HttpError(409, error.message, { code: error.code });
        }
        throw error;
      }
    }
    await runtime.assertTargetControl(scope, serial);
    const recovery = await runtime.recoverTarget(serial, reason);
    await appendActivity({
      eventType: recovery.ready ? "target.recovery.completed" : "target.recovery.failed",
      resourceKind: "target",
      resourceId: serial,
      summary: recovery.summary,
    });
    if (!assignment || !assignments || !recoveryFenceAssignmentId) {
      json(response, 200, { recovery });
      return true;
    }
    if (!recovery.ready) {
      recordRecoveryFenceAudit(scope, {
        assignmentId: recoveryFenceAssignmentId,
        serial,
        result: "deny",
      });
      throw new HttpError(
        409,
        "Target recovery did not restore a ready device; the durable recovery fence remains in place",
        { code: "DURABLE_RECOVERY_FENCE_TARGET_NOT_READY", recovery },
      );
    }
    const operation = currentOperationContext();
    if (!operation) {
      // `assertTargetControl` should already have rejected this. Keep the
      // release path explicit because the durable `releasedBy` provenance is
      // never allowed to fall back to a server/default identity.
      recordRecoveryFenceAudit(scope, {
        assignmentId: recoveryFenceAssignmentId,
        serial,
        result: "deny",
      });
      throw new HttpError(
        400,
        "Actor-aware operation context is required for recovery-fence release",
      );
    }
    let reproof;
    try {
      reproof = await captureDurableRecoveryFenceReproof({
        assignment,
        executionTarget,
        capture: {
          captureScreenshot: () =>
            runtime.captureScreenshot({
              serial,
              caption: "Durable recovery-fence reproof",
              ephemeral: true,
              includeScreenMatch: false,
            }),
          captureSnapshot: () => runtime.captureSnapshot({ serial, iosOperation: "snapshot" }),
          cleanupScreenshot: runtime.cleanupScreenshot,
        },
      });
    } catch (error) {
      recordRecoveryFenceAudit(scope, {
        assignmentId: recoveryFenceAssignmentId,
        serial,
        result: "deny",
      });
      if (error instanceof DurableRecoveryFenceReproofError) {
        throw new HttpError(409, error.message, {
          code: error.code,
          recovery:
            "Keep the interrupted assignment fenced. Capture a fresh current screenshot and accessibility tree after the target is ready, then explicitly recover it again.",
        });
      }
      throw error;
    }
    // Make the proof-to-actor relationship durable before the irreversible
    // journal transition. If this write fails, evidence may remain for review
    // but the target fence is deliberately not released.
    await appendActivity({
      eventType: "target.recovery-fence.release-authorized",
      resourceKind: "durable-worker-assignment",
      resourceId: assignment.id,
      summary:
        "Fresh screenshot and semantic evidence verified for durable recovery-fence release.",
      evidenceIds: reproof.evidenceIds,
    });
    let released;
    try {
      released = assignments.releaseRecoveryFence({
        id: assignment.id,
        releasedBy: operation.actorId,
        reproofId: reproof.id,
        at: Math.max(runtime.now(), reproof.capturedAt),
      });
    } catch (error) {
      recordRecoveryFenceAudit(scope, {
        assignmentId: recoveryFenceAssignmentId,
        serial,
        result: "deny",
      });
      throw new HttpError(
        409,
        error instanceof Error ? error.message : "Durable recovery fence could not be released",
        { code: "DURABLE_RECOVERY_FENCE_RELEASE_REJECTED" },
      );
    }
    recordRecoveryFenceAudit(scope, {
      assignmentId: recoveryFenceAssignmentId,
      serial,
      result: "allow",
    });
    json(response, 200, {
      recovery,
      recoveryFenceRelease: {
        assignmentId: released.id,
        releasedAt: released.recoveryFenceRelease!.releasedAt,
        reproofId: reproof.id,
        evidence: {
          manifest: reproof.manifest,
          screenshotBefore: reproof.pixels.before,
          semanticSnapshot: reproof.semantics.evidence,
          screenshotAfter: reproof.pixels.after,
        },
      },
    });
    return true;
  }

  const poolPreflight = matchPath(pathname, "/device-pools/:id/preflight");
  if (method === "POST" && poolPreflight) {
    const pool = await readDevicePool(scope.projectId, poolPreflight.id!);
    if (!pool) throw new HttpError(404, "Device pool not found");
    json(response, 200, {
      preflight: preflightDevicePool({
        pool,
        devices: await runtime.listDevices().catch(() => []),
        leases: await runtime.listDeviceLeases(scope.projectId),
      }),
    });
    return true;
  }

  const buildPreflight = matchPath(pathname, "/builds/:id/preflight");
  if (method === "POST" && buildPreflight) {
    const build = await readBuild(scope.projectId, buildPreflight.id!);
    if (!build) throw new HttpError(404, "Build not found");
    const body = (await parseJsonBody(request)) as { serial?: unknown };
    const serial = typeof body.serial === "string" ? body.serial.trim() : "";
    const target = serial
      ? { kind: "device" as const, platform: build.platform, serial }
      : undefined;
    json(response, 200, {
      preflight: await preflightRegisteredBuild(build, {
        ...(target ? { target } : {}),
        ...(runtime.runBuildCommand ? { run: runtime.runBuildCommand } : {}),
      }),
    });
    return true;
  }

  const installMatch = matchPath(pathname, "/builds/:id/install");
  if (method === "POST" && installMatch) {
    const build = await readBuild(scope.projectId, installMatch.id!);
    if (!build) throw new HttpError(404, "Build not found");
    const body = (await parseJsonBody(request)) as {
      serial?: unknown;
      launch?: unknown;
      applicationId?: unknown;
    };
    const serial = typeof body.serial === "string" ? body.serial.trim() : "";
    if (!serial) throw new HttpError(400, "serial is required");
    await runtime.assertTargetControl(scope, serial);
    const device = (await runtime.listDevices().catch(() => [])).find(
      (candidate) => candidate.serial === serial,
    );
    if (!device) throw new HttpError(409, `Target ${serial} is not connected`);
    if (device.platform !== build.platform) {
      throw new HttpError(
        409,
        `Build targets ${build.platform}, but ${serial} is ${device.platform}`,
      );
    }
    const target = { kind: "device" as const, platform: build.platform, serial };
    const installed = await runWithTargetContext(target, () =>
      installRegisteredBuild({
        build,
        target,
        targetKind: device.kind,
        ...(runtime.runBuildCommand ? { run: runtime.runBuildCommand } : {}),
      }),
    );
    const shouldLaunch = body.launch === true;
    const launched = shouldLaunch
      ? await runWithTargetContext(target, () =>
          launchRegisteredBuild({
            build,
            target,
            applicationId:
              typeof body.applicationId === "string" ? body.applicationId : installed.applicationId,
            ...(runtime.runBuildCommand ? { run: runtime.runBuildCommand } : {}),
          }),
        )
      : undefined;
    json(response, 200, { installed, ...(launched ? { launched } : {}) });
    return true;
  }

  const launchMatch = matchPath(pathname, "/builds/:id/launch");
  if (method === "POST" && launchMatch) {
    const build = await readBuild(scope.projectId, launchMatch.id!);
    if (!build) throw new HttpError(404, "Build not found");
    const body = (await parseJsonBody(request)) as { serial?: unknown; applicationId?: unknown };
    const serial = typeof body.serial === "string" ? body.serial.trim() : "";
    if (!serial) throw new HttpError(400, "serial is required");
    await runtime.assertTargetControl(scope, serial);
    const target = { kind: "device" as const, platform: build.platform, serial };
    const launched = await runWithTargetContext(target, () =>
      launchRegisteredBuild({
        build,
        target,
        ...(typeof body.applicationId === "string" ? { applicationId: body.applicationId } : {}),
        ...(runtime.runBuildCommand ? { run: runtime.runBuildCommand } : {}),
      }),
    );
    json(response, 200, { launched });
    return true;
  }

  return false;
}
