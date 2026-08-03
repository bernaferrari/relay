import { readFile } from "node:fs/promises";
import type http from "node:http";
import {
  AuthoringStateError,
  authoringSessions,
  captureScreenshot,
  captureSnapshot,
  createDevice,
  getBrowserDevice,
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
import { assertTargetLease } from "./access-control.js";
import { HttpError, json, matchPath, parseJsonBody } from "./http.js";
import { isFinalizedMp4, startIosVideoTake, stopIosVideoTake } from "./ios-video-capture.js";
import type { RequestContext } from "./security.js";

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
    captureScreenshot({ device, caption: "Authoring evidence", ephemeral: true }),
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
        ? [await dependencies.captureSnapshot(device), await dependencies.captureScreenshot(device)]
        : await Promise.all([
            dependencies.captureSnapshot(device),
            dependencies.captureScreenshot(device),
          ]);
    return {
      capturedAt: Math.max(snapshot.capturedAt, screenshot.capturedAt),
      targetId: session.target.targetId,
      fingerprint: snapshot.screenIdentity.fingerprint,
      ...(snapshot.bounds ? { bounds: snapshot.bounds } : {}),
      nodes: snapshot.nodes.slice(0, 256) as Array<Record<string, unknown>>,
      screenshot: { data: Buffer.from(screenshot.base64, "base64"), mime: screenshot.mime },
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
        },
      ];
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
    case "steps":
      return [];
  }
}

function runtime(): AuthoringRuntime {
  const executeSteps = async (session: AuthoringSession, steps: RecipeStep[]) => {
    const device = await deviceFor(session);
    await runWithTargetContext(targetContext(session.target), async () => {
      for (const step of steps) {
        if (step.kind === "pause") {
          throw new Error("Pause steps cannot execute inside a Take replay");
        }
        await runRecipeStep(device, step, { log: () => undefined });
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
    async startVideo(session) {
      if (session.target.kind === "device" && session.target.platform === "ios") {
        const take = await startIosVideoTake(session.target.targetId);
        if (take.warning) {
          await stopIosVideoTake(session.target.targetId);
          throw new Error(take.warning);
        }
      }
    },
    async stopVideo(session) {
      if (session.target.kind !== "device" || session.target.platform !== "ios") return {};
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
  await assertTargetLease(scope, session.target.targetId, session.leaseId);
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
      json(response, 200, { sessions: await authoringSessions.list(scope.projectId) });
      return true;
    }
    if (method === "POST" && pathname === "/authoring-sessions") {
      const value = await body<CreateAuthoringSessionInput>(request);
      await assertTargetLease(scope, value.target.targetId, value.leaseId);
      json(response, 201, { session: await authoringSessions.create(value) });
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
    const authoringRuntime = input.authoringRuntime ?? runtime();
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
      json(response, 200, { session: await authoringSessions.replay(sessionId, authoringRuntime) });
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
