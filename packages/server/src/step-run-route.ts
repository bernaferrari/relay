import type http from "node:http";
import {
  createDevice,
  devicePlatformForSerial,
  getActiveJob,
  IosMutationOutcomeUnknownError,
  listDevices,
  runRecipeStep,
  runWithTargetContext,
  validateRecipeSteps,
} from "@relay/core";
import { assertTargetControl } from "./access-control.js";
import {
  browserCaseProfileIfManaged,
  rejectBlockedClaimedBrowserJob,
} from "./claimed-browser-job-admission.js";
import { HttpError, json, parseJsonBody } from "./http.js";
import { iosMutationOutcomeUnknownPayload } from "./interaction-routes.js";
import type { RequestContext } from "./security.js";

type StepRun = ReturnType<typeof validateRecipeSteps>[number];
type StepRunPlatform = NonNullable<Awaited<ReturnType<typeof devicePlatformForSerial>>>;

export type StandaloneStepReview = {
  /** A terminal review state, never an instruction to replay the command. */
  captureCurrent: {
    operationId: "target.screenshot.capture";
    input: { serial: string };
  };
};

type StepRunExecution = {
  serial: string;
  platform: StepRunPlatform;
  step: StepRun;
  log: (line: string) => void;
};

/** The injected execution seam lets the HTTP boundary be proven without a
 * connected device. It deliberately owns one complete step execution rather
 * than exposing an alternate mutation transport to callers. */
export type StepRunRouteRuntime = {
  assertTargetControl: typeof assertTargetControl;
  listDevices: typeof listDevices;
  devicePlatformForSerial: typeof devicePlatformForSerial;
  executeStep: (input: StepRunExecution) => Promise<void>;
};

const defaultRuntime: StepRunRouteRuntime = {
  assertTargetControl,
  listDevices,
  devicePlatformForSerial,
  async executeStep({ serial, platform, step, log }) {
    await runWithTargetContext({ kind: "device", platform, serial }, async () => {
      await runRecipeStep(createDevice(), step, { log });
    });
  },
};

/**
 * A screenshot is an explicit observation requested after an uncertain iOS
 * command. The pointer uses the public operation vocabulary so browser, CLI,
 * and MCP clients can all take the same next step without inventing a retry.
 */
export function standaloneStepOutcomeUnknownReview(serial: string): StandaloneStepReview {
  return {
    captureCurrent: {
      operationId: "target.screenshot.capture",
      input: { serial },
    },
  };
}

export async function handleStepRunRoute(context: {
  method: string;
  pathname: string;
  request: http.IncomingMessage;
  response: http.ServerResponse;
  scope: RequestContext;
  runtime?: Partial<StepRunRouteRuntime>;
}): Promise<boolean> {
  if (context.method !== "POST" || context.pathname !== "/step/run") return false;

  const runtime = { ...defaultRuntime, ...context.runtime };
  const body = (await parseJsonBody(context.request)) as { step?: unknown; serial?: string };
  if (!body || typeof body !== "object" || body.step === undefined) {
    throw new HttpError(400, "body.step is required");
  }
  const serial = typeof body.serial === "string" ? body.serial.trim() : "";
  if (!serial) throw new HttpError(400, "serial is required");
  await runtime.assertTargetControl(context.scope, serial);
  const browserCaseProfile = await browserCaseProfileIfManaged(serial);
  await rejectBlockedClaimedBrowserJob({
    projectId: context.scope.projectId,
    targetId: browserCaseProfile ? serial : undefined,
    browserCaseProfile,
  });

  let steps: StepRun[];
  try {
    steps = validateRecipeSteps([body.step]);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : String(error));
  }
  const step = steps[0]!;
  if (step.kind === "pause") throw new HttpError(400, "pause steps cannot run standalone");
  if (getActiveJob(serial)?.status === "running") {
    throw new HttpError(409, "A job is running — pause or cancel it before interacting manually");
  }

  // No connected device would surface as a confusing step-level failure
  // (e.g. "expect ... not visible") — report it plainly instead.
  let deviceCount = 0;
  try {
    deviceCount = (await runtime.listDevices()).length;
  } catch {
    deviceCount = 0;
  }
  if (deviceCount === 0) {
    json(context.response, 200, {
      ok: false,
      error: "No device connected",
      durationMs: 0,
      logs: [],
    });
    return true;
  }

  const logs: string[] = [];
  const started = Date.now();
  try {
    const platform = await runtime.devicePlatformForSerial(serial);
    if (!platform) throw new Error(`Target ${serial} is not connected`);
    await runtime.executeStep({ serial, platform, step, log: (line) => logs.push(line) });
    json(context.response, 200, { ok: true, durationMs: Date.now() - started, logs });
  } catch (error) {
    const durationMs = Date.now() - started;
    if (error instanceof IosMutationOutcomeUnknownError) {
      json(context.response, 200, {
        ok: false,
        terminal: "review-needed",
        error: error.message,
        durationMs,
        logs,
        ...iosMutationOutcomeUnknownPayload(error, {
          stepReview: standaloneStepOutcomeUnknownReview(serial),
        }),
      });
      return true;
    }
    json(context.response, 200, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      durationMs,
      logs,
    });
  }
  return true;
}
