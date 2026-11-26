import type {
  AppMap,
  AppMapBatchChange,
  AppMapEntity,
  AppMapCompiledConnectionRun,
  AppMapCompiledFlow,
  AppMapPatch,
  AppMapVariable,
  AppMapTest,
  AppMapCombine,
  AppMapCombinePreflight,
  CaseStack,
  ConnectionPatch,
  CreateConnectionInput,
  CreateScreenInput,
  MapGroup,
  LogicalScrollSurface,
  Proposal,
  RoutineImpactPreview,
  SaveFlowInput,
  SaveRoutineInput,
  Screen,
  ScreenConsolidationPreview,
  ScreenVariant,
  UpdateScreenInput,
} from "./app-map.js";
import type { RunReview } from "../run/run-review.js";
import {
  REVIEWED_DOCUMENT_ORIGIN_REVIEW_ASSERTION,
  REVIEWED_DOCUMENT_ORIGIN_REVOKE_ASSERTION,
  REVIEWED_DOCUMENT_ORIGIN_CONFIRMATION,
  type ReviewedDocumentOriginInspection,
  type ReviewedDocumentOriginLedger,
  type ReviewedDocumentOriginProjection,
} from "../reviewed/reviewed-document-origin.js";
import type {
  AppMapCompiledTest,
  AppMapNativeCompanionCompile,
  AppMapScenarioTestEdit,
  OfflineTestPreflightReport,
} from "../test/test-intent.js";
import type { OperationSchemaInput } from "../operation/operation-input-schemas.js";

type AppMapJobSummary = {
  id: string;
  action: string;
  status: string;
  queuedAt: number;
  frameCount?: number;
  review?: RunReview;
  [key: string]: unknown;
};

export type DegradedAppMapRef = {
  key: string;
  id?: string;
  error: string;
  /** Newer maps are retained but cannot be opened or rewritten by this Relay. */
  disposition?: "read-only" | "quarantined";
};

export type AppMapOperationMap = {
  "app-map.list": {
    input: Record<string, never>;
    output: { appMaps: AppMap[]; degraded?: DegradedAppMapRef[] };
  };
  "app-map.get": { input: { appMapId: string }; output: { appMap: AppMap } };
  "app-map.observed": {
    input: { appMapId: string };
    output: import("./app-map-observed.js").AppMapObserved;
  };
  "app-map.remove": { input: { appMapId: string }; output: { ok: true } };
  "app-map.create": {
    input: { appMapId: string; name: string };
    output: { appMap: AppMap };
  };
  "app-map.duplicate": {
    input: { sourceAppMapId: string; appMapId: string; name?: string };
    output: { appMap: AppMap };
  };
  "app-map.export": {
    input: { appMapId: string };
    output: { appMap: AppMap; yaml: string; filename: string };
  };
  "app-map.import": {
    input: {
      yaml: string;
      dryRun?: boolean;
      conflict?: "reject" | "replace" | "copy";
    };
    output: { appMap: AppMap; imported: boolean };
  };
  "app-map.update": {
    input: { appMapId: string; expectedRevision: number; eventId?: string; patch: AppMapPatch };
    output: { appMap: AppMap };
  };
  "app-map.commit": {
    input: {
      appMapId: string;
      expectedRevision: number;
      eventId?: string;
      summary?: string;
      changes: AppMapBatchChange[];
      patch?: AppMapPatch;
    };
    output: { appMap: AppMap };
  };
  "app-map.screen.add": {
    input: {
      appMapId: string;
      expectedRevision: number;
      eventId?: string;
      screen: CreateScreenInput;
    };
    output: { appMap: AppMap };
  };
  "app-map.screen.capture": {
    input: OperationSchemaInput<"app-map.screen.capture">;
    output: {
      appMapId: string;
      appMapRevision: number;
      screen: Screen;
      variant: ScreenVariant;
      created: boolean;
      /** A changed semantic capture is pending human comparison; the map still
       * renders its prior approved variant until this proposal is accepted. */
      reviewProposalId?: string;
    };
  };
  "app-map.screen.refresh.prepare": {
    input: OperationSchemaInput<"app-map.screen.refresh.prepare">;
    output: { token: string; screenshotUri: string; expiresAt: number };
  };
  "app-map.screen.refresh.apply": {
    input: OperationSchemaInput<"app-map.screen.refresh.apply">;
    output: { appMap: AppMap; screen: Screen; variant: ScreenVariant };
  };
  "app-map.screen.alias-observe": {
    input: OperationSchemaInput<"app-map.screen.alias-observe">;
    output: {
      appMap: AppMap;
      screen: Screen;
      variant: ScreenVariant;
      alias: { fingerprint: string; aliasesNow: string[] };
    };
  };
  "app-map.scroll-surface.capture": {
    input: OperationSchemaInput<"app-map.scroll-surface.capture">;
    output: {
      appMap: AppMap;
      screen: Screen;
      variant: ScreenVariant;
      scrollSurface: LogicalScrollSurface;
    };
  };
  "app-map.scroll-surface.regenerate": {
    input: OperationSchemaInput<"app-map.scroll-surface.regenerate">;
    output: {
      appMap: AppMap;
      screen: Screen;
      variant: ScreenVariant;
      scrollSurface: LogicalScrollSurface;
    };
  };
  "app-map.scroll-surface.origin.inspect": {
    input: {
      appMapId: string;
      screenId: string;
      variantId: string;
      captureId: string;
    };
    output: { inspection: ReviewedDocumentOriginInspection };
  };
  "app-map.scroll-surface.origin.review": {
    input: {
      appMapId: string;
      screenId: string;
      variantId: string;
      captureId: string;
      expectedRevision: number;
      reason: string;
      assertion: typeof REVIEWED_DOCUMENT_ORIGIN_REVIEW_ASSERTION;
      confirmation: typeof REVIEWED_DOCUMENT_ORIGIN_CONFIRMATION;
    };
    output: {
      projection: ReviewedDocumentOriginProjection;
      ledger: ReviewedDocumentOriginLedger;
      alreadyActive: boolean;
    };
  };
  "app-map.scroll-surface.origin.revoke": {
    input: {
      appMapId: string;
      screenId: string;
      variantId: string;
      captureId: string;
      projectionId: string;
      expectedRevision: number;
      reason: string;
      assertion: typeof REVIEWED_DOCUMENT_ORIGIN_REVOKE_ASSERTION;
      confirmation: typeof REVIEWED_DOCUMENT_ORIGIN_CONFIRMATION;
    };
    output: {
      projection: ReviewedDocumentOriginProjection;
      ledger: ReviewedDocumentOriginLedger;
      alreadyRevoked: boolean;
    };
  };
  "app-map.teach": {
    input: OperationSchemaInput<"app-map.teach">;
    output: {
      appMapId: string;
      appMapRevision: number;
      screen: Screen;
      variant: ScreenVariant;
      created: boolean;
      connectionId?: string;
      reviewProposalId?: string;
    };
  };
  "app-map.screen.update": {
    input: {
      appMapId: string;
      screenId: string;
      expectedRevision: number;
      eventId?: string;
      input: UpdateScreenInput;
    };
    output: { appMap: AppMap };
  };
  "app-map.screen.remove": {
    input: { appMapId: string; screenId: string; expectedRevision: number; eventId?: string };
    output: { appMap: AppMap };
  };
  "app-map.screen.consolidate": {
    input: OperationSchemaInput<"app-map.screen.consolidate">;
    output: {
      appMap: AppMap;
      applied: boolean;
      preview: ScreenConsolidationPreview;
    };
  };
  "app-map.connection.create": {
    input: {
      appMapId: string;
      expectedRevision: number;
      eventId?: string;
      connection: CreateConnectionInput;
    };
    output: { appMap: AppMap };
  };
  "app-map.connection.update": {
    input: {
      appMapId: string;
      connectionId: string;
      expectedRevision: number;
      eventId?: string;
      patch: ConnectionPatch;
    };
    output: { appMap: AppMap };
  };
  "app-map.connection.remove": {
    input: { appMapId: string; connectionId: string; expectedRevision: number; eventId?: string };
    output: { appMap: AppMap };
  };
  "app-map.connection.run": {
    input: OperationSchemaInput<"app-map.connection.run">;
    output: {
      job: AppMapJobSummary;
      jobs: AppMapJobSummary[];
      plan: AppMapCompiledConnectionRun;
      matrix?: {
        id: string;
        createdAt: number;
        seed: number;
        strategy: "repeat" | "zip" | "cartesian" | "pairwise";
        cases: Array<{
          id: string;
          name: string;
          index: number;
          values: Record<string, string>;
          provenance: unknown[];
        }>;
      };
    };
  };
  "app-map.group.save": {
    input: {
      appMapId: string;
      groupId: string;
      expectedRevision: number;
      eventId?: string;
      group: MapGroup;
    };
    output: { appMap: AppMap };
  };
  "app-map.group.remove": {
    input: { appMapId: string; groupId: string; expectedRevision: number; eventId?: string };
    output: { appMap: AppMap };
  };
  "app-map.flow.save": {
    input: {
      appMapId: string;
      flowId: string;
      expectedRevision: number;
      eventId?: string;
      flow: SaveFlowInput;
    };
    output: { appMap: AppMap };
  };
  "app-map.flow.remove": {
    input: { appMapId: string; flowId: string; expectedRevision: number; eventId?: string };
    output: { appMap: AppMap };
  };
  "app-map.flow.run": {
    input: OperationSchemaInput<"app-map.flow.run">;
    output: {
      job: AppMapJobSummary;
      jobs: AppMapJobSummary[];
      plan: AppMapCompiledFlow;
      matrix?: {
        id: string;
        createdAt: number;
        seed: number;
        strategy: "repeat" | "zip" | "cartesian" | "pairwise";
        cases: Array<{
          id: string;
          name: string;
          index: number;
          values: Record<string, string>;
          provenance: unknown[];
        }>;
      };
    };
  };
  "app-map.case-stack.save": {
    input: {
      appMapId: string;
      caseStackId: string;
      expectedRevision: number;
      eventId?: string;
      caseStack: CaseStack;
    };
    output: { appMap: AppMap };
  };
  "app-map.case-stack.attach": {
    input: {
      appMapId: string;
      connectionId: string;
      caseStackId: string;
      expectedRevision: number;
      eventId?: string;
      caseStack?: CaseStack;
    };
    output: { appMap: AppMap };
  };
  "app-map.case-stack.remove": {
    input: {
      appMapId: string;
      caseStackId: string;
      expectedRevision: number;
      eventId?: string;
    };
    output: { appMap: AppMap };
  };
  "app-map.variable.save": {
    input: {
      appMapId: string;
      variableId: string;
      expectedRevision: number;
      eventId?: string;
      variable: AppMapVariable;
    };
    output: { appMap: AppMap };
  };
  "app-map.variable.infer": {
    input: OperationSchemaInput<"app-map.variable.infer">;
    output: {
      appMapId: string;
      expectedRevision: number;
      capturedAt: number;
      variable: AppMapVariable;
      mutation: {
        operationId: "app-map.variable.save";
        input: AppMapOperationMap["app-map.variable.save"]["input"];
      };
    };
  };
  "app-map.variable.remove": {
    input: {
      appMapId: string;
      variableId: string;
      expectedRevision: number;
      eventId?: string;
    };
    output: { appMap: AppMap };
  };
  "app-map.test.save": {
    input: {
      appMapId: string;
      testId: string;
      expectedRevision: number;
      eventId?: string;
      test: Omit<AppMapTest, keyof AppMapEntity | "surfaceBindings">;
    };
    output: { appMap: AppMap };
  };
  "app-map.test.remove": {
    input: {
      appMapId: string;
      testId: string;
      expectedRevision: number;
      eventId?: string;
    };
    output: { appMap: AppMap };
  };
  "app-map.test.edit": {
    input: {
      appMapId: string;
      testId: string;
      expectedRevision: number;
      eventId?: string;
      edits: AppMapScenarioTestEdit[];
    };
    output: { appMap: AppMap };
  };
  "app-map.test.undo": {
    input: {
      appMapId: string;
      testId: string;
      expectedRevision: number;
      eventId?: string;
    };
    output: { appMap: AppMap };
  };
  "app-map.test.redo": {
    input: {
      appMapId: string;
      testId: string;
      expectedRevision: number;
      eventId?: string;
    };
    output: { appMap: AppMap };
  };
  "app-map.test.propose": {
    input: {
      appMapId: string;
      testId: string;
      expectedRevision: number;
      eventId?: string;
      proposalId?: string;
      title?: string;
      description?: string;
      edits: AppMapScenarioTestEdit[];
    };
    output: { appMap: AppMap; proposalId: string };
  };
  "app-map.test.compile": {
    input: OperationSchemaInput<"app-map.test.compile">;
    output: {
      plan: AppMapCompiledTest;
      preflight: OfflineTestPreflightReport;
      nativeCompanion?: AppMapNativeCompanionCompile;
    };
  };
  "app-map.test.from-intent": {
    input: { appMapId: string; intent: string };
    output: {
      status: "compiled" | "stuck";
      intent: string;
      connectionIds?: string[];
      missing?: string;
      matches: { connectionId: string; label: string; fromScreenId: string; toScreenId?: string }[];
    };
  };
  "app-map.test.draft": {
    input: { appMapId: string; goal: string; startUrl?: string };
    output: {
      name: string;
      steps: { kind: "instruction" | "validation"; intent: string }[];
      source: "model" | "lines";
    };
  };
  "app-map.test.run": {
    input: OperationSchemaInput<"app-map.test.run">;
    output: {
      planIdentity: {
        appMapId: string;
        appMapRevision: number;
        testId: string;
        rootRecipeId: string;
      };
      plan: AppMapCompiledTest;
      job: AppMapJobSummary;
      jobs?: AppMapJobSummary[];
      combine?: { id: string; revision: number };
      campaign?: { id: string; selectedCellIds: string[] };
      nativeCompanion?: AppMapNativeCompanionCompile;
    };
  };
  "app-map.combine.save": {
    input: {
      appMapId: string;
      combineId: string;
      expectedRevision: number;
      eventId?: string;
      combine: AppMapCombine;
    };
    output: { appMap: AppMap };
  };
  "app-map.combine.preflight": {
    input: OperationSchemaInput<"app-map.combine.preflight">;
    output: {
      preflight: AppMapCombinePreflight;
      accountCapacity?: import("../combine/combine-profile-target-schema.js").BrowserAccountPackQuote;
    };
  };
  "app-map.combine.remove": {
    input: {
      appMapId: string;
      combineId: string;
      expectedRevision: number;
      eventId?: string;
    };
    output: { appMap: AppMap };
  };
  "app-map.routine.save": {
    input: {
      appMapId: string;
      routineId: string;
      expectedRevision: number;
      eventId?: string;
      routine: SaveRoutineInput;
    };
    output: { appMap: AppMap };
  };
  "app-map.routine.remove": {
    input: { appMapId: string; routineId: string; expectedRevision: number; eventId?: string };
    output: { appMap: AppMap };
  };
  "app-map.routine.impact": {
    input: { appMapId: string; routineId: string };
    output: { impact: RoutineImpactPreview };
  };
  "app-map.diff.impact": {
    input: {
      appMapId: string;
      changedFiles: string[];
      /** v1 diff-to-flows front-matter. Callers supply `{entityId -> sourcePaths}`
       * until the protocol carries `sourcePaths` natively (see core diff-impact). */
      sourcePaths?: Record<string, string[]>;
    };
    output: {
      appMapId: string;
      appMapRevision: number;
      changedFiles: string[];
      matchedEntityIds: string[];
      affectedTestIds: string[];
    };
  };
  "app-map.proposal.submit": {
    input: { appMapId: string; expectedRevision: number; eventId?: string; proposal: Proposal };
    output: { appMap: AppMap };
  };
  "app-map.observations.propose": {
    input: OperationSchemaInput<"app-map.observations.propose">;
    output: { appMap: AppMap; proposalId: string };
  };
  "app-map.proposal.approve": {
    input: OperationSchemaInput<"app-map.proposal.approve">;
    output: { appMap: AppMap };
  };
  "app-map.proposal.reject": {
    input: {
      appMapId: string;
      proposalId: string;
      expectedRevision: number;
      eventId?: string;
      reason?: string;
    };
    output: { appMap: AppMap };
  };
  "app-map.proposal.revert": {
    input: {
      appMapId: string;
      proposalId: string;
      expectedRevision: number;
      eventId?: string;
      reason?: string;
    };
    output: { appMap: AppMap };
  };
};
