import type { ProductRunExecutionIdentity, ProductRunSummary } from "@relay/product/catalog";

const attentionOutcomes = new Set([
  "product-failure",
  "harness-failure",
  "uncertain",
  "needs-review",
]);

/** Keep actionable evidence until a later, comparable successful execution
 * proves that the same frozen configuration no longer fails. */
export function homeAttentionRuns(runs: readonly ProductRunSummary[]): ProductRunSummary[] {
  const actionable = runs.filter((run) => attentionOutcomes.has(run.outcome ?? run.phase));
  const resolved = actionable.filter(
    (failure) =>
      !runs.some(
        (candidate) =>
          isSuccessful(candidate) &&
          isLater(candidate, failure) &&
          comparableExecution(candidate.executionIdentity, failure.executionIdentity),
      ),
  );
  const latestByExecution = new Map<string, ProductRunSummary>();
  for (const run of [...resolved].sort((left, right) => runTime(right) - runTime(left))) {
    const key = executionIdentityKey(run.executionIdentity) ?? `run:${run.id}`;
    if (!latestByExecution.has(key)) latestByExecution.set(key, run);
  }
  return [...latestByExecution.values()];
}

function isSuccessful(run: ProductRunSummary): boolean {
  return run.phase === "completed" && run.outcome === "passed";
}

function isLater(candidate: ProductRunSummary, failure: ProductRunSummary): boolean {
  return runTime(candidate) > runTime(failure);
}

function comparableExecution(
  left: ProductRunExecutionIdentity | undefined,
  right: ProductRunExecutionIdentity | undefined,
): boolean {
  if (!left || !right) return false;
  const keys = [
    "appMapId",
    "testId",
    "appMapRevision",
    "sourceRevision",
    "buildId",
    "targetProfileId",
    "platform",
    "deviceId",
    "dataSetId",
    "accountId",
  ] as const;
  const known = keys.filter((key) => left[key] !== undefined || right[key] !== undefined);
  // A missing fact is unresolved evidence. It cannot authorize supersession.
  const hasFrozenRevision = left.appMapRevision !== undefined && right.appMapRevision !== undefined;
  const hasTestIdentity =
    left.appMapId !== undefined &&
    right.appMapId !== undefined &&
    left.testId !== undefined &&
    right.testId !== undefined;
  const hasTargetIdentity =
    left.platform !== undefined &&
    right.platform !== undefined &&
    (left.targetProfileId !== undefined || left.deviceId !== undefined) &&
    (right.targetProfileId !== undefined || right.deviceId !== undefined);
  if (
    !hasTestIdentity ||
    !hasFrozenRevision ||
    !hasTargetIdentity ||
    known.some((key) => left[key] === undefined || right[key] === undefined)
  ) {
    return false;
  }
  return known.every((key) => left[key] === right[key]);
}

function executionIdentityKey(
  identity: ProductRunExecutionIdentity | undefined,
): string | undefined {
  if (!identity || !comparableExecution(identity, identity)) return undefined;
  const keys = Object.keys(identity).sort();
  if (!keys.length) return undefined;
  if (keys.some((key) => identity[key as keyof ProductRunExecutionIdentity] === undefined)) {
    return undefined;
  }
  return JSON.stringify(
    keys.map((key) => [key, identity[key as keyof ProductRunExecutionIdentity]]),
  );
}

function runTime(run: ProductRunSummary): number {
  return run.finishedAt ?? run.startedAt ?? run.queuedAt;
}
