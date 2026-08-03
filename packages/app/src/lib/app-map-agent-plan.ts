import type { DeviceInfo } from "./api-types";
import type {
  AgentModelOption,
  AgentStrategy,
  AgentWorker,
} from "../components/app-map-agent-types";

export function buildAgentWorkers(
  targets: readonly DeviceInfo[],
  models: readonly AgentModelOption[],
  options: { strategy: AgentStrategy; areas: readonly string[]; actionBudget: number },
  id: () => string = () => crypto.randomUUID(),
): AgentWorker[] {
  const workers = targets.flatMap((target) =>
    models.map(
      (model): AgentWorker => ({
        id: id(),
        targetId: target.serial,
        targetName: target.name ?? target.serial,
        model,
        actionBudget: options.actionBudget,
        status: "queued",
        stage: "Waiting for target",
        planner: "model",
        screens: 0,
        interactions: 0,
      }),
    ),
  );
  return workers.map((worker, index) => ({
    ...worker,
    ...(options.strategy === "divide" && options.areas.length
      ? { focus: options.areas[index % options.areas.length] }
      : {}),
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
