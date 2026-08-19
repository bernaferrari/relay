import type { DeviceInfo } from "./api-types";
import type { AgentStrategy, AgentWorker } from "../components/app-map-agent-types";

export function buildAgentWorkers(
  targets: readonly DeviceInfo[],
  options: { strategy: AgentStrategy; areas: readonly string[]; actionBudget: number },
  id: () => string = () => crypto.randomUUID(),
): AgentWorker[] {
  const workers = targets.map(
    (target): AgentWorker => ({
      id: id(),
      targetId: target.serial,
      targetName: target.name ?? target.serial,
      actionBudget: options.actionBudget,
      status: "queued",
      stage: "Waiting for target",
      screens: 0,
      interactions: 0,
    }),
  );
  return workers.map((worker, index) => ({
    ...worker,
    ...(options.strategy === "divide" && options.areas.length
      ? { focus: options.areas[index % options.areas.length] }
      : {}),
  }));
}

export type JourneyWorkerOption = {
  id: string;
  /** Short enough for a tab: the divided area, else the perspective. */
  label: string;
  /** The target, so two agents on the same area stay distinguishable. */
  detail: string;
  live: boolean;
};

/** Every crawl that reached a session, oldest first, so the panel can offer one
 * journey per worker instead of only the one that happens to hold focus. */
export function journeyWorkerOptions(workers: readonly AgentWorker[]): JourneyWorkerOption[] {
  return workers
    .filter((worker) => worker.sessionId)
    .map((worker) => ({
      id: worker.id,
      label: worker.focus?.trim() || "Relay",
      detail: worker.targetName,
      live: worker.status === "running",
    }));
}

/** Independent targets may run concurrently; each returned row is one target's
 * exclusive serial queue and must execute in order. */
export function agentTargetQueues(workers: readonly AgentWorker[]): AgentWorker[][] {
  const queues = new Map<string, AgentWorker[]>();
  for (const worker of workers) {
    const queue = queues.get(worker.targetId) ?? [];
    queue.push(worker);
    queues.set(worker.targetId, queue);
  }
  return [...queues.values()];
}
