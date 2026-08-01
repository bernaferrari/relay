import { toast } from "../context/toast";
import type {
  Frame,
  PersistedRun,
  RecipeStep,
  SnapshotNode,
  SnapshotState,
  TraceFrameRef,
} from "./api-types";
import { interactionBody, type InteractiveStep } from "./server-interaction";
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
  setBusyCapture: (value: boolean) => void;
  setSnapshot: (value: SnapshotState) => void;
  setShowOverlays: (value: boolean) => void;
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

export function createServerCapture(deps: CaptureServerDeps) {
  let keyboardChain = Promise.resolve(true);

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
    deps.setBusyCapture(true);
    try {
      const serial = serialFor(deps);
      const query = serial ? `?serial=${encodeURIComponent(serial)}` : "";
      const data = await deps.request<NonNullable<SnapshotState> & { tree?: string }>(
        `/snapshot${query}`,
      );
      deps.setSnapshot(data);
      deps.setShowOverlays(true);
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
      toast(error instanceof Error ? error.message : String(error), "error");
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
        `/journeys/${encodeURIComponent(recipeId)}/evidence`,
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
      deps.setLiveFrame({
        id: `live-${data.capturedAt}`,
        capturedAt: data.capturedAt,
        mime: data.mime,
        base64: data.base64,
        bytes: data.bytes,
        serial: data.serial ?? serial,
        caption: `live · ${new Date(data.capturedAt).toLocaleTimeString(undefined, { hour12: false })}`,
      });
      deps.setLiveCaptureIssue?.(null);
    } catch (error) {
      // Live refresh is best-effort; retain the last good frame, but preserve
      // the reason for the stage. Swallowing it made setup failures invisible.
      deps.setLiveCaptureIssue?.(error instanceof Error ? error.message : String(error));
    }
  }

  async function pollLiveSnapshot(): Promise<void> {
    try {
      const serial = serialFor(deps);
      const query = serial ? `?serial=${encodeURIComponent(serial)}` : "";
      const data = await deps.request<NonNullable<SnapshotState> & { tree?: string }>(
        `/snapshot${query}`,
        undefined,
        // Keep this in lockstep with the screenshot poll. On iOS both calls
        // wait for the same first-run XCTest preparation, so a shorter tree
        // timeout used to overwrite the useful "preparing" state with an
        // unrelated network error.
        30_000,
      );
      deps.setSnapshot(data);
      deps.setLiveCaptureIssue?.(null);
    } catch (error) {
      // Snapshot and screenshot share the same iOS runner. Preserve the
      // failure reason without disturbing a previously valid UI tree.
      deps.setLiveCaptureIssue?.(error instanceof Error ? error.message : String(error));
    }
  }

  async function pressNode(node: SnapshotNode): Promise<void> {
    try {
      const discoveryId = activeDiscoveryId(deps);
      const run = (body: Record<string, unknown>) =>
        deps.request(
          discoveryId ? `/discovery/${encodeURIComponent(discoveryId)}/interact` : "/interact",
          {
            method: "POST",
            body: JSON.stringify({ ...body, serial: deps.selectedDevice() }),
          },
        );

      if (node.ref) {
        await run({ kind: "ref", ref: node.ref });
        deps.appendLog(`pressed ref ${node.ref}`, "success");
      } else if (node.label) {
        await run({ kind: "label", label: node.label });
        deps.appendLog(`pressed label ${node.label}`, "success");
      } else if (node.rect) {
        const x = Math.round(node.rect.x + node.rect.width / 2);
        const y = Math.round(node.rect.y + node.rect.height / 2);
        await run({ kind: "point", x, y });
        deps.appendLog(`pressed point ${x},${y}`, "success");
      } else {
        deps.appendLog("node has no actionable target", "error");
      }

      if (discoveryId) await deps.refreshDiscoverySessions();
      else {
        await captureUiScreenshot(
          node.label ? `after tap · ${node.label}` : "after tap",
          undefined,
          undefined,
          true,
        ).catch(() => undefined);
      }
      void captureUiSnapshot().catch(() => undefined);
    } catch (error) {
      deps.appendLog(error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function interactStep(step: InteractiveStep, caption?: string): Promise<boolean> {
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
      if (discoveryId) await deps.refreshDiscoverySessions();
      else
        await captureUiScreenshot(
          caption ?? `interact · ${step.kind}`,
          undefined,
          undefined,
          true,
        ).catch(() => undefined);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deps.appendLog(message, "error");
      toast(message, "error");
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
    recordIosVideo,
    iosVideoUrl,
    touchDevice,
    keyDevice,
    scrollDevice,
    captureUiSnapshot,
    captureUiScreenshot,
    copyUiScreenshot,
    persistRecordingEvidence,
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
