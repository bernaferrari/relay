import type { RecipeParameter, RecipeStep, StepPoint, StepTarget } from "./recipes.js";
import type { AppMapScenarioTest, AppMapScenarioTestEdit } from "./test-intent.js";
import type { AssertionSpec } from "./assertions.js";
import type { ActorKind } from "./coordination.js";
import type { ScreenIdentity } from "./discovery-contract.js";
import type {
  ConnectionNavigationContract,
  ConnectionReturnContract,
  DestinationEvidenceSurface,
} from "./connection-navigation.js";
import type { TargetProfile } from "./target-contract.js";
import type { ExecutionTargetRef } from "./execution-target.js";
import type { ConnectionExecutionObservation } from "./connection-execution.js";
import type { ConnectionPresentation, ConnectionSourceAnchor } from "./connection-presentation.js";
import type {
  LogicalProductState,
  ProductActionIntent,
  ReviewedActionIntentBinding,
  ReviewedLogicalStateBinding,
} from "./product-intent.js";
import type { ScreenConsolidationPreview } from "./screen-consolidation.js";
import type {
  LogicalScrollSurface,
  ScreenVariantRawAccessibilityTree,
  ScrollSurfaceCapturePolicy,
} from "./scroll-surface.js";
export type {
  ConnectionNavigationContract,
  ConnectionNavigationTarget,
  ConnectionReturnContract,
  ConnectionScreenProof,
  DestinationEvidenceSurface,
} from "./connection-navigation.js";
export type {
  ConnectionArrowStyle,
  ConnectionPort,
  ConnectionPresentation,
  ConnectionRouteStyle,
  ConnectionSourceAnchor,
} from "./connection-presentation.js";
export type {
  LogicalScrollSurface,
  LogicalScrollSurfaceImport,
  RawAccessibilityTreeEvidence,
  ScreenVariantRawAccessibilityTree,
  ScrollSurfaceCapturePolicy,
  ScrollSurfaceDocumentOriginAuthorization,
  ScrollSurfaceDocumentOriginAttestation,
  ScrollSurfaceDocumentOriginProof,
  ScrollSurfaceEvidence,
  ScrollSurfaceSemanticAnchor,
  ScrollSurfaceSemanticIndex,
  ScrollSurfaceStopReason,
  ScrollSurfaceTestBinding,
  ScrollSurfaceViewport,
} from "./scroll-surface.js";
export type { ScreenConsolidationPreview } from "./screen-consolidation.js";
export type {
  AppMapCanvasCollaborationEntities,
  AppMapCollaborationAdapter,
  AppMapCollaborationChange,
  AppMapCollaborationCollection,
  AppMapCollaborationDocument,
  ConnectionPresentationPatch,
} from "./app-map-collaboration.js";

export const APP_MAP_SCHEMA_VERSION = 1 as const;
/**
 * Version of the provider-neutral, mutable App Map document. This is kept
 * distinct from the persisted App Map schema so a Yjs, Automerge, or custom
 * provider can evolve its transport without changing the domain document.
 */
export const APP_MAP_COLLABORATION_DOCUMENT_VERSION = 1 as const;

export type VolatileSemanticKind =
  | "clock"
  | "counter"
  | "date"
  | "generated-id"
  | "percentage"
  | "placeholder"
  | "relative-time"
  | "uuid";

export type SemanticField = "identifier" | "label" | "value";

export type VolatileSemanticSignal = {
  kind: VolatileSemanticKind;
  field: SemanticField;
  node: number;
};

export type NormalizedSemanticNode = {
  role: string;
  label?: string;
  value?: string;
  identifier?: string;
  enabled?: boolean;
  selected?: boolean;
  focused?: boolean;
  hittable?: boolean;
  depth?: number;
};

export type ScreenIdentityObservation = {
  fingerprint: string;
  nodes: NormalizedSemanticNode[];
  volatileSignals: VolatileSemanticSignal[];
};

export type AppMapScope = {
  organizationId: string;
  projectId: string;
  appMapId: string;
};

export type AppMapEntity = AppMapScope & {
  id: string;
  createdAt: number;
  updatedAt: number;
};

export type AppMapPoint = { x: number; y: number };

export type AppMapNote = AppMapEntity & {
  text: string;
  position: AppMapPoint;
};

/** Optional visual organization for the canvas and screen browser. A Group
 * never changes execution, identity, or connection semantics. */
export type MapGroup = AppMapEntity & {
  name: string;
  screenIds: string[];
};

export type Screen = AppMapEntity & {
  title: string;
  description?: string;
  logicalStateBinding?: ReviewedLogicalStateBinding;
  /** A surface intentionally owned outside the application under test. It is
   * still a first-class test checkpoint, but can only be authored through an
   * explicit expected handoff and has a declared reversible exit. */
  handoff?: {
    ownerApp: string;
    returnAction: "back" | "relaunch-source";
  };
  identity?: ScreenIdentity;
  evidenceSurface?: DestinationEvidenceSurface;
  position?: AppMapPoint;
  variantIds: string[];
  /** Lossless audit trail for viewport cards absorbed into this logical
   * surface. Raw variants and removed internal edges remain available for
   * regeneration even though they no longer participate in execution. */
  consolidations?: Array<{
    eventId: string;
    actorId: string;
    at: number;
    sourceScreens: Screen[];
    sourceVariants: ScreenVariant[];
    internalConnections: Connection[];
    preview: ScreenConsolidationPreview;
  }>;
};

export type AppMapPatch = {
  name?: string;
  description?: string | null;
  /**
   * Legacy whole-collection note replacement. New canvas writes use
   * `note.save` and `note.remove`, which are safe to compose with a
   * collaborative document provider.
   */
  notes?: Record<string, AppMapNote>;
};

export type BaselineProvenance = {
  approvedAt: number;
  approvedBy: string;
  source:
    | { kind: "run"; targetResultId: string; evidenceId?: string }
    | { kind: "recording"; takeId: string; takeRevision: number; evidenceIds: string[] }
    | { kind: "manual"; evidenceIds: string[] };
};

export type ScreenVariant = AppMapEntity & {
  screenId: string;
  targetProfile: TargetProfile;
  observation?: ScreenIdentityObservation;
  evidenceIds: string[];
  /** Durable artifact locations corresponding to evidenceIds. Resource URIs
   * remain separate from short stable identifiers so maps are both strict and
   * reopenable without renderer-owned blob URLs. */
  evidenceUris?: string[];
  /** The immutable raw accessibility snapshot that produced `observation`.
   * Unlike the normalized observation this retains hierarchy and bounds, so
   * offline planning can prove row relations and duplicate labels without a
   * connected target. Historical variants may legitimately omit it. */
  rawAccessibilityTree?: ScreenVariantRawAccessibilityTree;
  /** The canonical visual preview. Evidence lists may also contain semantic
   * snapshots or video, so renderers must never guess from array order. */
  screenshotUri?: string;
  /** Immutable capture history for this target/locale-specific variant. The
   * newest item is the default logical-screen presentation. */
  scrollSurfaces?: LogicalScrollSurface[];
  /** Missing means the conservative viewport-only default. */
  scrollCapturePolicy?: ScrollSurfaceCapturePolicy;
  baseline?: BaselineProvenance;
  /** Explicitly reviewed manual capture retained alongside prior evidence. */
  refreshCapture?: { captureId: string; capturedAt: number };
  /** Historical capture lineage. This is independent of reviewed baseline
   * approval and may describe a localized run retained for comparison. */
  captureProvenance?: {
    kind: "run";
    runId: string;
    capturedAt: number;
    locale?: string;
    screenshotEvidenceId: string;
    accessibilityEvidenceId?: string;
  };
};

type ActionMetadata = {
  id: string;
  label?: string;
  /** Continue when this best-effort setup or cleanup action is unavailable. */
  optional?: boolean;
  /** Execute only when the named UI state is currently true. This keeps
   * reusable setup routines deterministic without tapping obscured controls
   * that remain in an application's accessibility tree. */
  when?: {
    target: StepTarget;
    condition: "present" | "absent";
    /** Optional normalized viewport region used to distinguish an actually
     * visible control from an off-canvas copy retained by SwiftUI. */
    region?: { minX?: number; maxX?: number; minY?: number; maxY?: number };
  };
};

export type { AssertionSpec } from "./assertions.js";

export type GestureSpec =
  | { kind: "swipe"; from: StepPoint; to: StepPoint; durationMs?: number }
  | { kind: "scroll"; direction: "up" | "down"; amount?: number };

export type ActionSpec = ActionMetadata &
  (
    | {
        kind: "recorded";
        takeId: string;
        takeRevision: number;
        steps: RecipeStep[];
        evidenceIds: string[];
      }
    | {
        /** Deterministic steps authored directly by a person, agent, CLI, or
         * MCP client. Unlike a recorded action this never invents a Take. */
        kind: "steps";
        steps: RecipeStep[];
      }
    | {
        kind: "tap";
        target: StepTarget;
        fallbackTargets?: StepTarget[];
        expectedApp?: string;
      }
    | { kind: "text"; text: string; target?: StepTarget }
    | { kind: "gesture"; gesture: GestureSpec }
    | {
        /** Locate a semantic control on a logical scroll surface before the
         * following interaction. Unlike a fixed swipe count this survives
         * locale reflow, font scaling, and different viewport heights. */
        kind: "reveal";
        target: StepTarget;
        direction?: "up" | "down" | "auto";
        maxAttempts?: number;
      }
    | { kind: "back" }
    | { kind: "home" }
    | { kind: "app"; action: "open"; app?: string; url?: string; relaunch?: boolean }
    | { kind: "app"; action: "close"; app: string }
    | { kind: "wait"; ms: number }
    | { kind: "assertion"; assertion: AssertionSpec }
    | { kind: "routine"; routineId: string; bindings?: Record<string, string> }
    | { kind: "passive"; reason: "automatic" | "observe-only" | "external" }
  );

export type ConnectionDestination = { kind: "screen"; screenId: string } | { kind: "end" };

export type Connection = AppMapEntity & {
  fromScreenId: string;
  destination: ConnectionDestination;
  label?: string;
  actionIntentBinding?: ReviewedActionIntentBinding;
  caseStackId?: string;
  state: "draft" | "ready";
  actions: ActionSpec[];
  navigation?: ConnectionNavigationContract;
  return?: ConnectionReturnContract;
  sourceAnchor?: ConnectionSourceAnchor;
  recordingSource?: import("./authoring-capture.js").AuthoringRecordingSource;
  presentation?: ConnectionPresentation;
};

export type CaseExpansionStrategy = "zip" | "cartesian" | "pairwise";

/** A reusable coverage definition. Values remain project test data so private
 * actor-local data never has to enter the collaborative App Map document. */
export type CaseStack = AppMapEntity & {
  name: string;
  description?: string;
  dataIds: string[];
  strategy: CaseExpansionStrategy;
  maxCases: number;
};

/** Language, location, theme, account, later toggles — one array × a path. */
export type AppMapVariableKind =
  | "language"
  | "location"
  | "account"
  | "theme"
  | "workspace"
  | "build"
  | "toggle"
  | "custom";

export type VariableNavStep =
  | {
      kind: "tap";
      target: { identifier?: string; label?: string; text?: string };
      /** Ordered aliases for the same control, such as a settings row whose
       * visible label changes after the language state is applied. */
      fallbackTargets?: Array<{ identifier?: string; label?: string; text?: string }>;
    }
  | { kind: "back" }
  | { kind: "wait"; ms: number }
  | { kind: "scroll"; direction: "up" | "down"; amount?: number }
  | { kind: "relaunch" }
  | { kind: "openApp"; app: string; relaunch?: boolean };

export type VariableRow = {
  id: string;
  identifier?: string;
  label?: string;
  text?: string;
};

export type VariableApply =
  | {
      kind: "list";
      /** Recorded map connection that opens the list (preferred over flattened nav). */
      inConnectionId?: string;
      /** Recorded map connection that leaves the list before work runs. */
      outConnectionId?: string;
      listScreenId?: string;
      /** Recipe step id of the demonstrated list tap; In is before, Out after if no outConnectionId. */
      pickStepId?: string;
      entryPath?: VariableNavStep[];
      pickerPath?: VariableNavStep[];
      exitPath?: VariableNavStep[];
    }
  | {
      /** Android's first-party per-app locale API. This avoids brittle taps in
       * a system language picker while keeping the Variable explicit. */
      kind: "appLocale";
      app: string;
      /** Default true. Stay on the current screen only when explicitly false. */
      relaunch?: boolean;
    }
  | {
      kind: "toggle";
      target: StepTarget;
      on: { identifier?: string; label?: string };
      off: { identifier?: string; label?: string };
    };

/** Named possibilities that change app state, then a map path runs in each world. */
export type AppMapVariable = AppMapEntity & {
  name: string;
  kind: AppMapVariableKind;
  apply: VariableApply;
  options: VariableRow[];
  restoreId?: string;
  screenshotEach?: boolean;
};

/** Evidence captured while running a graph-native Test. */
export type AppMapCapturePolicy =
  | { mode: "every-screen" }
  | { mode: "checkpoints"; screenIds: string[] }
  | { mode: "final-screen" }
  | { mode: "failures-only" }
  | { mode: "none" };

/** The only Test contract. Navigation is bound to reviewed App Map connections. */
export type AppMapTest = AppMapScenarioTest;

/** Explicit runtime evidence profile for one Test × world cell.
 * Absent a binding, start/preflight inherit a default target profile when the
 * caller supplied a default target and a compatible saved profile exists. */
export type AppMapCombineCellRuntimeProfile = {
  testId: string;
  /** Canonical variable-id → value-id map. Ordering is not identity. */
  values: Record<string, string>;
  targetProfileId: string;
};

/**
 * Explicit execution location for one Test × world cell. This is deliberately
 * separate from `targetProfileId`: a profile proves the frozen evidence Relay
 * compiled against, while this reference says where the accepted work will
 * execute. A Combine run never borrows either one from another cell.
 */
export type AppMapCombineCellTargetBinding = {
  testId: string;
  /** Canonical variable-id → value-id map. Ordering is not identity. */
  values: Record<string, string>;
  target: ExecutionTargetRef;
};

/** Figma-like binding: variables × tests. Extra variables are M×N×O; extra tests run in order. */
export type AppMapCombine = AppMapEntity & {
  name: string;
  variableIds: string[];
  testIds: string[];
  /** Optional value subset per variable. Missing entries mean every saved value. */
  selected?: Record<string, string[]>;
  /** Evidence policy belongs to this run plan, so the same test can be reused
   * by a visual sweep and a fast no-screenshot smoke matrix. */
  captures?: Record<string, AppMapCapturePolicy>;
  strategy?: CaseExpansionStrategy;
  repeatPolicy?: import("./repeat-spec.js").RepeatPolicySpec;
  /** Persisted per-cell target-profile overrides. Missing cells inherit a default. */
  cellRuntimeProfiles?: AppMapCombineCellRuntimeProfile[];
};

export type AppMapCombinePreflightIssue = {
  code:
    | "missing-variable"
    | "missing-test"
    | "empty-selection"
    | "invalid-variable"
    | "invalid-test"
    | "compile-failed"
    | "large-run"
    | "unknown-screenshot-count"
    | "target-missing"
    | "target-not-ready"
    | "missing-binding"
    | "duplicate-binding"
    | "foreign-binding"
    | "extra-binding"
    | "mismatched-binding"
    | "zero-bindings"
    | "missing-target-binding"
    | "duplicate-target-binding"
    | "foreign-target-binding"
    | "extra-target-binding"
    | "mismatched-target-binding"
    | "unsupported-target-binding"
    | "zero-target-bindings";
  message: string;
  cellId?: string;
  testId?: string;
  values?: Record<string, string>;
  targetProfileId?: string;
};

export type AppMapCombineCellBindingStatus =
  | "bound"
  | "missing"
  | "foreign"
  | "duplicate"
  | "extra"
  | "mismatched";

export type AppMapCombineCellState = {
  cellId: string;
  testId: string;
  testName: string;
  values: Record<string, string>;
  worldLabel: string;
  targetProfileId?: string;
  /** The explicitly accepted execution location, when the caller supplied one. */
  target?: ExecutionTargetRef;
  binding: AppMapCombineCellBindingStatus;
  preflight?: "ready" | "blocked";
  message?: string;
};

/** Measured serial wall-clock for one Combine shape. Parallel N is unquoted. */
export type AppMapCombineObservedDuration = {
  durationMs: number;
  provenance: "observed-p50" | "observed-p95" | "observed-sample";
  sampleCount: number;
  workItemCount: number;
  campaignIds: string[];
};

/** Exact run-plan projection shared by the canvas, server, and CLI. */
export type AppMapCombinePreflight = {
  ok: boolean;
  appMapId: string;
  combineId: string;
  name: string;
  formula: string;
  strategy: CaseExpansionStrategy;
  variables: Array<{
    id: string;
    name: string;
    selectedCount: number;
    availableCount: number;
  }>;
  tests: Array<{
    id: string;
    name: string;
    kind: AppMapTest["kind"];
    expectedScreenshots?: number;
  }>;
  worlds: number;
  checks: number;
  deviceRuns: number;
  expectedScreenshots?: number;
  estimatedDurationMs?: number;
  /** Wall-clock of completed Plan runs with the same cell count. Never a
   * guessed recipe estimate. Parallel contexts stay unquoted here. */
  observedDuration?: AppMapCombineObservedDuration;
  blockers: AppMapCombinePreflightIssue[];
  warnings: AppMapCombinePreflightIssue[];
  cells: AppMapCombineCellState[];
  target?: {
    serial: string;
    state: "connected" | "not-ready" | "missing";
  };
};

export type Routine = AppMapEntity & {
  name: string;
  description?: string;
  parameters: RecipeParameter[];
  actions: ActionSpec[];
};

export type Flow = AppMapEntity & {
  name: string;
  startScreenId: string;
  /** Optional, explicit preparation executed before Relay verifies the entry
   * screen. This is auditable setup, never silent start-state healing. */
  setup?: { routineId: string; bindings?: Record<string, string> };
  connectionIds: string[];
};

export type AppMapCompiledStepProvenance = {
  recipeId: string;
  stepIndex: number;
  stepId: string;
  origin: "setup" | "source" | "action" | "destination";
  ownerKind: "flow" | "connection" | "routine";
  ownerId: string;
  actionId?: string;
};

export type AppMapCompiledRecipe = {
  id: string;
  title: string;
  description?: string;
  parameters: RecipeParameter[];
  steps: RecipeStep[];
  stepProvenance: AppMapCompiledStepProvenance[];
};

export type AppMapCompiledConnection = {
  connectionIndex: number;
  connectionId: string;
  fromScreenId: string;
  destination: ConnectionDestination;
  caseStackId?: string;
  /** Half-open range in the root recipe: [start, end). */
  compiledStepRange: readonly [start: number, end: number];
};

/** Immutable execution plan compiled from one exact App Map revision. */
export type AppMapCompiledFlow = {
  schemaVersion: 1;
  appMapId: string;
  appMapRevision: number;
  flow: Pick<Flow, "id" | "name" | "startScreenId" | "setup">;
  rootRecipeId: string;
  recipes: Record<string, AppMapCompiledRecipe>;
  connections: AppMapCompiledConnection[];
  caseStacks: CaseStack[];
  terminal: ConnectionDestination | { kind: "screen"; screenId: string };
};

/** Immutable execution plan for replaying one saved connection in isolation.
 * This is intentionally distinct from a Flow: inspecting a transition must
 * never invent a persisted path or fall back to renderer-owned draft steps. */
export type AppMapCompiledConnectionRun = {
  schemaVersion: 1;
  appMapId: string;
  appMapRevision: number;
  connection: Pick<Connection, "id" | "fromScreenId" | "destination" | "label" | "caseStackId">;
  rootRecipeId: string;
  recipes: Record<string, AppMapCompiledRecipe>;
  caseStacks: CaseStack[];
  terminal: ConnectionDestination;
};

export type RunReference = AppMapEntity & {
  flowId?: string;
  appMapRevision: number;
  targetResultIds: string[];
  startedAt: number;
  finishedAt?: number;
};

export type TargetResultOutcome =
  | "passed"
  | "product-failure"
  | "harness-failure"
  | "uncertain"
  | "cancelled";

export type TargetResultReference = AppMapEntity & {
  runId: string;
  targetProfile: TargetProfile;
  outcome: TargetResultOutcome;
  connectionId?: string;
  connectionObservations?: ConnectionExecutionObservation[];
  evidenceIds: string[];
  finishedAt?: number;
};

export type AddScreenInput = { screen: Screen; variants?: ScreenVariant[] };

export type ScreenPatch = {
  title?: string;
  description?: string | null;
  logicalStateBinding?: ReviewedLogicalStateBinding | null;
  handoff?: Screen["handoff"] | null;
  identity?: ScreenIdentity | null;
  evidenceSurface?: DestinationEvidenceSurface | null;
  position?: AppMapPoint | null;
};

export type UpdateScreenInput = {
  patch: ScreenPatch;
  upsertVariants?: ScreenVariant[];
  removeVariantIds?: string[];
};

export type ConnectionPatch = {
  fromScreenId?: string;
  destination?: ConnectionDestination;
  label?: string | null;
  actionIntentBinding?: ReviewedActionIntentBinding | null;
  caseStackId?: string | null;
  state?: Connection["state"];
  actions?: ActionSpec[];
  navigation?: ConnectionNavigationContract | null;
  return?: ConnectionReturnContract | null;
  /** Capture-derived origin evidence. `null` deliberately removes stale or
   * disproven evidence; normal canvas styling must never modify this field. */
  sourceAnchor?: ConnectionSourceAnchor | null;
  presentation?: ConnectionPresentation | null;
};

/** Public intent-level inputs. Relay owns scope and audit timestamps so a
 * human, CLI, or agent never has to manufacture persistence metadata. */
export type CreateScreenInput = Pick<Screen, "id" | "title"> &
  Partial<Pick<Screen, "description" | "logicalStateBinding" | "identity" | "position">>;

export type CreateConnectionInput = Pick<Connection, "id" | "fromScreenId" | "destination"> &
  Partial<
    Pick<
      Connection,
      | "label"
      | "actionIntentBinding"
      | "caseStackId"
      | "state"
      | "actions"
      | "navigation"
      | "return"
      | "presentation"
    >
  >;

export type SaveRoutineInput = Pick<Routine, "name" | "actions"> &
  Partial<Pick<Routine, "description" | "parameters">>;

export type SaveFlowInput = Pick<Flow, "name" | "startScreenId" | "connectionIds"> &
  Partial<Pick<Flow, "setup">>;

/** One atomic, reviewable authoring change. The desktop, CLI, HTTP API, and
 * agents use this same vocabulary so a canvas gesture cannot partially save. */
export type AppMapBatchChange =
  | { kind: "note.save"; note: AppMapNote }
  | { kind: "note.remove"; noteId: string }
  | { kind: "screen.add"; input: AddScreenInput }
  | { kind: "screen.update"; screenId: string; input: UpdateScreenInput }
  | { kind: "screen.remove"; screenId: string }
  | { kind: "connection.create"; connection: Connection }
  | { kind: "connection.update"; connectionId: string; patch: ConnectionPatch }
  | { kind: "connection.remove"; connectionId: string }
  | { kind: "group.save"; group: MapGroup }
  | { kind: "group.remove"; groupId: string }
  | { kind: "flow.save"; flow: Flow }
  | { kind: "flow.remove"; flowId: string }
  /** A Flow and its exposed Test can be authored in one atomic revision. */
  | { kind: "test.save"; test: AppMapTest }
  | { kind: "combine.save"; combine: AppMapCombine }
  | { kind: "combine.remove"; combineId: string };

export type ProposalChange =
  | { kind: "screen.add"; input: AddScreenInput }
  | { kind: "screen.update"; screenId: string; input: UpdateScreenInput }
  | { kind: "screen.remove"; screenId: string }
  | { kind: "connection.connect"; connection: Connection }
  | { kind: "connection.update"; connectionId: string; patch: ConnectionPatch }
  | { kind: "connection.remove"; connectionId: string }
  | { kind: "group.save"; group: MapGroup }
  | { kind: "group.remove"; groupId: string }
  /** Reviewable graph-Test edits use the same stable-ID operations as direct
   * authoring. A proposal is a review boundary, not a second Test format. */
  | {
      kind: "test.edit";
      testId: string;
      edits: AppMapScenarioTestEdit[];
      /** Server-derived, review-only projection. Approval always replays the
       * semantic edits and never trusts this cached description as input. */
      review?: AppMapTestProposalReview;
    };

export type AppMapTestProposalSnapshot = {
  name: string;
  stepCount: number;
  resolvedStepCount: number;
  unresolvedStepCount: number;
};

export type AppMapTestProposalEditSummary = {
  kind: AppMapScenarioTestEdit["kind"];
  summary: string;
  stepId?: string;
};

export type AppMapTestProposalReview = {
  before: AppMapTestProposalSnapshot;
  after: AppMapTestProposalSnapshot;
  edits: AppMapTestProposalEditSummary[];
};

export type ProposalDecision = { actorId: string; at: number; reason?: string };

export type Proposal = AppMapEntity & {
  title: string;
  description?: string;
  status: "pending" | "approved" | "rejected";
  /** Revision originally observed by the proposer when a safe rebase occurred. */
  sourceRevision?: number;
  baseRevision: number;
  changes: ProposalChange[];
  decision?: ProposalDecision;
  repair?: import("./campaign-repair.js").CampaignRepairProposalMetadata;
};

export type ActivitySubjectKind =
  | "app-map"
  | "screen"
  | "connection"
  | "group"
  | "flow"
  | "routine"
  | "case-stack"
  | "variable"
  | "test"
  | "combine"
  | "proposal"
  | "run";

export type ActivityEvent = AppMapScope & {
  id: string;
  actorId: string;
  actorKind: ActorKind;
  eventType:
    | "app-map.updated"
    | "app-map.committed"
    | "screen.added"
    | "screen.updated"
    | "screen.removed"
    | "screen.consolidated"
    | "connection.connected"
    | "connection.updated"
    | "connection.removed"
    | "group.saved"
    | "group.removed"
    | "flow.saved"
    | "flow.removed"
    | "routine.saved"
    | "routine.removed"
    | "case-stack.saved"
    | "case-stack.attached"
    | "case-stack.removed"
    | "variable.saved"
    | "variable.removed"
    | "test.saved"
    | "test.validated"
    | "test.undone"
    | "test.redone"
    | "test.removed"
    | "combine.saved"
    | "combine.removed"
    | "recording.committed"
    | "run.finished"
    | "proposal.submitted"
    | "proposal.approved"
    | "proposal.rejected"
    | "proposal.reverted";
  subject: { kind: ActivitySubjectKind; id: string };
  /** Optional stable semantic subjects changed by this event. Whole-entity
   * writers omit this field; granular editors use it so independent fields can
   * rebase without pretending the entire entity changed. */
  touched?: string[];
  summary: string;
  at: number;
  beforeRevision: number;
  afterRevision: number;
};

export type AppMap = {
  schemaVersion: typeof APP_MAP_SCHEMA_VERSION;
  id: string;
  organizationId: string;
  projectId: string;
  name: string;
  description?: string;
  revision: number;
  notes: Record<string, AppMapNote>;
  groups: Record<string, MapGroup>;
  /** Optional in historical documents; absence is the canonical empty set. */
  logicalStates?: Record<string, LogicalProductState>;
  actionIntents?: Record<string, ProductActionIntent>;
  screens: Record<string, Screen>;
  screenVariants: Record<string, ScreenVariant>;
  connections: Record<string, Connection>;
  caseStacks: Record<string, CaseStack>;
  variables: Record<string, AppMapVariable>;
  tests: Record<string, AppMapTest>;
  combines: Record<string, AppMapCombine>;
  routines: Record<string, Routine>;
  flows: Record<string, Flow>;
  runs: Record<string, RunReference>;
  targetResults: Record<string, TargetResultReference>;
  proposals: Record<string, Proposal>;
  activity: Record<string, ActivityEvent>;
  createdAt: number;
  updatedAt: number;
};

export type AppMapMutationContext = {
  expectedRevision: number;
  eventId: string;
  actorId: string;
  actorKind: ActorKind;
  at: number;
};

export type RoutineUsageReference = {
  ownerKind: "connection" | "routine" | "flow";
  ownerId: string;
  actionId?: string;
};

export type RoutineImpactPreview = {
  routineId: string;
  directUsages: RoutineUsageReference[];
  affectedRoutineIds: string[];
  affectedConnectionIds: string[];
  affectedFlowIds: string[];
};

export type SerializedAppMap = Omit<
  AppMap,
  | "screens"
  | "notes"
  | "groups"
  | "logicalStates"
  | "actionIntents"
  | "screenVariants"
  | "connections"
  | "caseStacks"
  | "variables"
  | "tests"
  | "combines"
  | "routines"
  | "flows"
  | "runs"
  | "targetResults"
  | "proposals"
  | "activity"
> & {
  notes: AppMapNote[];
  groups: MapGroup[];
  logicalStates?: LogicalProductState[];
  actionIntents?: ProductActionIntent[];
  screens: Screen[];
  screenVariants: ScreenVariant[];
  connections: Connection[];
  caseStacks: CaseStack[];
  variables: AppMapVariable[];
  tests: AppMapTest[];
  combines: AppMapCombine[];
  routines: Routine[];
  flows: Flow[];
  runs: RunReference[];
  targetResults: TargetResultReference[];
  proposals: Proposal[];
  activity: ActivityEvent[];
};

export type { AppMapErrorCode } from "./app-map-error-code.js";
