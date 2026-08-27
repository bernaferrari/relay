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
    kind: z.enum(["frozen-run", "frame"]),
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
      })
      .strict(),
    objects: z.array(tracePackObjectSchema).min(1).readonly(),
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

export const tracePackOfflineAnalysisSchema = z
  .object({
    schemaVersion: z.literal(1),
    mode: z.literal("trace-pack-offline-analysis"),
    tracePackDigest: sha256,
    sourceRunId: z.string().min(1),
    historicalVerdict: z.enum(["proved", "failed", "insufficient-evidence"]),
    futureTransitionVerdict: z.literal("unknown"),
    proved: z.array(proofStatementSchema).readonly(),
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
export type TracePack = z.output<typeof tracePackSchema>;
export type TracePackOfflineAnalysis = z.output<typeof tracePackOfflineAnalysisSchema>;
export type TracePackExportResponse = z.output<typeof tracePackExportResponseSchema>;

export function parseTracePack(value: unknown): TracePack {
  return tracePackSchema.parse(value);
}

export function parseTracePackExportResponse(value: unknown): TracePackExportResponse {
  return tracePackExportResponseSchema.parse(value);
}
