import { randomUUID } from "node:crypto";
import type { ExecutionTargetRef, TargetProfile } from "@relay/protocol";
import { appMapCombineCellExecutionIntentArtifactKind } from "./app-map-combine-cell-intent.js";
import type { PreparedAppMapCombineCell } from "./app-map-combine-cell-prepare.js";
import { digestAppMapTestExecutionValue } from "./app-map-test-execution-intent.js";
import { currentOperationContext, type OperationContext } from "./operation-context.js";
import { prepareJobBatch, type EnqueueJobInput, type TestJob } from "./session.js";

type QueuedCombineCellTarget = Extract<
  ExecutionTargetRef,
  { kind: "local-device" | "local-browser" }
>;

function legacyTarget(input: {
  targetId?: string;
  platform?: "android" | "ios" | "browser";
  targetKind?: "device" | "browser";
  browserTargetId?: string;
}): QueuedCombineCellTarget {
  const targetId =
    input.targetKind === "browser"
      ? input.browserTargetId?.trim() || input.targetId?.trim()
      : input.targetId?.trim();
  if (!targetId) throw new Error("Combine enqueue requires an explicit target");
  if (input.targetKind === "browser" || input.platform === "browser") {
    return {
      schemaVersion: 1,
      kind: "local-browser",
      provider: { key: "relay.local.browser", scope: "local" },
      targetId,
      platform: "browser",
      identity: { kind: "browser-target", value: targetId },
    };
  }
  if (input.platform !== "android" && input.platform !== "ios") {
    throw new Error("Combine device enqueue requires an Android or iOS platform");
  }
  return {
    schemaVersion: 1,
    kind: "local-device",
    provider: { key: "relay.local.agent-device", scope: "local" },
    targetId,
    platform: input.platform,
    identity: { kind: "device-serial", value: targetId },
  };
}

function enqueueInputForTarget(
  target: QueuedCombineCellTarget,
): Pick<EnqueueJobInput, "serial" | "platform" | "targetKind" | "browserTargetId"> {
  if (target.kind === "local-browser") {
    return { targetKind: "browser", browserTargetId: target.targetId };
  }
  return { targetKind: "device", serial: target.targetId, platform: target.platform };
}

export type EnqueuePreparedAppMapCombineCellsInput = {
  cells: PreparedAppMapCombineCell[];
  batchId?: string;
  title?: string;
  /** Legacy one-target fallback. New callers bind targets per cell. */
  targetId?: string;
  platform?: "android" | "ios" | "browser";
  targetKind?: "device" | "browser";
  browserTargetId?: string;
  targetForCell?: (cell: PreparedAppMapCombineCell) => QueuedCombineCellTarget;
  /** Isolated per-cell lease provenance for all-or-nothing multi-target admission. */
  operationContextForCell?: (
    cell: PreparedAppMapCombineCell,
    target: QueuedCombineCellTarget,
  ) => OperationContext | undefined;
  queuedTargetProfile?: (
    cell: PreparedAppMapCombineCell,
    target: QueuedCombineCellTarget,
  ) => TargetProfile | undefined;
  projectId?: string;
  ownerId?: string;
};

export type StagedAppMapCombineCellBatch = {
  batchId: string;
  jobs: TestJob[];
  activate(): TestJob[];
  dispatch(): TestJob[];
  commit(): TestJob[];
  rollback(): void;
};

/** Stage all durable assignments before a campaign record makes any cell
 * dispatchable. A route can persist its campaign, then commit exactly once. */
export function stagePreparedAppMapCombineCells(
  input: EnqueuePreparedAppMapCombineCellsInput,
): StagedAppMapCombineCellBatch {
  const batchId = input.batchId?.trim() || randomUUID();
  const operation = currentOperationContext();
  const projectId = input.projectId?.trim() || operation?.projectId || "default";
  const ownerId = input.ownerId?.trim() || operation?.actorId;
  const title = input.title?.trim() || "Combine";
  const inputs = input.cells.map((cell, index) => {
    const target =
      input.targetForCell?.(cell) ??
      legacyTarget({
        targetId: input.targetId,
        platform: input.platform,
        targetKind: input.targetKind,
        browserTargetId: input.browserTargetId,
      });
    const queuedAt = Date.now();
    const enqueue: EnqueueJobInput = {
      recipe: cell.recipeSnapshot.id,
      title: `${title} · ${cell.worldLabel} · ${cell.testName}`,
      ...enqueueInputForTarget(target),
      // Persist the canonical provider-neutral binding alongside legacy target fields.
      // The job factory verifies they agree before the job becomes durable.
      executionTarget: structuredClone(target),
      targetProfile: input.queuedTargetProfile?.(cell, target),
      variables: cell.wrapperInputs,
      recipeSnapshot: cell.recipeSnapshot,
      recipeGraph: cell.recipeGraph,
      batchId,
      caseIndex: index,
      caseCount: input.cells.length,
      projectId,
      ownerId,
      artifacts: [
        {
          kind: appMapCombineCellExecutionIntentArtifactKind,
          capturedAt: queuedAt,
          data: cell.outerIntent,
        },
        {
          kind: "app-map-test-plan",
          capturedAt: queuedAt,
          data: cell.childIntent.plan,
        },
        {
          kind: "app-map-test-preflight",
          capturedAt: queuedAt,
          data: {
            schemaVersion: 1,
            runtimeTargetProfile: structuredClone(cell.selectedRuntimeTargetProfile),
            report: structuredClone(cell.childIntent.preflight),
          },
        },
        {
          kind: "frozen-inputs",
          capturedAt: queuedAt,
          data: {
            kind: "combine-cell",
            cellId: cell.cellId,
            testId: cell.testId,
            values: cell.values,
            targetProfileId: cell.targetProfileId,
            executionTarget: target,
            outerIntentDigest: cell.outerIntent.digest,
            childIntentDigest: digestAppMapTestExecutionValue(cell.childIntent),
            wrapperGraphDigest: cell.outerIntent.wrapper.recipeGraphDigest,
            staticInputDigest: digestAppMapTestExecutionValue(cell.staticInputs),
          },
        },
      ],
    };
    const operationContext = input.operationContextForCell?.(cell, target);
    return { input: enqueue, ...(operationContext ? { operationContext } : {}) };
  });
  const staged = prepareJobBatch(inputs);
  return {
    batchId,
    jobs: staged.jobs,
    activate: staged.activate,
    dispatch: staged.dispatch,
    commit: staged.commit,
    rollback: staged.rollback,
  };
}

export function enqueuePreparedAppMapCombineCells(input: EnqueuePreparedAppMapCombineCellsInput): {
  batchId: string;
  jobs: TestJob[];
} {
  const staged = stagePreparedAppMapCombineCells(input);
  return { batchId: staged.batchId, jobs: staged.commit() };
}

export function combineCampaignCaseFromPreparedCell(
  cell: PreparedAppMapCombineCell,
  input: {
    index: number;
    phase: "pilot" | "coverage";
    status: "pending" | "queued";
    jobId?: string;
  },
) {
  return {
    index: input.index,
    cellId: cell.cellId,
    testId: cell.testId,
    world: cell.worldLabel,
    values: cell.values,
    targetProfileId: cell.targetProfileId,
    target: structuredClone(cell.executionTarget),
    childIntentDigest: digestAppMapTestExecutionValue(cell.childIntent),
    outerIntentDigest: cell.outerIntent.digest,
    wrapperGraphDigest: cell.outerIntent.wrapper.recipeGraphDigest,
    staticInputDigest: digestAppMapTestExecutionValue(cell.staticInputs),
    phase: input.phase,
    status: input.status,
    ...(input.jobId ? { jobId: input.jobId } : {}),
  };
}
