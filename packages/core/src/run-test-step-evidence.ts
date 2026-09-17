import { parseAppMapCombineCellExecutionIntentArtifact } from "./app-map-combine-cell-intent.js";
import { parseAppMapTestExecutionIntentArtifact } from "./app-map-test-execution-intent.js";
import type { AppMapTestStepProvenance, EvidenceEvent, RunTestStepEvidence } from "@relay/protocol";
import {
  captureReviewIdentityFramePaths,
  isCaptureReviewDestPhase,
  parseRunTestStepEvidence,
} from "@relay/protocol";
import type { TraceStep } from "./trace.js";

type RunArtifact = { kind: string; data: unknown };

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function validProvenance(value: AppMapTestStepProvenance): boolean {
  return (
    nonEmpty(value.recipeId) !== undefined &&
    Number.isSafeInteger(value.stepIndex) &&
    value.stepIndex >= 0 &&
    nonEmpty(value.recipeStepId) !== undefined &&
    nonEmpty(value.testId) !== undefined &&
    nonEmpty(value.testStepId) !== undefined
  );
}

function traceArtifactStepId(artifact: RunArtifact): string | undefined {
  return nonEmpty(record(artifact.data)?.stepId);
}

function artifactBelongsToTrace(artifact: RunArtifact, trace: TraceStep): boolean {
  const stepId = traceArtifactStepId(artifact);
  if (!stepId) return false;
  if (stepId === trace.id) return true;
  return artifact.kind === "capture-review" && stepId === nonEmpty(trace.recipeStepId);
}

function destPhaseReviews(
  artifacts: readonly RunArtifact[],
): Array<{ stepId: string; framePath: string }> {
  const dest: Array<{ stepId: string; framePath: string }> = [];
  for (const artifact of artifacts) {
    if (artifact.kind !== "capture-review") continue;
    const payload = record(artifact.data);
    if (!isCaptureReviewDestPhase(nonEmpty(payload?.phase))) continue;
    const stepId = nonEmpty(payload?.stepId);
    const framePath = nonEmpty(payload?.framePath);
    if (stepId && framePath) dest.push({ stepId, framePath });
  }
  return dest;
}

function evidenceForTrace(
  trace: TraceStep,
  item: Pick<AppMapTestStepProvenance, "testStepId" | "recipeId" | "recipeStepId">,
  occurrence: number,
  events: readonly Pick<EvidenceEvent, "sequence" | "stepId">[] | undefined,
  artifacts: readonly RunArtifact[],
): RunTestStepEvidence {
  const framePaths = [
    ...new Set(
      trace.frames
        .map((frame) => nonEmpty(frame.path))
        .filter((path): path is string => path !== undefined),
    ),
  ];
  const eventSequences = [
    ...new Set(
      (events ?? [])
        .filter((event) => event.stepId === trace.id && positiveInteger(event.sequence))
        .map((event) => event.sequence),
    ),
  ].sort((left, right) => left - right);
  const artifactKinds = [
    ...new Set(
      artifacts
        .filter((artifact) => artifactBelongsToTrace(artifact, trace))
        .map((artifact) => nonEmpty(artifact.kind))
        .filter((kind): kind is string => kind !== undefined),
    ),
  ];
  return parseRunTestStepEvidence({
    schemaVersion: 1,
    testStepId: item.testStepId,
    recipeId: item.recipeId,
    recipeStepId: item.recipeStepId,
    traceStepId: trace.id,
    traceStepIndex: trace.index,
    occurrence,
    evidence: { framePaths, eventSequences, artifactKinds },
  });
}

/** Dest wait-for identity is authored evidence. Leftover Close / Run saved Test
 * last-frame cannot fill dest-end Observe. */
function preferDestEndIdentityEvidence(
  items: readonly RunTestStepEvidence[],
  artifacts: readonly RunArtifact[],
): RunTestStepEvidence[] {
  const destFrames = new Set(captureReviewIdentityFramePaths(artifacts));
  if (destFrames.size === 0) return [...items];
  const destTestStepIds = new Set(
    items
      .filter((item) => item.evidence.framePaths.some((path) => destFrames.has(path)))
      .map((item) => item.testStepId),
  );
  if (destTestStepIds.size === 0) return [...items];
  return items.filter((item) => {
    if (!destTestStepIds.has(item.testStepId)) return true;
    if (item.evidence.framePaths.length === 0) return true;
    return item.evidence.framePaths.some((path) => destFrames.has(path));
  });
}

function joinDestPhaseTraces(input: {
  items: RunTestStepEvidence[];
  steps: readonly TraceStep[];
  provenance: readonly AppMapTestStepProvenance[];
  events?: readonly Pick<EvidenceEvent, "sequence" | "stepId">[];
  artifacts: readonly RunArtifact[];
  occurrenceByTestStep: Map<string, number>;
}): void {
  const have = new Set(input.items.flatMap((item) => item.evidence.framePaths));
  for (const dest of destPhaseReviews(input.artifacts)) {
    if (have.has(dest.framePath)) continue;
    const destTrace = input.steps.find(
      (trace) => nonEmpty(trace.recipeStepId) === dest.stepId && nonEmpty(trace.id),
    );
    if (!destTrace) continue;
    const recipeId = nonEmpty(destTrace.recipeId);
    const recipeStepId = nonEmpty(destTrace.recipeStepId);
    if (!recipeId || !recipeStepId) continue;
    const sibling =
      input.provenance.find(
        (item) =>
          validProvenance(item) && item.recipeId === recipeId && item.recipeStepId === recipeStepId,
      ) ?? input.provenance.find((item) => validProvenance(item) && item.recipeId === recipeId);
    if (!sibling) continue;
    const occurrence = (input.occurrenceByTestStep.get(sibling.testStepId) ?? 0) + 1;
    input.occurrenceByTestStep.set(sibling.testStepId, occurrence);
    const joined = evidenceForTrace(
      destTrace,
      { testStepId: sibling.testStepId, recipeId, recipeStepId },
      occurrence,
      input.events,
      input.artifacts,
    );
    input.items.push(joined);
    have.add(dest.framePath);
  }
}

/**
 * Project frozen execution-intent provenance onto observed runtime traces.
 * Matching uses explicit recipe and recipe-step identities carried by the
 * trace, never the generated trace UUID or an index-only heuristic.
 *
 * A trace can occur more than once (for example when a reusable branch or
 * repeat executes the same compiled step). Such occurrences remain separate
 * and receive a deterministic one-based occurrence number for their authored
 * Test step. Nested reusable recipes only appear when the runner emits an
 * explicit trace identity for them; this function deliberately does not
 * attribute a parent trace to child steps by assumption.
 */
export function projectRunTestStepEvidence(input: {
  steps: readonly TraceStep[];
  provenance: readonly AppMapTestStepProvenance[];
  events?: readonly Pick<EvidenceEvent, "sequence" | "stepId">[];
  artifacts?: readonly RunArtifact[];
}): RunTestStepEvidence[] {
  const provenanceByRecipeStep = new Map<string, AppMapTestStepProvenance[]>();
  for (const item of input.provenance) {
    if (!validProvenance(item)) continue;
    const key = `${item.recipeId}\u0000${item.recipeStepId}`;
    provenanceByRecipeStep.set(key, [...(provenanceByRecipeStep.get(key) ?? []), item]);
  }

  const occurrenceByTestStep = new Map<string, number>();
  const result: RunTestStepEvidence[] = [];
  for (const trace of input.steps) {
    const recipeId = nonEmpty(trace.recipeId);
    const recipeStepId = nonEmpty(trace.recipeStepId);
    if (!recipeId || !recipeStepId || !nonEmpty(trace.id)) continue;
    const matched = provenanceByRecipeStep.get(`${recipeId}\u0000${recipeStepId}`) ?? [];
    for (const item of matched) {
      const occurrence = (occurrenceByTestStep.get(item.testStepId) ?? 0) + 1;
      occurrenceByTestStep.set(item.testStepId, occurrence);
      result.push(evidenceForTrace(trace, item, occurrence, input.events, input.artifacts ?? []));
    }
  }
  joinDestPhaseTraces({
    items: result,
    steps: input.steps,
    provenance: input.provenance,
    events: input.events,
    artifacts: input.artifacts ?? [],
    occurrenceByTestStep,
  });
  return preferDestEndIdentityEvidence(result, input.artifacts ?? []);
}

/** Persisted leftover last-frame evidence yields dest wait-for when dest-phase
 * capture-review is on disk. Event sequences on other steps stay intact. */
export function overlayDestEndIdentityEvidence(input: {
  items: readonly RunTestStepEvidence[];
  steps: readonly TraceStep[];
  provenance: readonly AppMapTestStepProvenance[];
  artifacts?: readonly RunArtifact[];
}): RunTestStepEvidence[] {
  const artifacts = input.artifacts ?? [];
  const destFrames = new Set(captureReviewIdentityFramePaths(artifacts));
  if (destFrames.size === 0) return [...input.items];
  const projected = projectRunTestStepEvidence({
    steps: input.steps,
    provenance: input.provenance,
    artifacts,
  });
  const destItems = projected.filter((item) =>
    item.evidence.framePaths.some((path) => destFrames.has(path)),
  );
  const destTestStepIds = new Set(destItems.map((item) => item.testStepId));
  if (destTestStepIds.size === 0) return [...input.items];
  const kept = input.items.filter((item) => {
    if (!destTestStepIds.has(item.testStepId)) return true;
    if (item.evidence.framePaths.length === 0) return true;
    return item.evidence.framePaths.some((path) => destFrames.has(path));
  });
  const have = new Set(kept.flatMap((item) => item.evidence.framePaths));
  return [
    ...kept,
    ...destItems.filter((item) => item.evidence.framePaths.some((path) => !have.has(path))),
  ];
}

export function executionIntentPlannedSlots(
  artifacts: readonly { kind?: string; data?: unknown }[],
): import("@relay/protocol").CaptureReviewPlannedSlot[] | undefined {
  for (const artifact of artifacts) {
    if (artifact?.kind !== "app-map-test-execution-intent") continue;
    const slots = record(record(artifact.data)?.plan)?.plannedSlots;
    if (Array.isArray(slots)) {
      return slots as import("@relay/protocol").CaptureReviewPlannedSlot[];
    }
  }
  for (const artifact of artifacts) {
    if (artifact?.kind !== "app-map-combine-cell-execution-intent") continue;
    const slots = record(record(record(artifact.data)?.child)?.plan)?.plannedSlots;
    if (Array.isArray(slots)) {
      return slots as import("@relay/protocol").CaptureReviewPlannedSlot[];
    }
  }
  return undefined;
}

export function executionIntentProvenance(
  artifacts: readonly { kind: string; data: unknown }[],
): import("@relay/protocol").AppMapTestStepProvenance[] {
  const artifact = artifacts.find(
    (candidate) => candidate?.kind === "app-map-test-execution-intent",
  );
  if (artifact) return parseAppMapTestExecutionIntentArtifact(artifact)?.plan.stepProvenance ?? [];
  const cell = artifacts.find(
    (candidate) => candidate?.kind === "app-map-combine-cell-execution-intent",
  );
  return cell
    ? (parseAppMapCombineCellExecutionIntentArtifact(cell)?.child.plan.stepProvenance ?? [])
    : [];
}
