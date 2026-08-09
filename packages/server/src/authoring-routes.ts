import { readFile } from "node:fs/promises";
import type http from "node:http";
import {
  AuthoringStateError,
  authoringSessions,
  captureScreenshot,
  captureSnapshot,
  createDevice,
  describeRecipeStep,
  getBrowserDevice,
  listDevices,
  observeVisualScreenFingerprint,
  runRecipeStep,
  runWithTargetContext,
  type AuthoringRuntime,
  type CapturedAuthoringObservation,
  type Device,
  type ScreenshotPayload,
  type SnapshotPayload,
} from "@relay/core";
import type {
  AuthoringInteraction,
  AuthoringSession,
  AuthoringTarget,
  CommitAuthoringSessionInput,
  CreateAuthoringSessionInput,
  RecipeStep,
  ReorderAuthoringTakeInput,
  ReplaceAuthoringActionInput,
  TrimAuthoringTakeInput,
} from "@relay/protocol";
import { assertTargetControl, assertTargetLease } from "./access-control.js";
import { HttpError, json, matchPath, parseJsonBody } from "./http.js";
import { isFinalizedMp4, startIosVideoTake, stopIosVideoTake } from "./ios-video-capture.js";
import type { RequestContext } from "./security.js";

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
      : Promise.resolve(createDevice()),
  );
}

type AuthoringObservationDependencies = {
  resolveDevice(session: AuthoringSession): Promise<Device>;
  captureSnapshot(device: Device): Promise<SnapshotPayload>;
  captureScreenshot(device: Device): Promise<ScreenshotPayload>;
};

const authoringObservationDependencies: AuthoringObservationDependencies = {
  resolveDevice: deviceFor,
  captureSnapshot: (device) => captureSnapshot({ device }),
  captureScreenshot: (device) =>
    captureScreenshot({
      device,
      caption: "Authoring evidence",
      ephemeral: true,
      includeScreenMatch: false,
    }),
};

export async function captureAuthoringObservation(
  session: AuthoringSession,
  dependencies: AuthoringObservationDependencies = authoringObservationDependencies,
): Promise<CapturedAuthoringObservation> {
  const device = await dependencies.resolveDevice(session);
  return runWithTargetContext(targetContext(session.target), async () => {
    // A physical Apple device has one XCTest command channel. Issuing the UI
    // tree and fallback screenshot concurrently makes the runner cancel one
    // request, so an otherwise healthy iPad intermittently falls back out of
    // recording. Android, simulators, and browsers keep the faster parallel
    // path because their capture transports are independent.
    const [snapshot, screenshot] =
      session.target.kind === "device" && session.target.platform === "ios"
        ? await (async () => {
            // Freeze the pixels first. Native inspection uses the XCTest
            // command channel and may need to recover a missing app session;
            // evidence must still describe what was visibly on the device
            // when this observation began.
            const screenshot = await dependencies.captureScreenshot(device);
            const snapshot = await dependencies.captureSnapshot(device);
            return [snapshot, screenshot] as const;
          })()
        : await Promise.all([
            dependencies.captureSnapshot(device),
            dependencies.captureScreenshot(device),
          ]);
    // captureScreenshot already bakes iOS orientation; do not normalize again
    // (a second 180° would flip upright frames back).
    const screenshotBytes = Buffer.from(screenshot.base64, "base64");
    // Authoring always has a screenshot, while native semantics can disappear
    // between two captures on real devices (notably Samsung Settings and
    // custom-rendered apps). Keep one identity modality for the whole Take so
    // a successful replay cannot fail merely because accessibility recovered.
    // The semantic tree remains attached as evidence and is still used by the
    // deterministic resolver; visual identity is only the screen-state key.
    const fingerprint =
      observeVisualScreenFingerprint(screenshotBytes) ?? snapshot.screenIdentity.fingerprint;
    return {
      capturedAt: Math.max(snapshot.capturedAt, screenshot.capturedAt),
      targetId: session.target.targetId,
      fingerprint,
      ...(snapshot.bounds ? { bounds: snapshot.bounds } : {}),
      nodes: snapshot.nodes.slice(0, 256) as Array<Record<string, unknown>>,
      screenshot: { data: screenshotBytes, mime: screenshot.mime },
    };
  });
}

function executableInteraction(interaction: AuthoringInteraction): RecipeStep[] {
  switch (interaction.kind) {
    case "tap":
      return [{ kind: "tap", target: structuredClone(interaction.target) }];
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

async function body<T>(request: http.IncomingMessage): Promise<T> {
  return (await parseJsonBody(request)) as T;
}

function mapError(error: unknown): never {
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
      const activeStates = new Set(["preparing", "ready", "recording", "reviewing", "committing"]);
      const sessions = (await authoringSessions.list(scope.projectId)).filter(
        (session) =>
          (!appMapId || session.appMapId === appMapId) &&
          (!targetId || session.target.targetId === targetId) &&
          (!activeOnly || activeStates.has(session.state)),
      );
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
      await assertTargetLease(scope, value.target.targetId, value.leaseId);
      const authoringRuntime = input.authoringRuntime ?? createAuthoringRuntime();
      const created = await authoringSessions.create(value);
      try {
        const observed = await authoringSessions.observe(created.id, authoringRuntime);
        if (observed.state !== "ready") {
          throw new HttpError(422, observed.error ?? "Relay could not read the source screen", {
            code: "AUTHORING_SOURCE_UNAVAILABLE",
            sessionId: created.id,
            recovery: "Recover the selected device, then start the proposal again.",
          });
        }
        const started = await authoringSessions.start(created.id, authoringRuntime);
        if (started.state !== "recording") {
          throw new HttpError(422, started.error ?? "Relay could not start the proposal", {
            code: "AUTHORING_START_FAILED",
            sessionId: created.id,
            recovery: "Recover the selected device, then start the proposal again.",
          });
        }
        json(response, 201, {
          session: started,
        });
      } catch (error) {
        await authoringSessions.cancel(created.id, authoringRuntime).catch(() => undefined);
        throw error;
      }
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
