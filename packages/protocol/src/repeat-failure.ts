import * as z from "zod/v4";

/**
 * The small set of failure families that are useful when reviewing a Repeat.
 * A family is deliberately about the observed cause, not the locale or the
 * target cell: those fields belong to the member rows in a cluster.
 */
export const repeatFailureKindSchema = z.enum([
  "causal",
  "visual",
  "localization",
  "network",
  "crash",
]);

export type RepeatFailureKind = z.infer<typeof repeatFailureKindSchema>;

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

/** Stable digest of normalized immutable evidence. Run and cell ids are not
 * part of the digest, so equivalent cases can be reviewed together. */
export const repeatFailureSignatureSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: repeatFailureKindSchema,
    digest: sha256Schema,
    /** Human-readable, canonicalized basis for the digest. */
    key: z.string().min(1).max(4_096),
    summary: z.string().min(1).max(512),
    failureCategory: z
      .enum([
        "environment",
        "target-state",
        "locator",
        "action",
        "completion",
        "extraction",
        "deterministic-assertion",
        "semantic-assertion",
        "visual-assertion",
        "judge-uncertainty",
        "review-required",
        "harness-defect",
      ])
      .optional(),
    checkIds: z.array(z.string().min(1).max(256)).max(100).readonly(),
  })
  .strict();

export type RepeatFailureSignature = z.output<typeof repeatFailureSignatureSchema>;

export const repeatFailureDecisionSchema = z
  .object({
    status: z.enum(["pending", "approved", "rejected"]),
    reason: z.string().min(1).max(2_000),
    decidedAt: z.number().finite().optional(),
  })
  .strict();

export type RepeatFailureDecision = z.output<typeof repeatFailureDecisionSchema>;

/** One case keeps its own evidence and review decision even when it shares a
 * signature with many sibling locales. */
export const repeatFailureClusterCaseSchema = z
  .object({
    cellId: z.string().min(1).max(256),
    runId: z.string().min(1).max(256),
    priorRunIds: z.array(z.string().min(1).max(256)).max(100).readonly(),
    values: z.record(z.string().min(1).max(256), z.string().max(4_096)),
    world: z.string().max(4_096),
    targetProfileId: z.string().min(1).max(256),
    status: z.enum(["failed", "blocked", "cancelled"]),
    signature: repeatFailureSignatureSchema,
    evidenceRefs: z.array(z.string().min(1).max(4_096)).max(128).readonly(),
    decision: repeatFailureDecisionSchema.optional(),
  })
  .strict();

export type RepeatFailureClusterCase = z.output<typeof repeatFailureClusterCaseSchema>;

export const repeatFailureClusterSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1).max(512),
    kind: repeatFailureKindSchema,
    signature: repeatFailureSignatureSchema,
    cohort: z.string().min(1).max(256),
    representativeCellId: z.string().min(1).max(256),
    representativeRunId: z.string().min(1).max(256),
    cases: z.array(repeatFailureClusterCaseSchema).min(1).max(1_000).readonly(),
  })
  .strict();

export type RepeatFailureCluster = z.output<typeof repeatFailureClusterSchema>;

export const repeatFailureClusterReportSchema = z
  .object({
    schemaVersion: z.literal(1),
    campaignId: z.string().min(1).max(256),
    clusters: z.array(repeatFailureClusterSchema).max(1_000).readonly(),
  })
  .strict();

export type RepeatFailureClusterReport = z.output<typeof repeatFailureClusterReportSchema>;
