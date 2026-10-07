import { disposeAuthoringScreenshots, pixelFingerprint } from "./authoring-observation.js";
import {
  captureAuthoringObservation,
  authoringObservationDependencies,
  type AuthoringObservationDependencies,
} from "./authoring-observation.js";
export { captureAuthoringObservation } from "./authoring-observation.js";
import { InputNotDispatchedError } from "@relay/core";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type http from "node:http";
import {
  AuthoringStateError,
  authoringReplaySourceSteps,
  prepareAuthoringBrowserReplay,
  authoringSessions,
  captureScreenshot,
  captureAuthoringFullPage,
  captureSnapshot,
  cleanupScreenshot,
  currentOperationContext,
  describeRecipeStep,
  IosMutationOutcomeUnknownError,
  isBlankScreenshot,
  listDevices,
  observeVisualScreenFingerprint,
  proposeAuthoringRawOptimizations,
  runRecipeStep,
  resolveIosLaunchBundleId,
  readAppMap,
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
import { deviceFor, targetContext, type AuthoringDeviceOptions } from "./authoring-device.js";
import { executableInteraction } from "./authoring-interaction-steps.js";
import { HttpError, json, matchPath, parseJsonBody } from "./http.js";
import { iosMutationOutcomeUnknownHttpError } from "./interaction-routes.js";
import { isFinalizedMp4, startIosVideoTake, stopIosVideoTake } from "./ios-video-capture.js";
import type { RequestContext } from "./security.js";
import {
  pixelBracketStatus,
  semanticProofStatus,
  type SemanticProofStatus,
} from "./authoring-observation-proof.js";

export type { AuthoringDeviceOptions } from "./authoring-device.js";

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

/** A session with only its current Take revision and that revision's latest replay. */
function latestRevisionOf(session: AuthoringSession): AuthoringSession {
  const take = session.take;
  if (!take) return session;
  const replay = take.replayAttempts
    .filter((attempt) => attempt.takeRevision === take.currentRevision)
    .at(-1);
  return {
    ...session,
    take: {
      ...take,
      revisions: take.revisions.filter((revision) => revision.revision === take.currentRevision),
      replayAttempts: replay ? [replay] : [],
    },
  };
}

/**
 * Retain current selectors for Android/browser replay endpoints. iOS keeps an
 * immediate pixels-only endpoint because its delayed XCTest query cannot
 * establish current geometry after a mutation.
 */
export async function captureAuthoringReplayActionEndpoint(
  session: AuthoringSession,
  dependencies: AuthoringObservationDependencies = authoringObservationDependencies,
): Promise<CapturedAuthoringObservation> {
  // Android's independent capture transports and browser DOM snapshots use
  // the normal observation path. Persist a fresh tree with each endpoint so
  // edited actions can become an executable map path on that exact profile.
  if (session.target.kind === "browser" || session.target.platform === "android") {
    return captureAuthoringObservation(session, dependencies);
  }
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

export function createAuthoringRuntime(
  options: AuthoringDeviceOptions = {},
  dependencies: { resolveDevice?: typeof deviceFor } = {},
): AuthoringRuntime {
  let replayDevice: Device | undefined;
  const resolveDevice = (session: AuthoringSession) =>
    replayDevice
      ? Promise.resolve(replayDevice)
      : (dependencies.resolveDevice ?? deviceFor)(session, options);
  const executeSteps = async (
    session: AuthoringSession,
    steps: RecipeStep[],
    recordingIosAppBundleId?: string,
  ) => {
    const device = await resolveDevice(session);
    const variables: Record<string, string> = {};
    const artifacts: { kind: string; capturedAt: number; data: unknown }[] = [];
    await runWithTargetContext(targetContext(session.target), async () => {
      for (const [index, step] of steps.entries()) {
        if (step.kind === "pause") {
          throw new Error("Pause steps cannot execute inside a Take replay");
        }
        try {
          await runRecipeStep(device, step, {
            log: () => undefined,
            variables,
            artifacts,
            ...(recordingIosAppBundleId ? { recordingIosAppBundleId } : {}),
          });
        } catch (error) {
          if (error instanceof IosMutationOutcomeUnknownError) throw error;
          if (index === 0 && error instanceof InputNotDispatchedError) throw error;
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`Step ${index + 1} (${describeRecipeStep(step)}): ${message}`, {
            cause: error,
          });
        }
      }
    });
  };
  return {
    async captureFullPage(session) {
      return runWithTargetContext(targetContext(session.target), () =>
        captureAuthoringFullPage(session),
      );
    },
    async observe(session, request) {
      return captureAuthoringObservation(
        session,
        {
          ...authoringObservationDependencies,
          resolveDevice,
        },
        request,
      );
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
      let recordingIosAppBundleId: string | undefined;
      if (
        (interaction.kind === "tap" ||
          (interaction.kind === "steps" &&
            steps.every((step) => step.kind === "wait-for" || step.kind === "expect"))) &&
        session.target.kind === "device" &&
        session.target.platform === "ios" &&
        session.originApplication
      ) {
        try {
          recordingIosAppBundleId = resolveIosLaunchBundleId(session.originApplication);
        } catch {
          // Legacy unknown origins keep the established observation.
        }
      }
      await executeSteps(session, steps, recordingIosAppBundleId);
    },
    async replay(session, steps) {
      await executeSteps(session, steps);
    },
    async prepareReplaySource(session) {
      if (session.target.kind === "browser") {
        replayDevice = await prepareAuthoringBrowserReplay(session);
      }
      const map = await readAppMap(session.projectId, session.appMapId);
      const steps = authoringReplaySourceSteps(session, map ?? undefined);
      if (steps.length) await executeSteps(session, steps);
    },
    async replayAction(session, action: AuthoringAction) {
      await executeSteps(session, action.steps);
    },
    async observeReplayActionEndpoint(session) {
      return captureAuthoringReplayActionEndpoint(session, {
        ...authoringObservationDependencies,
        resolveDevice,
      });
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
    const started = await authoringSessions.begin(created.id, runtime);
    if (started.session.state !== "recording") {
      throw new HttpError(422, started.session.error ?? "Relay could not start the proposal", {
        code:
          started.failure === "source-unavailable"
            ? "AUTHORING_SOURCE_UNAVAILABLE"
            : "AUTHORING_START_FAILED",
        sessionId: created.id,
        recovery: "Recover the selected device, then start the proposal again.",
      });
    }
    return started.session;
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
        ...(input.testName ? { testName: input.testName } : {}),
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
  if (error instanceof InputNotDispatchedError) {
    throw new HttpError(409, error.message, { code: error.code, dispatched: false });
  }
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
      const latestRevisionOnly = query.get("latestRevisionOnly") === "true";
      json(response, 200, {
        sessions: latestRevisionOnly ? sessions.map(latestRevisionOf) : sessions,
      });
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
        ...(value.testName ? { testName: value.testName } : {}),
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
