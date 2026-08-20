import { randomUUID } from "node:crypto";
import type { TargetProfile } from "@relay/protocol";
import { appMapCombineCellExecutionIntentArtifactKind } from "./app-map-combine-cell-intent.js";
import type { PreparedAppMapCombineCell } from "./app-map-combine-cell-prepare.js";
import { digestAppMapTestExecutionValue } from "./app-map-test-execution-intent.js";
import { currentOperationContext } from "./operation-context.js";
import { enqueueJob, type EnqueueJobInput, type TestJob } from "./session.js";

export function enqueuePreparedAppMapCombineCells(input: {
  cells: PreparedAppMapCombineCell[];
  batchId?: string;
  title?: string;
  targetId: string;
  platform?: "android" | "ios" | "browser";
  targetKind?: "device" | "browser";
  browserTargetId?: string;
  queuedTargetProfile?: (cell: PreparedAppMapCombineCell) => TargetProfile | undefined;
  projectId?: string;
  ownerId?: string;
}): { batchId: string; jobs: TestJob[] } {
  const batchId = input.batchId?.trim() || randomUUID();
  const operation = currentOperationContext();
  const projectId = input.projectId?.trim() || operation?.projectId || "default";
  const ownerId = input.ownerId?.trim() || operation?.actorId;
  const title = input.title?.trim() || "Combine";
  const jobs = input.cells.map((cell, index) => {
    const queuedAt = Date.now();
    const enqueue: EnqueueJobInput = {
      recipe: cell.recipeSnapshot.id,
      title: `${title} · ${cell.worldLabel} · ${cell.testName}`,
      serial: input.targetKind === "browser" ? undefined : input.targetId,
      platform: input.platform === "browser" ? undefined : input.platform,
      targetKind: input.targetKind ?? "device",
      browserTargetId: input.browserTargetId,
      targetProfile: input.queuedTargetProfile?.(cell),
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
            outerIntentDigest: cell.outerIntent.digest,
            childIntentDigest: digestAppMapTestExecutionValue(cell.childIntent),
            wrapperGraphDigest: cell.outerIntent.wrapper.recipeGraphDigest,
            staticInputDigest: digestAppMapTestExecutionValue(cell.staticInputs),
          },
        },
      ],
    };
    return enqueueJob(enqueue);
  });
  return { batchId, jobs };
}

export function combineCampaignCaseFromPreparedCell(
  cell: PreparedAppMapCombineCell,
  input: { index: number; phase: "pilot" | "coverage"; status: "pending" | "queued"; jobId?: string },
) {
  return {
    index: input.index,
    cellId: cell.cellId,
    testId: cell.testId,
    world: cell.worldLabel,
    values: cell.values,
    targetProfileId: cell.targetProfileId,
    childIntentDigest: digestAppMapTestExecutionValue(cell.childIntent),
    outerIntentDigest: cell.outerIntent.digest,
    wrapperGraphDigest: cell.outerIntent.wrapper.recipeGraphDigest,
    staticInputDigest: digestAppMapTestExecutionValue(cell.staticInputs),
    phase: input.phase,
    status: input.status,
    ...(input.jobId ? { jobId: input.jobId } : {}),
  };
}
