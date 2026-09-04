import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type http from "node:http";
import {
  AuthoringStateError,
  authoringSessions,
  captureScreenshot,
  captureSnapshot,
  cleanupScreenshot,
  createDeviceForTarget,
  currentOperationContext,
  describeRecipeStep,
  getBrowserDevice,
  IosMutationOutcomeUnknownError,
  isBlankScreenshot,
  listDevices,
  observeVisualScreenFingerprint,
  proposeAuthoringRawOptimizations,
  runRecipeStep,
  runWithTargetContext,
  type AuthoringRuntime,
  type CapturedAuthoringObservation,
  type Device,
  type ScreenshotPayload,
  type SnapshotPayload,
} from "@relay/core";
import type {
  AuthoringAction,
  AuthoringCaptureContext,
  AuthoringInteraction,
  AuthoringObservationProof,
  AuthoringSession,
  AuthoringTarget,
  CommitAuthoringSessionInput,
  CreateAuthoringSessionInput,
  EditAuthoringTakeInput,
  RecipeStep,
  ReorderAuthoringTakeInput,
  ReplaceAuthoringActionInput,
  TrimAuthoringTakeInput,
  WorkflowTransitionInput,
} from "@relay/protocol";
import { assertTargetControl, assertTargetLease } from "./access-control.js";
import { HttpError, json, matchPath, parseJsonBody } from "./http.js";
import { iosMutationOutcomeUnknownHttpError } from "./interaction-routes.js";
import { isFinalizedMp4, startIosVideoTake, stopIosVideoTake } from "./ios-video-capture.js";
import type { RequestContext } from "./security.js";
import {
  pixelBracketStatus,
  semanticProofStatus,
  type SemanticProofStatus,
} from "./authoring-observation-proof.js";

// XCTest video recording owns the command channel on attached Apple hardware:
// any tap, snapshot, or text command restarts the runner and destroys the
// movie. Simulator video uses a separate transport and remains fully
// interactive. Physical devices therefore capture deterministic actions plus
// before/after evidence; this is both more useful and dramatically smaller
// than an unbounded, non-interactive XCTest movie.
const evidenceOnlyIosSessions = new Set<string>();

async function usesExclusivePhysicalIosRunner(session: AuthoringSession): Promise<boolean> {
  if (session.target.kind !== "device" || session.target.platform !== "ios") return false;
  const devices = await listDevices().catch(() => []);
  const target = devices.find((device) => device.serial === session.target.targetId);
  return !target || !/simulator/i.test(target.kind ?? "");
}

function targetContext(target: AuthoringTarget) {
  return target.kind === "browser"
    ? ({ kind: "browser", platform: "browser", targetId: target.targetId } as const)
    : ({ kind: "device", platform: target.platform, serial: target.targetId } as const);
}

async function deviceFor(session: AuthoringSession) {
  const context = targetContext(session.target);
  return runWithTargetContext(context, () =>
    session.target.kind === "browser"
      ? getBrowserDevice(session.target.targetId)
      : Promise.resolve(createDeviceForTarget(context)),
  );
}

type AuthoringObservationDependencies = {
  resolveDevice(session: AuthoringSession): Promise<Device>;
  captureSnapshot(device: Device): Promise<SnapshotPayload>;
  /** Retry Android semantics through the explicit serial when the shared
   * authoring observation starts with an empty UiAutomation tree. */
  captureSnapshotBySerial?(serial: string): Promise<SnapshotPayload>;
  captureScreenshot(device: Device): Promise<ScreenshotPayload>;
};

const authoringObservationDependencies: AuthoringObservationDependencies = {
  resolveDevice: deviceFor,
  captureSnapshot: (device) => captureSnapshot({ device }),
  captureSnapshotBySerial: (serial) => captureSnapshot({ serial }),
  captureScreenshot: (device) =>
    captureScreenshot({
      device,
      caption: "Authoring evidence",
      ephemeral: true,
      includeScreenMatch: false,
    }),
};

/** Every authoring observation copies its pixels into immutable evidence before
 * returning. The workspace capture path is therefore private implementation
 * state, not an evidence reference. Cleanup is deliberately best-effort so a
 * filesystem issue never hides the already-durable authoring result/error. */
async function disposeAuthoringScreenshots(
  ...screenshots: Array<ScreenshotPayload | undefined>
): Promise<void> {
  const paths = new Set(
    screenshots
      .map((screenshot) => screenshot?.path)
      .filter((path): path is string => Boolean(path)),
  );
  await Promise.all(
    [...paths].map(async (path) => {
      await cleanupScreenshot(path).catch(() => undefined);
    }),
  );
}

/** A PNG-derived screen fingerprint is stable across benign encoder variance;
 * raw bytes are a conservative fallback for failed/fixture decoders. It is
 * deliberately separate from the AX identity so a late tree cannot certify
 * its own visual bracket. */
function pixelFingerprint(bytes: Uint8Array): string {
  return observeVisualScreenFingerprint(bytes) ?? createHash("sha256").update(bytes).digest("hex");
}

export async function captureAuthoringObservation(
  session: AuthoringSession,
  dependencies: AuthoringObservationDependencies = authoringObservationDependencies,
): Promise<CapturedAuthoringObservation> {
  const device = await dependencies.resolveDevice(session);
  return runWithTargetContext(targetContext(session.target), async () => {
    const ios = session.target.kind === "device" && session.target.platform === "ios";
    // A physical Apple device has one XCTest command channel. Issuing the UI
    // tree and fallback screenshot concurrently makes the runner cancel one
    // request, so an otherwise healthy iPad intermittently falls back out of
    // recording. Android, simulators, and browsers keep the faster parallel
    // path because their capture transports are independent.
    let snapshot: SnapshotPayload;
    let screenshot: ScreenshotPayload | undefined;
    let closingScreenshot: ScreenshotPayload | undefined;
    let closingScreenshotBytes: Buffer | undefined;
    try {
      if (ios) {
        // Freeze the pixels first. Native inspection uses the XCTest command
        // channel and may need to recover a missing app session; evidence must
        // still describe what was visibly on the device when this observation
        // began.
        screenshot = await dependencies.captureScreenshot(device);
        const openingBytes = Buffer.from(screenshot.base64, "base64");
        if (isBlankScreenshot(openingBytes)) {
          throw new Error(
            "The device returned a blank screenshot. Recover or relaunch the app, then retry capture; no map screen was saved.",
          );
        }
        snapshot = await dependencies.captureSnapshot(device);
        // Do not pay for a second raster when the tree was already unavailable.
        // When it could otherwise become selector or identity evidence, bracket
        // the AX read with a fresh raster. A failed closing capture leaves the
        // primary screenshot usable but deliberately downgrades semantics.
        if (semanticProofStatus(snapshot) === "current") {
          try {
            closingScreenshot = await dependencies.captureScreenshot(device);
            closingScreenshotBytes = Buffer.from(closingScreenshot.base64, "base64");
          } catch {
            closingScreenshot = undefined;
            closingScreenshotBytes = undefined;
          }
        }
      } else {
        // Settle both independently so a successful temporary raster is
        // still available to dispose when the concurrent AX call fails.
        const [snapshotResult, screenshotResult] = await Promise.allSettled([
          dependencies.captureSnapshot(device),
          dependencies.captureScreenshot(device),
        ]);
        if (screenshotResult.status === "fulfilled") screenshot = screenshotResult.value;
        if (snapshotResult.status === "rejected") throw snapshotResult.reason;
        if (screenshotResult.status === "rejected") throw screenshotResult.reason;
        snapshot = snapshotResult.value;
        if (
          session.target.kind === "device" &&
          session.target.platform === "android" &&
          snapshot.nodes.length === 0 &&
          dependencies.captureSnapshotBySerial
        ) {
          try {
            const retry = await dependencies.captureSnapshotBySerial(session.target.targetId);
            if (retry.nodes.length > snapshot.nodes.length) snapshot = retry;
          } catch {
            // Keep the original pixel-backed observation and its honest empty
            // semantics when the bounded retry cannot acquire UiAutomation.
          }
        }
      }
      if (!screenshot) throw new Error("Authoring screenshot capture did not return evidence.");
      // captureScreenshot already bakes iOS orientation; do not normalize again
      // (a second 180° would flip upright frames back).
      const screenshotBytes = Buffer.from(screenshot.base64, "base64");
      if (isBlankScreenshot(screenshotBytes)) {
        throw new Error(
          "The device returned a blank screenshot. Recover or relaunch the app, then retry capture; no map screen was saved.",
        );
      }
      const primaryPixelFingerprint = pixelFingerprint(screenshotBytes);
      const closingPixelFingerprint = closingScreenshotBytes
        ? pixelFingerprint(closingScreenshotBytes)
        : undefined;
      const bracket =
        ios && semanticProofStatus(snapshot) === "current"
          ? {
              status:
                closingScreenshot && closingScreenshotBytes && closingPixelFingerprint
                  ? pixelBracketStatus({
                      before: screenshot,
                      beforeFingerprint: primaryPixelFingerprint,
                      after: closingScreenshot,
                      afterBytes: closingScreenshotBytes,
                      afterFingerprint: closingPixelFingerprint,
                    })
                  : ("unavailable" as const),
              ...(closingScreenshot ? { afterCapturedAt: closingScreenshot.capturedAt } : {}),
              ...(closingPixelFingerprint ? { afterFingerprint: closingPixelFingerprint } : {}),
            }
          : undefined;
      // Authoring always has a screenshot, while native semantics can disappear
      // between two captures on real devices (notably Samsung Settings and
      // custom-rendered apps). Keep one identity modality for the whole Take so
      // a successful replay cannot fail merely because accessibility recovered.
      // The semantic tree remains attached as evidence and is still used by the
      // deterministic resolver; visual identity is only the screen-state key.
      // iOS must never use the delayed AX fingerprint as a stand-in for raster
      // evidence. Other transports retain their established semantic fallback
      // when a test fixture or provider cannot decode the image.
      const fingerprint = ios
        ? primaryPixelFingerprint
        : (observeVisualScreenFingerprint(screenshotBytes) ?? snapshot.screenIdentity.fingerprint);
      const semanticStatus: SemanticProofStatus =
        ios && semanticProofStatus(snapshot) === "current" && bracket?.status !== "coherent"
          ? "stale"
          : semanticProofStatus(snapshot);
      const proof: AuthoringObservationProof = {
        schemaVersion: 1,
        captureOrder: bracket ? "pixels-ax-pixels" : ios ? "pixels-first" : "concurrent",
        pixels: {
          status: "captured",
          capturedAt: screenshot.capturedAt,
          fingerprint: ios ? primaryPixelFingerprint : fingerprint,
          ...(screenshot.width !== undefined ? { width: screenshot.width } : {}),
          ...(screenshot.height !== undefined ? { height: screenshot.height } : {}),
          ...(bracket ? { bracket } : {}),
        },
        semantics: {
          status: semanticStatus,
          capturedAt: snapshot.capturedAt,
          ...(snapshot.inspectable !== false && snapshot.nodes.length > 0
            ? { fingerprint: snapshot.screenIdentity.fingerprint }
            : {}),
        },
      };
      const capture: AuthoringCaptureContext = {
        snapshotSource: snapshot.source,
        inspectable: snapshot.inspectable,
        ...(snapshot.inspectionState ? { inspectionState: snapshot.inspectionState } : {}),
        ...(snapshot.bindingState ? { bindingState: snapshot.bindingState } : {}),
        ...(snapshot.treeApp ? { treeApp: snapshot.treeApp } : {}),
        ...(ios
          ? { visualFingerprint: primaryPixelFingerprint }
          : snapshot.visualFingerprint
            ? { visualFingerprint: snapshot.visualFingerprint }
            : {}),
      };
      return {
        capturedAt: Math.max(
          snapshot.capturedAt,
          screenshot.capturedAt,
          closingScreenshot?.capturedAt ?? Number.NEGATIVE_INFINITY,
        ),
        targetId: session.target.targetId,
        fingerprint,
        proof,
        capture,
        ...(snapshot.foregroundApp ? { foregroundApp: snapshot.foregroundApp } : {}),
        ...(snapshot.bounds ? { bounds: snapshot.bounds } : {}),
        nodes: snapshot.nodes.slice(0, 256) as Array<Record<string, unknown>>,
        screenshotCapturedAt: screenshot.capturedAt,
        screenshot: { data: screenshotBytes, mime: screenshot.mime },
        ...(closingScreenshot &&
        closingScreenshotBytes &&
        !screenshotBytes.equals(closingScreenshotBytes)
          ? {
              bracketScreenshot: {
                data: closingScreenshotBytes,
                mime: closingScreenshot.mime,
                capturedAt: closingScreenshot.capturedAt,
              },
            }
          : {}),
      };
    } finally {
      await disposeAuthoringScreenshots(screenshot, closingScreenshot);
    }
  });
}

/**
 * Capture a replay action endpoint without starting a new accessibility
 * request. This is intentionally a pixels-only fact: `captureScreenshot`
 * owns physical iOS orientation normalization, while a cached tree must never
 * be presented as current after the action changed the device.
 */
export async function captureAuthoringReplayActionEndpoint(
  session: AuthoringSession,
  dependencies: AuthoringObservationDependencies = authoringObservationDependencies,
): Promise<CapturedAuthoringObservation> {
  const device = await dependencies.resolveDevice(session);
  return runWithTargetContext(targetContext(session.target), async () => {
    let screenshot: ScreenshotPayload | undefined;
    try {
      screenshot = await dependencies.captureScreenshot(device);
      const screenshotBytes = Buffer.from(screenshot.base64, "base64");
      if (isBlankScreenshot(screenshotBytes)) {
        throw new Error(
          "The device returned a blank replay endpoint screenshot. Recover or relaunch the app before trying again; no action proof was saved.",
        );
      }
      const fingerprint =
        observeVisualScreenFingerprint(screenshotBytes) ??
        createHash("sha256").update(screenshotBytes).digest("hex");
      return {
        capturedAt: screenshot.capturedAt,
        targetId: session.target.targetId,
        fingerprint,
        proof: {
          schemaVersion: 1,
          captureOrder: "pixels-first",
          pixels: {
            status: "captured",
            capturedAt: screenshot.capturedAt,
            fingerprint,
            ...(screenshot.width !== undefined ? { width: screenshot.width } : {}),
            ...(screenshot.height !== undefined ? { height: screenshot.height } : {}),
          },
          // Do not reuse or query AX here. A later normal observation may carry
          // current semantics, but this immediate action endpoint is honest
          // pixels-only evidence even when the platform still has a tree cached.
          semantics: { status: "unavailable", capturedAt: screenshot.capturedAt },
        },
        capture: {
          snapshotSource: "pixels-only",
          inspectable: false,
          visualFingerprint: fingerprint,
        },
        ...(screenshot.foregroundApp ? { foregroundApp: screenshot.foregroundApp } : {}),
        ...(screenshot.width !== undefined && screenshot.height !== undefined
          ? { bounds: { width: screenshot.width, height: screenshot.height } }
          : {}),
        screenshotCapturedAt: screenshot.capturedAt,
        screenshot: { data: screenshotBytes, mime: screenshot.mime },
      };
    } finally {
      await disposeAuthoringScreenshots(screenshot);
    }
  });
}

function executableInteraction(interaction: AuthoringInteraction): RecipeStep[] {
  switch (interaction.kind) {
    case "tap":
      return [
        {
          kind: "tap",
          target: structuredClone(interaction.target),
          ...(interaction.expectedApp ? { expectedApp: interaction.expectedApp } : {}),
        },
      ];
    case "type":
      return [
        {
          kind: "type",
          text: interaction.text,
          ...(interaction.target ? { target: structuredClone(interaction.target) } : {}),
          ...(interaction.mode ? { mode: interaction.mode } : {}),
        },
      ];
    case "clipboard":
      return [
        {
          kind: "clipboard",
          action: interaction.action,
          ...(interaction.text !== undefined ? { text: interaction.text } : {}),
          ...(interaction.target ? { target: structuredClone(interaction.target) } : {}),
          ...(interaction.expect !== undefined ? { expect: interaction.expect } : {}),
          ...(interaction.match ? { match: interaction.match } : {}),
        },
      ];
    case "app":
      return [
        {
          kind: "app",
          action: interaction.action,
          ...(interaction.app !== undefined ? { app: interaction.app } : {}),
          ...(interaction.url !== undefined ? { url: interaction.url } : {}),
          ...(interaction.relaunch !== undefined ? { relaunch: interaction.relaunch } : {}),
          ...(interaction.artifact !== undefined ? { artifact: interaction.artifact } : {}),
          ...(interaction.as !== undefined ? { as: interaction.as } : {}),
          ...(interaction.version !== undefined ? { version: interaction.version } : {}),
          ...(interaction.versionMatch ? { versionMatch: interaction.versionMatch } : {}),
        },
      ];
    case "device":
      return [{ kind: "device", action: interaction.action }];
    case "rotate":
      return [{ kind: "rotate", orientation: interaction.orientation }];
    case "swipe":
      return [
        {
          kind: "swipe",
          from: { ...interaction.from },
          to: { ...interaction.to },
          ...(interaction.durationMs !== undefined ? { durationMs: interaction.durationMs } : {}),
        },
      ];
    case "key":
      return [{ kind: "key", key: interaction.key }];
    case "wait":
      return interaction.ms > 0 ? [{ kind: "sleep", ms: interaction.ms }] : [];
    case "observe":
    case "screenshot":
    case "reusable":
      return [];
    case "steps":
      return structuredClone(interaction.steps);
  }
}

export function createAuthoringRuntime(): AuthoringRuntime {
  const executeSteps = async (session: AuthoringSession, steps: RecipeStep[]) => {
    const device = await deviceFor(session);
    const variables: Record<string, string> = {};
    const artifacts: { kind: string; capturedAt: number; data: unknown }[] = [];
    await runWithTargetContext(targetContext(session.target), async () => {
      for (const [index, step] of steps.entries()) {
        if (step.kind === "pause") {
          throw new Error("Pause steps cannot execute inside a Take replay");
        }
        try {
          await runRecipeStep(device, step, { log: () => undefined, variables, artifacts });
        } catch (error) {
          if (error instanceof IosMutationOutcomeUnknownError) throw error;
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`Step ${index + 1} (${describeRecipeStep(step)}): ${message}`, {
            cause: error,
          });
        }
      }
    });
  };
  return {
    async observe(session) {
      return captureAuthoringObservation(session);
    },
    async execute(session, interaction) {
      const steps = executableInteraction(interaction);
      if (
        steps.length === 0 &&
        !["observe", "screenshot", "reusable", "steps"].includes(interaction.kind)
      ) {
        if (interaction.kind !== "wait" || interaction.ms !== 0) {
          throw new Error(`Capability unavailable for ${interaction.kind}`);
        }
      }
      await executeSteps(session, steps);
    },
    async replay(session, steps) {
      await executeSteps(session, steps);
    },
    async prepareReplaySource(session) {
      if (session.target.kind !== "browser") return;
      await executeSteps(session, [{ kind: "key", key: "home" }]);
    },
    async replayAction(session, action: AuthoringAction) {
      await executeSteps(session, action.steps);
    },
    async observeReplayActionEndpoint(session) {
      return captureAuthoringReplayActionEndpoint(session);
    },
    async settle(ms) {
      await new Promise<void>((resolve) => setTimeout(resolve, ms));
    },
    async startVideo(session) {
      if (session.target.kind === "device" && session.target.platform === "ios") {
        if (await usesExclusivePhysicalIosRunner(session)) {
          evidenceOnlyIosSessions.add(session.id);
          return;
        }
        const take = await startIosVideoTake(session.target.targetId);
        if (take.warning) {
          await stopIosVideoTake(session.target.targetId);
          throw new Error(take.warning);
        }
      }
    },
    async stopVideo(session) {
      if (session.target.kind !== "device" || session.target.platform !== "ios") return {};
      if (evidenceOnlyIosSessions.delete(session.id)) return {};
      const take = await stopIosVideoTake(session.target.targetId);
      if (!take) return { warning: "No active Apple video recording was found." };
      let data: Buffer | undefined;
      let warning = take.warning;
      try {
        data = await readFile(take.path);
        if (!isFinalizedMp4(data)) {
          data = undefined;
          warning ??=
            "Apple recording ended before its video was finalized. The transition and final screen were still saved.";
        }
      } catch {
        data = undefined;
      }
      return {
        ...(data ? { data } : {}),
        mime: "video/mp4",
        ...(warning ? { warning } : {}),
      };
    },
  };
}

async function controlledSession(scope: RequestContext, sessionId: string) {
  const session = await authoringSessions.get(sessionId);
  try {
    await assertTargetLease(scope, session.target.targetId, session.leaseId);
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 403) throw error;
    // Authoring reviews intentionally outlive short exclusive leases. Accept
    // a renewed lease only when the same operation actor currently owns the
    // same target; this preserves exclusivity without making a person discard
    // a good Take after reading or editing it for fifteen minutes.
    await assertTargetControl(scope, session.target.targetId);
  }
  return session;
}

type AuthoringWorkflowTransition = Exclude<
  WorkflowTransitionInput,
  { action: "attach-run" | "cancel-run" | "start-authoring" | "authoring-abandon" }
>;

export async function assertAuthoringTransitionAccess(
  scope: RequestContext,
  session: AuthoringSession,
  action: AuthoringWorkflowTransition["action"],
): Promise<void> {
  const actorId = currentOperationContext()?.actorId ?? scope.subject;
  if (session.actorId !== actorId) throw new HttpError(404, "Authoring Session not found");
  if (
    [
      "authoring-record",
      "authoring-checkpoint",
      "authoring-stop",
      "authoring-replay",
      "authoring-cancel",
    ].includes(action)
  ) {
    await controlledSession(scope, session.id);
  }
}

/** Server-side authoring begin used by both the canonical operation and the
 * durable workflow coordinator. The caller must reserve durable intent before
 * entering this function when response loss matters. */
export async function beginControlledAuthoringSession(
  scope: RequestContext,
  value: CreateAuthoringSessionInput,
  runtime: AuthoringRuntime = createAuthoringRuntime(),
): Promise<AuthoringSession> {
  await assertTargetLease(scope, value.target.targetId, value.leaseId);
  const created = await authoringSessions.create(value);
  try {
    const observed = await authoringSessions.observe(created.id, runtime);
    if (observed.state !== "ready") {
      throw new HttpError(422, observed.error ?? "Relay could not read the source screen", {
        code: "AUTHORING_SOURCE_UNAVAILABLE",
        sessionId: created.id,
        recovery: "Recover the selected device, then start the proposal again.",
      });
    }
    const started = await authoringSessions.start(created.id, runtime);
    if (started.state !== "recording") {
      throw new HttpError(422, started.error ?? "Relay could not start the proposal", {
        code: "AUTHORING_START_FAILED",
        sessionId: created.id,
        recovery: "Recover the selected device, then start the proposal again.",
      });
    }
    return started;
  } catch (error) {
    await authoringSessions.cancel(created.id, runtime).catch(() => undefined);
    throw error;
  }
}

/** Execute exactly one already-reserved durable Authoring transition. This
 * function never retries; the workflow coordinator owns reconciliation. */
export async function executeControlledAuthoringTransition(
  scope: RequestContext,
  sessionId: string,
  input: AuthoringWorkflowTransition,
  runtime: AuthoringRuntime = createAuthoringRuntime(),
  workflowMutation?: NonNullable<AuthoringSession["workflowMutation"]>,
): Promise<AuthoringSession> {
  const current = await authoringSessions.get(sessionId);
  await assertAuthoringTransitionAccess(scope, current, input.action);
  if (input.action === "authoring-record") {
    return authoringSessions.interact(sessionId, input.interaction, runtime, workflowMutation);
  }
  if (input.action === "authoring-checkpoint") {
    return authoringSessions.interact(
      sessionId,
      { kind: "screenshot", ...(input.label ? { label: input.label } : {}) },
      runtime,
      workflowMutation,
    );
  }
  if (input.action === "authoring-stop") {
    return authoringSessions.stop(sessionId, runtime, workflowMutation);
  }
  if (input.action === "authoring-edit") {
    return authoringSessions.edit(sessionId, input.edit, workflowMutation);
  }
  if (input.action === "authoring-replay") {
    const session = await authoringSessions.replay(sessionId, runtime, workflowMutation);
    const attempt = session.take?.replayAttempts.at(-1);
    if (attempt?.outcome === "failed") {
      throw new HttpError(422, attempt.error ?? "Proposal replay failed", {
        code: "REPLAY_FAILED",
        sessionId,
        replayId: attempt.id,
      });
    }
    if (attempt?.outcome === "cancelled") {
      throw new HttpError(409, "Proposal replay was cancelled", {
        code: "REPLAY_CANCELLED",
        sessionId,
        replayId: attempt.id,
      });
    }
    return session;
  }
  if (input.action === "authoring-approve") {
    return authoringSessions.commit(
      sessionId,
      {
        ...(input.destination ? { destination: input.destination } : {}),
        createTest: true,
      },
      undefined,
      workflowMutation,
    );
  }
  if (input.action === "authoring-discard") {
    return authoringSessions.discard(sessionId, workflowMutation);
  }
  return authoringSessions.cancel(sessionId, runtime, workflowMutation);
}

async function body<T>(request: http.IncomingMessage): Promise<T> {
  return (await parseJsonBody(request)) as T;
}

function mapError(error: unknown): never {
  if (error instanceof IosMutationOutcomeUnknownError) {
    throw iosMutationOutcomeUnknownHttpError(error);
  }
  if (error instanceof HttpError) throw error;
  if (error instanceof AuthoringStateError) throw new HttpError(error.status, error.message);
  throw error;
}

export async function handleAuthoringRoute(input: {
  method: string;
  pathname: string;
  request: http.IncomingMessage;
  response: http.ServerResponse;
  scope: RequestContext;
  authoringRuntime?: AuthoringRuntime;
}): Promise<boolean> {
  const { method, pathname, request, response, scope } = input;
  try {
    if (method === "GET" && pathname === "/authoring-sessions") {
      const query = new URL(request.url ?? pathname, "http://relay.local").searchParams;
      const appMapId = query.get("appMapId");
      const targetId = query.get("targetId");
      const activeOnly = query.get("activeOnly") === "true";
      const includeHistory = query.get("includeHistory") === "true";
      const activeStates = new Set(["preparing", "ready", "recording", "reviewing", "committing"]);
      const candidates = (await authoringSessions.list(scope.projectId, { includeHistory })).filter(
        (session) =>
          (!appMapId || session.appMapId === appMapId) &&
          (!targetId || session.target.targetId === targetId) &&
          (!activeOnly || activeStates.has(session.state)),
      );
      // Defensive deduplication for sessions written by an older Relay or a
      // concurrent replacement: the live view has one actionable review per
      // actor/map/target. Explicit history remains complete and immutable.
      const newestReviewByScope = new Map<string, string>();
      if (!includeHistory) {
        for (const session of candidates) {
          if (session.state !== "reviewing" || session.archive) continue;
          const key = `${session.actorId}\0${session.appMapId}\0${session.target.targetId}`;
          if (!newestReviewByScope.has(key)) newestReviewByScope.set(key, session.id);
        }
      }
      const sessions = candidates.filter((session) => {
        if (includeHistory || session.state !== "reviewing" || session.archive) return true;
        const key = `${session.actorId}\0${session.appMapId}\0${session.target.targetId}`;
        return newestReviewByScope.get(key) === session.id;
      });
      json(response, 200, { sessions });
      return true;
    }
    if (method === "POST" && pathname === "/authoring-sessions") {
      const value = await body<CreateAuthoringSessionInput>(request);
      await assertTargetLease(scope, value.target.targetId, value.leaseId);
      json(response, 201, { session: await authoringSessions.create(value) });
      return true;
    }
    if (method === "POST" && pathname === "/authoring-sessions/begin") {
      const value = await body<CreateAuthoringSessionInput>(request);
      json(response, 201, {
        session: await beginControlledAuthoringSession(
          scope,
          value,
          input.authoringRuntime ?? createAuthoringRuntime(),
        ),
      });
      return true;
    }

    const optimizationMatch = matchPath(
      pathname,
      "/authoring-sessions/:sessionId/optimization-proposal",
    );
    if (method === "GET" && optimizationMatch) {
      const session = await authoringSessions.get(optimizationMatch.sessionId!);
      json(response, 200, {
        proposal: session.take ? (proposeAuthoringRawOptimizations(session.take) ?? null) : null,
      });
      return true;
    }

    const sessionMatch = matchPath(pathname, "/authoring-sessions/:sessionId");
    if (method === "GET" && sessionMatch) {
      json(response, 200, { session: await authoringSessions.get(sessionMatch.sessionId!) });
      return true;
    }
    if (method === "DELETE" && sessionMatch) {
      await authoringSessions.get(sessionMatch.sessionId!);
      await authoringSessions.cleanup(sessionMatch.sessionId!);
      json(response, 200, { ok: true });
      return true;
    }

    const actionMatch = matchPath(pathname, "/authoring-sessions/:sessionId/:action");
    if (method !== "POST" || !actionMatch) return false;
    const sessionId = actionMatch.sessionId!;
    const action = actionMatch.action!;
    if (["observe", "capture", "start", "interact", "stop", "replay", "cancel"].includes(action)) {
      await controlledSession(scope, sessionId);
    } else {
      await authoringSessions.get(sessionId);
    }
    const authoringRuntime = input.authoringRuntime ?? createAuthoringRuntime();
    if (action === "observe") {
      await body(request);
      json(response, 200, {
        session: await authoringSessions.observe(sessionId, authoringRuntime),
      });
      return true;
    }
    if (action === "capture") {
      await body(request);
      json(response, 200, {
        session: await authoringSessions.capture(sessionId, authoringRuntime),
      });
      return true;
    }
    if (action === "start") {
      await body(request);
      json(response, 200, { session: await authoringSessions.start(sessionId, authoringRuntime) });
      return true;
    }
    if (action === "interact") {
      const value = await body<{ interaction: AuthoringInteraction }>(request);
      json(response, 200, {
        session: await authoringSessions.interact(sessionId, value.interaction, authoringRuntime),
      });
      return true;
    }
    if (action === "stop") {
      await body(request);
      json(response, 200, { session: await authoringSessions.stop(sessionId, authoringRuntime) });
      return true;
    }
    if (action === "trim") {
      const value = await body<TrimAuthoringTakeInput>(request);
      json(response, 200, { session: await authoringSessions.trim(sessionId, value) });
      return true;
    }
    if (action === "reorder") {
      const value = await body<ReorderAuthoringTakeInput>(request);
      json(response, 200, { session: await authoringSessions.reorder(sessionId, value.actionIds) });
      return true;
    }
    if (action === "edit") {
      const value = await body<EditAuthoringTakeInput>(request);
      json(response, 200, { session: await authoringSessions.edit(sessionId, value.edit) });
      return true;
    }
    if (action === "replay") {
      await body(request);
      const session = await authoringSessions.replay(sessionId, authoringRuntime);
      const attempt = session.take?.replayAttempts.at(-1);
      if (attempt?.outcome === "failed") {
        throw new HttpError(422, attempt.error ?? "Proposal replay failed", {
          code: "REPLAY_FAILED",
          sessionId,
          replayId: attempt.id,
          recovery: "Return the target to the recorded source screen, then replay again.",
        });
      }
      if (attempt?.outcome === "cancelled") {
        throw new HttpError(409, "Proposal replay was cancelled", {
          code: "REPLAY_CANCELLED",
          sessionId,
          replayId: attempt.id,
        });
      }
      json(response, 200, { session });
      return true;
    }
    if (action === "commit") {
      const value = await body<CommitAuthoringSessionInput>(request);
      const session = await authoringSessions.commit(sessionId, {
        destination: value.destination,
        ...(value.createTest ? { createTest: true } : {}),
      });
      json(response, 200, { session });
      return true;
    }
    if (action === "discard") {
      await body(request);
      json(response, 200, { session: await authoringSessions.discard(sessionId) });
      return true;
    }
    if (action === "cancel") {
      await body(request);
      json(response, 200, { session: await authoringSessions.cancel(sessionId, authoringRuntime) });
      return true;
    }
    return false;
  } catch (error) {
    mapError(error);
  }
}

export async function handleAuthoringActionReplace(input: {
  method: string;
  pathname: string;
  request: http.IncomingMessage;
  response: http.ServerResponse;
  scope: RequestContext;
}): Promise<boolean> {
  const match = matchPath(input.pathname, "/authoring-sessions/:sessionId/actions/:actionId");
  if (input.method !== "POST" || !match) return false;
  try {
    await authoringSessions.get(match.sessionId!);
    const value = await body<ReplaceAuthoringActionInput>(input.request);
    json(input.response, 200, {
      session: await authoringSessions.replace(
        match.sessionId!,
        match.actionId!,
        value.interaction,
      ),
    });
    return true;
  } catch (error) {
    mapError(error);
  }
}
