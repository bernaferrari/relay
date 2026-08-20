import { toast } from "../context/toast";
import { humanError } from "./human-error";
import type {
  Frame,
  PersistedRun,
  RecipeStep,
  SnapshotNode,
  SnapshotState,
  TraceFrameRef,
} from "./api-types";
import type { TargetRuntimeReadiness } from "@relay/protocol";
import { interactionBody, type InteractiveStep } from "./server-interaction";
import {
  iosInteractionFailure,
  iosMutationOutcomeUnknownIntervention,
  type IosInteractionFailure,
  type IosMutationOutcomeUnknownIntervention,
} from "./ios-interaction-safety";
import {
  frameUrlForPersisted as buildFrameUrl,
  recordingEvidenceUrl as buildRecordingEvidenceUrl,
  videoUrlForRun as buildVideoUrl,
} from "./server-urls";

type Request = <T = unknown>(path: string, init?: RequestInit, timeoutMs?: number) => Promise<T>;

export type CaptureServerDeps = {
  request: Request;
  serverUrl: () => string;
  selectedDevice: () => string | null;
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

type ScreenshotResponse = {
  serial?: string;
  capturedAt: number;
  mime: string;
  base64: string;
  bytes: number;
  jobId?: string;
  framePath?: string;
  width?: number;
  height?: number;
  screenMatch?: {
    fingerprint?: string;
    visualFingerprint?: string;
    matchedScreenId?: string | null;
    status?: string;
  };
  proposedRows?: Array<{ x: number; y: number; top?: number; bottom?: number; height?: number }>;
  readiness?: TargetRuntimeReadiness;
};

type ScrollSurveyResponse = {
  status: "completed" | "stopped";
  reason: string;
  message: string;
  restoredStartViewport: boolean;
  frames: Array<{
    index: number;
    offsetY: number;
    appendedHeight: number;
    screenshot: { base64: string; width: number; height: number; capturedAt: number };
    snapshot: NonNullable<SnapshotState>;
  }>;
  stitched?: { base64: string; width: number; height: number; mime: string };
  mergedNodes: SnapshotNode[];
};

export type DeviceVideoTake = {
  id: string;
  serial: string;
  startedAt: number;
  finishedAt?: number;
  state: "recording" | "ready";
  warning?: string;
};

export type LiveTouchAction = "down" | "move" | "up" | "cancel";
export type LiveKeyboardInput =
  | { kind: "text"; text: string }
  | { kind: "key"; key: "enter" | "backspace" };

/** The last direct action is explicit state, not an inferred retry hint.
 * Boolean callers stay compatible while picker/recorder callers can preserve
 * an iOS outcome-unknown stop instead of turning it into a point fallback. */
export type InteractionAttemptOutcome =
  | { status: "succeeded"; iosFailure?: undefined }
  | { status: "failed"; iosFailure?: IosInteractionFailure }
  | {
      status: "ios-outcome-unknown";
      iosFailure: IosInteractionFailure;
      intervention: IosMutationOutcomeUnknownIntervention;
      evidenceFrameId?: string;
    };

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
  let keyboardChain = Promise.resolve(true);
  let lastLiveFrameBase64 = "";
  let lastLiveFrameSerial: string | undefined;
  let lastLiveFrame: Frame | null = null;
  let lastInteractionOutcome: InteractionAttemptOutcome | null = null;

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
    const result = await deps.request<{ take: DeviceVideoTake | null }>(
      "/device/video",
      {
        method: "POST",
        body: JSON.stringify({ serial, action }),
      },
      250_000,
    );
    return result.take;
  }

  function iosVideoUrl(takeId: string): string {
    return `${deps.serverUrl().replace(/\/$/, "")}/device/video/${encodeURIComponent(takeId)}`;
  }

  async function touchDevice(action: LiveTouchAction, x: number, y: number): Promise<boolean> {
    const serial = deps.selectedDevice();
    if (!serial) return false;
    try {
      await deps.request(
        "/device/touch",
        {
          method: "POST",
          body: JSON.stringify({ serial, action, x, y }),
        },
        2000,
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
    const serial = deps.selectedDevice();
    if (!serial) return false;
    try {
      await deps.request(
        "/device/scroll",
        {
          method: "POST",
          body: JSON.stringify({ serial, x, y, scrollX, scrollY }),
        },
        2000,
      );
      return true;
    } catch {
      return false;
    }
  }

  function keyDevice(input: LiveKeyboardInput): Promise<boolean> {
    const send = async () => {
      const serial = deps.selectedDevice();
      if (!serial) return false;
      try {
        await deps.request(
          "/device/key",
          {
            method: "POST",
            body: JSON.stringify({ serial, ...input }),
          },
          2000,
        );
        return true;
      } catch {
        return false;
      }
    };
    // HTTP requests may resolve out of order under fast key repeat. Keep the
    // scrcpy control messages in exactly the same order as DOM keydown events.
    keyboardChain = keyboardChain.then(send, send);
    return keyboardChain;
  }

  async function captureUiSnapshot(): Promise<SnapshotState> {
    if (!deps.collectAccessibility()) return null;
    deps.setBusyCapture(true);
    try {
      const serial = serialFor(deps);
      const query = serial ? `?serial=${encodeURIComponent(serial)}` : "";
      const data = await deps.request<NonNullable<SnapshotState> & { tree?: string }>(
        `/snapshot${query}`,
      );
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
      const params = new URLSearchParams();
      if (serial) params.set("serial", serial);
      if (caption) params.set("caption", caption);
      if (jobId) params.set("jobId", jobId);
      const query = params.toString() ? `?${params}` : "";
      const data = await deps.request<ScreenshotResponse>(`/screenshot${query}`);
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
      const survey = await deps.request<ScrollSurveyResponse>(
        "/capture/scroll-survey",
        { method: "POST", body: JSON.stringify({ serial, maxScrolls: 4 }) },
        90_000,
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
      const params = new URLSearchParams({ ephemeral: "1" });
      if (serial) params.set("serial", serial);
      const query = `?${params}`;
      const data = await deps.request<ScreenshotResponse>(`/screenshot${query}`);
      await deps.copyImage(data.base64, data.mime);
      toast("Screenshot copied", "success");
    } catch (error) {
      toast(humanError(error, "Could not copy this screenshot"), "error");
    } finally {
      deps.setBusyCapture(false);
    }
  }

  async function persistRecordingEvidence(
    recipeId: string,
    evidenceId: string,
    frame: Frame,
  ): Promise<{ bytes: number; sha256: string; deduplicated: boolean } | null> {
    try {
      const saved = await deps.request<{ bytes: number; sha256: string; deduplicated: boolean }>(
        `/recipes/${encodeURIComponent(recipeId)}/evidence`,
        {
          method: "POST",
          body: JSON.stringify({ evidenceId, mime: frame.mime, base64: frame.base64 }),
        },
      );
      deps.appendLog(`saved recording evidence ${evidenceId}`, "success");
      return saved;
    } catch (error) {
      deps.appendLog(
        `recording evidence not saved · ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
      return null;
    }
  }

  async function pollLiveFrame(): Promise<void> {
    try {
      const serial = serialFor(deps);
      const params = new URLSearchParams({ ephemeral: "1" });
      if (serial) params.set("serial", serial);
      // The first iOS read may install/sign the local XCTest runner. It is a
      // one-time operation and legitimately takes longer than Android's
      // screenshot path, so a five second transport timeout turns setup into
      // a phantom "Loading screen" race.
      const data = await deps.request<ScreenshotResponse>(
        `/screenshot?${params}`,
        undefined,
        30_000,
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
      const queryParams = new URLSearchParams();
      if (serial) queryParams.set("serial", serial);
      if (options?.interactiveOnly) queryParams.set("interactiveOnly", "1");
      const query = queryParams.size > 0 ? `?${queryParams}` : "";
      const data = await deps.request<NonNullable<SnapshotState> & { tree?: string }>(
        `/snapshot${query}`,
        undefined,
        // Keep this in lockstep with the screenshot poll. On iOS both calls
        // wait for the same first-run XCTest preparation, so a shorter tree
        // timeout used to overwrite the useful "preparing" state with an
        // unrelated network error.
        30_000,
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

  async function pressNode(node: SnapshotNode): Promise<boolean> {
    const interaction = interactionForSnapshotNode(node);
    if (!interaction) {
      // Do not leave stale unknown-outcome state attached to a node that never
      // produced a device command. Callers can rely on every invocation
      // returning a current, explicit result.
      lastInteractionOutcome = { status: "failed" };
      deps.appendLog("node has no actionable target", "error");
      return false;
    }

    // Composition is deliberate: the shared boundary owns the only error
    // policy, including the exact-once iOS stop, current-pixel review frame,
    // and durable lastInteractionOutcome. A tree-row press must never turn a
    // 409 into an error log or a follow-up tap.
    const succeeded = await interactStep(interaction.step, interaction.caption);
    if (succeeded) void captureUiSnapshot().catch(() => undefined);
    return succeeded;
  }

  async function interactStep(step: InteractiveStep, caption?: string): Promise<boolean> {
    const label = caption ?? `interact · ${step.kind}`;
    lastInteractionOutcome = null;
    try {
      const body = interactionBody(step);
      const discoveryId = activeDiscoveryId(deps);
      await deps.request(
        discoveryId ? `/discovery/${encodeURIComponent(discoveryId)}/interact` : "/interact",
        {
          method: "POST",
          body: JSON.stringify({ ...body, serial: deps.selectedDevice() }),
        },
      );
      deps.appendLog(`interact ${step.kind}`, "success");
      lastInteractionOutcome = { status: "succeeded" };
      if (discoveryId) await deps.refreshDiscoverySessions();
      else await captureUiScreenshot(label, undefined, undefined, true).catch(() => undefined);
      return true;
    } catch (error) {
      const intervention = iosMutationOutcomeUnknownIntervention(error, label);
      const iosFailure = iosInteractionFailure(error);
      if (intervention && iosFailure) {
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
        lastInteractionOutcome = {
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
        return false;
      }
      lastInteractionOutcome = {
        status: "failed",
        ...(iosFailure ? { iosFailure } : {}),
      };
      const message = error instanceof Error ? error.message : String(error);
      const readable = humanError(error, "Could not run this step on the device");
      deps.appendLog(message, "error");
      toast(readable, "error");
      return false;
    }
  }

  async function runStep(
    step: RecipeStep,
  ): Promise<{ ok: boolean; error?: string; durationMs?: number; logs?: string[] }> {
    try {
      const serial = serialFor(deps);
      return await deps.request<{
        ok: boolean;
        error?: string;
        durationMs?: number;
        logs?: string[];
      }>("/step/run", {
        method: "POST",
        body: JSON.stringify({ step, ...(serial ? { serial } : {}) }),
      });
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
    persistRecordingEvidence,
    recordingEvidenceUrl: (recipeId: string, evidenceId: string) =>
      buildRecordingEvidenceUrl(deps.serverUrl(), recipeId, evidenceId),
    pollLiveFrame,
    pollLiveSnapshot,
    pressNode,
    interactStep,
    lastInteractionOutcome: () =>
      lastInteractionOutcome ? structuredClone(lastInteractionOutcome) : null,
    runStep,
    frameUrlForPersisted: (run: PersistedRun, frame: TraceFrameRef) =>
      buildFrameUrl(deps.serverUrl(), run, frame),
    videoUrlForRun: (runId: string, path: string) => buildVideoUrl(deps.serverUrl(), runId, path),
  };
}
