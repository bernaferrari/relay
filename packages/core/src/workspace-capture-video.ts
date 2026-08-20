/**
 * Durable iOS review-video capture.
 *
 * Pixel and semantic snapshots are intentionally independent from this
 * XCTest-backed evidence channel. A failed preparation stays visible and
 * actionable; this module never repairs, resets, or retries a device.
 */
import type { TargetRuntimeReadiness } from "@relay/protocol";
import type { Device, DevicePlatform } from "./device.js";
import { rethrowIosMutationOutcomeUnknown } from "./ios-mutation-policy.js";
import { now } from "./events.js";
import { currentTargetContext, runWithTargetContext } from "./target-context.js";
import { diagnoseIosRunnerError, recordIosVideo } from "./ios-device-adapter.js";
import { resolveRuntimeTarget } from "./workspace-devices.js";
import { ensureIosRunnerPrepared, withSession } from "./workspace-ios-session.js";
import {
  recordTargetRuntimeCapability,
  targetRuntimeReadiness,
} from "./target-runtime-readiness.js";

export type DeviceVideoCapture = {
  serial?: string;
  platform: DevicePlatform;
  mode: "recorded-video";
  path?: string;
  warning?: string;
};

/**
 * A recorded iOS take has its own proof boundary. It must not turn a failed
 * XCTest preparation into an invisible reset/retry; pixels can remain useful
 * while this evidence channel is unavailable.
 */
export type IosEvidenceCaptureUnavailableDiagnostic = {
  operation: "evidence-start";
  stage: "runner-preparation" | "recording";
  outcome: "unavailable";
  code: "IOS_EVIDENCE_CAPTURE_UNAVAILABLE";
  attempts: 1;
  repairAttempted: false;
  message: string;
  readiness: TargetRuntimeReadiness;
  recovery: "Recorded iOS video is unavailable. Press Reconnect once, then start the take again.";
  recoveryAction: {
    operationId: "target.recover";
    input: { serial: string; reason: "record" };
    cli: { argv: string[] };
  };
};

/** A product-safe, machine-readable recorded-evidence failure. */
export class IosEvidenceCaptureUnavailableError extends Error {
  readonly name = "IosEvidenceCaptureUnavailableError";

  constructor(readonly diagnostic: IosEvidenceCaptureUnavailableDiagnostic) {
    super(diagnostic.message);
  }
}

type IosEvidenceVideoRuntime = {
  ensureIosRunnerPrepared: typeof ensureIosRunnerPrepared;
  withSession: typeof withSession;
  recordIosVideo: typeof recordIosVideo;
  diagnoseIosRunnerError: typeof diagnoseIosRunnerError;
  recordTargetRuntimeCapability: typeof recordTargetRuntimeCapability;
  targetRuntimeReadiness: typeof targetRuntimeReadiness;
  now: typeof now;
};

const defaultIosEvidenceVideoRuntime: IosEvidenceVideoRuntime = {
  ensureIosRunnerPrepared,
  withSession,
  recordIosVideo,
  diagnoseIosRunnerError,
  recordTargetRuntimeCapability,
  targetRuntimeReadiness,
  now,
};

function iosEvidenceRecoveryAction(
  serial: string,
): IosEvidenceCaptureUnavailableDiagnostic["recoveryAction"] {
  return {
    operationId: "target.recover",
    input: { serial, reason: "record" },
    cli: {
      argv: ["device", "recover", serial, "--input", '{"reason":"record"}'],
    },
  };
}

/**
 * Start/stop a durable Apple review take after the target has already been
 * resolved. The optional runtime is an internal test seam; production uses
 * the one bounded XCTest path above.
 */
export async function captureIosEvidenceVideo(
  input: {
    device: Device;
    serial: string;
    action: "start" | "stop";
    path?: string;
  },
  runtime: IosEvidenceVideoRuntime = defaultIosEvidenceVideoRuntime,
): Promise<DeviceVideoCapture> {
  const startedAt = runtime.now();
  const unavailable = async (
    stage: IosEvidenceCaptureUnavailableDiagnostic["stage"],
    cause: unknown,
  ): Promise<never> => {
    const diagnosed = await runtime
      .diagnoseIosRunnerError(cause, input.serial)
      .catch(() => (cause instanceof Error ? cause : new Error(String(cause))));
    const capturedAt = runtime.now();
    const message = diagnosed.message || "Relay could not start recorded iOS video.";
    runtime.recordTargetRuntimeCapability(
      { serial: input.serial, platform: "ios" },
      "evidenceCapture",
      "unavailable",
      {
        at: capturedAt,
        durationMs: Math.max(0, capturedAt - startedAt),
        reason: "probe-failed",
        errorMessage: message,
      },
    );
    throw new IosEvidenceCaptureUnavailableError({
      operation: "evidence-start",
      stage,
      outcome: "unavailable",
      code: "IOS_EVIDENCE_CAPTURE_UNAVAILABLE",
      attempts: 1,
      repairAttempted: false,
      message,
      readiness: runtime.targetRuntimeReadiness(
        { serial: input.serial, platform: "ios" },
        capturedAt,
      ),
      recovery:
        "Recorded iOS video is unavailable. Press Reconnect once, then start the take again.",
      recoveryAction: iosEvidenceRecoveryAction(input.serial),
    });
  };

  if (input.action === "start") {
    try {
      // Exactly one proof attempt. `ensureIosRunnerPrepared` cannot repair or
      // retry the host; only `recoverTargetRuntime` owns that destructive path.
      await runtime.ensureIosRunnerPrepared(input.device, input.serial);
    } catch (error) {
      return unavailable("runner-preparation", error);
    }
  }

  let recorded: Awaited<ReturnType<typeof recordIosVideo>>;
  try {
    recorded = await runtime.withSession(
      input.device,
      () =>
        runtime.recordIosVideo(input.device, {
          udid: input.serial,
          action: input.action,
          ...(input.path ? { path: input.path } : {}),
        }),
      "evidence",
    );
  } catch (error) {
    // A video start might already be active on the device. Do not turn that
    // terminal, reviewable fact into an ordinary recorder-unavailable retry.
    rethrowIosMutationOutcomeUnknown(error);
    if (input.action === "start") return unavailable("recording", error);
    throw error;
  }

  if (input.action === "start") {
    const capturedAt = runtime.now();
    runtime.recordTargetRuntimeCapability(
      { serial: input.serial, platform: "ios" },
      "evidenceCapture",
      "proven",
      {
        at: capturedAt,
        durationMs: Math.max(0, capturedAt - startedAt),
      },
    );
  }
  return { serial: input.serial, platform: "ios", ...recorded };
}

/**
 * Capture an iOS review take through XCTest. It intentionally does not share
 * the Android H.264 stream path: a take is a durable video, not live preview.
 */
export async function captureDeviceVideo(input: {
  serial: string;
  action: "start" | "stop";
  path?: string;
}): Promise<DeviceVideoCapture> {
  const target = await resolveRuntimeTarget(input.serial);
  return runWithTargetContext(target.context, async () => {
    const context = currentTargetContext();
    if (context.kind !== "device" || context.platform !== "ios") {
      throw new Error("Recorded video capture is currently available for Apple devices only");
    }
    const serial = context.serial;
    if (!serial) throw new Error("Choose an iPhone or iPad before recording video");
    return captureIosEvidenceVideo({
      device: target.device,
      serial,
      action: input.action,
      ...(input.path ? { path: input.path } : {}),
    });
  });
}
