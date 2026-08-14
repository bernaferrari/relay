import { createSignal, type Accessor, type Setter } from "solid-js";
import type { RelayClient } from "@relay/client";
import type { EventEnvelope } from "@relay/protocol";
import type { Frame, LogLine, TraceFrameRef } from "./api-types";
import { projectRelayEvent, type EventActivity, type EventRefresh } from "./event-projection";

export function createServerEventController(input: {
  client: Accessor<RelayClient | null>;
  refreshers: Record<EventRefresh, () => Promise<unknown>>;
  appendLog: (text: string, level?: LogLine["level"], jobId?: string) => void;
  pushFrame: (frame: Omit<Frame, "id">) => Frame;
  setRunning: Setter<boolean>;
  selectedJobId: Accessor<string | null>;
  setSelectedJobId: Setter<string | null>;
  refreshJobs: () => Promise<unknown>;
  refreshRuns: () => Promise<unknown>;
  loadRunDetail: (id: string) => Promise<void>;
  captureUiScreenshot: (
    caption?: string,
    jobId?: string,
    actionId?: string,
    quiet?: boolean,
  ) => Promise<Frame>;
}) {
  const [sseConnected, setSseConnected] = createSignal(false);
  const [eventActivity, setEventActivity] = createSignal<EventActivity | null>(null);
  let cursor = 0;
  let abort: AbortController | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  function refreshFromEvent(kind: EventRefresh): void {
    void input.refreshers[kind]();
  }

  function handleEvent(envelope: EventEnvelope): void {
    const projection = projectRelayEvent(cursor, envelope);
    if (!projection.accepted) return;
    cursor = projection.cursor;
    if (projection.activity) setEventActivity(projection.activity);
    for (const refresh of new Set(projection.refresh)) refreshFromEvent(refresh);
    const event = envelope.payload as Record<string, unknown>;
    const type = String(event.type ?? "");
    switch (type) {
      case "job.queued":
        input.appendLog(`queued ${event.action}`, "info", event.jobId as string);
        void input.refreshJobs();
        break;
      case "job.started":
        input.appendLog(`started ${event.action}`, "info", event.jobId as string);
        input.setRunning(true);
        if (!input.selectedJobId()) input.setSelectedJobId((event.jobId as string) ?? null);
        void input.refreshJobs();
        break;
      case "job.log":
        if (event.line) {
          input.appendLog(
            String(event.line),
            event.level as LogLine["level"],
            event.jobId as string,
          );
        }
        break;
      case "job.healed":
        input.appendLog(
          `healed ${event.action}: ${event.healMessage}`,
          "success",
          event.jobId as string,
        );
        void input.refreshJobs();
        void input.refreshRuns();
        break;
      case "job.paused":
      case "job.resumed":
        input.appendLog(
          `${type === "job.paused" ? "paused" : "resumed"} ${event.action}`,
          "info",
          event.jobId as string,
        );
        input.setRunning(true);
        void input.refreshJobs();
        break;
      case "job.cancelled":
        input.appendLog(`cancelled ${event.action}`, "error", event.jobId as string);
        input.setRunning(false);
        void input.refreshJobs();
        void input.refreshRuns();
        void input.loadRunDetail(event.jobId as string);
        break;
      case "job.finished":
        input.appendLog(
          event.healed
            ? `healed ${event.action} (${event.durationMs ?? "?"}ms)`
            : event.ok
              ? `finished ${event.action} (${event.durationMs ?? "?"}ms)`
              : `failed ${event.action}: ${event.error ?? "?"}`,
          event.ok || event.healed ? "success" : "error",
          event.jobId as string,
        );
        input.setRunning(false);
        void input.refreshJobs();
        void input.refreshRuns();
        // Persistence happens immediately after the terminal event; reconcile
        // once more so the durable catalog cannot remain one write behind.
        setTimeout(() => void input.refreshRuns(), 300);
        void input
          .captureUiScreenshot(
            event.ok || event.healed ? `${event.action} · done` : `${event.action} · failed`,
            event.jobId as string,
            event.action as string,
            true,
          )
          .catch(() => undefined);
        break;
      case "job.step": {
        const step = event.step as { title?: string; status?: string } | undefined;
        if (step?.title) {
          input.appendLog(
            `step: ${step.title}${step.status ? ` (${step.status})` : ""}`,
            "info",
            event.jobId as string,
          );
        }
        void input.refreshJobs();
        break;
      }
      case "job.frame": {
        const frame = event.frame as TraceFrameRef | undefined;
        if (frame?.base64) {
          input.pushFrame({
            capturedAt: frame.capturedAt,
            mime: frame.mime ?? "image/png",
            base64: frame.base64,
            bytes: frame.bytes ?? 0,
            caption: frame.caption,
            jobId: event.jobId as string,
            path: frame.path,
          });
        }
        void input.refreshJobs();
        break;
      }
      case "device.selected":
        // Selection is client-local focus. Other actors remain visible via
        // eventActivity, but can never retarget this renderer.
        break;
      case "error":
        input.appendLog(String(event.message ?? "error"), "error");
        break;
      default:
        break;
    }
  }

  function connect(): void {
    abort?.abort();
    if (reconnectTimer) clearTimeout(reconnectTimer);
    const client = input.client();
    if (!client) return;
    const controller = new AbortController();
    abort = controller;
    setSseConnected(false);
    void client
      .events(handleEvent, {
        signal: controller.signal,
        afterSequence: cursor,
        onOpen: () => setSseConnected(true),
      })
      .catch((error: unknown) => {
        if ((error as { name?: string }).name === "AbortError" || controller.signal.aborted) {
          return;
        }
        setSseConnected(false);
        reconnectTimer = setTimeout(() => connect(), 1_000);
      });
  }

  function dispose(): void {
    abort?.abort();
    if (reconnectTimer) clearTimeout(reconnectTimer);
  }

  return { sseConnected, eventActivity, connect, dispose };
}
