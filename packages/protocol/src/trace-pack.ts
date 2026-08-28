import * as z from "zod/v4";

const sha256 = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const jsonValue: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(jsonValue),
    z.record(z.string(), jsonValue),
  ]),
);

export const tracePackObjectSchema = z
  .object({
    path: z
      .string()
      .min(1)
      .refine(
        (path) =>
          !path.startsWith("/") &&
          !path.includes("\\") &&
          path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== ".."),
        "object path must be a normalized relative path",
      ),
    kind: z.enum(["frozen-run", "frame", "artifact"]),
    mediaType: z.string().min(1),
    encoding: z.enum(["json", "base64"]),
    digest: sha256,
    bytes: z.number().int().nonnegative(),
    content: jsonValue,
  })
  .strict()
  .superRefine((object, context) => {
    if (object.encoding === "base64" && typeof object.content !== "string") {
      context.addIssue({ code: "custom", message: "base64 objects require string content" });
    }
    if (object.kind === "frozen-run" && object.encoding !== "json") {
      context.addIssue({ code: "custom", message: "the frozen run must use JSON encoding" });
    }
  });

const evidenceChannelStatus = z.enum([
  "captured",
  "partial",
  "unsupported",
  "denied",
  "failed",
  "redacted",
  "missing",
]);

const tracePackArtifactReferenceSchema = z
  .object({
    path: z.string().min(1).max(4096),
    status: z.enum(["embedded", "missing", "redacted"]),
    sources: z.array(z.string().min(1)).min(1).max(64).readonly(),
    channels: z.array(z.string().min(1)).max(16).readonly(),
    expectedBytes: z.number().int().nonnegative().optional(),
    objectPath: z.string().min(1).optional(),
    digest: sha256.optional(),
    bytes: z.number().int().nonnegative().optional(),
    mediaType: z.string().min(1).optional(),
    reason: z
      .enum([
        "not-found",
        "invalid-path",
        "not-a-file",
        "outside-run-directory",
        "byte-count-mismatch",
        "object-too-large",
        "pack-too-large",
        "changed-during-export",
        "redacted-channel",
        "external-reference-unresolved",
      ])
      .optional(),
  })
  .strict()
  .superRefine((reference, context) => {
    const normalized =
      !reference.path.startsWith("/") &&
      !reference.path.includes("\\") &&
      reference.path
        .split("/")
        .every((segment) => segment !== "" && segment !== "." && segment !== "..");
    if (reference.status === "embedded" && !normalized) {
      context.addIssue({
        code: "custom",
        message: "embedded artifact paths must be normalized and relative",
      });
    }
    const embeddedFields = [
      reference.objectPath,
      reference.digest,
      reference.bytes,
      reference.mediaType,
    ];
    if (reference.status === "embedded" && embeddedFields.some((field) => field === undefined)) {
      context.addIssue({
        code: "custom",
        message: "embedded artifact references require objectPath, digest, bytes, and mediaType",
      });
    }
    if (reference.status !== "embedded" && reference.reason === undefined) {
      context.addIssue({
        code: "custom",
        message: "unembedded artifact references require a reason",
      });
    }
    if (reference.status !== "embedded" && embeddedFields.some((field) => field !== undefined)) {
      context.addIssue({
        code: "custom",
        message: "missing or redacted artifact references cannot claim embedded object metadata",
      });
    }
  });

export const tracePackSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("relay-trace-pack"),
    digest: sha256,
    createdAt: z.number().int().nonnegative(),
    source: z
      .object({
        runId: z.string().min(1),
        runSchemaVersion: z.number().int().positive(),
        status: z.string().min(1),
        action: z.string().min(1),
        inputDigest: z.string().regex(/^[a-f0-9]{64}$/u),
        writtenAt: z.number().int().nonnegative(),
      })
      .strict(),
    redaction: z
      .object({
        status: z.enum(["applied-at-persistence", "unknown"]),
        redactedChannels: z.array(z.string()).readonly(),
      })
      .strict(),
    completeness: z
      .object({
        status: z.enum(["complete", "partial"]),
        channels: z.record(z.string(), evidenceChannelStatus),
        missing: z.array(z.string()).readonly(),
        /** Added to schema v1 as an optional compatibility field. Packs
         * written before artifact closure remain readable; current exporters
         * always populate it. */
        artifacts: z.array(tracePackArtifactReferenceSchema).max(10_000).readonly().optional(),
      })
      .strict(),
    objects: z.array(tracePackObjectSchema).min(1).max(10_001).readonly(),
  })
  .strict();

const proofStatementSchema = z
  .object({
    code: z.string().min(1),
    statement: z.string().min(1),
    evidence: z.array(sha256).readonly(),
  })
  .strict();

const unknownStatementSchema = z
  .object({
    code: z.string().min(1),
    statement: z.string().min(1),
    resolution: z.string().min(1),
  })
  .strict();

const recomputedStatementSchema = z
  .object({
    code: z.literal("CURRENT_SELECTOR_MATCHER"),
    algorithm: z.literal("semantic-activation-v1"),
    checkId: z.string().min(1),
    status: z.enum(["supports-recorded", "changed", "blocked", "unavailable"]),
    /** Deterministic fraction of frozen semantic selectors resolved by this
     * matcher. It describes old evidence only, never future target success. */
    robustness: z.number().min(0).max(1),
    statement: z.string().min(1),
    evidence: z.array(sha256).min(1).readonly(),
    requiresLiveVerification: z.literal(true),
  })
  .strict();

export const tracePackOfflineAnalysisSchema = z
  .object({
    schemaVersion: z.literal(1),
    mode: z.literal("trace-pack-offline-analysis"),
    tracePackDigest: sha256,
    sourceRunId: z.string().min(1),
    historicalVerdict: z.enum(["proved", "failed", "insufficient-evidence"]),
    futureTransitionVerdict: z.literal("unknown"),
    proved: z.array(proofStatementSchema).readonly(),
    /** Additive Replay Lab output. Older v1 analyses without this field remain readable. */
    recomputed: z.array(recomputedStatementSchema).readonly().optional(),
    unknown: z.array(unknownStatementSchema).min(1).readonly(),
    smallestLiveVerification: z
      .object({
        kind: z.enum(["replay-check", "replay-frozen-test", "recapture-frozen-plan"]),
        reason: z.string().min(1),
        checkId: z.string().min(1).optional(),
        requiresTarget: z.literal(true),
      })
      .strict(),
  })
  .strict();

export const tracePackExportResponseSchema = z
  .object({ tracePack: tracePackSchema, analysis: tracePackOfflineAnalysisSchema })
  .strict();

export type TracePackObject = z.output<typeof tracePackObjectSchema>;
export type TracePackArtifactReference = z.output<typeof tracePackArtifactReferenceSchema>;
export type TracePack = z.output<typeof tracePackSchema>;
export type TracePackOfflineAnalysis = z.output<typeof tracePackOfflineAnalysisSchema>;
export type TracePackExportResponse = z.output<typeof tracePackExportResponseSchema>;

export function parseTracePack(value: unknown): TracePack {
  return tracePackSchema.parse(value);
}

export function parseTracePackExportResponse(value: unknown): TracePackExportResponse {
  return tracePackExportResponseSchema.parse(value);
}
