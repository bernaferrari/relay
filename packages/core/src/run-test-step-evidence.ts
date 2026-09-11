import { parseAppMapCombineCellExecutionIntentArtifact } from "./app-map-combine-cell-intent.js";
import { parseAppMapTestExecutionIntentArtifact } from "./app-map-test-execution-intent.js";
import type { AppMapTestStepProvenance, EvidenceEvent, RunTestStepEvidence } from "@relay/protocol";
import { parseRunTestStepEvidence } from "@relay/protocol";
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
      const framePaths = [
        ...new Set(
          trace.frames
            .map((frame) => nonEmpty(frame.path))
            .filter((path): path is string => path !== undefined),
        ),
      ];
      const eventSequences = [
        ...new Set(
          (input.events ?? [])
            .filter((event) => event.stepId === trace.id && positiveInteger(event.sequence))
            .map((event) => event.sequence),
        ),
      ].sort((left, right) => left - right);
      const artifactKinds = [
        ...new Set(
          (input.artifacts ?? [])
            .filter((artifact) => traceArtifactStepId(artifact) === trace.id)
            .map((artifact) => nonEmpty(artifact.kind))
            .filter((kind): kind is string => kind !== undefined),
        ),
      ];
      // The parser is the final boundary for this additive persisted shape;
      // malformed user-controlled provenance never becomes a trusted link.
      result.push(
        parseRunTestStepEvidence({
          schemaVersion: 1,
          testStepId: item.testStepId,
          recipeId: item.recipeId,
          recipeStepId: item.recipeStepId,
          traceStepId: trace.id,
          traceStepIndex: trace.index,
          occurrence,
          evidence: { framePaths, eventSequences, artifactKinds },
        }),
      );
    }
  }
  return result;
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
