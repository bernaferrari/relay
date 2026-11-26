import * as z from "zod/v4";

const sha256 = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

export const offlineFactClassificationSchema = z.enum([
  "historically-proved",
  "historically-failed",
  "recomputable",
  "live-verification-required",
  "unknowable",
]);

const factSchema = z
  .object({
    classification: offlineFactClassificationSchema,
    statement: z.string().min(1),
    evidence: z.array(sha256).min(1).readonly(),
  })
  .strict();

const packSummarySchema = z
  .object({
    ordinal: z.number().int().nonnegative(),
    tracePackDigest: sha256,
    sourceRunId: z.string().min(1),
    historicalVerdict: z.enum(["proved", "failed", "insufficient-evidence"]),
    classification: z.enum(["historically-proved", "historically-failed", "unknowable"]),
    completeness: z.enum(["complete", "partial"]),
  })
  .strict();

const testIdentityEntrySchema = z
  .object({
    tracePackDigest: sha256,
    planDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    appMapId: z.string().min(1).optional(),
    appMapRevision: z.number().int().nonnegative().optional(),
    testId: z.string().min(1).optional(),
    testName: z.string().min(1).optional(),
  })
  .strict();

const testIdentityComparisonSchema = z
  .object({
    status: z.enum(["common", "changed", "unavailable"]),
    fact: factSchema,
    entries: z.array(testIdentityEntrySchema).min(2).max(64).readonly(),
  })
  .strict();

const requiredPathSchema = z
  .object({
    originScreenId: z.string().min(1),
    destinationScreenId: z.string().min(1),
  })
  .strict();

const reachabilityObservationSchema = z
  .object({
    tracePackDigest: sha256,
    historicalState: z.enum(["proved", "failed", "unproved", "absent"]),
    path: requiredPathSchema.optional(),
  })
  .strict();

const requiredPathComparisonSchema = z
  .object({
    checkId: z.string().min(1),
    title: z.string().min(1),
    observations: z.array(reachabilityObservationSchema).min(2).max(64).readonly(),
    path: z
      .object({
        status: z.enum(["unchanged", "changed", "not-provable"]),
        fact: factSchema,
      })
      .strict(),
    reachability: z
      .object({
        status: z.enum([
          "unchanged-proved",
          "unchanged-failed",
          "regressed",
          "improved",
          "changed",
          "not-provable",
        ]),
        fact: factSchema,
      })
      .strict(),
  })
  .strict();

const matcherObservationSchema = z
  .object({
    tracePackDigest: sha256,
    status: z.enum(["supports-recorded", "changed", "blocked", "unavailable"]),
    robustness: z.number().min(0).max(1),
    evidence: z.array(sha256).min(1).readonly(),
  })
  .strict();

const matcherDeltaSchema = z
  .object({
    algorithm: z.literal("semantic-activation-v1"),
    checkId: z.string().min(1),
    status: z.enum(["unchanged", "changed", "not-comparable"]),
    fact: factSchema,
    observations: z.array(matcherObservationSchema).min(1).max(64).readonly(),
    requiresLiveVerification: z.literal(true),
  })
  .strict();

const completenessGapSchema = z
  .object({
    tracePackDigest: sha256,
    missing: z.array(z.string().min(1)).min(1).readonly(),
    fact: factSchema,
  })
  .strict();

const smallestLiveVerificationSchema = z
  .object({
    classification: z.literal("live-verification-required"),
    kind: z.enum([
      "replay-check",
      "replay-frozen-test",
      "recapture-frozen-plan",
      "recapture-required-evidence",
    ]),
    tracePackDigest: sha256,
    checkId: z.string().min(1).optional(),
    reason: z.string().min(1),
    requiresTarget: z.literal(true),
  })
  .strict();

/** Pure, portable comparison of an explicitly ordered TracePack history. */
export const tracePackComparisonSchema = z
  .object({
    schemaVersion: z.literal(1),
    mode: z.literal("trace-pack-offline-comparison"),
    orderedTracePacks: z.array(packSummarySchema).min(2).max(64).readonly(),
    testIdentity: testIdentityComparisonSchema,
    requiredPaths: z.array(requiredPathComparisonSchema).max(10_000).readonly(),
    matcherDeltas: z.array(matcherDeltaSchema).max(10_000).readonly(),
    completenessGaps: z.array(completenessGapSchema).max(64).readonly(),
    futureTransitionVerdict: z.literal("unknown"),
    smallestLiveVerification: smallestLiveVerificationSchema,
    repairPolicy: z
      .object({ mutation: z.literal("none"), requiresReview: z.literal(true) })
      .strict(),
  })
  .strict();

export type OfflineFactClassification = z.output<typeof offlineFactClassificationSchema>;
export type TracePackComparison = z.output<typeof tracePackComparisonSchema>;

export function parseTracePackComparison(value: unknown): TracePackComparison {
  return tracePackComparisonSchema.parse(value);
}
