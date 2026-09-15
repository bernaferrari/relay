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
  RoutineImpactPreview,
  SaveFlowInput,
  SaveRoutineInput,
  Screen,
  ScreenConsolidationPreview,
  ScreenVariant,
  UpdateScreenInput,
} from "./app-map.js";
import type { RepeatPilotSpec, RepeatSpec } from "./repeat-spec.js";
import type { RunReview } from "./run-review.js";
import {
  REVIEWED_DOCUMENT_ORIGIN_REVIEW_ASSERTION,
  REVIEWED_DOCUMENT_ORIGIN_REVOKE_ASSERTION,
  REVIEWED_DOCUMENT_ORIGIN_CONFIRMATION,
  type ReviewedDocumentOriginInspection,
  type ReviewedDocumentOriginLedger,
  type ReviewedDocumentOriginProjection,
} from "./reviewed-document-origin.js";
import type { CombineLensInput } from "./app-map-combine-id.js";
import type { SourceRevision } from "./source-revision.js";
import type {
  AppMapCompiledTest,
  AppMapNativeCompanionCompile,
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
  /** Newer maps are retained but cannot be opened or rewritten by this Relay. */
  disposition?: "read-only" | "quarantined";
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
      authenticationFixtureReference?: string;
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
  "app-map.screen.refresh.prepare": {
    input: {
      appMapId: string;
      screenId: string;
      expectedRevision: number;
      target: AuthoringTarget;
      leaseId: string;
    };
    output: { token: string; screenshotUri: string; expiresAt: number };
  };
  "app-map.screen.refresh.apply": {
    input: { appMapId: string; screenId: string; expectedRevision: number; token: string };
    output: { appMap: AppMap; screen: Screen; variant: ScreenVariant };
  };
  "app-map.screen.alias-observe": {
    input: {
      appMapId: string;
      screenId: string;
      expectedRevision: number;
      eventId?: string;
      target: AuthoringTarget;
      leaseId: string;
    };
    output: {
      appMap: AppMap;
      screen: Screen;
      variant: ScreenVariant;
      alias: { fingerprint: string; aliasesNow: string[] };
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
      authenticationFixtureReference?: string;
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
    input: {
      appMapId: string;
      variableId: string;
      expectedRevision: number;
      target: AuthoringTarget;
      leaseId: string;
      taughtRows: Array<{
        id: string;
        identifier?: string;
        label?: string;
        text?: string;
      }>;
      name?: string;
      kind?: AppMapVariable["kind"];
      apply?: AppMapVariable["apply"];
    };
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
    input: {
      appMapId: string;
      testId: string;
      /** Read-only preview of the suffix that would start from this exact
       * checkpoint. Its resulting plan still owns the startup contract. */
      entryCheckpointScreenId?: string;
      startupMode?: "warm" | "cold";
      /** Read-only runtime evidence scope. The target profile is selected by
       * immutable profile ID, never inferred from translated visible copy.
       * `ios` and `android` follow a linked native companion Test. */
      targetProfileId?: string;
      forceRecaptureScreenIds?: string[];
    };
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
  "app-map.test.run": {
    input: {
      appMapId: string;
      testId: string;
      /** Server calls resolveLaneExecution; omit revision/target overlay fields. */
      laneId?: string;
      expectedRevision?: number;
      target?: AuthoringTarget;
      /** Optional explicit saved profile scope. Relay binds it to this exact
       * target before control, then preflights the same frozen plan it queues.
       * `ios` and `android` follow a linked native companion Test. */
      engine?: "chromium" | "firefox" | "webkit";
      account?:
        | { kind: "fixture"; accountId: string; accountRevision: string; reference?: string }
        | { kind: "signed-out"; attested: true };
      /** Run-scoped evidence policy. Named screens are bound as full-surface
       * for this run so Combine `visual` surveys after arrival. The saved Test
       * stays unchanged. */
      surfaceCapture?: {
        forceRecaptureScreenIds: string[];
      };
      /** Explicit startup behavior. Verified checkpoint performs a fresh
       * destination proof and never falls back to an app relaunch. */
      startup?: AppMapTestStartup;
      /** Variable id → selected value ids. When present, Relay upserts a
       * Combine for this Test × those worlds and starts a campaign. */
      in?: Record<string, string[]>;
      /** Expansion strategy for the ordered Repeat dimensions in `in`. */
      strategy?: "zip" | "cartesian" | "pairwise";
      /** Exact resolved value tuple to run as the sole pilot. */
      pilotCase?: Record<string, string>;
      /** Capture lens for the upserted Combine. Visual/smoke aliases or a raw
       * capture-policy name. Screenshots are never a Variable. */
      lens?: CombineLensInput;
      /** Default is one cell. `all` is explicit. */
      executionMode?: "pilot" | "all";
      /** World or cell selector used with `in` to run one cell. */
      cell?: string;
      /** Immutable commit/build binding for the code under test. Frozen into
       * the run manifest as audit-grade provenance. */
      sourceRevision?: SourceRevision;
      /** Internal identity required to adopt an already-started Repeat after
       * the initiating client loses its response or local opaque reference. */
      repeatRecovery?: {
        schemaVersion: 1;
        testPlanDigest: string;
        spec: RepeatSpec;
        resolved: {
          dimensions: Array<{ id: string; valueIds: string[] }>;
          strategy: "cartesian" | "zip" | "pairwise";
          pilot: RepeatPilotSpec;
          resume: "untouched" | "failed" | "all";
        };
        workflowMutation?: {
          schemaVersion: 1;
          workflowId: string;
          transitionVersion: number;
          action: "repeat-pilot" | "repeat-resume" | "repeat-cancel";
          completedAt: number;
        };
      };
      workflowRequestId?: string;
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
    input: {
      appMapId: string;
      combineId: string;
      serial?: string;
      platform?: "android" | "ios";
      targetKind?: "device" | "browser";
      browserTargetId?: string;
      targetProfileId?: string;
      selected?: Record<string, string[]>;
      strategy?: "zip" | "cartesian" | "pairwise";
      selectedCellIds?: string[];
      profileTargets?: import("./combine-profile-target-schema.js").CombineProfileTargetInput[];
    };
    output: {
      preflight: AppMapCombinePreflight;
      accountCapacity?: import("./combine-profile-target-schema.js").BrowserAccountPackQuote;
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
