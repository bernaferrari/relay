import type { CombineCampaign } from "@relay/protocol";
import type {
  FrozenRepeatTestIdentity,
  RepeatOutcomeCounts,
  RepeatTestSnapshot,
  RepeatValueResult,
  DurableWorkflowHandle,
  WorkflowProblem,
  WorkflowRef,
} from "./types.js";
import type { RepeatWorkflowReference } from "./workflow-ref.js";

type SelectedRepeatResult = CombineCampaign["cases"][number];

const provingRunEvidenceError = "Relay is still proving immutable Run evidence for this result.";

function isTerminalResult(status: SelectedRepeatResult["status"]): boolean {
  return (
    status === "passed" || status === "failed" || status === "blocked" || status === "cancelled"
  );
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    new Set(left).size === right.length &&
    left.every((id) => right.includes(id))
  );
}

function sameSelection(
  actual: Record<string, string[]> | undefined,
  frozen: FrozenRepeatTestIdentity,
): boolean {
  if (!actual) return false;
  const expected = frozen.resolved.dimensions;
  const actualIds = Object.keys(actual);
  return (
    actualIds.length === expected.length &&
    expected.every(
      (dimension, index) =>
        actualIds[index] === dimension.id &&
        sameValues(actual[dimension.id] ?? [], dimension.valueIds),
    )
  );
}

function targetMatches(
  target: CombineCampaign["target"] | SelectedRepeatResult["target"],
  frozen: FrozenRepeatTestIdentity,
): boolean {
  if (!target) return false;
  if ("id" in target) {
    return (
      target.id === frozen.target.targetId &&
      target.kind === frozen.target.kind &&
      target.platform === frozen.target.platform
    );
  }
  return target.targetId === frozen.target.targetId && target.platform === frozen.target.platform;
}

/** Validate every durable identity needed to continue exactly the work the
 * pilot established. Error copy is outcome-oriented because it may be shown
 * directly in a public workflow problem. */
export function selectedRepeatResults(
  record: CombineCampaign,
  reference: RepeatWorkflowReference,
): SelectedRepeatResult[] {
  const { frozen } = reference;
  if (
    record.id !== reference.repeatId ||
    record.appMapId !== frozen.appMapId ||
    record.sourceRevision !== frozen.executionAppMapRevision
  ) {
    throw new TypeError("The durable Repeat identity no longer matches the frozen Test revision.");
  }
  const byId = new Map(record.cases.map((item) => [item.cellId, item]));
  const selected = reference.selectedCaseIds.map((id) => byId.get(id));
  if (selected.some((item) => !item)) {
    throw new TypeError("A selected Repeat result is missing from durable execution state.");
  }
  const results = (selected as SelectedRepeatResult[]).map((item) =>
    isTerminalResult(item.status) && !item.runId
      ? {
          ...item,
          status: "running" as const,
          error: provingRunEvidenceError,
        }
      : item,
  );
  const executionIds = record.execution?.selectedCellIds;
  if (!executionIds || !sameValues(executionIds, reference.selectedCaseIds)) {
    throw new TypeError("The selected Repeat scope no longer matches its frozen identity.");
  }
  if (
    record.execution?.strategy !== frozen.resolved.strategy ||
    !sameSelection(record.execution?.selected, frozen)
  ) {
    throw new TypeError("The selected Repeat values no longer match their frozen identity.");
  }
  const campaignTargetMatches = targetMatches(record.target, frozen);
  for (const item of results) {
    const entries = Object.entries(item.values);
    if (
      item.testId !== frozen.testId ||
      entries.length !== frozen.resolved.dimensions.length ||
      frozen.resolved.dimensions.some(
        (dimension, index) =>
          entries[index]?.[0] !== dimension.id ||
          !dimension.valueIds.includes(entries[index]?.[1] ?? ""),
      ) ||
      (!campaignTargetMatches && !targetMatches(item.target, frozen))
    ) {
      throw new TypeError(
        "A selected Repeat result no longer matches the frozen Test, value, or target.",
      );
    }
  }
  const tupleKeys = results.map((item) =>
    frozen.resolved.dimensions.map((dimension) => item.values[dimension.id]).join("\u0000"),
  );
  if (new Set(tupleKeys).size !== tupleKeys.length) {
    throw new TypeError("The durable Repeat contains a duplicate selected case tuple.");
  }
  const pilots = results.filter((item) => item.phase === "pilot");
  if (pilots.length !== 1 || pilots[0]?.jobId !== reference.pilotJobId) {
    throw new TypeError("The durable Repeat does not identify exactly one matching pilot.");
  }
  const requestedPilot = frozen.resolved.pilot;
  if (requestedPilot.mode === "specified") {
    if (
      frozen.resolved.dimensions.some(
        (dimension) => pilots[0]!.values[dimension.id] !== requestedPilot.case[dimension.id],
      )
    ) {
      throw new TypeError("The durable Repeat pilot no longer matches the specified case tuple.");
    }
  }
  return results;
}

function fingerprint(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

function counts(results: readonly SelectedRepeatResult[]): RepeatOutcomeCounts {
  const output: RepeatOutcomeCounts = {
    selected: results.length,
    observed: 0,
    untouched: 0,
    running: 0,
    passed: 0,
    failed: 0,
    needsReview: 0,
    cancelled: 0,
  };
  for (const result of results) {
    if (result.status === "pending") output.untouched += 1;
    else output.observed += 1;
    if (result.status === "queued" || result.status === "running") output.running += 1;
    else if (result.status === "passed") output.passed += 1;
    else if (result.status === "failed") output.failed += 1;
    else if (result.status === "blocked") output.needsReview += 1;
    else if (result.status === "cancelled") output.cancelled += 1;
  }
  return output;
}

function valueResults(results: readonly SelectedRepeatResult[]): RepeatValueResult[] {
  return results.map((result) => ({
    cellId: result.cellId,
    values: { ...result.values },
    phase: result.phase === "pilot" ? "pilot" : "remaining",
    status:
      result.status === "pending"
        ? "untouched"
        : result.status === "queued" || result.status === "running"
          ? "running"
          : result.status === "blocked"
            ? "needs-review"
            : result.status,
    ...(result.runId ? { runId: result.runId } : {}),
    ...(result.error ? { error: result.error } : {}),
  }));
}

function version(record: CombineCampaign, results: readonly SelectedRepeatResult[]): string {
  return `repeat-v1-${fingerprint(
    JSON.stringify([
      record.id,
      record.status,
      record.updatedAt,
      ...results.flatMap((item) => [
        item.cellId,
        item.status,
        item.jobId,
        item.error,
        ...(item.priorRunIds ?? []),
      ]),
    ]),
  )}`;
}

function problem(
  input: Omit<WorkflowProblem, "retryable"> & { retryable?: boolean },
): WorkflowProblem {
  return { ...input, retryable: input.retryable ?? false };
}

export function snapshotFromRepeatRecord(input: {
  ref?: WorkflowRef;
  workflow?: DurableWorkflowHandle;
  reference: RepeatWorkflowReference;
  record: CombineCampaign;
}): RepeatTestSnapshot {
  const { ref, workflow, reference, record } = input;
  const results = selectedRepeatResults(record, reference);
  const outcome = counts(results);
  const pilot = results.find((item) => item.phase === "pilot")!;
  let phase: RepeatTestSnapshot["phase"];
  let stage: RepeatTestSnapshot["stage"];
  let label: string;
  let actions: RepeatTestSnapshot["allowedNextActions"];
  let problems: WorkflowProblem[] = [];
  const provingRunEvidence = results.some((item) => item.error === provingRunEvidenceError);
  const resumeMode = reference.frozen.resolved.resume;
  const reviewableTerminalResults = results.filter(
    (item) =>
      item.status === "failed" ||
      (resumeMode === "all" && (item.status === "blocked" || item.status === "cancelled")),
  );

  if (provingRunEvidence) {
    phase = "running";
    stage = pilot.error === provingRunEvidenceError ? "pilot" : "remaining";
    label = "Proving immutable Run evidence";
    actions = ["inspect", "cancel"];
  } else if (pilot.status === "pending") {
    phase = "needs-attention";
    stage = "unknown";
    label = "Relay cannot prove that the representative case started";
    actions = ["inspect", "cancel"];
    problems = [
      problem({
        code: "unexpected-authoring-state",
        title: "The representative case has no proved outcome",
        detail: "Durable execution state still marks the representative case as untouched.",
        recovery: "Inspect again or cancel this Repeat. Do not continue unproved work.",
      }),
    ];
  } else if (record.status === "pilot-running") {
    phase = "running";
    stage = "pilot";
    label = "Running one representative case";
    actions = ["inspect", "cancel"];
  } else if (record.status === "ready-to-resume" && pilot.status === "passed") {
    phase = "paused";
    stage = "awaiting-continuation";
    label = "Representative case passed · review before continuing";
    actions = ["inspect", "continue", "cancel"];
  } else if (record.status === "needs-review" && outcome.untouched > 0) {
    phase = "needs-attention";
    stage = "awaiting-continuation";
    label = "Representative case needs review before continuing";
    actions = ["inspect", "confirm-and-continue", "cancel"];
    problems = [
      problem({
        code: "operation-unavailable",
        title: "The representative case needs an explicit review decision",
        detail:
          "Relay will leave the remaining selected values untouched until a person confirms the observed result.",
        recovery:
          "Review the representative evidence, then explicitly confirm and continue or cancel.",
        retryable: true,
      }),
    ];
  } else if (record.status === "running") {
    phase = "running";
    stage = "remaining";
    label = "Running the remaining selected values";
    actions = ["inspect", "cancel"];
  } else if (record.status === "completed") {
    phase = "succeeded";
    stage = "complete";
    label = "Repeat completed";
    actions = ["inspect"];
  } else if (record.status === "completed-with-problems") {
    if (resumeMode !== "untouched" && reviewableTerminalResults.length) {
      phase = "needs-attention";
      stage = "awaiting-continuation";
      label = "Review non-passing results before retrying";
      actions = ["inspect", "confirm-and-continue", "cancel"];
      problems = [
        problem({
          code: "operation-unavailable",
          title: "Retry requires an explicit evidence review",
          detail: `${reviewableTerminalResults.length} immutable Run result${reviewableTerminalResults.length === 1 ? " is" : "s are"} eligible under the saved ${resumeMode} resume policy.`,
          recovery:
            "Inspect those Runs, then explicitly confirm and continue to retry only eligible results.",
          retryable: true,
        }),
      ];
    } else {
      phase = "failed";
      stage = "complete";
      label = "Repeat completed with problems";
      actions = ["inspect"];
      problems = [
        problem({
          code: "operation-unavailable",
          title: "Some selected values did not pass",
          detail: "Inspect the failed and review-required results before accepting this change.",
          recovery: "Inspect evidence and start a new Repeat after repairs when needed.",
        }),
      ];
    }
  } else if (record.status === "cancelled") {
    phase = "cancelled";
    stage = "complete";
    label = "Repeat cancelled";
    actions = ["inspect"];
  } else {
    phase = "needs-attention";
    stage = "unknown";
    label = "Relay cannot prove the next Repeat action";
    actions = ["inspect", "cancel"];
    problems = [
      problem({
        code: "unexpected-authoring-state",
        title: "The representative case is not proved safe to continue",
        detail: `The durable Repeat reports ${record.status} with a ${pilot.status} representative result.`,
        recovery:
          "Inspect or cancel this Repeat. Start new work only after the state is understood.",
      }),
    ];
  }

  const completed = outcome.passed + outcome.failed + outcome.needsReview + outcome.cancelled;
  return {
    schemaVersion: 1,
    kind: "repeat-test",
    title: `Repeat ${reference.frozen.testId}`,
    phase,
    stage,
    version: version(record, results),
    ...(workflow ? { workflow } : {}),
    ...(ref ? { ref } : {}),
    frozen: reference.frozen,
    repeat: { id: reference.repeatId },
    outcomes: outcome,
    results: valueResults(results),
    progress: { label, completed, total: outcome.selected },
    allowedNextActions: actions,
    problems,
    evidenceRefs: results.flatMap((result) =>
      [...(result.priorRunIds ?? []), ...(result.runId ? [result.runId] : [])].map((id) => ({
        kind: "run" as const,
        id,
      })),
    ),
  };
}
