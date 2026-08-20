import type { AuthoringTarget } from "./authoring.js";
import type {
  AppMap,
  AppMapBatchChange,
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
  LogicalScrollSurfaceImport,
  Proposal,
  SaveFlowInput,
  SaveRoutineInput,
  Screen,
  ScreenConsolidationPreview,
  ScreenVariant,
  UpdateScreenInput,
} from "./app-map.js";
import type { OperationRecord } from "./operation-contract.js";
import type { RunReview } from "./run-review.js";
import {
  REVIEWED_DOCUMENT_ORIGIN_REVIEW_ASSERTION,
  REVIEWED_DOCUMENT_ORIGIN_REVOKE_ASSERTION,
  REVIEWED_DOCUMENT_ORIGIN_CONFIRMATION,
  type ReviewedDocumentOriginInspection,
  type ReviewedDocumentOriginLedger,
  type ReviewedDocumentOriginProjection,
} from "./reviewed-document-origin.js";
import type {
  AppMapCompiledTest,
  AppMapScenarioTestEdit,
  AppMapTestStartup,
  OfflineTestPreflightReport,
} from "./test-intent.js";

type AppMapJobSummary = {
  id: string;
  action: string;
  status: string;
  queuedAt: number;
  frameCount: number;
  review?: RunReview;
  [key: string]: unknown;
};

export type DegradedAppMapRef = {
  key: string;
  id?: string;
  error: string;
};

export type AppMapOperationMap = {
  "app-map.list": {
    input: Record<string, never>;
    output: { appMaps: AppMap[]; degraded?: DegradedAppMapRef[] };
  };
  "app-map.get": { input: { appMapId: string }; output: { appMap: AppMap } };
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
    input: {
      appMapId: string;
      expectedRevision: number;
      eventId?: string;
      target: AuthoringTarget;
      leaseId: string;
      title?: string;
      position?: { x: number; y: number };
    };
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
  "app-map.scroll-surface.capture": {
    input: {
      appMapId: string;
      screenId: string;
      variantId: string;
      expectedRevision: number;
      eventId?: string;
      target: AuthoringTarget;
      leaseId: string;
      maxScrolls?: number;
    };
    output: {
      appMap: AppMap;
      screen: Screen;
      variant: ScreenVariant;
      scrollSurface: LogicalScrollSurface;
    };
  };
  "app-map.scroll-surface.regenerate": {
    input: {
      appMapId: string;
      screenId: string;
      variantId: string;
      captureId: string;
      expectedRevision: number;
      eventId?: string;
    };
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
    input: {
      appMapId: string;
      expectedRevision?: number;
      eventId?: string;
      target: AuthoringTarget;
      leaseId: string;
      fromScreenId?: string;
      title?: string;
      label?: string;
      handoff?: {
        expectedApp: string;
        returnAction: "back" | "relaunch-source";
      };
      interaction?:
        | { kind: "point"; x: number; y: number }
        | { kind: "label"; label: string; point?: { x: number; y: number } }
        | { kind: "identifier"; identifier: string; point?: { x: number; y: number } }
        | {
            kind: "swipe";
            from: { x: number; y: number };
            to: { x: number; y: number };
            durationMs?: number;
          };
    };
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
    input: {
      appMapId: string;
      targetScreenId: string;
      sourceScreenIds: string[];
      expectedRevision: number;
      eventId?: string;
      dryRun?: boolean;
      targetTitle?: string;
      surfaceImport?: LogicalScrollSurfaceImport;
    };
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
    input: {
      appMapId: string;
      connectionId: string;
      serial?: string;
      platform?: "android" | "ios";
      targetKind?: "device" | "browser";
      browserTargetId?: string;
      variables?: Record<string, string | string[]>;
    };
    output: {
      job: OperationRecord;
      jobs: OperationRecord[];
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
    input: {
      appMapId: string;
      flowId: string;
      throughConnectionId?: string;
      serial?: string;
      platform?: "android" | "ios";
      targetKind?: "device" | "browser";
      browserTargetId?: string;
      variables?: Record<string, string | string[]>;
    };
    output: {
      job: OperationRecord;
      jobs: OperationRecord[];
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
      test: AppMapTest;
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
    input: {
      appMapId: string;
      testId: string;
      /** Read-only preview of the suffix that would start from this exact
       * checkpoint. Its resulting plan still owns the startup contract. */
      entryCheckpointScreenId?: string;
      /** Read-only runtime evidence scope. The target profile is selected by
       * immutable profile ID, never inferred from translated visible copy. */
      targetProfileId?: string;
    };
    output: { plan: AppMapCompiledTest; preflight: OfflineTestPreflightReport };
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
  "app-map.test.run": {
    input: {
      appMapId: string;
      testId: string;
      expectedRevision: number;
      target: AuthoringTarget;
      /** Optional explicit saved profile scope. Relay binds it to this exact
       * target before control, then preflights the same frozen plan it queues. */
      targetProfileId?: string;
      /** Run-scoped evidence policy. Only the selected full-surface bindings
       * bypass the exact comparison cache; the saved Test remains unchanged. */
      surfaceCapture?: {
        forceRecaptureScreenIds: string[];
      };
      /** Explicit startup behavior. Verified checkpoint performs a fresh
       * destination proof and never falls back to an app relaunch. */
      startup?: AppMapTestStartup;
    };
    output: {
      planIdentity: {
        appMapId: string;
        appMapRevision: number;
        testId: string;
        rootRecipeId: string;
      };
      plan: AppMapCompiledTest;
      job: AppMapJobSummary;
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
    input: {
      appMapId: string;
      combineId: string;
      serial?: string;
      selected?: Record<string, string[]>;
      strategy?: "zip" | "cartesian" | "pairwise";
    };
    output: { preflight: AppMapCombinePreflight };
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
  "app-map.proposal.submit": {
    input: { appMapId: string; expectedRevision: number; eventId?: string; proposal: Proposal };
    output: { appMap: AppMap };
  };
  "app-map.observations.propose": {
    input: {
      appMapId: string;
      sessionId: string;
      expectedRevision: number;
      proposalId?: string;
      title?: string;
      transitionIds?: string[];
      eventId?: string;
    };
    output: { appMap: AppMap; proposalId: string };
  };
  "app-map.proposal.approve": {
    input: {
      appMapId: string;
      proposalId: string;
      expectedRevision: number;
      eventId?: string;
      reason?: string;
      serial?: string;
      prove?: boolean;
    };
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
