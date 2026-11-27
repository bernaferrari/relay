import { managedFixtureOutputSchemas } from "../managed-fixture.js";
import { savedSignInOperationOutputSchemas } from "../sign-in/saved-sign-in.js";
import { e2eOperationOutputSchemas } from "../e2e-project.js";
import type * as z from "zod/v4";
import { coreOperationOutputSchemas } from "../core-operation-output-schemas.js";
import { executionOperationOutputSchemas } from "../execution/execution-operation-output-schemas.js";
import { captureReviewOperationOutputSchemas } from "../capture/capture-review-output-schemas.js";
import { campaignCapacityOperationOutputSchemas } from "../campaign/campaign-capacity-operation-output-schemas.js";
import { runRepairOperationOutputSchemas } from "../run/run-repair-operation-output-schemas.js";
import { observationOperationOutputSchemas } from "../observation-operation-output-schemas.js";
import { workspaceTargetOperationOutputSchemas } from "../workspace/workspace-target-operation-output-schemas.js";
import { laneOperationOutputSchemas } from "../lane/lane-operation-schemas.js";
import { changeVerificationOperationOutputSchemas } from "../change/change-verification-operation-schemas.js";
import { proofSetupOperationOutputSchemas } from "../proof-setup.js";
import { targetDeviceControlOutputSchemas } from "../target/target-device-control-schemas.js";
import { tracePackExportResponseSchema } from "../trace/trace-pack.js";
import { walkthroughPackExportResponseSchema } from "../walkthrough/walkthrough-pack.js";
import { runPanelManifestSchema } from "../run/run-panel-manifest-schema.js";
import {
  authoringSessionListResponseSchema,
  authoringSessionResponseSchema,
  authoringRawOptimizationProposalResponseSchema,
} from "../authoring/authoring-session-schema.js";
import {
  appMapCombinePreflightSchema,
  appMapCompiledConnectionRunSchema,
  appMapCompiledFlowSchema,
  appMapCompiledTestSchema,
  appMapJobSummarySchema,
  appMapNativeCompanionCompileSchema,
  appMapRunMatrixSchema,
  offlineTestPreflightReportSchema,
} from "../app-map/app-map-compiled-plan-schema.js";
import {
  reviewedDocumentOriginInspectionSchema,
  reviewedDocumentOriginLedgerSchema,
  reviewedDocumentOriginProjectionSchema,
} from "../reviewed/reviewed-document-origin-schema.js";
import {
  appMapDocumentSchema,
  appMapVariableSchema,
  logicalScrollSurfaceSchema,
  screenConsolidationPreviewSchema,
  screenSchema,
  screenVariantSchema,
} from "../app-map/app-map-document-schema.js";
import * as zod from "zod/v4";
import { browserAccountPackQuoteSchema } from "../combine/combine-profile-target-schema.js";

const appMapEnvelopeSchema = zod.object({ appMap: appMapDocumentSchema }).strict();

/** Schema-first outputs for operation families that previously used OperationRecord. */
export const operationFamilyOutputSchemas = {
  ...workspaceTargetOperationOutputSchemas,
  ...managedFixtureOutputSchemas,
  ...savedSignInOperationOutputSchemas,
  ...laneOperationOutputSchemas,
  ...observationOperationOutputSchemas,
  ...executionOperationOutputSchemas,
  ...captureReviewOperationOutputSchemas,
  ...campaignCapacityOperationOutputSchemas,
  ...runRepairOperationOutputSchemas,
  ...changeVerificationOperationOutputSchemas,
  ...proofSetupOperationOutputSchemas,
  ...targetDeviceControlOutputSchemas,
  "run.trace-pack.get": tracePackExportResponseSchema,
  "run.walkthrough-pack.get": walkthroughPackExportResponseSchema,
  "run.panel-manifest.get": zod.object({ manifest: runPanelManifestSchema }).strict(),
  "authoring.session.list": authoringSessionListResponseSchema,
  "authoring.session.get": authoringSessionResponseSchema,
  "authoring.session.create": authoringSessionResponseSchema,
  "authoring.session.begin": authoringSessionResponseSchema,
  "authoring.session.observe": authoringSessionResponseSchema,
  "authoring.session.capture": authoringSessionResponseSchema,
  "authoring.session.start": authoringSessionResponseSchema,
  "authoring.session.interact": authoringSessionResponseSchema,
  "authoring.session.stop": authoringSessionResponseSchema,
  "authoring.take.optimization.get": authoringRawOptimizationProposalResponseSchema,
  "authoring.take.trim": authoringSessionResponseSchema,
  "authoring.take.reorder": authoringSessionResponseSchema,
  "authoring.take.replace": authoringSessionResponseSchema,
  "authoring.take.edit": authoringSessionResponseSchema,
  "authoring.take.replay": authoringSessionResponseSchema,
  "authoring.session.commit": authoringSessionResponseSchema,
  "authoring.session.discard": authoringSessionResponseSchema,
  "authoring.session.cancel": authoringSessionResponseSchema,
  "authoring.session.cleanup": zod.object({ ok: zod.literal(true) }).strict(),
  "app-map.case-stack.attach": appMapEnvelopeSchema,
  "app-map.case-stack.remove": appMapEnvelopeSchema,
  "app-map.case-stack.save": appMapEnvelopeSchema,
  "app-map.combine.remove": appMapEnvelopeSchema,
  "app-map.combine.save": appMapEnvelopeSchema,
  "app-map.commit": appMapEnvelopeSchema,
  "app-map.connection.create": appMapEnvelopeSchema,
  "app-map.connection.remove": appMapEnvelopeSchema,
  "app-map.connection.update": appMapEnvelopeSchema,
  "app-map.create": appMapEnvelopeSchema,
  "app-map.duplicate": appMapEnvelopeSchema,
  "app-map.flow.remove": appMapEnvelopeSchema,
  "app-map.flow.save": appMapEnvelopeSchema,
  "app-map.get": appMapEnvelopeSchema,
  "app-map.group.remove": appMapEnvelopeSchema,
  "app-map.group.save": appMapEnvelopeSchema,
  "app-map.proposal.approve": appMapEnvelopeSchema,
  "app-map.proposal.reject": appMapEnvelopeSchema,
  "app-map.proposal.revert": appMapEnvelopeSchema,
  "app-map.proposal.submit": appMapEnvelopeSchema,
  "app-map.routine.remove": appMapEnvelopeSchema,
  "app-map.routine.save": appMapEnvelopeSchema,
  "app-map.screen.add": appMapEnvelopeSchema,
  "app-map.screen.remove": appMapEnvelopeSchema,
  "app-map.screen.update": appMapEnvelopeSchema,
  "app-map.test.actions.forget": appMapEnvelopeSchema,
  "app-map.test.edit": appMapEnvelopeSchema,
  "app-map.test.redo": appMapEnvelopeSchema,
  "app-map.test.remove": appMapEnvelopeSchema,
  "app-map.test.save": appMapEnvelopeSchema,
  "app-map.test.undo": appMapEnvelopeSchema,
  "app-map.update": appMapEnvelopeSchema,
  "app-map.variable.remove": appMapEnvelopeSchema,
  "app-map.variable.save": appMapEnvelopeSchema,
  "app-map.list": zod
    .object({
      appMaps: zod.array(appMapDocumentSchema),
      degraded: zod
        .array(
          zod
            .object({
              key: zod.string(),
              id: zod.string().optional(),
              error: zod.string(),
              disposition: zod.enum(["read-only", "quarantined"]).optional(),
            })
            .strict(),
        )
        .optional(),
    })
    .strict(),
  "app-map.export": zod
    .object({ appMap: appMapDocumentSchema, yaml: zod.string(), filename: zod.string() })
    .strict(),
  "app-map.import": zod.object({ appMap: appMapDocumentSchema, imported: zod.boolean() }).strict(),
  "app-map.remove": zod.object({ ok: zod.literal(true) }).strict(),
  "app-map.combine.preflight": zod
    .object({
      preflight: appMapCombinePreflightSchema,
      accountCapacity: browserAccountPackQuoteSchema.optional(),
    })
    .strict(),
  "app-map.test.compile": zod
    .object({
      plan: appMapCompiledTestSchema,
      preflight: offlineTestPreflightReportSchema,
      nativeCompanion: appMapNativeCompanionCompileSchema.optional(),
    })
    .strict(),
  "app-map.test.run": zod
    .object({
      planIdentity: zod
        .object({
          appMapId: zod.string(),
          appMapRevision: zod.number(),
          testId: zod.string(),
          rootRecipeId: zod.string(),
        })
        .strict(),
      plan: appMapCompiledTestSchema,
      job: appMapJobSummarySchema,
      jobs: zod.array(appMapJobSummarySchema).optional(),
      combine: zod.object({ id: zod.string(), revision: zod.number() }).strict().optional(),
      campaign: zod
        .object({ id: zod.string(), selectedCellIds: zod.array(zod.string()) })
        .strict()
        .optional(),
      nativeCompanion: appMapNativeCompanionCompileSchema.optional(),
    })
    .strict(),
  "app-map.flow.run": zod
    .object({
      job: appMapJobSummarySchema,
      jobs: zod.array(appMapJobSummarySchema),
      plan: appMapCompiledFlowSchema,
      matrix: appMapRunMatrixSchema.optional(),
    })
    .strict(),
  "app-map.connection.run": zod
    .object({
      job: appMapJobSummarySchema,
      jobs: zod.array(appMapJobSummarySchema),
      plan: appMapCompiledConnectionRunSchema,
      matrix: appMapRunMatrixSchema.optional(),
    })
    .strict(),
  "app-map.scroll-surface.origin.inspect": zod
    .object({ inspection: reviewedDocumentOriginInspectionSchema })
    .strict(),
  "app-map.scroll-surface.origin.review": zod
    .object({
      projection: reviewedDocumentOriginProjectionSchema,
      ledger: reviewedDocumentOriginLedgerSchema,
      alreadyActive: zod.boolean(),
    })
    .strict(),
  "app-map.scroll-surface.origin.revoke": zod
    .object({
      projection: reviewedDocumentOriginProjectionSchema,
      ledger: reviewedDocumentOriginLedgerSchema,
      alreadyRevoked: zod.boolean(),
    })
    .strict(),
  "app-map.teach": zod
    .object({
      appMapId: zod.string(),
      appMapRevision: zod.number(),
      screen: screenSchema,
      variant: screenVariantSchema,
      created: zod.boolean(),
      connectionId: zod.string().optional(),
      reviewProposalId: zod.string().optional(),
    })
    .strict(),
  "app-map.screen.consolidate": zod
    .object({
      appMap: appMapDocumentSchema,
      applied: zod.boolean(),
      preview: screenConsolidationPreviewSchema,
    })
    .strict(),
  "app-map.screen.capture": zod
    .object({
      appMapId: zod.string(),
      appMapRevision: zod.number(),
      screen: screenSchema,
      variant: screenVariantSchema,
      created: zod.boolean(),
      reviewProposalId: zod.string().optional(),
    })
    .strict(),
  "app-map.screen.refresh.prepare": zod
    .object({ token: zod.string(), screenshotUri: zod.string(), expiresAt: zod.number() })
    .strict(),
  "app-map.screen.refresh.apply": zod
    .object({ appMap: appMapDocumentSchema, screen: screenSchema, variant: screenVariantSchema })
    .strict(),
  "app-map.screen.alias-observe": zod
    .object({
      appMap: appMapDocumentSchema,
      screen: screenSchema,
      variant: screenVariantSchema,
      alias: zod
        .object({ fingerprint: zod.string(), aliasesNow: zod.array(zod.string()) })
        .strict(),
    })
    .strict(),
  "app-map.scroll-surface.capture": zod
    .object({
      appMap: appMapDocumentSchema,
      screen: screenSchema,
      variant: screenVariantSchema,
      scrollSurface: logicalScrollSurfaceSchema,
    })
    .strict(),
  "app-map.scroll-surface.regenerate": zod
    .object({
      appMap: appMapDocumentSchema,
      screen: screenSchema,
      variant: screenVariantSchema,
      scrollSurface: logicalScrollSurfaceSchema,
    })
    .strict(),
  "app-map.test.propose": zod
    .object({ appMap: appMapDocumentSchema, proposalId: zod.string() })
    .strict(),
  "app-map.test.from-intent": zod
    .object({
      status: zod.enum(["compiled", "stuck"]),
      intent: zod.string(),
      connectionIds: zod.array(zod.string()).optional(),
      missing: zod.string().optional(),
      matches: zod.array(
        zod
          .object({
            connectionId: zod.string(),
            label: zod.string(),
            fromScreenId: zod.string(),
            toScreenId: zod.string().optional(),
          })
          .strict(),
      ),
    })
    .strict(),
  "app-map.test.draft": zod
    .object({
      name: zod.string(),
      steps: zod.array(
        zod
          .object({
            kind: zod.enum(["instruction", "validation"]),
            intent: zod.string(),
          })
          .strict(),
      ),
      source: zod.enum(["model", "lines"]),
    })
    .strict(),
  "app-map.observations.propose": zod
    .object({ appMap: appMapDocumentSchema, proposalId: zod.string() })
    .strict(),
  "app-map.diff.impact": zod
    .object({
      appMapId: zod.string(),
      appMapRevision: zod.number(),
      changedFiles: zod.array(zod.string()),
      matchedEntityIds: zod.array(zod.string()),
      affectedTestIds: zod.array(zod.string()),
    })
    .strict(),
  "app-map.routine.impact": zod
    .object({
      impact: zod
        .object({
          routineId: zod.string(),
          directUsages: zod.array(
            zod
              .object({
                ownerKind: zod.enum(["connection", "routine", "flow"]),
                ownerId: zod.string(),
                actionId: zod.string().optional(),
              })
              .strict(),
          ),
          affectedRoutineIds: zod.array(zod.string()),
          affectedConnectionIds: zod.array(zod.string()),
          affectedFlowIds: zod.array(zod.string()),
        })
        .strict(),
    })
    .strict(),
  "app-map.variable.infer": zod
    .object({
      appMapId: zod.string(),
      expectedRevision: zod.number(),
      capturedAt: zod.number(),
      variable: appMapVariableSchema,
      mutation: zod
        .object({
          operationId: zod.literal("app-map.variable.save"),
          input: zod
            .object({
              appMapId: zod.string(),
              variableId: zod.string(),
              expectedRevision: zod.number(),
              eventId: zod.string().optional(),
              variable: appMapVariableSchema,
            })
            .strict(),
        })
        .strict(),
    })
    .strict(),
  "app-map.observed": zod
    .object({
      appMapId: zod.string(),
      runsScanned: zod.number(),
      screens: zod.array(
        zod
          .object({
            key: zod.string(),
            screenId: zod.string().optional(),
            title: zod.string(),
            status: zod.enum(["passing", "failing", "seen", "untested", "new"]),
            addedByRuns: zod.boolean().optional(),
            addedAt: zod.number().optional(),
            runCount: zod.number(),
            lastSeenAt: zod.number().optional(),
            lastRunId: zod.string().optional(),
            lastOutcome: zod
              .enum(["passed", "product-failure", "harness-failure", "uncertain", "cancelled"])
              .optional(),
            frame: zod
              .object({ runId: zod.string(), file: zod.string(), capturedAt: zod.number() })
              .strict()
              .optional(),
          })
          .strict(),
      ),
      transitions: zod.array(
        zod
          .object({
            fromKey: zod.string(),
            toKey: zod.string(),
            label: zod.string(),
            count: zod.number(),
            lastOutcome: zod
              .enum(["passed", "product-failure", "harness-failure", "uncertain", "cancelled"])
              .optional(),
          })
          .strict(),
      ),
      summary: zod
        .object({
          known: zod.number(),
          tested: zod.number(),
          failing: zod.number(),
          new: zod.number(),
        })
        .strict(),
    })
    .strict(),
} as const satisfies Readonly<Record<string, z.ZodType>>;

/** Canonical output schema for every registered operation. */
export const operationOutputSchemas = {
  ...coreOperationOutputSchemas,
  ...e2eOperationOutputSchemas,
  ...operationFamilyOutputSchemas,
} as const satisfies Readonly<Record<string, z.ZodType>>;

export type OperationOutputSchemaId = keyof typeof operationOutputSchemas;
export type OperationSchemaOutput<Id extends OperationOutputSchemaId> = z.output<
  (typeof operationOutputSchemas)[Id]
>;
