import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { findWorkspaceRoot } from "@relay/core";
import {
  GOAL_EXPLORATION_MAX_WORKERS,
  GOAL_EXPLORATION_SCHEMA_VERSION,
  type GoalExplorationRecord,
  type GoalExplorationResult,
  type GoalExplorationStartInput,
  type GoalExplorationStatus,
  type GoalExplorationSummary,
  type GoalExplorationWorker,
  type GoalFinding,
} from "@relay/protocol";
import type { GoalSessionResult } from "@relay/protocol";
import type { GoalSessionRunner } from "./goal-runner.js";

const MAX_ERROR_CHARS = 1_024;

export type GoalExplorationStore = {
  load(id: string): Promise<GoalExplorationRecord | null>;
  save(record: GoalExplorationRecord): Promise<void>;
};

export type GoalExplorationRunnerOptions = {
  sessions: GoalSessionRunner;
  store?: GoalExplorationStore;
  now?: () => number;
  id?: () => string;
};

export type GoalExplorationRunner = {
  start(input: GoalExplorationStartInput): Promise<GoalExplorationResult>;
  resume(explorationId: string): Promise<GoalExplorationResult>;
  inspect(explorationId: string): Promise<GoalExplorationRecord>;
};

function root(): string {
  const state = process.env.RELAY_STATE_DIR?.trim() || join(findWorkspaceRoot(), ".relay");
  return join(state, "explorations");
}

function validId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(value);
}

function assertId(value: string): void {
  if (!validId(value)) throw new TypeError("Invalid goal exploration id.");
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.trim().slice(0, MAX_ERROR_CHARS) || "Goal worker failed";
}

function agentsFor(input: GoalExplorationStartInput): number {
  const agents = input.agents ?? 1;
  const goal = input.goal.trim();
  if (!goal || goal.length > 2_048) {
    throw new TypeError("goal must be between 1 and 2048 characters.");
  }
  if (!Number.isInteger(agents) || agents < 1 || agents > GOAL_EXPLORATION_MAX_WORKERS) {
    throw new TypeError(`agents must be an integer between 1 and ${GOAL_EXPLORATION_MAX_WORKERS}.`);
  }
  if (input.startUrl && input.authenticationFixtureReference) {
    throw new TypeError(
      "authenticationFixtureReference requires an existing managed browser target; provide targetId instead of startUrl.",
    );
  }
  if (agents > 1 && input.targetId) {
    throw new TypeError(
      "Multiple workers need a startUrl so Relay can create isolated browser targets; one connected target cannot be shared.",
    );
  }
  if (agents > 1 && (input.laneId || input.authenticationFixtureReference)) {
    throw new TypeError(
      "Multiple workers cannot share one Lane or authentication fixture; provide isolated signed-out browser workers.",
    );
  }
  return agents;
}

function summary(workers: readonly GoalExplorationWorker[]): GoalExplorationSummary {
  return {
    workers: workers.length,
    completed: workers.filter((worker) => worker.status === "completed").length,
    partial: workers.filter((worker) => worker.status === "partial").length,
    blocked: workers.filter((worker) => worker.status === "blocked").length,
    uncertain: workers.filter((worker) => worker.status === "uncertain").length,
  };
}

function finalStatus(result: GoalExplorationSummary): Exclude<GoalExplorationStatus, "running"> {
  if (result.uncertain > 0) return "uncertain";
  if (result.completed === result.workers) return "completed";
  if (result.completed > 0 || result.partial > 0) return "partial";
  return "blocked";
}

function parseRecord(value: unknown, expectedId: string): GoalExplorationRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Stored goal exploration is not an object.");
  }
  const record = value as Partial<GoalExplorationRecord>;
  if (
    record.schemaVersion !== GOAL_EXPLORATION_SCHEMA_VERSION ||
    record.id !== expectedId ||
    typeof record.goal !== "string" ||
    !Number.isInteger(record.agents) ||
    !Array.isArray(record.workers) ||
    record.workers.length !== record.agents ||
    !record.summary ||
    typeof record.summary !== "object"
  ) {
    throw new TypeError("Stored goal exploration is malformed.");
  }
  return record as GoalExplorationRecord;
}

function fileStore(): GoalExplorationStore {
  return {
    async load(id) {
      assertId(id);
      try {
        return parseRecord(JSON.parse(await readFile(join(root(), `${id}.json`), "utf8")), id);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    async save(record) {
      assertId(record.id);
      const directory = root();
      await mkdir(directory, { recursive: true });
      const temporary = join(directory, `.${record.id}.${randomUUID()}.tmp`);
      await writeFile(temporary, JSON.stringify(record), { encoding: "utf8", mode: 0o600 });
      await rename(temporary, join(directory, `${record.id}.json`));
    },
  };
}

function workerResult(
  worker: GoalExplorationWorker,
  result: GoalSessionResult,
): GoalExplorationWorker {
  return {
    ...worker,
    status:
      result.status === "completed"
        ? "completed"
        : result.status === "uncertain"
          ? "uncertain"
          : result.status === "blocked"
            ? "blocked"
            : "partial",
    targetId: result.target.targetId,
    laneId: result.target.laneId,
    authenticationFixtureReference: result.target.authenticationFixtureReference,
    result,
    error: undefined,
  };
}

function aggregateFindings(
  workers: readonly GoalExplorationWorker[],
  existing: readonly GoalFinding[] = [],
): GoalFinding[] {
  const findings = [...existing, ...workers.flatMap((worker) => worker.result?.findings ?? [])];
  return [...new Map(findings.map((finding) => [finding.id, finding])).values()];
}

export function createGoalExplorationRunner(
  options: GoalExplorationRunnerOptions,
): GoalExplorationRunner {
  const store = options.store ?? fileStore();
  const sessions = options.sessions;
  const now = options.now ?? Date.now;
  const id = options.id ?? randomUUID;

  const persist = async (record: GoalExplorationRecord): Promise<void> => {
    await store.save({ ...record, updatedAt: now() });
  };

  const run = async (starting: GoalExplorationRecord, input?: GoalExplorationStartInput) => {
    let record = starting;
    let writes = Promise.resolve();
    const sessionInput = input ? (({ agents: _agents, ...rest }) => rest)(input) : undefined;
    const apply = (update: (current: GoalExplorationRecord) => GoalExplorationRecord) => {
      writes = writes.then(async () => {
        record = update(record);
        await persist(record);
      });
      return writes;
    };

    const activeWorkers = record.workers.filter(
      (worker) => worker.status === "pending" || worker.status === "running",
    );
    await Promise.all(
      activeWorkers.map(async (worker) => {
        try {
          // A partitioned exploration gives every worker exactly one mission.
          const missionInput = worker.mission
            ? { ...sessionInput!, goal: worker.mission }
            : sessionInput!;
          const result = input
            ? await sessions.start({
                ...missionInput,
                sessionId: worker.sessionId,
              })
            : await sessions.resume(worker.sessionId);
          await apply((current) => ({
            ...current,
            workers: current.workers.map((item) =>
              item.id === worker.id ? workerResult(item, result) : item,
            ),
          }));
        } catch (error) {
          await apply((current) => ({
            ...current,
            workers: current.workers.map((item) =>
              item.id === worker.id
                ? { ...item, status: "blocked", error: errorMessage(error) }
                : item,
            ),
          }));
        }
      }),
    );
    await writes;
    const workerSummary = summary(record.workers);
    record = {
      ...record,
      status: finalStatus(workerSummary),
      summary: workerSummary,
      findings: aggregateFindings(record.workers, record.findings),
      stopReason: {
        code: "all-workers-finished",
        message: "Every bounded goal worker reached a terminal result.",
        at: now(),
      },
      updatedAt: now(),
    };
    await persist(record);
    return record;
  };

  return {
    async start(input) {
      const explorationId = id();
      assertId(explorationId);
      const missions = (input.missions ?? [])
        .map((mission) => mission.trim().slice(0, 2_048))
        .filter(Boolean);
      // Mission partitioning governs worker count; without missions every
      // worker would receive the same goal, which buys no new coverage.
      const agents = missions.length ? Math.max(1, Math.min(missions.length, agentsFor(input))) : agentsFor(input);
      const goal = input.goal.trim();
      const at = now();
      const workers: GoalExplorationWorker[] = Array.from({ length: agents }, (_, index) => ({
        id: `worker-${index + 1}`,
        index: index + 1,
        sessionId: `explore-${explorationId}-${index + 1}`,
        status: "pending",
        ...(missions[index] ? { mission: missions[index] } : {}),
        ...(input.targetId ? { targetId: input.targetId } : {}),
        ...(input.laneId ? { laneId: input.laneId } : {}),
        ...(input.authenticationFixtureReference
          ? { authenticationFixtureReference: input.authenticationFixtureReference }
          : {}),
      }));
      const record: GoalExplorationRecord = {
        schemaVersion: GOAL_EXPLORATION_SCHEMA_VERSION,
        id: explorationId,
        goal,
        agents,
        status: "running",
        createdAt: at,
        updatedAt: at,
        workers,
        summary: summary(workers),
        findings: [],
      };
      await store.save(record);
      return run(record, input);
    },
    async resume(explorationId) {
      assertId(explorationId);
      const record = await store.load(explorationId);
      if (!record) throw new TypeError(`Goal exploration ${explorationId} was not found.`);
      if (record.status !== "running") return record;
      return run(record);
    },
    async inspect(explorationId) {
      assertId(explorationId);
      const record = await store.load(explorationId);
      if (!record) throw new TypeError(`Goal exploration ${explorationId} was not found.`);
      return record;
    },
  };
}
