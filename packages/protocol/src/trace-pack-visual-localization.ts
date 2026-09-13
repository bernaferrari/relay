import * as z from "zod/v4";

const sha256 = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

const offlineFactSchema = z
  .object({
    classification: z.enum(["recomputable", "live-verification-required", "unknowable"]),
    statement: z.string().min(1),
    evidence: z.array(sha256).readonly(),
  })
  .strict();

const packFrameObservationSchema = z
  .object({
    tracePackDigest: sha256,
    status: z.enum(["embedded", "absent", "missing", "redacted"]),
    digest: sha256.optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    caption: z.string().optional(),
    semanticObservation: z.boolean(),
  })
  .strict();

const visualFrameDeltaSchema = z
  .object({
    canonicalKey: z.string().min(1),
    status: z.enum([
      "exact-match",
      "pixels-changed",
      "dimensions-changed",
      "presence-changed",
      "not-comparable",
    ]),
    captionStatus: z.enum(["unchanged", "changed", "unavailable"]),
    fact: offlineFactSchema,
    observations: z.array(packFrameObservationSchema).min(2).max(64).readonly(),
  })
  .strict();

const localizationFindingSchema = z
  .object({
    id: z.string().min(1),
    code: z.enum([
      "SCREEN_MISSING",
      "POSSIBLE_LOCALE_NOT_APPLIED",
      "CONTROL_MISSING",
      "POSSIBLE_UNTRANSLATED_TEXT",
      "POSSIBLE_TEXT_CLIPPED",
      "ACCOUNT_NEEDS_RELOGIN",
      "PRODUCT_ASSERTION",
      "HARNESS_FAILURE",
    ]),
    severity: z.enum(["critical", "warning"]),
    confidence: z.enum(["high", "medium"]),
    canonicalKey: z.string().min(1),
    screenLabel: z.string().min(1),
    locale: z.string().min(1),
    baselineLocale: z.string().min(1),
    stableKey: z.string().min(1).optional(),
    expected: z.string().optional(),
    observed: z.string().optional(),
    detail: z.string().min(1),
  })
  .strict();

const packSummarySchema = z
  .object({
    ordinal: z.number().int().nonnegative(),
    tracePackDigest: sha256,
    sourceRunId: z.string().min(1),
    locale: z.string().min(1).optional(),
    testKey: sha256.optional(),
    targetKey: sha256.optional(),
    sourceKey: sha256.optional(),
    frameCount: z.number().int().nonnegative(),
    embeddedFrames: z.number().int().nonnegative(),
    inspectedFrames: z.number().int().nonnegative(),
  })
  .strict();

/**
 * Portable visual and localization recomputation over verified TracePacks.
 * The result describes historical embedded evidence only. It cannot approve a
 * baseline, mutate a Test, or claim that a future target transition will pass.
 */
export const tracePackVisualLocalizationSchema = z
  .object({
    schemaVersion: z.literal(1),
    mode: z.literal("trace-pack-visual-localization-recomputation"),
    orderedTracePacks: z.array(packSummarySchema).min(2).max(64).readonly(),
    historicalBaseline: z
      .object({
        status: z.enum(["comparable", "not-comparable"]),
        locale: z.string().min(1).optional(),
        testKey: sha256.optional(),
        targetKey: sha256.optional(),
        frameCountStatus: z.enum(["unchanged", "changed", "unavailable"]),
        fact: offlineFactSchema,
        frames: z.array(visualFrameDeltaSchema).max(10_000).readonly(),
      })
      .strict(),
    localization: z
      .object({
        status: z.enum(["recomputed", "partial", "not-applicable", "insufficient-evidence"]),
        locales: z.array(z.string().min(1)).readonly(),
        baselineLocale: z.string().min(1).optional(),
        coverage: z
          .object({
            frames: z.number().int().nonnegative(),
            inspectedFrames: z.number().int().nonnegative(),
          })
          .strict(),
        findings: z.array(localizationFindingSchema).max(10_000).readonly(),
        fact: offlineFactSchema,
      })
      .strict(),
    sufficiency: z
      .object({
        visual: z.enum(["sufficient", "insufficient"]),
        localization: z.enum(["sufficient", "partial", "insufficient", "not-applicable"]),
        reasons: z.array(z.string().min(1)).readonly(),
      })
      .strict(),
    futureTransitionVerdict: z.literal("unknown"),
    smallestLiveVerification: z
      .object({
        classification: z.literal("live-verification-required"),
        kind: z.enum([
          "replay-frozen-test",
          "recapture-frame-evidence",
          "recapture-semantic-evidence",
        ]),
        tracePackDigest: sha256,
        reason: z.string().min(1),
        requiresTarget: z.literal(true),
      })
      .strict(),
    repairPolicy: z
      .object({ mutation: z.literal("none"), requiresReview: z.literal(true) })
      .strict(),
  })
  .strict();

export type TracePackVisualLocalization = z.output<typeof tracePackVisualLocalizationSchema>;

export function parseTracePackVisualLocalization(value: unknown): TracePackVisualLocalization {
  return tracePackVisualLocalizationSchema.parse(value);
}
