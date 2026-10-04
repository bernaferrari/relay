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
  getBrowserDevice,
  listDeviceLeases,
  listDevices,
  listTargets,
  listAndroidAppLocales,
  listAndroidInstalledApps,
  setAndroidAppLocaleOnDevice,
  listTargetWorkers,
  preflightLocalCampaignCapacity,
  preflightDevicePool,
  preflightRegisteredBuild,
  currentTargetSupervisorStore,
  readReconcileReceipt,
  rememberReconcileReceipt,
  completeReconcileReceipt,
  controlTargetIdForBrowserLane,
  managedBrowserTargetIdFromSchedulingKey,
  serializeReconciliation,
  openApp,
  recoverSupervisedTargetRuntime,
  targetRuntimeReadiness,
  type TargetRuntimeRecovery,
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
import {
  projectRoleAllows,
  summarizeLaunchedForeground,
  type LocalAgentDeviceExecutionTargetRef,
  type LocalBrowserExecutionTargetRef,
  type OperationInput,
  type TargetSupervisorHealth,
} from "@relay/protocol";
import { iosMutationOutcomeUnknownHttpError } from "./interaction-routes.js";
import { recordAudit, type RequestContext } from "./security.js";
import { captureDurableTargetObservation } from "./target-observation-route.js";
import {
  assertClientUnknownReviewAllowed,
  completeClientUnknownInputReview,
} from "./target-client-input-review.js";
import {
  durableObservationId,
  localBrowserExecutionTarget,
  localDeviceExecutionTarget,
  publicTargetHealth,
  recordRecoveryFenceAudit,
  requestedRecoveryFenceAssignmentId,
  resolveSupervisedRuntimeTarget,
  scopedTargetHealth,
} from "./target-runtime-support.js";

export type SupervisedRuntimePlatform = "android" | "ios" | "browser";

export type TargetRuntimeRouteRuntime = {
  listDevices: typeof listDevices;
  listTargets: typeof listTargets;
  listDeviceLeases: typeof listDeviceLeases;
  listTargetWorkers: typeof listTargetWorkers;
  assertTargetControl: typeof assertTargetControl;
  launchApp: (input: {
    serial: string;
    platform: SupervisedRuntimePlatform;
    app: string;
    relaunch: boolean;
  }) => Promise<void>;
  recoverTarget: (
    serial: string,
    reason?: string,
    force?: boolean,
    platform?: "android" | "ios",
  ) => Promise<TargetRuntimeRecovery>;
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
  listAndroidInstalledApps: typeof listAndroidInstalledApps;
  setAppLocale: typeof setAndroidAppLocaleOnDevice;
  now: () => number;
  readTargetHealth: (serial: string, platform: SupervisedRuntimePlatform) => TargetSupervisorHealth;
  captureTargetObservation: typeof captureDurableTargetObservation;
  reconcileTargetInput: (
    serial: string,
    platform: SupervisedRuntimePlatform,
    input: {
      mutationId: string;
      observationId: string;
      outcome: "applied" | "not-applied" | "ambiguous";
    },
  ) => TargetSupervisorHealth;
  recordTargetRecovery: (
    serial: string,
    platform: "android" | "ios",
    recovery: TargetRuntimeRecovery,
  ) => void;
};

const defaultRuntime: TargetRuntimeRouteRuntime = {
  listDevices,
  listTargets,
  listDeviceLeases,
  listTargetWorkers,
  assertTargetControl,
  launchApp: async ({ serial, platform, app, relaunch }) => {
    if (platform === "browser") {
      await runWithTargetContext({ kind: "browser", platform, targetId: serial }, async () =>
        openApp(await getBrowserDevice(serial), app, { relaunch }),
      );
      return;
    }
    await runWithTargetContext({ kind: "device", platform, serial }, () =>
      openApp(createDevice(), app, { relaunch }),
    );
  },
  recoverTarget: async (serial, reason, force, platform) => {
    if (!platform) throw new Error("Target platform is required for supervised recovery");
    const store = currentTargetSupervisorStore();
    if (!store) throw new Error("Server-owned TargetSupervisor store is unavailable");
    return await recoverSupervisedTargetRuntime({
      store,
      target: { id: serial, kind: platform },
      channel: reason === "observe" ? "pixels" : "semantics",
      ...(reason ? { cause: new Error(`Recovery requested for ${reason}`) } : {}),
      force: force === true,
    });
  },
  captureScreenshot,
  captureSnapshot,
  cleanupScreenshot,
  // Keep this lazy: tests and the desktop host may choose RELAY_STATE_DIR
  // after this module has been imported.
  getDurableWorkerAssignments: () => durableWorkerAssignmentStore(),
  listAndroidAppLocales,
  listAndroidInstalledApps,
  setAppLocale: setAndroidAppLocaleOnDevice,
  now: () => Date.now(),
  readTargetHealth: (serial, platform) => {
    const store = currentTargetSupervisorStore();
    if (!store) throw new Error("Server-owned TargetSupervisor store is unavailable");
    if (platform === "browser") return store.health({ id: serial, kind: "browser" });
    return store.health(
      { id: serial, kind: platform },
      targetRuntimeReadiness({ serial, platform }),
    );
  },
  captureTargetObservation: captureDurableTargetObservation,
  reconcileTargetInput: (serial, platform, input) => {
    const store = currentTargetSupervisorStore();
    if (!store) throw new Error("Server-owned TargetSupervisor store is unavailable");
    return store.transition(
      { id: serial, kind: platform },
      {
        kind: "input.reconciled",
        mutationId: input.mutationId,
        observationId: input.observationId,
        outcome: input.outcome,
      },
    ).health;
  },
  // The production recovery path commits every stage through the coordinator.
  // Test/runtime adapters may still use this hook to project legacy receipts.
  recordTargetRecovery: () => {},
};

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

  if (method === "GET" && pathname === "/device/health") {
    const url = new URL(request.url ?? pathname, "http://relay.local");
    const serial = url.searchParams.get("serial")?.trim() ?? "";
    if (!serial) throw new HttpError(400, "serial is required");
    json(response, 200, {
      health: await scopedTargetHealth({ scope, serial, runtime }),
    });
    return true;
  }

  if (method === "POST" && pathname === "/device/input/reconcile") {
    const body = (await parseJsonBody(request)) as OperationInput<"target.input.reconcile">;
    const serial = typeof body.serial === "string" ? body.serial.trim() : "";
    let mutationId = typeof body.mutationId === "string" ? body.mutationId.trim() : "";
    if (!serial) throw new HttpError(400, "serial is required");
    if (!mutationId) throw new HttpError(400, "mutationId is required");
    if (body.reconcilePending !== undefined && typeof body.reconcilePending !== "boolean") {
      throw new HttpError(400, "reconcilePending must be a boolean");
    }
    if (body.reconcilePending === true && body.clientUnknown !== true) {
      // The person reviewed the screen; bind their decision to the input that
      // is actually pending on this target.
      const target = await resolveSupervisedRuntimeTarget({ serial, runtime });
      const pending = runtime.readTargetHealth(target.id, target.platform).input;
      if (pending.state === "uncertain" && pending.pendingMutationId) {
        mutationId = pending.pendingMutationId;
      }
    }
    if (!new Set(["applied", "not-applied", "ambiguous"]).has(body.outcome)) {
      throw new HttpError(400, "outcome must be applied, not-applied, or ambiguous");
    }
    await runtime.assertTargetControl(scope, controlTargetIdForBrowserLane(serial));
    return serializeReconciliation(serial, async () => {
      const receiptScope = { organizationId: scope.organizationId, projectId: scope.projectId };
      const clientTarget =
        body.clientUnknown === true
          ? await resolveSupervisedRuntimeTarget({ serial, runtime })
          : undefined;
      if (clientTarget) {
        assertClientUnknownReviewAllowed({
          mutationId,
          platform: clientTarget.platform,
          health: runtime.readTargetHealth(clientTarget.id, clientTarget.platform),
          reconcilePending: body.reconcilePending,
        });
      }
      const latest = readReconcileReceipt({ ...receiptScope, serial, mutationId });
      const stored = body.resolutionId
        ? (readReconcileReceipt({
            ...receiptScope,
            serial,
            mutationId,
            resolutionId: body.resolutionId,
          }) ?? (latest?.outcome !== "ambiguous" ? latest : undefined))
        : latest;
      if (stored) {
        // A prepared decision survives a crash between persistence and transition.
        // Recover the fence only; never replay input or take another observation.
        if (!stored.healthSnapshot) {
          const target = await resolveSupervisedRuntimeTarget({ serial, runtime });
          const current = runtime.readTargetHealth(target.id, target.platform);
          if (stored.review) {
            assertClientUnknownReviewAllowed({
              mutationId,
              platform: target.platform,
              health: current,
            });
          }
          if (current.input.pendingMutationId && current.input.pendingMutationId !== mutationId) {
            throw new HttpError(
              409,
              "A newer input needs review before this decision can be recovered",
            );
          }
          const health =
            current.input.state === "uncertain" &&
            current.input.pendingMutationId === mutationId &&
            stored.outcome !== "acknowledged"
              ? runtime.reconcileTargetInput(target.id, target.platform, {
                  mutationId,
                  observationId: stored.observationId!,
                  outcome: stored.outcome,
                })
              : current;
          const completed = completeReconcileReceipt({
            ...receiptScope,
            receipt: stored,
            health: health.input,
            healthSnapshot: { ...health, visibility: "project" },
          });
          Object.assign(stored, completed);
        }
        json(response, 200, {
          health: stored.healthSnapshot ?? {
            input: stored.health ?? { state: "ready" },
            visibility: "project",
          },
          ...(stored.observation ? { observation: stored.observation } : {}),
          mutationId: stored.mutationId,
          outcome: stored.outcome,
          ...(stored.review ? { review: stored.review } : {}),
          resolutionId: stored.resolutionId,
        });
        return true;
      }
      if (clientTarget) {
        const receipt = await completeClientUnknownInputReview({
          scope,
          serial,
          mutationId,
          outcome: body.outcome,
          target: clientTarget,
          runtime,
          ...(body.resolutionId ? { resolutionId: body.resolutionId } : {}),
        });
        json(response, 200, {
          health: receipt.healthSnapshot,
          observation: receipt.observation,
          mutationId: receipt.mutationId,
          outcome: receipt.outcome,
          resolutionId: receipt.resolutionId,
          review: receipt.review,
        });
        return true;
      }
      const resolved = await resolveSupervisedRuntimeTarget({ serial, runtime });
      const before = runtime.readTargetHealth(resolved.id, resolved.platform);
      if (before.input.state !== "uncertain" || before.input.pendingMutationId !== mutationId) {
        throw new HttpError(409, "The target has no matching uncertain mutation to reconcile", {
          code: "TARGET_INPUT_RECONCILIATION_STALE",
        });
      }
      // Capture after authority and pending-id checks, but before releasing the
      // exact mutation fence. The reviewed decision is therefore bound to a
      // fresh immutable observation rather than a caller-supplied evidence id.
      const observation = await runtime.captureTargetObservation(serial);
      const prepared = rememberReconcileReceipt({
        ...receiptScope,
        serial,
        mutationId,
        ...(body.resolutionId ? { resolutionId: body.resolutionId } : {}),
        outcome: body.outcome,
        observationId: durableObservationId(observation),
        observation,
      });
      const health = runtime.reconcileTargetInput(resolved.id, resolved.platform, {
        mutationId,
        observationId: durableObservationId(observation),
        outcome: body.outcome,
      });
      recordAudit(scope, {
        action: "target.input.reconcile",
        resource: mutationId,
        target: serial,
        result: body.outcome === "ambiguous" ? "deny" : "allow",
      });
      const receipt = completeReconcileReceipt({
        ...receiptScope,
        receipt: prepared,
        health: {
          state: health.input.state,
          ...(health.input.pendingMutationId
            ? { pendingMutationId: health.input.pendingMutationId }
            : {}),
          ...(health.input.reason ? { reason: health.input.reason } : {}),
        },
        healthSnapshot: { ...health, visibility: "project" },
      });
      json(response, 200, {
        health: { ...health, visibility: "project" },
        observation,
        mutationId: receipt.mutationId,
        outcome: receipt.outcome,
        resolutionId: receipt.resolutionId,
      });
      return true;
    });
  }

  if (method === "GET" && pathname === "/device/input/receipt") {
    const url = new URL(request.url ?? pathname, "http://relay.local");
    const serial = url.searchParams.get("serial")?.trim() ?? "";
    const mutationId = url.searchParams.get("mutationId")?.trim() ?? "";
    const resolutionId = url.searchParams.get("resolutionId")?.trim() ?? "";
    if (!serial && !resolutionId) throw new HttpError(400, "serial or resolutionId is required");
    const receipt = readReconcileReceipt({
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      ...(resolutionId ? { resolutionId } : {}),
      ...(serial ? { serial } : {}),
      ...(mutationId ? { mutationId } : {}),
    });
    if (!receipt) throw new HttpError(404, "No durable reconciliation receipt for that mutation");
    if (!receipt.healthSnapshot)
      throw new HttpError(
        409,
        "Reconciliation is still completing. Retry the same reconciliation attempt.",
      );
    json(response, 200, {
      receipt: {
        resolutionId: receipt.resolutionId,
        mutationId: receipt.mutationId,
        outcome: receipt.outcome,
        reviewedAt: receipt.reviewedAt,
        ...(receipt.health ? { health: receipt.health } : {}),
        ...(receipt.observation ? { observation: receipt.observation } : {}),
        ...(receipt.review ? { review: receipt.review } : {}),
      },
    });
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

  if (method === "GET" && pathname === "/device/apps") {
    const url = new URL(request.url ?? pathname, "http://relay.local");
    const serial = url.searchParams.get("serial")?.trim() ?? "";
    if (!serial) throw new HttpError(400, "serial is required");
    const device = (await runtime.listDevices()).find((candidate) => candidate.serial === serial);
    if (!device) throw new HttpError(409, "The selected device is no longer connected");
    if (device.platform !== "android")
      throw new HttpError(400, "App discovery currently requires an Android device");
    json(response, 200, { apps: await runtime.listAndroidInstalledApps(serial) });
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
    const result = await runtime.listAndroidAppLocales(serial, packageName);
    json(response, 200, { packageName, ...result });
    return true;
  }

  if (method === "POST" && pathname === "/device/app/locale") {
    const body = (await parseJsonBody(request)) as OperationInput<"target.app.locale.set">;
    const serial = typeof body.serial === "string" ? body.serial.trim() : "";
    const packageName = typeof body.package === "string" ? body.package.trim() : "";
    const locale = typeof body.locale === "string" ? body.locale.trim() : "";
    if (!serial) throw new HttpError(400, "serial is required");
    if (!packageName) throw new HttpError(400, "package is required");
    if (!locale) throw new HttpError(400, "locale is required");
    await runtime.assertTargetControl(scope, serial);
    const device = (await runtime.listDevices().catch(() => [])).find(
      (candidate) => candidate.serial === serial,
    );
    if (!device) throw new HttpError(409, `Target ${serial} is not connected`);
    if (device.platform !== "android") {
      throw new HttpError(400, "Per-app locale application currently requires Android");
    }
    let observedLocale: string | undefined;
    try {
      // setAndroidAppLocaleOnDevice retries the he/iw and id/in aliases and
      // rejects when the read-back still reports another language, so a 200
      // here means the app itself confirmed the change.
      observedLocale = await runtime.setAppLocale(serial, packageName, locale);
    } catch (error) {
      throw new HttpError(409, error instanceof Error ? error.message : String(error), {
        code: "APP_LOCALE_DID_NOT_TAKE",
        recovery:
          "The app kept another language after the alias retries. Inspect its locale resources, or verify the screen with device snapshot before trusting the switch.",
      });
    }
    json(response, 200, {
      packageName,
      locale,
      ...(observedLocale ? { observedLocale } : {}),
    });
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
    const device = await resolveSupervisedRuntimeTarget({ serial, runtime });
    if (device.platform === "browser") {
      let destination: URL;
      try {
        destination = new URL(app);
      } catch {
        throw new HttpError(400, "Browser navigation requires an http or https URL");
      }
      if (destination.protocol !== "http:" && destination.protocol !== "https:") {
        throw new HttpError(400, "Browser navigation requires an http or https URL");
      }
    }
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
    let observed = summarizeLaunchedForeground(app, undefined);
    try {
      observed = summarizeLaunchedForeground(app, await runtime.captureSnapshot({ serial }));
    } catch {
      observed = { matched: false };
    }
    json(response, 200, {
      launched: { serial, app, platform: device.platform, launchedAt: Date.now() },
      observed,
    });
    return true;
  }

  if (method === "POST" && pathname === "/device/recover") {
    const body = (await parseJsonBody(request)) as {
      serial?: unknown;
      reason?: unknown;
      recoveryFenceAssignmentId?: unknown;
      force?: unknown;
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
    // Force is the destructive wedge-clearing lane: it restarts Relay's local
    // helper even when no lock could be verified stale. Gate it like other
    // privileged maintenance and reject anything but an explicit boolean.
    const force = body.force === true;
    if (body.force !== undefined && typeof body.force !== "boolean") {
      throw new HttpError(400, "force must be a boolean");
    }
    if (force && !projectRoleAllows(scope.role, "admin")) {
      throw new HttpError(403, "Forced target recovery is available only to project admins", {
        code: "TARGET_RECOVERY_FORCE_ADMIN_ONLY",
      });
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
    const browserTarget =
      device === undefined
        ? (await runtime.listTargets().catch(() => [])).find(
            (candidate) => candidate.id === serial && candidate.kind === "browser",
          )
        : undefined;
    if (!device && !browserTarget) throw new HttpError(409, `Target ${serial} is not connected`);
    if (device && device.platform !== "ios" && device.platform !== "android") {
      throw new HttpError(
        400,
        "Automatic runtime recovery is available for connected devices only",
      );
    }
    const executionTarget = device
      ? localDeviceExecutionTarget(serial, device.platform)
      : localBrowserExecutionTarget(serial);
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
    const recovery = device
      ? await runtime.recoverTarget(
          serial,
          reason,
          force || Boolean(recoveryFenceAssignmentId),
          device.platform,
        )
      : {
          serial,
          recovered: true,
          ready: true,
          summary: "Relay verified the managed browser target.",
          actions: [],
          session: { status: "restored" as const, detail: "Ready for a fresh proof." },
        };
    if (device) runtime.recordTargetRecovery(serial, device.platform, recovery);
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
    if (build.platform === "web") {
      throw new HttpError(409, "Web deployments do not support mobile build preflight", {
        code: "PROOF_WEB_DEPLOYMENT_REQUIRED",
      });
    }
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
    if (build.platform === "web") {
      throw new HttpError(409, "Web deployments cannot be installed on a device", {
        code: "PROOF_WEB_DEPLOYMENT_REQUIRED",
      });
    }
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
    if (build.platform === "web") {
      throw new HttpError(409, "Web deployments cannot be launched as mobile builds", {
        code: "PROOF_WEB_DEPLOYMENT_REQUIRED",
      });
    }
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
