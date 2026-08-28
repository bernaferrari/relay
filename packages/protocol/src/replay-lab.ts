import * as z from "zod/v4";
import { tracePackComparisonSchema } from "./trace-pack-comparison.js";
import { tracePackVisualLocalizationSchema } from "./trace-pack-visual-localization.js";

const sha256 = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

export const replayLabAnalysisSchema = z.enum(["compare", "visual-localization", "all"]);

const replayLabHypothesisSchema = z
  .object({
    rank: z.number().int().min(1).max(32),
    priority: z.number().int().min(1).max(100),
    kind: z.enum([
      "evidence-gap",
      "reachability-change",
      "matcher-change",
      "visual-change",
      "localization-finding",
    ]),
    classification: z.enum(["historically-observed", "recomputed-signal", "unknowable"]),
    statement: z.string().min(1),
    evidence: z.array(sha256).min(1).max(64).readonly(),
    requiresLiveVerification: z.literal(true),
  })
  .strict();

const replayLabLiveExperimentSchema = z
  .object({
    source: z.enum(["comparison", "visual-localization"]),
    classification: z.literal("live-verification-required"),
    kind: z.enum([
      "replay-check",
      "replay-frozen-test",
      "recapture-frozen-plan",
      "recapture-required-evidence",
      "recapture-frame-evidence",
      "recapture-semantic-evidence",
    ]),
    tracePackDigest: sha256,
    checkId: z.string().min(1).optional(),
    reason: z.string().min(1),
    requiresTarget: z.literal(true),
  })
  .strict();

/** Bounded product projection over immutable local TracePacks. It deliberately
 * carries no repair command or future-device verdict. */
export const replayLabReportSchema = z
  .object({
    schemaVersion: z.literal(1),
    mode: z.literal("relay-replay-lab"),
    analysis: replayLabAnalysisSchema,
    tracePackCount: z.number().int().min(2).max(64),
    comparison: tracePackComparisonSchema.optional(),
    visualLocalization: tracePackVisualLocalizationSchema.optional(),
    hypotheses: z.array(replayLabHypothesisSchema).max(32).readonly(),
    smallestLiveExperiment: replayLabLiveExperimentSchema,
    futureTransitionVerdict: z.literal("unknown"),
    repairPolicy: z
      .object({ mutation: z.literal("none"), requiresReview: z.literal(true) })
      .strict(),
  })
  .strict()
  .superRefine((report, context) => {
    if (report.analysis !== "visual-localization" && !report.comparison) {
      context.addIssue({ code: "custom", message: "comparison output is required" });
    }
    if (report.analysis !== "compare" && !report.visualLocalization) {
      context.addIssue({ code: "custom", message: "visual/localization output is required" });
    }
    if (report.analysis === "compare" && report.visualLocalization) {
      context.addIssue({ code: "custom", message: "compare output cannot include visual output" });
    }
    if (report.analysis === "visual-localization" && report.comparison) {
      context.addIssue({ code: "custom", message: "visual output cannot include comparison" });
    }
  });

export type ReplayLabAnalysis = z.output<typeof replayLabAnalysisSchema>;
export type ReplayLabReport = z.output<typeof replayLabReportSchema>;

export function parseReplayLabReport(value: unknown): ReplayLabReport {
  return replayLabReportSchema.parse(value);
}
