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

export type TargetWorkerScheduledWork = TargetWorkerAssignment & {
  id: string;
  run: () => Promise<void>;
};

type ScheduledWork = TargetWorkerScheduledWork;

/** A validated scheduler reservation. Staged work is deliberately invisible
 * to drain until its owning campaign record is durable. Once staged,
 * `dispatch()` only transfers the already-normalized work to the queue and
 * cannot re-plan a later cell into a partial dispatch. */
export type TargetWorkerStagedBatch = {
  dispatch(): void;
  rollback(): void;
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
  /** Scheduler-policy reservations that have passed admission but must not
   * start until their campaign/job records are durable. */
  readonly #staged = new Map<string, readonly ScheduledWork[]>();
  #nextStagedBatchId = 0;
  readonly #activeTargets = new Set<string>();
  readonly #activeByWorker = new Map<string, Set<string>>();
  readonly #capacityByWorker = new Map<string, number>();
  readonly #hostByWorker = new Map<string, TargetWorkerAssignment["host"]>();
  readonly #activeByHost = new Map<string, Set<string>>();
  readonly #capacityByHost = new Map<string, number>();

  enqueue(work: ScheduledWork): void {
    this.enqueueBatch([work]);
  }

  /** Validate and register an entire accepted batch before starting any work.
   * This is the queue half of campaign atomicity: an invalid later cell cannot
   * dispatch an earlier one while Relay is still constructing the batch. */
  enqueueBatch(work: readonly ScheduledWork[]): void {
    this.stageBatch(work).dispatch();
  }

  /** Preflight the exact scheduler policy without registering or dispatching
   * work. Batch admission uses this before durable queue records are written. */
  assertCanEnqueueBatch(work: readonly ScheduledWork[]): void {
    this.#planBatch(work);
  }

  /** Reserve a fully validated batch without exposing it to the worker drain.
   * Subsequent admissions validate against staged policy too, so a later
   * request cannot invalidate this batch between campaign persistence and
   * dispatch. `dispatch()` has no policy validation or external I/O. */
  stageBatch(work: readonly ScheduledWork[]): TargetWorkerStagedBatch {
    const { normalized } = this.#planBatch(work);
    const batchId = `scheduler-stage-${++this.#nextStagedBatchId}`;
    this.#staged.set(batchId, normalized);
    let state: "staged" | "dispatched" | "rolled-back" = "staged";
    return {
      dispatch: () => {
        if (state !== "staged") return;
        // Every throwing validation was completed by stageBatch(). Applying
        // frozen policy is Map mutation only; this is the intentionally
        // no-throw post-persistence transition.
        this.#staged.delete(batchId);
        this.#applyPolicy(normalized);
        this.#queued.push(...normalized);
        state = "dispatched";
        this.#drain();
      },
      rollback: () => {
        if (state !== "staged") return;
        this.#staged.delete(batchId);
        state = "rolled-back";
      },
    };
  }

  #planBatch(work: readonly ScheduledWork[]) {
    const normalized = work.map((item) => this.#normalize(item));
    const workerCapacities = new Map(this.#capacityByWorker);
    const workerHosts = new Map(this.#hostByWorker);
    const hostCapacities = new Map(this.#capacityByHost);
    const addPolicy = (item: ScheduledWork) => {
      if (!workerCapacities.has(item.workerId)) {
        workerCapacities.set(item.workerId, item.capacity);
      }
      const hasEstablishedHost = workerHosts.has(item.workerId);
      const establishedHost = workerHosts.get(item.workerId);
      if (
        hasEstablishedHost &&
        ((!establishedHost && item.host) ||
          (establishedHost && (!item.host || establishedHost.workerId !== item.host.workerId)))
      ) {
        throw new Error(`Target worker ${item.workerId} cannot change host capacity policy`);
      }
      if (!hasEstablishedHost) workerHosts.set(item.workerId, item.host);
      if (item.host) {
        const previous = hostCapacities.get(item.host.workerId);
        // A later, lower explicit ceiling must take effect immediately; raising
        // a shared ceiling is intentionally a process restart/config action.
        hostCapacities.set(
          item.host.workerId,
          previous === undefined ? item.host.capacity : Math.min(previous, item.host.capacity),
        );
      }
    };
    // A staged campaign has an accepted immutable policy even though it is
    // not visible in the execution queue yet. Include it in every following
    // admission so a concurrent enqueue cannot make its dispatch invalid.
    for (const staged of this.#staged.values()) {
      for (const item of staged) addPolicy(item);
    }
    for (const item of normalized) addPolicy(item);
    return { normalized, workerCapacities, workerHosts, hostCapacities };
  }

  #applyPolicy(work: readonly ScheduledWork[]): void {
    for (const item of work) {
      if (!this.#capacityByWorker.has(item.workerId)) {
        this.#capacityByWorker.set(item.workerId, item.capacity);
      }
      if (!this.#hostByWorker.has(item.workerId)) {
        this.#hostByWorker.set(item.workerId, item.host);
      }
      if (item.host) {
        const previous = this.#capacityByHost.get(item.host.workerId);
        this.#capacityByHost.set(
          item.host.workerId,
          previous === undefined ? item.host.capacity : Math.min(previous, item.host.capacity),
        );
      }
    }
  }

  #normalize(work: ScheduledWork): ScheduledWork {
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
    return normalized;
  }

  remove(id: string): boolean {
    const index = this.#queued.findIndex((work) => work.id === id);
    if (index < 0) return false;
    this.#queued.splice(index, 1);
    return true;
  }

  statuses(): TargetWorkerStatus[] {
    // A staged batch is already an accepted capacity reservation. It cannot
    // dispatch before its owner is durable, but preflight must still see it so
    // a concurrent campaign cannot promise the same target or host capacity.
    const staged = [...this.#staged.values()].flat();
    const pending = [...this.#queued, ...staged];
    const workerIds = new Set([
      ...this.#capacityByWorker.keys(),
      ...pending.map((work) => work.workerId),
    ]);
    return [...workerIds].sort().map((workerId) => {
      const stagedForWorker = staged.filter((work) => work.workerId === workerId);
      const hasWorkerPolicy = this.#capacityByWorker.has(workerId);
      const hasHostPolicy = this.#hostByWorker.has(workerId);
      const host = hasHostPolicy
        ? this.#hostByWorker.get(workerId)
        : stagedForWorker.find((work) => work.host)?.host;
      const activeTargets = [...(this.#activeByWorker.get(workerId) ?? [])].sort();
      const queuedTargets = pending
        .filter((work) => work.workerId === workerId)
        .map((work) => work.targetId);
      const hostActive = host ? (this.#activeByHost.get(host.workerId)?.size ?? 0) : undefined;
      const hostQueued = host
        ? pending.filter((work) => work.host?.workerId === host.workerId).length
        : undefined;
      const stagedHostCapacity = host
        ? staged
            .filter((work) => work.host?.workerId === host.workerId)
            .reduce(
              (capacity, work) => Math.min(capacity, work.host?.capacity ?? capacity),
              host.capacity,
            )
        : undefined;
      return {
        workerId,
        capacity: hasWorkerPolicy
          ? this.#capacityByWorker.get(workerId)!
          : (stagedForWorker[0]?.capacity ?? 1),
        active: activeTargets.length,
        queued: queuedTargets.length,
        activeTargets,
        queuedTargets,
        ...(host
          ? {
              host: {
                workerId: host.workerId,
                capacity:
                  this.#capacityByHost.get(host.workerId) ?? stagedHostCapacity ?? host.capacity,
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
