import * as z from "zod/v4";

/**
 * A persisted, provider-neutral join from one runtime trace occurrence to the
 * authored Test step that produced it. `traceStepId` remains an opaque source
 * reference; consumers select by `testStepId` and use the evidence references
 * below rather than inferring identity from a generated trace UUID.
 */
export const runTestStepEvidenceSchema = z
  .object({
    schemaVersion: z.literal(1),
    testStepId: z.string().min(1),
    recipeId: z.string().min(1),
    recipeStepId: z.string().min(1),
    traceStepId: z.string().min(1),
    traceStepIndex: z.number().int().nonnegative(),
    /** One-based occurrence for repeated execution of an authored step. */
    occurrence: z.number().int().positive(),
    evidence: z
      .object({
        /** Relative frame paths owned by the persisted Run. */
        framePaths: z.array(z.string().min(1)).readonly(),
        /** EvidenceManifest event sequence numbers associated with the trace. */
        eventSequences: z.array(z.number().int().positive()).readonly(),
        /** Kinds of Run artifacts explicitly carrying this trace step id. */
        artifactKinds: z.array(z.string().min(1)).readonly(),
      })
      .strict(),
  })
  .strict();

export type RunTestStepEvidence = z.output<typeof runTestStepEvidenceSchema>;

export function parseRunTestStepEvidence(value: unknown): RunTestStepEvidence {
  return runTestStepEvidenceSchema.parse(value);
}

/**
 * Parse the additive field on a persisted Run. A malformed optional field is
 * discarded by the compatibility boundary instead of making an otherwise
 * readable historical Run unreadable.
 */
export function parseOptionalRunTestStepEvidence(
  value: unknown,
): RunTestStepEvidence[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return undefined;
  const parsed: RunTestStepEvidence[] = [];
  for (const item of value) {
    try {
      parsed.push(parseRunTestStepEvidence(item));
    } catch {
      return undefined;
    }
  }
  return parsed;
}
