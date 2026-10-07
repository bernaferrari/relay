import { randomUUID } from "node:crypto";
import {
  canonicalAppMapTestTupleIdentity,
  type BrowserAuthenticationHealth,
  type ExecutionTargetRef,
  type SourceRevision,
  type TargetProfile,
} from "@relay/protocol";
import { appMapCombineCellExecutionIntentArtifactKind } from "./app-map-combine-cell-intent.js";
import type { PreparedAppMapCombineCell } from "./app-map-combine-cell-prepare.js";
import { digestAppMapTestExecutionValue } from "./app-map-test-execution-intent.js";
import { PLAYER_MAP_SNAPSHOT_ARTIFACT_KIND, type PlayerMapSnapshot } from "./player-manifest.js";
import { currentOperationContext, type OperationContext } from "./operation-context.js";
import { prepareJobBatch, type EnqueueJobInput, type TestJob } from "./session.js";
import { requirePreparedCombineCellInputs } from "./app-map-combine-cell-inputs.js";

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
  /** Saved Repeat definition. Optional only for legacy/ad-hoc internal callers. */
  combineId?: string;
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
  /** Frozen at enqueue time into every cell manifest as audit provenance. */
  sourceRevision?: SourceRevision;
  /** Distinct unsigned Lane so signed-out Combine cells can overlap another unsigned Lane. */
  unsignedLaneId?: string;
  /** Invoked Lane, including fixture Lanes that omit unsignedLaneId. */
  laneId?: string;
  authenticationHealth?: BrowserAuthenticationHealth;
  playerMapSnapshot?: PlayerMapSnapshot;
  referenceReviewMode?: import("@relay/protocol").CaptureReferenceReviewMode;
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
  requirePreparedCombineCellInputs(input.cells);
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
    const caseIdentity = canonicalAppMapTestTupleIdentity({
      appMapId: cell.childIntent.sourcePlan.appMapId,
      testId: cell.testId,
      values: cell.values,
    });
    const enqueue: EnqueueJobInput = {
      recipe: cell.recipeSnapshot.id,
      ...(input.referenceReviewMode ? { referenceReviewMode: input.referenceReviewMode } : {}),
      title: `${title} · ${cell.worldLabel} · ${cell.testName}`,
      ...enqueueInputForTarget(target),
      // Persist the canonical provider-neutral binding alongside legacy target fields.
      // The job factory verifies they agree before the job becomes durable.
      executionTarget: structuredClone(target),
      targetProfile: input.queuedTargetProfile?.(cell, target),
      ...(input.laneId ? { laneId: input.laneId } : {}),
      ...(input.unsignedLaneId ? { unsignedLaneId: input.unsignedLaneId } : {}),
      ...(input.authenticationHealth
        ? { authenticationHealth: structuredClone(input.authenticationHealth) }
        : {}),
      ...(input.sourceRevision ? { sourceRevision: structuredClone(input.sourceRevision) } : {}),
      // Wrapper steps reference generated prefixes ({{v0_…}}, {{v0_…_label}});
      // without these inputs every template stays literal and the appLocale
      // step fails its BCP-47 check before control begins.
      variables: { ...cell.runtimeInputs?.variables, ...cell.wrapperInputs },
      sensitiveInputNames: cell.runtimeInputs?.sensitiveInputNames,
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
        ...(input.playerMapSnapshot
          ? [
              {
                kind: PLAYER_MAP_SNAPSHOT_ARTIFACT_KIND,
                capturedAt: queuedAt,
                data: structuredClone(input.playerMapSnapshot),
              },
            ]
          : []),
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
            ...(cell.childIntent.frozenInputs
              ? { inputs: structuredClone(cell.childIntent.frozenInputs) }
              : {}),
            ...caseIdentity,
            ...(input.combineId ? { combineId: input.combineId } : {}),
            world: cell.worldLabel,
            cellId: cell.cellId,
            targetProfileId: cell.targetProfileId,
            /** Audit: `explicit` per-cell binding, or `inherited` from the
             * only saved profile matching this cell's concrete target. */
            targetProfileIdSource: cell.targetProfileIdSource,
            executionTarget: target,
            /** Stable timing cohort identity. Wrapper recipe ids can change
             * when a Combine world is recompiled, so duration admission keys
             * completed runs to the immutable App Map Test instead. */
            durationCohortAction: `app-map:${cell.childIntent.sourcePlan.appMapId}:test:${cell.testId}`,
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

export function unrecordedPreparedCombineReason(
  cell: Pick<PreparedAppMapCombineCell, "plan">,
): string | undefined {
  const reason = cell.plan.omittedSteps?.[0]?.reason?.trim();
  if (!reason) return undefined;
  if (/No recorded (?:Web|Android|iOS) route/u.test(reason)) return reason;
  if (cell.plan.performance.executableOperations > 0) return undefined;
  return reason;
}

export function queueablePreparedCombineCells<T extends Pick<PreparedAppMapCombineCell, "plan">>(
  cells: readonly T[],
): T[] {
  return cells.filter((cell) => !unrecordedPreparedCombineReason(cell));
}

export function combineCampaignCaseFromPreparedCell(
  cell: PreparedAppMapCombineCell,
  input: {
    index: number;
    phase: "pilot" | "coverage";
    status: "pending" | "queued" | "blocked";
    jobId?: string;
  },
) {
  const unrecorded = unrecordedPreparedCombineReason(cell);
  return {
    index: input.index,
    cellId: cell.cellId,
    ...(cell.executionCaseId ? { executionCaseId: cell.executionCaseId } : {}),
    testId: cell.testId,
    world: cell.worldLabel,
    values: cell.values,
    targetProfileId: cell.targetProfileId,
    target: structuredClone(cell.executionTarget),
    plannedCaptures: structuredClone(cell.childIntent.plan.plannedSlots ?? []),
    ...(cell.childIntent.frozenInputs
      ? { frozenInputs: structuredClone(cell.childIntent.frozenInputs) }
      : {}),
    childIntentDigest: digestAppMapTestExecutionValue(cell.childIntent),
    outerIntentDigest: cell.outerIntent.digest,
    wrapperGraphDigest: cell.outerIntent.wrapper.recipeGraphDigest,
    staticInputDigest: digestAppMapTestExecutionValue(cell.staticInputs),
    phase: input.phase,
    status: unrecorded ? ("blocked" as const) : input.status,
    ...(unrecorded ? { error: `UNSUPPORTED_PLATFORM: ${unrecorded}` } : {}),
    ...(input.jobId ? { jobId: input.jobId } : {}),
  };
}
