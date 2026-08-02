export type TargetWorkerAssignment = {
  workerId: string;
  targetId: string;
  capacity: number;
};

export type TargetWorkerStatus = {
  workerId: string;
  capacity: number;
  active: number;
  queued: number;
  activeTargets: string[];
  queuedTargets: string[];
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

  enqueue(work: ScheduledWork): void {
    const normalized = {
      ...work,
      workerId: work.workerId.trim() || "local",
      targetId: work.targetId.trim(),
      capacity: positiveCapacity(work.capacity),
    };
    if (!normalized.targetId) throw new Error("Scheduled work requires an explicit target");
    if (!this.#capacityByWorker.has(normalized.workerId)) {
      this.#capacityByWorker.set(normalized.workerId, normalized.capacity);
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
      return {
        workerId,
        capacity: this.#capacityByWorker.get(workerId) ?? 1,
        active: activeTargets.length,
        queued: queuedTargets.length,
        activeTargets,
        queuedTargets,
      };
    });
  }

  #drain(): void {
    for (let index = 0; index < this.#queued.length;) {
      const work = this.#queued[index]!;
      const activeForWorker = this.#activeByWorker.get(work.workerId) ?? new Set<string>();
      const capacity = this.#capacityByWorker.get(work.workerId) ?? work.capacity;
      if (this.#activeTargets.has(work.targetId) || activeForWorker.size >= capacity) {
        index += 1;
        continue;
      }

      this.#queued.splice(index, 1);
      this.#activeTargets.add(work.targetId);
      activeForWorker.add(work.targetId);
      this.#activeByWorker.set(work.workerId, activeForWorker);
      void work
        .run()
        .catch(() => undefined)
        .finally(() => {
          this.#activeTargets.delete(work.targetId);
          const active = this.#activeByWorker.get(work.workerId);
          active?.delete(work.targetId);
          if (active?.size === 0) this.#activeByWorker.delete(work.workerId);
          this.#drain();
        });
    }
  }
}

function capacityFromEnvironment(name: string, fallback: number): number {
  const configured = process.env[name]?.trim();
  return positiveCapacity(configured ? Number(configured) : fallback);
}

export function defaultTargetWorkerAssignment(input: {
  targetId: string;
  platform: "android" | "ios" | "browser";
  workerId?: string;
  workerCapacity?: number;
}): TargetWorkerAssignment {
  const platform = input.platform;
  const environmentName = `RELAY_${platform.toUpperCase()}_WORKER_CAPACITY`;
  const conservativeDefault = platform === "ios" ? 1 : 2;
  return {
    targetId: input.targetId,
    workerId: input.workerId?.trim() || `local:${platform}`,
    capacity: input.workerCapacity ?? capacityFromEnvironment(environmentName, conservativeDefault),
  };
}
