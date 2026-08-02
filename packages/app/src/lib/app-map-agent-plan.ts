import type { DeviceInfo } from "./api-types";
import type { AgentModelOption, AgentWorker } from "../components/app-map-agent-types";

export function buildAgentWorkers(
  targets: readonly DeviceInfo[],
  models: readonly AgentModelOption[],
  id: () => string = () => crypto.randomUUID(),
): AgentWorker[] {
  return targets.flatMap((target) =>
    models.map((model) => ({
      id: id(),
      targetId: target.serial,
      targetName: target.name ?? target.serial,
      model,
      status: "queued",
      stage: "Waiting for target",
      planner: "model",
      screens: 0,
      interactions: 0,
    })),
  );
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
