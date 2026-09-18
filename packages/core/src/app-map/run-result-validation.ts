import type { AppMapScope, RunReference, TargetResultReference } from "./model.js";
import { assertTargetProfile } from "./validation-shapes.js";
import { appMapFail } from "./errors.js";
import { assertEntity } from "./entity-validation.js";
import {
  finiteTimestamp,
  identifier,
  objectValue,
  safeInteger,
  stringArray,
} from "./validation-primitives.js";

export function assertRun(run: RunReference, scope: AppMapScope, label: string): void {
  assertEntity(run, scope, label);
  if (run.flowId !== undefined) identifier(run.flowId, `${label}.flowId`);
  safeInteger(run.appMapRevision, `${label}.appMapRevision`);
  stringArray(run.targetResultIds, `${label}.targetResultIds`);
  finiteTimestamp(run.startedAt, `${label}.startedAt`);
  if (run.finishedAt !== undefined) {
    finiteTimestamp(run.finishedAt, `${label}.finishedAt`);
    if (run.finishedAt < run.startedAt)
      appMapFail("invalid-map", `${label}.finishedAt cannot precede startedAt`);
  }
}

export function assertTargetResult(
  result: TargetResultReference,
  scope: AppMapScope,
  label: string,
): void {
  assertEntity(result, scope, label);
  identifier(result.runId, `${label}.runId`);
  assertTargetProfile(result.targetProfile, `${label}.targetProfile`);
  if (
    !(["passed", "product-failure", "harness-failure", "uncertain", "cancelled"] as const).includes(
      result.outcome,
    )
  )
    appMapFail("invalid-map", `${label}.outcome is unsupported`);
  if (result.connectionId !== undefined) identifier(result.connectionId, `${label}.connectionId`);
  if (result.connectionObservations !== undefined) {
    if (!Array.isArray(result.connectionObservations)) {
      appMapFail("invalid-map", `${label}.connectionObservations must be an array`);
    }
    result.connectionObservations.forEach((observation, index) => {
      const item = `${label}.connectionObservations[${index}]`;
      objectValue(observation, item);
      identifier(observation.connectionId, `${item}.connectionId`);
      if (observation.outcome !== "passed" && observation.outcome !== "failed") {
        appMapFail("invalid-map", `${item}.outcome is unsupported`);
      }
      safeInteger(observation.durationMs, `${item}.durationMs`);
      finiteTimestamp(observation.observedAt, `${item}.observedAt`);
    });
  }
  stringArray(result.evidenceIds, `${label}.evidenceIds`);
  if (result.finishedAt !== undefined) finiteTimestamp(result.finishedAt, `${label}.finishedAt`);
}
