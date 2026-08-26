import { toast } from "../context/toast";
import type { RelayClient } from "@relay/client";
import { humanError } from "./human-error";
import type {
  Frame,
  PersistedRun,
  RecipeStep,
  SnapshotNode,
  SnapshotState,
  TraceFrameRef,
} from "./api-types";
import type {
  OperationOutput,
  StandaloneStepReview,
  StepRunResult,
} from "@relay/protocol";
import { interactionBody, type InteractiveStep } from "./server-interaction";
import {
  iosInteractionFailure,
  iosInteractionFailureFromPayload,
  iosMutationOutcomeUnknownIntervention,
  iosMutationOutcomeUnknownInterventionFromPayload,
  type IosInteractionFailure,
  type IosMutationOutcomeUnknownIntervention,
} from "./ios-interaction-safety";
import {
  frameUrlForPersisted as buildFrameUrl,
  recordingEvidenceUrl as buildRecordingEvidenceUrl,
  videoUrlForRun as buildVideoUrl,
} from "./server-urls";

export type CaptureServerDeps = {
  client: () => Promise<RelayClient>;
  serverUrl: () => string;
  selectedDevice: () => string | null;
  /** The persistent H.264 input transport is Android-only. iOS always goes
   * through the typed semantic interaction boundary below. */
  selectedDevicePlatform: () => "android" | "ios" | "browser" | undefined;
  selectedAction: () => string | null;
  activeDiscoverySessionId: () => string | null;
  collectAccessibility: () => boolean;
  setBusyCapture: (value: boolean) => void;
  setSnapshot: (value: SnapshotState) => void;
  setLiveFrame: (value: Frame | null) => void;
  /** A live poll is deliberately non-throwing, but the stage still needs to
   * explain a setup failure instead of spinning forever. */
  setLiveCaptureIssue?: (value: string | null) => void;
  pushFrame: (frame: Omit<Frame, "id">) => Frame;
  copyImage?: (base64: string, mime: string) => void | Promise<void>;
  appendLog: (
    text: string,
    level?: "info" | "success" | "error" | "default",
    jobId?: string,
  ) => void;
  refreshDiscoverySessions: () => Promise<void>;
};

type ScreenshotResponse = OperationOutput<"target.screenshot.capture">;
type ScrollSurveyResponse = OperationOutput<"target.scroll-survey.capture">;
export type DeviceVideoTake = NonNullable<OperationOutput<"target.video.start">["take"]>;

export type LiveTouchAction = "down" | "move" | "up" | "cancel";
export type LiveKeyboardInput =
  | { kind: "text"; text: string }
  | { kind: "key"; key: "enter" | "backspace" };

/** A direct action is explicit state, not an inferred retry hint. A boolean
 * cannot represent the iOS outcome-unknown stop. */
export type InteractionAttemptOutcome =
  | { status: "succeeded"; iosFailure?: undefined }
  | { status: "failed"; iosFailure?: IosInteractionFailure }
  | {
      status: "ios-outcome-unknown";
      iosFailure: IosInteractionFailure;
      intervention: IosMutationOutcomeUnknownIntervention;
      evidenceFrameId?: string;
    };

/** The standalone-step response remains in-band (HTTP 200), so preserve its
 * terminal review state as a distinct client result rather than collapsing it
 * into an ordinary failed boolean. */
export type StepRunOutcome =
  | { ok: true; durationMs: number; logs: string[] }
  | {
      ok: false;
      error: string;
      durationMs?: number;
      logs?: string[];
      terminal?: never;
    }
  | (Extract<StepRunResult, { terminal: "review-needed" }> & {
      iosFailure: IosInteractionFailure;
      intervention: IosMutationOutcomeUnknownIntervention;
      stepReview: StandaloneStepReview;
    });

function activeDiscoveryId(deps: CaptureServerDeps): string | undefined {
  // An explicit selection is authoritative, even when it is paused: the
  // server can then explain why the interaction is unavailable instead of
  // silently sending it somewhere else. A map must be selected by the user
  // (or started from the map workspace); never infer one from background
  // sessions, because a paused map or a second map could steal a normal tap.
  return deps.activeDiscoverySessionId() ?? undefined;
}

function serialFor(deps: CaptureServerDeps): string | undefined {
  return deps.selectedDevice() ?? undefined;
}

/**
 * `/step/run` is intentionally an in-band result so a debugger can retain its
 * row/log context. Validate the terminal iOS shape before exposing it as a
 * review state; a malformed result remains an ordinary failure and cannot
 * authorize a follow-up action.
 */
function normalizeStepRunOutcome(
  result: StepRunResult,
  serial: string | undefined,
  label: string,
): StepRunOutcome {
  if (result.ok) return result;
  if (
    !("terminal" in result) ||
    result.terminal !== "review-needed" ||
    result.code !== "IOS_MUTATION_OUTCOME_UNKNOWN" ||
    !serial ||
    result.stepReview.captureCurrent.operationId !== "target.screenshot.capture" ||
    result.stepReview.captureCurrent.input.serial !== serial
  ) {
    return {
      ok: false,
      error: result.error,
      durationMs: result.durationMs,
      logs: result.logs,
    };
  }
  const iosFailure = iosInteractionFailureFromPayload(result);
  const baseIntervention = iosMutationOutcomeUnknownInterventionFromPayload(result, label);
  if (!iosFailure || !baseIntervention) {
    return {
      ok: false,
      error: result.error,
      durationMs: result.durationMs,
      logs: result.logs,
    };
  }
  return {
    ...result,
    iosFailure,
    // Unlike an interactive renderer action, the standalone runner does not
    // capture after the uncertain command. Keep that next observation
    // explicit through stepReview rather than implying pixels are already
    // saved.
    intervention: {
      ...baseIntervention,
      detail:
        "Relay sent one iOS command and did not retry it. Capture the current screen, review it, then explicitly choose any next action.",
    },
  };
}

function hasAndroidLiveInput(deps: CaptureServerDeps): boolean {
  return deps.selectedDevicePlatform() === "android";
}

/**
 * The older tree-row affordance still accepts a SnapshotNode, but it must not
 * own a second physical-action transport path. Convert its reviewed selector
 * preference into the same typed interaction that powers the stage,
 * recorder, and picker. In particular, a ref remains more specific than a
 * label, and a point is only the final fallback.
 */
function interactionForSnapshotNode(
  node: SnapshotNode,
): { step: InteractiveStep; caption: string } | undefined {
  if (node.ref) {
    return {
      step: { kind: "ref", ref: node.ref },
      caption: `tap ref ${node.ref}`,
    };
  }
  if (node.label) {
    return {
      step: { kind: "label", label: node.label },
      caption: `tap ${node.label}`,
    };
  }
  if (node.rect) {
    const x = Math.round(node.rect.x + node.rect.width / 2);
    const y = Math.round(node.rect.y + node.rect.height / 2);
    return {
      step: { kind: "point", x, y },
      caption: `tap ${x},${y}`,
    };
  }
  return undefined;
}

export function createServerCapture(deps: CaptureServerDeps) {
  let keyboardChain = Promise.resolve<InteractionAttemptOutcome>({ status: "failed" });
  let lastLiveFrameBase64 = "";
  let lastLiveFrameSerial: string | undefined;
  let lastLiveFrame: Frame | null = null;

  function resetLivePreview(): void {
    // Starting a live view is a new observation session, even when it targets
    // the same serial. Do not paint yesterday's last frame while the current
    // stream is negotiating, and reset deduplication so an unchanged but fresh
    // first screenshot can mount again.
    lastLiveFrameBase64 = "";
    lastLiveFrameSerial = undefined;
    lastLiveFrame = null;
    deps.setLiveFrame(null);
    deps.setSnapshot(null);
    deps.setLiveCaptureIssue?.(null);
  }

  async function recordIosVideo(action: "start" | "stop"): Promise<DeviceVideoTake | null> {
    const serial = serialFor(deps);
    if (!serial) return null;
    const result = await (await deps.client()).invoke(
      "target.video.start",
      { serial, action },
      { signal: AbortSignal.timeout(250_000) },
    );
    return result.take;
  }

  function iosVideoUrl(takeId: string): string {
    return `${deps.serverUrl().replace(/\/$/, "")}/device/video/${encodeURIComponent(takeId)}`;
  }

  async function touchDevice(action: LiveTouchAction, x: number, y: number): Promise<boolean> {
    if (!hasAndroidLiveInput(deps)) return false;
    const serial = deps.selectedDevice();
    if (!serial) return false;
    try {
      await (await deps.client()).invoke(
        "target.touch",
        { serial, action, x, y },
        { signal: AbortSignal.timeout(2000) },
      );
      return true;
    } catch {
      // The H.264 control stream is optional. The stage falls back to the
      // existing one-shot ADB tap/swipe path when it isn't ready.
      return false;
    }
  }

  async function scrollDevice(
    x: number,
    y: number,
    scrollX: number,
    scrollY: number,
  ): Promise<boolean> {
    if (!hasAndroidLiveInput(deps)) return false;
    const serial = deps.selectedDevice();
    if (!serial) return false;
    try {
      await (await deps.client()).invoke(
        "target.scroll",
        { serial, x, y, scrollX, scrollY },
        { signal: AbortSignal.timeout(2000) },
      );
      return true;
    } catch {
      return false;
    }
  }

  function keyDevice(input: LiveKeyboardInput): Promise<InteractionAttemptOutcome> {
    const send = async () => {
      if (!hasAndroidLiveInput(deps)) return { status: "failed" } as const;
      const serial = deps.selectedDevice();
      if (!serial) return { status: "failed" } as const;
      try {
        await (await deps.client()).invoke(
          "target.key",
          { serial, ...input },
          { signal: AbortSignal.timeout(2000) },
        );
        return { status: "succeeded" } as const;
      } catch (error) {
        // A current renderer does not ask iOS to use this Android-only
        // transport. Preserve the stop anyway: a stale client or a platform
        // race must not swallow a reported unknown outcome and let
        // `flushType` issue a second /interact command.
        return reportIosMutationOutcomeUnknown(error, `type ${input.kind}`);
      }
    };
    // HTTP requests may resolve out of order under fast key repeat. Keep the
    // scrcpy control messages in exactly the same order as DOM keydown events.
    // An iOS unknown outcome is also a hard stop for any keys that were
    // already queued behind it: a second key is still a second physical
    // mutation, not a harmless retry.
    keyboardChain = keyboardChain.then(
      (previous) => (previous.status === "ios-outcome-unknown" ? previous : send()),
      send,
    );
    return keyboardChain;
  }

  async function reportIosMutationOutcomeUnknown(
    error: unknown,
    label: string,
  ): Promise<InteractionAttemptOutcome> {
    const intervention = iosMutationOutcomeUnknownIntervention(error, label);
    const iosFailure = iosInteractionFailure(error);
    if (!intervention || !iosFailure) {
      return { status: "failed", ...(iosFailure ? { iosFailure } : {}) };
    }
    const evidence = await captureUiScreenshot(
      intervention.screenshotCaption,
      undefined,
      undefined,
      true,
    ).catch((evidenceError) => {
      deps.appendLog(
        `could not capture review screen · ${
          evidenceError instanceof Error ? evidenceError.message : String(evidenceError)
        }`,
        "error",
      );
      return undefined;
    });
    const outcome: InteractionAttemptOutcome = {
      status: "ios-outcome-unknown",
      iosFailure,
      intervention,
      ...(evidence ? { evidenceFrameId: evidence.id } : {}),
    };
    deps.appendLog(
      `${intervention.title} · ${intervention.detail}${
        evidence ? ` Frame ${evidence.id} is ready for review.` : ""
      }`,
      "error",
    );
    toast(
      evidence
        ? "Action may already have happened. Current screen saved for review; do not retry."
        : "Action may already have happened. Capture the current screen before any retry.",
      "warning",
    );
    return outcome;
  }

  async function captureUiSnapshot(): Promise<SnapshotState> {
    if (!deps.collectAccessibility()) return null;
    deps.setBusyCapture(true);
    try {
      const serial = serialFor(deps);
      if (!serial) return null;
      const data = await (await deps.client()).invoke("target.snapshot.capture", { serial });
      if (!deps.collectAccessibility()) return null;
      deps.setSnapshot(data);
      deps.appendLog(
        `snapshot ${data.nodes.length} nodes · bounds ${data.bounds?.width ?? "?"}×${data.bounds?.height ?? "?"}`,
        "info",
      );
      return data;
    } catch (error) {
      deps.appendLog(error instanceof Error ? error.message : String(error), "error");
      return null;
    } finally {
      deps.setBusyCapture(false);
    }
  }

  async function captureUiScreenshot(
    caption?: string,
    jobId?: string,
    actionId?: string,
    quiet = false,
  ): Promise<Frame> {
    deps.setBusyCapture(true);
    try {
      const serial = serialFor(deps);
      if (!serial) throw new Error("Select a device before capturing a screenshot.");
      const data = await (await deps.client()).invoke("target.screenshot.capture", {
        serial,
        ...(caption ? { caption } : {}),
        ...(jobId ? { jobId } : {}),
      });
      const frame = deps.pushFrame({
        capturedAt: data.capturedAt,
        mime: data.mime,
        base64: data.base64,
        bytes: data.bytes,
        serial: data.serial ?? serial,
        caption:
          caption ?? `screenshot · ${new Date().toLocaleTimeString(undefined, { hour12: false })}`,
        jobId: data.jobId ?? jobId,
        actionId: actionId ?? deps.selectedAction() ?? undefined,
        path: data.framePath,
        ...(data.screenMatch?.fingerprint ? { fingerprint: data.screenMatch.fingerprint } : {}),
        ...(data.screenMatch?.visualFingerprint
          ? { visualFingerprint: data.screenMatch.visualFingerprint }
          : {}),
      });
      deps.appendLog(`screenshot ${data.bytes} bytes`, "info", data.jobId ?? jobId);
      if (!quiet) toast("Screenshot captured", "success");
      return frame;
    } catch (error) {
      deps.appendLog(error instanceof Error ? error.message : String(error), "error");
      throw error;
    } finally {
      deps.setBusyCapture(false);
    }
  }

  /**
   * Explicit long-list survey. Each viewport is retained as a normal frame;
   * the stitched image is a convenience preview and never replaces evidence.
   */
  async function captureScrollablePage(): Promise<ScrollSurveyResponse | null> {
    const serial = serialFor(deps);
    if (!serial) return null;
    deps.setBusyCapture(true);
    try {
      const survey = await (await deps.client()).invoke(
        "target.scroll-survey.capture",
        { serial, maxScrolls: 4 },
        { signal: AbortSignal.timeout(90_000) },
      );
      for (const frame of survey.frames) {
        deps.pushFrame({
          capturedAt: frame.screenshot.capturedAt,
          mime: "image/png",
          base64: frame.screenshot.base64,
          bytes: Math.floor((frame.screenshot.base64.length * 3) / 4),
          serial,
          caption: `full page · viewport ${frame.index + 1}`,
          width: frame.screenshot.width,
          height: frame.screenshot.height,
          scrollSurvey: {
            kind: "viewport",
            index: frame.index,
            offsetY: frame.offsetY,
            appendedHeight: frame.appendedHeight,
            snapshot: frame.snapshot,
            status: survey.status,
            reason: survey.reason,
            message: survey.message,
            restoredStartViewport: survey.restoredStartViewport,
          },
        });
      }
      if (survey.stitched) {
        deps.pushFrame({
          capturedAt: Date.now(),
          mime: survey.stitched.mime,
          base64: survey.stitched.base64,
          bytes: Math.floor((survey.stitched.base64.length * 3) / 4),
          serial,
          caption: "full page · stitched preview",
          width: survey.stitched.width,
          height: survey.stitched.height,
          scrollSurvey: {
            kind: "stitched-preview",
            mergedNodes: survey.mergedNodes,
            status: survey.status,
            reason: survey.reason,
            message: survey.message,
            restoredStartViewport: survey.restoredStartViewport,
          },
        });
      }
      deps.appendLog(
        `full-page survey: ${survey.reason} · ${survey.frames.length} viewports`,
        survey.status === "completed" ? "success" : "info",
      );
      toast(
        survey.status === "completed" ? "Full page captured" : survey.message,
        survey.status === "completed" ? "success" : "warning",
      );
      return survey;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const readable = humanError(error, "Could not read this screen");
      deps.appendLog(message, "error");
      toast(readable, "error");
      return null;
    } finally {
      deps.setBusyCapture(false);
    }
  }

  /**
   * Capture a current device image for sharing. This intentionally bypasses
   * Relay's frame library, logs, evidence, and recorded steps.
   */
  async function copyUiScreenshot(): Promise<void> {
    if (!deps.copyImage) {
      toast("Image clipboard is unavailable in this host", "warning");
      return;
    }
    deps.setBusyCapture(true);
    try {
      const serial = serialFor(deps);
      if (!serial) throw new Error("Select a device before copying a screenshot.");
      const data = await (await deps.client()).invoke("target.screenshot.capture", {
        serial,
        ephemeral: true,
      });
      await deps.copyImage(data.base64, data.mime);
      toast("Screenshot copied", "success");
    } catch (error) {
      toast(humanError(error, "Could not copy this screenshot"), "error");
    } finally {
      deps.setBusyCapture(false);
    }
  }

  async function pollLiveFrame(): Promise<void> {
    try {
      const serial = serialFor(deps);
      // The first iOS read may install/sign the local XCTest runner. It is a
      // one-time operation and legitimately takes longer than Android's
      // screenshot path, so a five second transport timeout turns setup into
      // a phantom "Loading screen" race.
      if (!serial) return;
      const data = await (await deps.client()).invoke(
        "target.screenshot.capture",
        { serial, ephemeral: true },
        { signal: AbortSignal.timeout(30_000) },
      );
      const responseSerial = data.serial ?? serial;
      // Physical Apple devices commonly return a multi-megabyte PNG even when
      // not one pixel changed. Replacing the image URL for every identical
      // poll forces Chromium to decode the same frame again and can make the
      // whole workbench feel frozen. Keep the current frame mounted; an input
      // or genuine visual change still produces a new payload immediately.
      if (responseSerial === lastLiveFrameSerial && data.base64 === lastLiveFrameBase64) {
        // Pixel bytes can be unchanged while their proof state advances (for
        // example, a successful go-ios capture following a stale XCTest
        // overlay). Keep the mounted bitmap intact, but retain that newer
        // metadata so the Stage never couples pixel freshness to AX freshness.
        if (data.readiness && lastLiveFrame) {
          lastLiveFrame = {
            ...lastLiveFrame,
            capturedAt: data.capturedAt,
            readiness: data.readiness,
          };
          deps.setLiveFrame(lastLiveFrame);
        }
        deps.setLiveCaptureIssue?.(null);
        return;
      }
      lastLiveFrameSerial = responseSerial;
      lastLiveFrameBase64 = data.base64;
      lastLiveFrame = {
        id: `live-${data.capturedAt}`,
        capturedAt: data.capturedAt,
        mime: data.mime,
        base64: data.base64,
        bytes: data.bytes,
        serial: responseSerial,
        caption: `live · ${new Date(data.capturedAt).toLocaleTimeString(undefined, { hour12: false })}`,
        ...(typeof data.width === "number" ? { width: data.width } : {}),
        ...(typeof data.height === "number" ? { height: data.height } : {}),
        ...(data.screenMatch?.fingerprint ? { fingerprint: data.screenMatch.fingerprint } : {}),
        ...(data.screenMatch?.visualFingerprint
          ? { visualFingerprint: data.screenMatch.visualFingerprint }
          : {}),
        ...(data.proposedRows?.length ? { proposedRows: data.proposedRows } : {}),
        ...(data.readiness ? { readiness: data.readiness } : {}),
      };
      deps.setLiveFrame(lastLiveFrame);
      deps.setLiveCaptureIssue?.(null);
    } catch (error) {
      // Live refresh is best-effort; retain the last good frame, but preserve
      // the reason for the stage. Swallowing it made setup failures invisible.
      deps.setLiveCaptureIssue?.(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Live preview needs actionable geometry, whereas authoring/evidence needs
   * the complete raw hierarchy. Keep that distinction at the transport
   * boundary so physical iOS never pays for a full XCTest traversal just to
   * redraw hover affordances.
   */
  async function pollLiveSnapshot(options?: { interactiveOnly?: boolean }): Promise<void> {
    if (!deps.collectAccessibility()) return;
    try {
      const serial = serialFor(deps);
      if (!serial) return;
      const data = await (await deps.client()).invoke(
        "target.snapshot.capture",
        { serial, ...(options?.interactiveOnly ? { interactiveOnly: true } : {}) },
        // Keep this in lockstep with the screenshot poll. On iOS both calls
        // wait for the same first-run XCTest preparation, so a shorter tree
        // timeout used to overwrite the useful "preparing" state with an
        // unrelated network error.
        { signal: AbortSignal.timeout(30_000) },
      );
      if (!deps.collectAccessibility()) return;
      deps.setSnapshot(data);
      deps.setLiveCaptureIssue?.(null);
    } catch (error) {
      // Snapshot and screenshot share the same iOS runner. Preserve the
      // failure reason without disturbing a previously valid UI tree.
      deps.setLiveCaptureIssue?.(error instanceof Error ? error.message : String(error));
    }
  }

  async function pressNode(node: SnapshotNode): Promise<InteractionAttemptOutcome> {
    const interaction = interactionForSnapshotNode(node);
    if (!interaction) {
      deps.appendLog("node has no actionable target", "error");
      return { status: "failed" };
    }

    // Composition is deliberate: the shared boundary owns the only error
    // policy, including the exact-once iOS stop and current-pixel review
    // frame. The typed outcome must travel to the caller; a tree-row press
    // must never turn a 409 into an error log or a follow-up tap.
    const outcome = await interactStep(interaction.step, interaction.caption);
    if (outcome.status === "succeeded") void captureUiSnapshot().catch(() => undefined);
    return outcome;
  }

  /**
   * Canonical manual-action boundary. The return value deliberately is not a
   * boolean: physical iOS can be failed, successful, or *unknown*. A caller
   * that wants a point rescue must pass this outcome through
   * `dispatchWithSafePointFallback`; it cannot mistake unknown for false.
   */
  async function interactStep(
    step: InteractiveStep,
    caption?: string,
  ): Promise<InteractionAttemptOutcome> {
    const label = caption ?? `interact · ${step.kind}`;
    try {
      const body = interactionBody(step);
      const discoveryId = activeDiscoveryId(deps);
      const serial = deps.selectedDevice();
      if (!serial) throw new Error("Select a device before interacting.");
      const client = await deps.client();
      if (discoveryId) {
        await client.invoke("discovery.interact", { sessionId: discoveryId, ...body, serial });
      } else {
        await client.invoke("target.interact", { ...body, serial });
      }
      deps.appendLog(`interact ${step.kind}`, "success");
      if (discoveryId) await deps.refreshDiscoverySessions();
      else await captureUiScreenshot(label, undefined, undefined, true).catch(() => undefined);
      return { status: "succeeded" };
    } catch (error) {
      const outcome = await reportIosMutationOutcomeUnknown(error, label);
      if (outcome.status === "ios-outcome-unknown") return outcome;
      const message = error instanceof Error ? error.message : String(error);
      const readable = humanError(error, "Could not run this step on the device");
      deps.appendLog(message, "error");
      toast(readable, "error");
      return outcome;
    }
  }

  async function runStep(step: RecipeStep): Promise<StepRunOutcome> {
    try {
      const serial = serialFor(deps);
      if (!serial) return { ok: false, error: "Select a device before running a step." };
      const result = await (await deps.client()).invoke("step.run", { step, serial });
      return normalizeStepRunOutcome(result, serial, `run ${step.kind} step`);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  return {
    resetLivePreview,
    recordIosVideo,
    iosVideoUrl,
    touchDevice,
    keyDevice,
    scrollDevice,
    captureUiSnapshot,
    captureUiScreenshot,
    captureScrollablePage,
    copyUiScreenshot,
    recordingEvidenceUrl: (recipeId: string, evidenceId: string) =>
      buildRecordingEvidenceUrl(deps.serverUrl(), recipeId, evidenceId),
    pollLiveFrame,
    pollLiveSnapshot,
    pressNode,
    interactStep,
    runStep,
    frameUrlForPersisted: (run: PersistedRun, frame: TraceFrameRef) =>
      buildFrameUrl(deps.serverUrl(), run, frame),
    videoUrlForRun: (runId: string, path: string) => buildVideoUrl(deps.serverUrl(), runId, path),
  };
}
