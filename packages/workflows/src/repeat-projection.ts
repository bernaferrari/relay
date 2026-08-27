import type { CombineCampaign } from "@relay/protocol";
import type {
  FrozenRepeatTestIdentity,
  RepeatOutcomeCounts,
  RepeatTestSnapshot,
  WorkflowProblem,
  WorkflowRef,
} from "./types.js";
import type { RepeatWorkflowReference } from "./workflow-ref.js";

type SelectedRepeatResult = CombineCampaign["cases"][number];

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    new Set(left).size === right.length &&
    left.every((id) => right.includes(id))
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
  const results = selected as SelectedRepeatResult[];
  const executionIds = record.execution?.selectedCellIds;
  if (!executionIds || !sameValues(executionIds, reference.selectedCaseIds)) {
    throw new TypeError("The selected Repeat scope no longer matches its frozen identity.");
  }
  const selectedValues = record.execution?.selected?.[frozen.over.dimensionId];
  if (!selectedValues || !sameValues(selectedValues, frozen.over.valueIds)) {
    throw new TypeError("The selected Repeat values no longer match their frozen identity.");
  }
  const campaignTargetMatches = targetMatches(record.target, frozen);
  for (const item of results) {
    const entries = Object.entries(item.values);
    if (
      item.testId !== frozen.testId ||
      entries.length !== 1 ||
      entries[0]?.[0] !== frozen.over.dimensionId ||
      !frozen.over.valueIds.includes(entries[0]?.[1] ?? "") ||
      (!campaignTargetMatches && !targetMatches(item.target, frozen))
    ) {
      throw new TypeError(
        "A selected Repeat result no longer matches the frozen Test, value, or target.",
      );
    }
  }
  const valueIds = results.map((item) => item.values[frozen.over.dimensionId]!);
  if (!sameValues(valueIds, frozen.over.valueIds)) {
    throw new TypeError("The durable Repeat does not contain each selected value exactly once.");
  }
  const pilots = results.filter((item) => item.phase === "pilot");
  if (pilots.length !== 1 || pilots[0]?.jobId !== reference.pilotJobId) {
    throw new TypeError("The durable Repeat does not identify exactly one matching pilot.");
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

function version(record: CombineCampaign, results: readonly SelectedRepeatResult[]): string {
  return `repeat-v1-${fingerprint(
    JSON.stringify([
      record.id,
      record.status,
      record.updatedAt,
      ...results.flatMap((item) => [item.cellId, item.status, item.jobId, item.error]),
    ]),
  )}`;
}

function problem(
  input: Omit<WorkflowProblem, "retryable"> & { retryable?: boolean },
): WorkflowProblem {
  return { ...input, retryable: input.retryable ?? false };
}

export function snapshotFromRepeatRecord(input: {
  ref: WorkflowRef;
  reference: RepeatWorkflowReference;
  record: CombineCampaign;
}): RepeatTestSnapshot {
  const { ref, reference, record } = input;
  const results = selectedRepeatResults(record, reference);
  const outcome = counts(results);
  const pilot = results.find((item) => item.phase === "pilot")!;
  let phase: RepeatTestSnapshot["phase"];
  let stage: RepeatTestSnapshot["stage"];
  let label: string;
  let actions: RepeatTestSnapshot["allowedNextActions"];
  let problems: WorkflowProblem[] = [];

  if (pilot.status === "pending") {
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
    ref,
    frozen: reference.frozen,
    repeat: { id: reference.repeatId, pilotJobId: reference.pilotJobId },
    outcomes: outcome,
    progress: { label, completed, total: outcome.selected },
    allowedNextActions: actions,
    problems,
    evidenceRefs: [],
  };
}
