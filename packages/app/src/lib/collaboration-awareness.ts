import type {
  CollaborationActivity,
  CollaborationAwareness,
  CollaborationAwarenessPublishInput,
} from "@relay/protocol";
import type { RelayAwarenessTransport } from "./relay-collaboration-transport";

export type LocalCollaborationAwareness = Omit<CollaborationAwarenessPublishInput, "journeyId">;

export type CollaborationAwarenessControllerOptions = Readonly<{
  journeyId: string;
  transport: RelayAwarenessTransport;
  pollMs?: number;
  publishThrottleMs?: number;
  heartbeatMs?: number;
  clock?: () => number;
}>;

const DEFAULT_LOCAL_AWARENESS: LocalCollaborationAwareness = Object.freeze({ activity: "idle" });

function assertDelay(value: number, label: string, minimum: number): number {
  if (!Number.isFinite(value) || value < minimum) throw new RangeError(`${label} is too small`);
  return Math.round(value);
}

function sameAwareness(
  left: LocalCollaborationAwareness,
  right: LocalCollaborationAwareness,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Lossy, ephemeral presence controller. It never receives canvas setters. */
export class CollaborationAwarenessController {
  readonly #journeyId: string;
  readonly #transport: RelayAwarenessTransport;
  readonly #pollMs: number;
  readonly #publishThrottleMs: number;
  readonly #heartbeatMs: number;
  readonly #clock: () => number;
  readonly #listeners = new Set<(awareness: readonly CollaborationAwareness[]) => void>();
  #local: LocalCollaborationAwareness = DEFAULT_LOCAL_AWARENESS;
  #remote: CollaborationAwareness[] = [];
  #serverClockOffset = 0;
  #lastPublishedAt = Number.NEGATIVE_INFINITY;
  #started = false;
  #destroyed = false;
  #publishing = false;
  #publishAgain = false;
  #publishTimer: ReturnType<typeof setTimeout> | undefined;
  #pollTimer: ReturnType<typeof setInterval> | undefined;
  #heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  #expiryTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: CollaborationAwarenessControllerOptions) {
    if (!options.journeyId.trim()) throw new TypeError("journeyId is required");
    this.#journeyId = options.journeyId;
    this.#transport = options.transport;
    this.#pollMs = assertDelay(options.pollMs ?? 2_000, "pollMs", 100);
    // Server awareness accepts at most one write every 50ms.
    this.#publishThrottleMs = assertDelay(options.publishThrottleMs ?? 80, "publishThrottleMs", 50);
    this.#heartbeatMs = assertDelay(options.heartbeatMs ?? 8_000, "heartbeatMs", 500);
    this.#clock = options.clock ?? Date.now;
  }

  get snapshot(): readonly CollaborationAwareness[] {
    const serverNow = this.#clock() + this.#serverClockOffset;
    return this.#remote
      .filter((entry) => entry.expiresAt > serverNow)
      .map((entry) => structuredClone(entry));
  }

  subscribe(listener: (awareness: readonly CollaborationAwareness[]) => void): () => void {
    if (this.#destroyed) throw new Error("Collaboration awareness is destroyed");
    this.#listeners.add(listener);
    listener(this.snapshot);
    return () => this.#listeners.delete(listener);
  }

  start(): void {
    if (this.#destroyed) throw new Error("Collaboration awareness is destroyed");
    if (this.#started) return;
    this.#started = true;
    void this.#poll();
    this.#pollTimer = setInterval(() => void this.#poll(), this.#pollMs);
    this.#heartbeatTimer = setInterval(() => this.#schedulePublish(), this.#heartbeatMs);
    this.#schedulePublish();
  }

  update(next: LocalCollaborationAwareness): void {
    if (this.#destroyed) return;
    const normalized = structuredClone(next);
    if (sameAwareness(this.#local, normalized)) return;
    this.#local = normalized;
    if (this.#started) this.#schedulePublish();
  }

  stop(): void {
    if (!this.#started) return;
    this.#started = false;
    this.#clearTimers();
    this.#remote = [];
    this.#emit();
    void this.#transport.remove(this.#journeyId).catch(() => undefined);
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.stop();
    this.#destroyed = true;
    this.#listeners.clear();
  }

  #schedulePublish(): void {
    if (!this.#started || this.#publishTimer) return;
    const delay = Math.max(0, this.#lastPublishedAt + this.#publishThrottleMs - this.#clock());
    this.#publishTimer = setTimeout(() => {
      this.#publishTimer = undefined;
      void this.#publish();
    }, delay);
  }

  async #publish(): Promise<void> {
    if (!this.#started) return;
    if (this.#publishing) {
      this.#publishAgain = true;
      return;
    }
    this.#publishing = true;
    const sent = this.#local;
    try {
      await this.#transport.publish({ journeyId: this.#journeyId, ...structuredClone(sent) });
      this.#lastPublishedAt = this.#clock();
    } catch {
      // Presence is intentionally lossy; the next heartbeat/poll retries.
    } finally {
      this.#publishing = false;
      if (this.#publishAgain || !sameAwareness(sent, this.#local)) {
        this.#publishAgain = false;
        this.#schedulePublish();
      }
    }
  }

  async #poll(): Promise<void> {
    if (!this.#started) return;
    try {
      const response = await this.#transport.list(this.#journeyId);
      if (!this.#started) return;
      this.#serverClockOffset = response.serverTime - this.#clock();
      this.#remote = response.awareness
        .filter(
          (entry) =>
            entry.actorId !== this.#transport.actorId && entry.expiresAt > response.serverTime,
        )
        .sort((left, right) => left.actorId.localeCompare(right.actorId));
      this.#emit();
      this.#scheduleExpiry();
    } catch {
      // Awareness does not affect document connectivity or local editing.
    }
  }

  #scheduleExpiry(): void {
    if (this.#expiryTimer) clearTimeout(this.#expiryTimer);
    const nextExpiry = Math.min(...this.#remote.map((entry) => entry.expiresAt));
    if (!Number.isFinite(nextExpiry)) return;
    const delay = Math.max(0, nextExpiry - (this.#clock() + this.#serverClockOffset));
    this.#expiryTimer = setTimeout(() => {
      this.#expiryTimer = undefined;
      const next = this.snapshot;
      if (next.length !== this.#remote.length) {
        this.#remote = [...next];
        this.#emit();
      }
      this.#scheduleExpiry();
    }, delay + 1);
  }

  #emit(): void {
    const snapshot = this.snapshot;
    for (const listener of this.#listeners) listener(snapshot);
  }

  #clearTimers(): void {
    if (this.#publishTimer) clearTimeout(this.#publishTimer);
    if (this.#pollTimer) clearInterval(this.#pollTimer);
    if (this.#heartbeatTimer) clearInterval(this.#heartbeatTimer);
    if (this.#expiryTimer) clearTimeout(this.#expiryTimer);
    this.#publishTimer = undefined;
    this.#pollTimer = undefined;
    this.#heartbeatTimer = undefined;
    this.#expiryTimer = undefined;
  }
}

export function collaborationActivity(input: {
  recording: boolean;
  running: boolean;
  editing: boolean;
}): CollaborationActivity {
  if (input.recording) return "recording";
  if (input.running) return "running";
  return input.editing ? "editing" : "idle";
}
