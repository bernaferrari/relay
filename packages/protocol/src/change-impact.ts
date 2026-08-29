import * as z from "zod/v4";
import {
  changeVerificationBuildSchema,
  changeVerificationChangeSchema,
  changeVerificationPolicySchema,
  changeVerificationSelectionSchema,
  frozenVerificationTargetCaseSchema,
  verificationCellSchema,
} from "./change-verification.js";

const identifier = z.string().trim().min(1).max(256);
const boundedText = z.string().trim().min(1).max(4_096);
const signalValue = z.string().trim().min(1).max(1_024);
const repositoryValue = signalValue.refine(
  (value) =>
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.split("/").some((segment) => segment === ".."),
  "must be a repository-relative value without parent traversal",
);

export const CHANGE_SIGNAL_KINDS = [
  "files",
  "symbols",
  "routes",
  "resources",
  "localizationKeys",
  "apiContracts",
] as const;

const changeSignalValuesSchema = z.array(signalValue).max(2_048).readonly();

export const changeSignalsSchema = z
  .object({
    files: z.array(repositoryValue).max(2_048).readonly(),
    symbols: changeSignalValuesSchema,
    routes: changeSignalValuesSchema,
    resources: changeSignalValuesSchema,
    localizationKeys: changeSignalValuesSchema,
    apiContracts: changeSignalValuesSchema,
  })
  .strict()
  .superRefine((signals, context) => {
    for (const kind of CHANGE_SIGNAL_KINDS) {
      if (new Set(signals[kind]).size !== signals[kind].length) {
        context.addIssue({ code: "custom", path: [kind], message: "must not contain duplicates" });
      }
    }
    if (CHANGE_SIGNAL_KINDS.every((kind) => signals[kind].length === 0)) {
      context.addIssue({ code: "custom", message: "at least one changed signal is required" });
    }
    if (CHANGE_SIGNAL_KINDS.reduce((total, kind) => total + signals[kind].length, 0) > 512) {
      context.addIssue({ code: "custom", message: "changed signals must be bounded to 512 items" });
    }
  });

export const journeyAssociationSchema = z
  .object({
    id: identifier,
    appMapId: identifier,
    testId: identifier,
    signals: changeSignalsSchema,
    confidence: z.enum(["definite", "probable"]),
    reason: boundedText,
    review: z
      .object({
        status: z.enum(["reviewed", "proposed", "revoked"]),
        revision: z.number().int().positive(),
        reviewedBy: identifier.optional(),
        reviewedAt: z.number().int().nonnegative().optional(),
      })
      .strict()
      .superRefine((review, context) => {
        if (
          review.status === "reviewed" &&
          (review.reviewedBy === undefined || review.reviewedAt === undefined)
        ) {
          context.addIssue({
            code: "custom",
            message: "reviewed associations require reviewer and review time",
          });
        }
        if (
          review.status !== "reviewed" &&
          (review.reviewedBy || review.reviewedAt !== undefined)
        ) {
          context.addIssue({
            code: "custom",
            message: "unreviewed associations cannot carry review authority",
          });
        }
      }),
  })
  .strict();

export const changeImpactJourneySchema = z
  .object({
    appMapId: identifier,
    testId: identifier,
    classification: z.enum(["definitely-affected", "probably-affected", "unrelated"]),
    reason: boundedText,
    associationIds: z.array(identifier).min(1).max(64).readonly(),
    matchedSignals: z
      .array(z.object({ kind: z.enum(CHANGE_SIGNAL_KINDS), value: signalValue }).strict())
      .max(256)
      .readonly(),
  })
  .strict();

export const changeCoverageGapSchema = z
  .object({
    code: z.enum([
      "unmapped-change",
      "unreviewed-association",
      "missing-target-case",
      "required-case-budget-exceeded",
    ]),
    reason: boundedText,
    signalKind: z.enum(CHANGE_SIGNAL_KINDS).optional(),
    signalValue: signalValue.optional(),
    associationId: identifier.optional(),
  })
  .strict();

export const changeImpactSchema = z
  .object({
    schemaVersion: z.literal(1),
    change: changeVerificationChangeSchema,
    changed: changeSignalsSchema,
    journeys: z.array(changeImpactJourneySchema).max(256).readonly(),
    coverageGaps: z.array(changeCoverageGapSchema).max(512).readonly(),
  })
  .strict()
  .superRefine((impact, context) => {
    const journeyKeys = impact.journeys.map(({ appMapId, testId }) => `${appMapId}\0${testId}`);
    if (new Set(journeyKeys).size !== journeyKeys.length) {
      context.addIssue({ code: "custom", path: ["journeys"], message: "must be unique" });
    }
  });

export const verificationPlanSchema = z
  .object({
    schemaVersion: z.literal(1),
    status: z.enum(["awaiting-build", "needs-review", "ready-for-approval"]),
    change: changeVerificationChangeSchema,
    impact: changeImpactSchema,
    builds: z.array(changeVerificationBuildSchema).max(32).readonly(),
    selection: changeVerificationSelectionSchema,
    policy: changeVerificationPolicySchema,
    pilotTargetCaseId: identifier.optional(),
    pilotCellId: identifier.optional(),
    expansion: z
      .object({
        /** Explicitly materialized required cells; targetCaseIds remains a
         * compatibility projection for historical plan consumers. */
        cellIds: z.array(identifier).max(1_000).readonly().optional(),
        targetCaseIds: z.array(identifier).max(250).readonly(),
        maxCases: z.number().int().positive().max(10_000),
        maxDurationMs: z.number().int().positive().max(86_400_000),
        conditions: z
          .tuple([
            z.literal("pilot-passed"),
            z.literal("evidence-complete"),
            z.literal("no-unreconciled-input"),
          ])
          .readonly(),
      })
      .strict(),
    coverageGaps: z.array(changeCoverageGapSchema).max(512).readonly(),
  })
  .strict()
  .superRefine((plan, context) => {
    if (plan.impact.change.headSha !== plan.change.headSha) {
      context.addIssue({ code: "custom", path: ["impact"], message: "must bind the exact change" });
    }
    if (plan.builds.some((build) => build.sourceSha !== plan.change.headSha)) {
      context.addIssue({
        code: "custom",
        path: ["builds"],
        message: "every build must bind to the exact headSha",
      });
    }
    if (new Set(plan.builds.map(({ id }) => id)).size !== plan.builds.length) {
      context.addIssue({ code: "custom", path: ["builds"], message: "ids must be unique" });
    }
    const targetIds = new Set(plan.selection.targetCases.map(({ id }) => id));
    if (targetIds.size !== plan.selection.targetCases.length) {
      context.addIssue({
        code: "custom",
        path: ["selection", "targetCases"],
        message: "ids must be unique",
      });
    }
    if (plan.pilotTargetCaseId && !targetIds.has(plan.pilotTargetCaseId)) {
      context.addIssue({
        code: "custom",
        path: ["pilotTargetCaseId"],
        message: "must name a frozen target case",
      });
    }
    const cellIds = new Set(plan.selection.cells?.map(({ id }) => id) ?? []);
    if (plan.pilotCellId && !cellIds.has(plan.pilotCellId)) {
      context.addIssue({
        code: "custom",
        path: ["pilotCellId"],
        message: "must name a materialized Verification Cell",
      });
    }
    if (plan.expansion.targetCaseIds.some((id) => !targetIds.has(id))) {
      context.addIssue({
        code: "custom",
        path: ["expansion", "targetCaseIds"],
        message: "must contain only frozen target cases",
      });
    }
    if (plan.expansion.cellIds) {
      if (plan.expansion.cellIds.some((id) => !cellIds.has(id))) {
        context.addIssue({
          code: "custom",
          path: ["expansion", "cellIds"],
          message: "must contain only materialized Verification Cells",
        });
      }
      const expectedCellIds = plan.selection.cells?.slice(1).map(({ id }) => id) ?? [];
      if (JSON.stringify(plan.expansion.cellIds) !== JSON.stringify(expectedCellIds)) {
        context.addIssue({
          code: "custom",
          path: ["expansion", "cellIds"],
          message: "must preserve the frozen pilot-first cell order",
        });
      }
      if (new Set(plan.expansion.cellIds).size !== plan.expansion.cellIds.length) {
        context.addIssue({
          code: "custom",
          path: ["expansion", "cellIds"],
          message: "must not contain duplicates",
        });
      }
    }
    if (new Set(plan.expansion.targetCaseIds).size !== plan.expansion.targetCaseIds.length) {
      context.addIssue({
        code: "custom",
        path: ["expansion", "targetCaseIds"],
        message: "must not contain duplicates",
      });
    }
    const pilot = plan.selection.targetCases.find(({ id }) => id === plan.pilotTargetCaseId);
    if (pilot && !pilot.required) {
      context.addIssue({
        code: "custom",
        path: ["pilotTargetCaseId"],
        message: "must name a policy-required target case",
      });
    }
    const selectedJourneyKeys = plan.selection.affectedJourneys
      .map(({ appMapId, testId, confidence }) => `${appMapId}\0${testId}\0${confidence}`)
      .sort();
    const impactedJourneyKeys = plan.impact.journeys
      .filter(({ classification }) => classification !== "unrelated")
      .map(
        ({ appMapId, testId, classification }) =>
          `${appMapId}\0${testId}\0${classification === "definitely-affected" ? "definite" : "probable"}`,
      )
      .sort();
    if (JSON.stringify(selectedJourneyKeys) !== JSON.stringify(impactedJourneyKeys)) {
      context.addIssue({
        code: "custom",
        path: ["selection", "affectedJourneys"],
        message: "must equal the explained affected journeys",
      });
    }
    const gapKeys = new Set(plan.coverageGaps.map((gap) => JSON.stringify(gap)));
    if (plan.impact.coverageGaps.some((gap) => !gapKeys.has(JSON.stringify(gap)))) {
      context.addIssue({
        code: "custom",
        path: ["coverageGaps"],
        message: "must retain every change-impact coverage gap",
      });
    }
    if (
      plan.status === "ready-for-approval" &&
      (!plan.builds.length ||
        plan.coverageGaps.length ||
        !plan.selection.cells?.length ||
        !plan.pilotCellId)
    ) {
      context.addIssue({
        code: "custom",
        message: "a plan is ready only with exact builds and no coverage gaps",
      });
    }
  });

export type ChangeSignals = z.output<typeof changeSignalsSchema>;
export type JourneyAssociation = z.output<typeof journeyAssociationSchema>;
export type ChangeImpact = z.output<typeof changeImpactSchema>;
export type ChangeCoverageGap = z.output<typeof changeCoverageGapSchema>;
export type VerificationPlan = z.output<typeof verificationPlanSchema>;
export type VerificationPlanTargetCase = z.output<typeof frozenVerificationTargetCaseSchema>;
export type VerificationPlanCell = z.output<typeof verificationCellSchema>;
