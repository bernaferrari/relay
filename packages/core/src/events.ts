import type { ResourceEvent } from "@relay/protocol";

/**
 * Process-local event bus (OpenCode-style pub/sub for hosts).
 * Server fans this out over SSE; CLI/TUI can subscribe in-process.
 */

export type DeviceEvent =
  | ResourceEvent
  | { type: "server.ready"; at: number; host: string; port: number }
  | { type: "device.list"; at: number; count: number }
  | { type: "device.selected"; at: number; serial: string | null }
  | { type: "job.queued"; at: number; jobId: string; action: string; serial?: string }
  | { type: "job.started"; at: number; jobId: string; action: string; serial?: string }
  | {
      type: "job.log";
      at: number;
      jobId: string;
      line: string;
      level?: "info" | "success" | "error" | "default";
    }
  | {
      type: "job.finished";
      at: number;
      jobId: string;
      action: string;
      ok: boolean;
      result?: unknown;
      error?: string;
      durationMs: number;
      healed?: boolean;
      cancelled?: boolean;
    }
  | { type: "job.healed"; at: number; jobId: string; action: string; healMessage: string }
  | { type: "job.paused"; at: number; jobId: string; action: string }
  | { type: "job.resumed"; at: number; jobId: string; action: string }
  | { type: "job.cancelled"; at: number; jobId: string; action: string }
  | { type: "job.step"; at: number; jobId: string; step: unknown }
  | { type: "job.frame"; at: number; jobId: string; frame: unknown }
  | { type: "snapshot.captured"; at: number; serial?: string; nodeCount: number }
  | { type: "screenshot.captured"; at: number; serial?: string; bytes: number }
  | { type: "error"; at: number; message: string; where?: string };

export type EventListener = (event: DeviceEvent) => void;

const listeners = new Set<EventListener>();
const recent: DeviceEvent[] = [];
const MAX_RECENT = 200;

export function publish(event: DeviceEvent): void {
  recent.push(event);
  if (recent.length > MAX_RECENT) recent.splice(0, recent.length - MAX_RECENT);
  for (const l of listeners) {
    try {
      l(event);
    } catch {
      /* never let a bad subscriber kill the bus */
    }
  }
}

export function subscribe(listener: EventListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function recentEvents(limit = 50): DeviceEvent[] {
  return recent.slice(-limit);
}

export function now(): number {
  return Date.now();
}
