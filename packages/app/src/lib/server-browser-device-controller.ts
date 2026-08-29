import { createSignal, type Accessor } from "solid-js";
import type { RelayClient } from "@relay/client";
import type {
  BrowserDeviceFrame,
  BrowserDeviceInputResolution,
  BrowserDeviceInput,
  BrowserDeviceSession,
  BrowserDeviceSemanticOverlay,
  BrowserEnvironmentInput,
  OperationOutput,
} from "@relay/protocol";
import type { Frame } from "./api-types";
import {
  captureBrowserDeviceFrame,
  controlBrowserDevice,
  inspectBrowserDevice,
  openBrowserDevice,
} from "./server-target-remote";

export function createServerBrowserDeviceController(deps: {
  client: () => Promise<RelayClient>;
  selectedDevice: Accessor<string | null>;
  setLiveFrame: (frame: Frame | null) => void;
  setLiveCaptureIssue: (issue: string | null) => void;
}) {
  type ControlResult = OperationOutput<"target.browser-device.control">;
  type BrowserDeviceClickResult = {
    applied: boolean;
    resolution?: BrowserDeviceInputResolution;
  };
  const [session, setSession] = createSignal<BrowserDeviceSession | null>(null);
  const [semanticOverlay, setSemanticOverlay] = createSignal<BrowserDeviceSemanticOverlay | null>(
    null,
  );
  let frame: BrowserDeviceFrame | undefined;
  let generation = 0;
  let reopenNeeded = false;

  function reset(): void {
    generation += 1;
    frame = undefined;
    reopenNeeded = false;
    setSession(null);
    setSemanticOverlay(null);
    deps.setLiveFrame(null);
    deps.setLiveCaptureIssue(null);
  }

  async function open(environment?: BrowserEnvironmentInput): Promise<BrowserDeviceSession> {
    const targetId = deps.selectedDevice();
    if (!targetId) throw new Error("Choose a browser target first");
    const requestGeneration = ++generation;
    const opened = await openBrowserDevice(await deps.client(), {
      targetId,
      ...(environment ? { environment } : {}),
    });
    if (requestGeneration !== generation || deps.selectedDevice() !== targetId) return opened;
    if (session()?.sessionId !== opened.sessionId) {
      frame = undefined;
      setSemanticOverlay(null);
      deps.setLiveFrame(null);
    }
    reopenNeeded = false;
    setSession(opened);
    deps.setLiveCaptureIssue(opened.issue ?? null);
    return opened;
  }

  async function poll(): Promise<void> {
    const targetId = deps.selectedDevice();
    if (!targetId) return;
    let requestGeneration = generation;
    try {
      if (session()?.targetId !== targetId || reopenNeeded) {
        await open();
        if (deps.selectedDevice() !== targetId) return;
        requestGeneration = generation;
      }
      const result = await captureBrowserDeviceFrame(
        await deps.client(),
        targetId,
        frame?.sequence,
      );
      if (
        requestGeneration !== generation ||
        deps.selectedDevice() !== targetId ||
        result.session.targetId !== targetId
      )
        return;
      setSession(result.session);
      frame = result.frame;
      // A semantic overlay is a proof of one exact raster observation. Any
      // later frame, even identical pixels, invalidates it until explicitly
      // re-inspected.
      setSemanticOverlay(null);
      deps.setLiveFrame({
        id: `browser-${result.session.sessionId}-${result.frame.sequence}`,
        capturedAt: result.frame.capturedAt,
        mime: result.frame.mime,
        base64: result.frame.base64,
        bytes: result.frame.bytes,
        serial: targetId,
        caption: `browser · frame ${result.frame.sequence}`,
        width: result.frame.width,
        height: result.frame.height,
        visualFingerprint: result.frame.visualFingerprint,
        browserDevice: {
          sessionId: result.session.sessionId,
          pageId: result.frame.pageId,
          sequence: result.frame.sequence,
        },
      });
      deps.setLiveCaptureIssue(
        result.gap
          ? `Browser stream skipped ${result.gap.dropped} stale frame${result.gap.dropped === 1 ? "" : "s"}.`
          : (result.session.issue ?? null),
      );
    } catch (error) {
      if (requestGeneration !== generation || deps.selectedDevice() !== targetId) return;
      const issue = error instanceof Error ? error.message : String(error);
      frame = undefined;
      deps.setLiveFrame(null);
      const current = session();
      const terminal = current?.status === "closed" || current?.status === "crashed";
      reopenNeeded = !terminal;
      if (current?.targetId === targetId && !terminal) {
        setSession({ ...current, status: "degraded", issue });
      }
      deps.setLiveCaptureIssue(issue);
    }
  }

  async function inspect(): Promise<BrowserDeviceSemanticOverlay | null> {
    const targetId = deps.selectedDevice();
    const bound = currentBoundInput();
    if (!targetId || !bound) return null;
    const requestGeneration = generation;
    try {
      const result = await inspectBrowserDevice(await deps.client(), targetId, bound);
      if (requestGeneration !== generation || deps.selectedDevice() !== targetId) return null;
      if (
        result.overlay.sessionId !== bound.sessionId ||
        result.overlay.pageId !== bound.pageId ||
        result.overlay.sequence !== bound.expectedSequence ||
        result.overlay.visualFingerprint !== frame?.visualFingerprint
      ) {
        setSemanticOverlay(null);
        return null;
      }
      setSemanticOverlay(result.overlay);
      return result.overlay;
    } catch (error) {
      if (requestGeneration === generation && deps.selectedDevice() === targetId) {
        deps.setLiveCaptureIssue(error instanceof Error ? error.message : String(error));
      }
      return null;
    }
  }

  function currentBoundInput(): Pick<
    BrowserDeviceInput,
    "sessionId" | "pageId" | "expectedSequence"
  > | null {
    const current = session();
    if (!current || !frame) return null;
    return {
      sessionId: current.sessionId,
      pageId: frame.pageId,
      expectedSequence: frame.sequence,
    };
  }

  async function send(
    makeInput: (bound: NonNullable<ReturnType<typeof currentBoundInput>>) => BrowserDeviceInput,
  ): Promise<ControlResult | null> {
    const targetId = deps.selectedDevice();
    const bound = currentBoundInput();
    if (!targetId || !bound) return null;
    const requestGeneration = generation;
    try {
      const result = await controlBrowserDevice(await deps.client(), targetId, makeInput(bound));
      if (requestGeneration !== generation || deps.selectedDevice() !== targetId) return null;
      setSession(result.session);
      return result;
    } catch (error) {
      if (requestGeneration !== generation || deps.selectedDevice() !== targetId) return null;
      deps.setLiveCaptureIssue(error instanceof Error ? error.message : String(error));
      await poll();
      return null;
    }
  }

  return {
    session,
    reset,
    open,
    poll,
    semanticOverlay,
    inspect,
    click: async (fx: number, fy: number): Promise<BrowserDeviceClickResult> => {
      const result = await send((bound) => ({
        ...bound,
        kind: "click",
        x: fx * (frame?.width ?? 0),
        y: fy * (frame?.height ?? 0),
        // A human clicking the painted raster has explicitly reviewed the
        // coordinate. The server still prefers a unique semantic locator.
        coordinateFallback: "reviewed" as const,
      }));
      return result
        ? { applied: true, ...(result.resolution ? { resolution: result.resolution } : {}) }
        : { applied: false };
    },
    wheel: (fx: number, fy: number, deltaX: number, deltaY: number) =>
      send((bound) => ({
        ...bound,
        kind: "wheel",
        x: fx * (frame?.width ?? 0),
        y: fy * (frame?.height ?? 0),
        deltaX,
        deltaY,
      })).then(Boolean),
    key: async (
      input:
        | {
            kind: "text";
            text: string;
          }
        | {
            kind: "key";
            key: "enter" | "backspace";
          },
    ) => {
      const applied = await send((bound) =>
        input.kind === "text"
          ? { ...bound, kind: "text", text: input.text }
          : {
              ...bound,
              kind: "key",
              key: input.key === "enter" ? "Enter" : "Backspace",
            },
      );
      const succeeded = Boolean(applied);
      if (succeeded) await poll();
      return succeeded;
    },
    navigate: (url: string) => send((bound) => ({ ...bound, kind: "navigate", url })).then(Boolean),
    history: (direction: "back" | "forward" | "reload") =>
      send((bound) => ({ ...bound, kind: "history", direction })).then(Boolean),
    activatePage: (targetPageId: string) =>
      send((bound) => ({ ...bound, kind: "page.activate", targetPageId })).then(Boolean),
    closePage: (targetPageId: string) =>
      send((bound) => ({ ...bound, kind: "page.close", targetPageId })).then(Boolean),
  };
}
