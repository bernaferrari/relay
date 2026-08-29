import { createSignal, type Accessor } from "solid-js";
import type { RelayClient } from "@relay/client";
import type {
  BrowserDeviceFrame,
  BrowserDeviceInput,
  BrowserDeviceSession,
  BrowserEnvironmentInput,
} from "@relay/protocol";
import type { Frame } from "./api-types";
import {
  captureBrowserDeviceFrame,
  controlBrowserDevice,
  openBrowserDevice,
} from "./server-target-remote";

export function createServerBrowserDeviceController(deps: {
  client: () => Promise<RelayClient>;
  selectedDevice: Accessor<string | null>;
  setLiveFrame: (frame: Frame | null) => void;
  setLiveCaptureIssue: (issue: string | null) => void;
}) {
  const [session, setSession] = createSignal<BrowserDeviceSession | null>(null);
  let frame: BrowserDeviceFrame | undefined;
  let generation = 0;
  let reopenNeeded = false;

  function reset(): void {
    generation += 1;
    frame = undefined;
    reopenNeeded = false;
    setSession(null);
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
  ): Promise<boolean> {
    const targetId = deps.selectedDevice();
    const bound = currentBoundInput();
    if (!targetId || !bound) return false;
    const requestGeneration = generation;
    try {
      const result = await controlBrowserDevice(await deps.client(), targetId, makeInput(bound));
      if (requestGeneration !== generation || deps.selectedDevice() !== targetId) return false;
      setSession(result.session);
      return true;
    } catch (error) {
      if (requestGeneration !== generation || deps.selectedDevice() !== targetId) return false;
      deps.setLiveCaptureIssue(error instanceof Error ? error.message : String(error));
      await poll();
      return false;
    }
  }

  return {
    session,
    reset,
    open,
    poll,
    click: (fx: number, fy: number) =>
      send((bound) => ({
        ...bound,
        kind: "click",
        x: fx * (frame?.width ?? 0),
        y: fy * (frame?.height ?? 0),
      })),
    wheel: (fx: number, fy: number, deltaX: number, deltaY: number) =>
      send((bound) => ({
        ...bound,
        kind: "wheel",
        x: fx * (frame?.width ?? 0),
        y: fy * (frame?.height ?? 0),
        deltaX,
        deltaY,
      })),
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
      if (applied) await poll();
      return applied;
    },
    navigate: (url: string) => send((bound) => ({ ...bound, kind: "navigate", url })),
    history: (direction: "back" | "forward" | "reload") =>
      send((bound) => ({ ...bound, kind: "history", direction })),
    activatePage: (targetPageId: string) =>
      send((bound) => ({ ...bound, kind: "page.activate", targetPageId })),
    closePage: (targetPageId: string) =>
      send((bound) => ({ ...bound, kind: "page.close", targetPageId })),
  };
}
