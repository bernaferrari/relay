/** Build frozen replay jobs without coupling construction to the scheduler. */
import { randomUUID } from "node:crypto";
import { now } from "./events.js";
import { getEvidenceCollectionPolicy } from "./evidence-policy.js";
import { currentOperationContext } from "./operation-context.js";
import { PRIVATE_INPUT } from "./private-inputs.js";
import { REDACTED } from "./redaction.js";
import type { PersistedRun } from "./runs.js";
import type { EnqueueJobInput, TestJob } from "./session-contract.js";
import type { TraceFrameRef, TraceStep } from "./trace.js";
import { defaultTargetWorkerAssignment } from "./target-worker.js";
import {
  inferDevicePlatformFromSerial,
  targetIdentity,
  type TargetContext,
} from "./target-context.js";

export function replayInputFromPersistedRun(
  run: Pick<
    PersistedRun,
    | "id"
    | "action"
    | "serial"
    | "platform"
    | "targetProfile"
    | "title"
    | "resolvedInputs"
    | "recipeSnapshot"
    | "recipeGraph"
    | "projectId"
    | "ownerId"
  >,
): EnqueueJobInput {
  if (!run.recipeSnapshot || !run.recipeGraph) {
    throw new Error("This run predates frozen replay data and cannot be replayed safely");
  }
  const unavailableInput = Object.entries(run.resolvedInputs).find(
    ([, value]) => value === PRIVATE_INPUT || value === REDACTED,
  );
  if (unavailableInput) {
    throw new Error(
      `This run used a private value for “${unavailableInput[0]}”. Provide it again before replaying.`,
    );
  }
  const platform =
    run.platform === "android" || run.platform === "ios" || run.platform === "browser"
      ? run.platform
      : undefined;
  const targetId = run.serial?.trim();
  if (!targetId || !platform) {
    throw new Error("This run has no reusable target identity and cannot be replayed safely");
  }
  return {
    recipe: run.action,
    ...(platform === "browser"
      ? { targetKind: "browser" as const, browserTargetId: targetId }
      : { targetKind: "device" as const, serial: targetId, platform }),
    targetProfile: run.targetProfile,
    title: `${run.title ?? run.action} · replay`,
    variables: structuredClone(run.resolvedInputs),
    recipeSnapshot: structuredClone(run.recipeSnapshot),
    recipeGraph: structuredClone(run.recipeGraph),
    projectId: run.projectId,
    ownerId: run.ownerId,
  };
}

export interface SessionJobFactoryOptions {
  findJob(id: string): TestJob | undefined;
  toTransport(job: TestJob): TestJob;
  attemptSeed?: number;
}

export function createSessionJob(
  input: EnqueueJobInput,
  { findJob, toTransport, attemptSeed = 1 }: SessionJobFactoryOptions,
): TestJob {
  const parent = input.retryOf ? findJob(input.retryOf) : undefined;
  const id = randomUUID();
  const targetKind = input.targetKind ?? parent?.targetKind ?? "device";
  const targetContext: TargetContext =
    targetKind === "browser"
      ? Object.freeze({
          kind: "browser" as const,
          platform: "browser" as const,
          targetId:
            input.browserTargetId?.trim() ||
            (parent?.targetContext.kind === "browser" ? parent.targetContext.targetId : "") ||
            input.serial?.trim() ||
            "",
        })
      : Object.freeze({
          kind: "device" as const,
          platform:
            input.platform ??
            parent?.platform ??
            inferDevicePlatformFromSerial(
              input.serial?.trim() ||
                (parent?.targetContext.kind === "device" ? parent.targetContext.serial : "") ||
                "",
            ) ??
            ("android" as const),
          serial:
            input.serial?.trim() ||
            (parent?.targetContext.kind === "device" ? parent.targetContext.serial : "") ||
            "",
        });
  const targetId = targetIdentity(targetContext);
  if (!targetId) throw new Error("Every Relay job requires an explicit target");
  const operationContext = currentOperationContext() ?? parent?.operationContext;
  const assignment = defaultTargetWorkerAssignment({
    targetId,
    platform: targetContext.platform,
    workerId: input.workerId ?? parent?.workerId,
    workerCapacity: input.workerCapacity ?? parent?.workerCapacity,
  });
  const baseJob = {
    id,
    projectId: input.projectId ?? parent?.projectId,
    ownerId: input.ownerId ?? parent?.ownerId,
    operationContext: operationContext
      ? Object.freeze(structuredClone(operationContext))
      : undefined,
    targetContext,
    serial: targetContext.kind === "device" ? targetContext.serial : undefined,
    deviceName: parent?.deviceName,
    platform: targetContext.kind === "device" ? targetContext.platform : ("android" as const),
    targetKind,
    browserTargetId: targetContext.kind === "browser" ? targetContext.targetId : undefined,
    targetProfile: input.targetProfile ?? parent?.targetProfile,
    workerId: assignment.workerId,
    workerCapacity: assignment.capacity,
    status: "queued" as const,
    queuedAt: now(),
    logs: [] as string[],
    attempts: parent ? parent.attempts + 1 : attemptSeed,
    retryOf: input.retryOf,
    previousError: parent?.error ?? parent?.previousError,
    steps: [] as TraceStep[],
    frames: [] as TraceFrameRef[],
    artifacts: [...(input.artifacts ?? [])] as {
      kind: string;
      capturedAt: number;
      data: unknown;
    }[],
    batchId: input.batchId ?? parent?.batchId,
    caseIndex: input.caseIndex ?? parent?.caseIndex,
    caseCount: input.caseCount ?? parent?.caseCount,
    resolvedInputs: Object.assign({}, parent?.resolvedInputs ?? input.variables),
    sensitiveInputNames: [
      ...new Set(parent?.sensitiveInputNames ?? input.sensitiveInputNames ?? []),
    ].sort((left, right) => left.localeCompare(right)),
    recipeSnapshot: structuredClone(input.recipeSnapshot ?? parent?.recipeSnapshot),
    recipeGraph: structuredClone(input.recipeGraph ?? parent?.recipeGraph),
    evidencePolicy: structuredClone(
      input.evidencePolicy ?? parent?.evidencePolicy ?? getEvidenceCollectionPolicy(),
    ),
    options: {
      prodAccountMatch: input.prodAccountMatch ?? parent?.options?.prodAccountMatch,
    },
  };

  // `action` remains the report/event label; every execution itself is a frozen recipe.
  const recipeId = input.recipe;
  const job: TestJob = {
    ...baseJob,
    action: recipeId,
    recipeId,
    glyphs: ["ai", "wait"],
    kind: "Replay",
    tone: "acc",
    title: input.title ?? recipeId,
  };
  Object.defineProperty(job, "toJSON", {
    enumerable: false,
    value: () => toTransport(job),
  });
  return job;
}
