export type TargetWorkerAssignment = {
  /** A one-target execution lane. This is deliberately not a host identity. */
  workerId: string;
  targetId: string;
  capacity: number;
  /** Optional aggregate limit for a local host or remote provider worker. */
  host?: {
    workerId: string;
    capacity: number;
  };
};

export type TargetWorkerStatus = {
  workerId: string;
  capacity: number;
  active: number;
  queued: number;
  activeTargets: string[];
  queuedTargets: string[];
  /** Present when the target lane is additionally constrained by a host. */
  host?: {
    workerId: string;
    capacity: number;
    active: number;
    queued: number;
  };
};

type ScheduledWork = TargetWorkerAssignment & {
  id: string;
  run: () => Promise<void>;
};

function positiveCapacity(value: number): number {
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.floor(value);
}

/**
 * Capacity-aware local scheduler. A worker may execute several independent
 * targets at once, while a physical target remains strictly single-owner.
 * DeviceLease still provides the durable actor-level exclusivity boundary;
 * this scheduler prevents two accepted jobs from driving the same target.
 */
export class TargetWorkerScheduler {
  readonly #queued: ScheduledWork[] = [];
  readonly #activeTargets = new Set<string>();
  readonly #activeByWorker = new Map<string, Set<string>>();
  readonly #capacityByWorker = new Map<string, number>();
  readonly #hostByWorker = new Map<string, TargetWorkerAssignment["host"]>();
  readonly #activeByHost = new Map<string, Set<string>>();
  readonly #capacityByHost = new Map<string, number>();

  enqueue(work: ScheduledWork): void {
    const normalized = {
      ...work,
      workerId: work.workerId.trim() || "local",
      targetId: work.targetId.trim(),
      capacity: positiveCapacity(work.capacity),
      host: work.host
        ? {
            workerId: work.host.workerId.trim(),
            capacity: positiveCapacity(work.host.capacity),
          }
        : undefined,
    };
    if (!normalized.targetId) throw new Error("Scheduled work requires an explicit target");
    if (normalized.host && !normalized.host.workerId) {
      throw new Error("Scheduled host capacity requires an explicit worker");
    }
    if (!this.#capacityByWorker.has(normalized.workerId)) {
      this.#capacityByWorker.set(normalized.workerId, normalized.capacity);
    }
    const hasEstablishedHost = this.#hostByWorker.has(normalized.workerId);
    const establishedHost = this.#hostByWorker.get(normalized.workerId);
    if (
      hasEstablishedHost &&
      ((!establishedHost && normalized.host) ||
        (establishedHost &&
          (!normalized.host || establishedHost.workerId !== normalized.host.workerId)))
    ) {
      throw new Error(`Target worker ${normalized.workerId} cannot change host capacity policy`);
    }
    if (!hasEstablishedHost) this.#hostByWorker.set(normalized.workerId, normalized.host);
    if (normalized.host) {
      const previous = this.#capacityByHost.get(normalized.host.workerId);
      // A later, lower explicit ceiling must take effect immediately; raising a
      // shared ceiling is intentionally a process restart/configuration action.
      this.#capacityByHost.set(
        normalized.host.workerId,
        previous === undefined
          ? normalized.host.capacity
          : Math.min(previous, normalized.host.capacity),
      );
    }
    this.#queued.push(normalized);
    this.#drain();
  }

  remove(id: string): boolean {
    const index = this.#queued.findIndex((work) => work.id === id);
    if (index < 0) return false;
    this.#queued.splice(index, 1);
    return true;
  }

  statuses(): TargetWorkerStatus[] {
    const workerIds = new Set([
      ...this.#capacityByWorker.keys(),
      ...this.#queued.map((work) => work.workerId),
    ]);
    return [...workerIds].sort().map((workerId) => {
      const activeTargets = [...(this.#activeByWorker.get(workerId) ?? [])].sort();
      const queuedTargets = this.#queued
        .filter((work) => work.workerId === workerId)
        .map((work) => work.targetId);
      const host = this.#hostByWorker.get(workerId);
      const hostActive = host ? (this.#activeByHost.get(host.workerId)?.size ?? 0) : undefined;
      const hostQueued = host
        ? this.#queued.filter((work) => work.host?.workerId === host.workerId).length
        : undefined;
      return {
        workerId,
        capacity: this.#capacityByWorker.get(workerId) ?? 1,
        active: activeTargets.length,
        queued: queuedTargets.length,
        activeTargets,
        queuedTargets,
        ...(host
          ? {
              host: {
                workerId: host.workerId,
                capacity: this.#capacityByHost.get(host.workerId) ?? host.capacity,
                active: hostActive!,
                queued: hostQueued!,
              },
            }
          : {}),
      };
    });
  }

  #drain(): void {
    for (let index = 0; index < this.#queued.length;) {
      const work = this.#queued[index]!;
      const activeForWorker = this.#activeByWorker.get(work.workerId) ?? new Set<string>();
      const capacity = this.#capacityByWorker.get(work.workerId) ?? work.capacity;
      const activeForHost = work.host
        ? (this.#activeByHost.get(work.host.workerId) ?? new Set<string>())
        : undefined;
      const hostCapacity = work.host
        ? (this.#capacityByHost.get(work.host.workerId) ?? work.host.capacity)
        : undefined;
      if (
        this.#activeTargets.has(work.targetId) ||
        activeForWorker.size >= capacity ||
        (activeForHost !== undefined &&
          hostCapacity !== undefined &&
          activeForHost.size >= hostCapacity)
      ) {
        index += 1;
        continue;
      }

      this.#queued.splice(index, 1);
      this.#activeTargets.add(work.targetId);
      activeForWorker.add(work.targetId);
      this.#activeByWorker.set(work.workerId, activeForWorker);
      if (work.host && activeForHost) {
        activeForHost.add(work.targetId);
        this.#activeByHost.set(work.host.workerId, activeForHost);
      }
      void work
        .run()
        .catch(() => undefined)
        .finally(() => {
          this.#activeTargets.delete(work.targetId);
          const active = this.#activeByWorker.get(work.workerId);
          active?.delete(work.targetId);
          if (active?.size === 0) this.#activeByWorker.delete(work.workerId);
          if (work.host) {
            const hostActive = this.#activeByHost.get(work.host.workerId);
            hostActive?.delete(work.targetId);
            if (hostActive?.size === 0) this.#activeByHost.delete(work.host.workerId);
          }
          this.#drain();
        });
    }
  }
}

function configuredCapacity(name: string): number | undefined {
  const configured = process.env[name]?.trim();
  return configured ? positiveCapacity(Number(configured)) : undefined;
}

function localTargetLaneId(platform: "android" | "ios" | "browser", targetId: string): string {
  return `local:${platform}:target:${encodeURIComponent(targetId)}`;
}

export function defaultTargetWorkerAssignment(input: {
  targetId: string;
  platform: "android" | "ios" | "browser";
  /** @deprecated Treat this as a host worker id; target lanes are derived from targetId. */
  workerId?: string;
  /** @deprecated Treat this as a host capacity; target lanes are always one-at-a-time. */
  workerCapacity?: number;
  hostWorkerId?: string;
  hostWorkerCapacity?: number;
}): TargetWorkerAssignment {
  const platform = input.platform;
  const targetId = input.targetId.trim();
  const canonicalHostCapacity = configuredCapacity(`RELAY_${platform.toUpperCase()}_HOST_CAPACITY`);
  // Preserve the old configuration name as a host ceiling rather than silently
  // continuing to serialize every physical device behind one platform worker.
  const legacyHostCapacity = configuredCapacity(`RELAY_${platform.toUpperCase()}_WORKER_CAPACITY`);
  const configuredHostCapacity = canonicalHostCapacity ?? legacyHostCapacity;
  const explicitHostId = input.hostWorkerId?.trim() || input.workerId?.trim();
  const hostCapacity = input.hostWorkerCapacity ?? input.workerCapacity ?? configuredHostCapacity;
  return {
    targetId,
    workerId: localTargetLaneId(platform, targetId),
    capacity: 1,
    ...((explicitHostId || configuredHostCapacity !== undefined) && hostCapacity !== undefined
      ? {
          host: {
            workerId: explicitHostId || `local:${platform}:host`,
            capacity: positiveCapacity(hostCapacity),
          },
        }
      : {}),
  };
}
