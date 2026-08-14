import type { RecipeParameter, RecipeStep, StepPoint, StepTarget } from "./recipes.js";
import type { AppMapScenarioTest, AppMapScenarioTestEdit } from "./test-intent.js";
import type { ActorKind } from "./coordination.js";
import type { ScreenIdentity, TargetProfile } from "./index.js";

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
  | "percentage"
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
  identity?: ScreenIdentity;
  position?: AppMapPoint;
  variantIds: string[];
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
  /** The canonical visual preview. Evidence lists may also contain semantic
   * snapshots or video, so renderers must never guess from array order. */
  screenshotUri?: string;
  baseline?: BaselineProvenance;
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

export type AssertionSpec =
  | { kind: "screen"; screenId: string }
  | { kind: "target"; target: StepTarget; condition: "visible" | "gone"; timeoutMs?: number }
  | {
      kind: "content";
      input: string;
      expected: string;
      match: "exact" | "contains" | "not-contains";
    };

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
    | { kind: "tap"; target: StepTarget; fallbackTargets?: StepTarget[] }
    | { kind: "text"; text: string; target?: StepTarget }
    | { kind: "gesture"; gesture: GestureSpec }
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

/** Visual presentation for a connection on the App Map canvas. These values
 * never change execution; they are durable author overrides applied after the
 * automatic layout has produced its baseline. */
export type ConnectionRouteStyle = "elbow" | "curve" | "straight";
/** Arrowheads are visual-only connector affordances. Keeping the two endpoints
 * explicit makes a collaborative canvas merge their choice independently from
 * route, port, and weight fields. */
export type ConnectionArrowStyle = "none" | "start" | "end" | "both";
export type ConnectionPort = "auto" | "left" | "right" | "top" | "bottom";
/** Immutable source-side evidence for a recorded connection. Values are
 * normalized to the captured source viewport, so an App Map can reliably mark
 * the control that initiated a transition at any canvas size or zoom. */
export type ConnectionSourceAnchor = {
  point: AppMapPoint;
  rect?: AppMapPoint & { width: number; height: number };
};
export type ConnectionPresentation = {
  /** Omitted routes use the rounded bent connector. */
  route?: ConnectionRouteStyle;
  strokeWidth?: 1 | 2 | 3;
  arrow?: ConnectionArrowStyle;
  sourcePort?: ConnectionPort;
  targetPort?: ConnectionPort;
  /** Position along the selected source edge, from 0 to 1. */
  sourceOffset?: number;
  /** Position along the selected target edge, from 0 to 1. */
  targetOffset?: number;
  /** Canvas-space nudge for an explicit curved connector. */
  controlOffset?: AppMapPoint;
};

export type Connection = AppMapEntity & {
  fromScreenId: string;
  destination: ConnectionDestination;
  label?: string;
  caseStackId?: string;
  state: "draft" | "ready";
  actions: ActionSpec[];
  /** Recorded source control evidence. This is not a mutable canvas-style field. */
  sourceAnchor?: ConnectionSourceAnchor;
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
       * a system language picker while keeping the modifier explicit. */
      kind: "appLocale";
      app: string;
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

/** A test you can bind to variables. Scenario = graph-native intent; Path and
 * Tour remain compatibility forms for recorded flows and live child walks. */
export type AppMapCapturePolicy =
  | { mode: "every-screen" }
  | { mode: "checkpoints"; screenIds: string[] }
  | { mode: "final-screen" }
  | { mode: "failures-only" }
  | { mode: "none" };

export type LegacyAppMapTest = AppMapEntity & {
  name: string;
  kind: "path" | "tour";
  flowId?: string;
  rootScreenId?: string;
  /**
   * Optional validated cold-start path for a standalone screen tour. The Flow
   * must finish at `rootScreenId`, so a tour can begin from a known app state
   * without copying launch or navigation steps into every test.
   */
  setupFlowId?: string;
  /** Exact mapped screens this test must capture. When omitted, a tour follows
   * every visible child row as before. */
  screenIds?: string[];
  /** Screen branches that are valid only for some account or feature states.
   * They are visited and captured when their recorded semantic row is present,
   * but their absence must not turn into a stale-coordinate tap or fail the
   * current-state coverage run. Values must also appear in `screenIds`. */
  optionalScreenIds?: string[];
  depth?: number;
  /** Evidence is independent from traversal: a test can visit ten screens
   * without necessarily saving ten screenshots. */
  capture?: AppMapCapturePolicy;
  /** @deprecated Read as every-screen/none when capture is absent. */
  screenshotEach?: boolean;
};

export type AppMapTest = LegacyAppMapTest | AppMapScenarioTest;

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
};

export type AppMapCombinePreflightIssue = {
  code:
    | "missing-modifier"
    | "missing-test"
    | "empty-selection"
    | "invalid-modifier"
    | "invalid-test"
    | "compile-failed"
    | "large-run"
    | "unknown-screenshot-count"
    | "target-missing"
    | "target-not-ready";
  message: string;
};

/** Exact run-plan projection shared by the canvas, server, and CLI. */
export type AppMapCombinePreflight = {
  ok: boolean;
  appMapId: string;
  combineId: string;
  name: string;
  formula: string;
  strategy: CaseExpansionStrategy;
  modifiers: Array<{
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
  blockers: AppMapCombinePreflightIssue[];
  warnings: AppMapCombinePreflightIssue[];
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
  evidenceIds: string[];
  finishedAt?: number;
};

export type AddScreenInput = { screen: Screen; variants?: ScreenVariant[] };

export type ScreenPatch = {
  title?: string;
  description?: string | null;
  identity?: ScreenIdentity | null;
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
  caseStackId?: string | null;
  state?: Connection["state"];
  actions?: ActionSpec[];
  /** Capture-derived origin evidence. `null` deliberately removes stale or
   * disproven evidence; normal canvas styling must never modify this field. */
  sourceAnchor?: ConnectionSourceAnchor | null;
  presentation?: ConnectionPresentation | null;
};

/** Public intent-level inputs. Relay owns scope and audit timestamps so a
 * human, CLI, or agent never has to manufacture persistence metadata. */
export type CreateScreenInput = Pick<Screen, "id" | "title"> &
  Partial<Pick<Screen, "description" | "identity" | "position">>;

export type CreateConnectionInput = Pick<Connection, "id" | "fromScreenId" | "destination"> &
  Partial<Pick<Connection, "label" | "caseStackId" | "state" | "actions" | "presentation">>;

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
  /** A Flow and the Test that exposes it can be authored in one atomic map
   * revision. This avoids a half-promoted recording on a revision conflict. */
  | { kind: "test.save"; test: AppMapTest };

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
    | "test.removed"
    | "combine.saved"
    | "combine.removed"
    | "recording.committed"
    | "run.finished"
    | "proposal.submitted"
    | "proposal.approved"
    | "proposal.rejected";
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

/**
 * CRDT-replicated canvas data. The execution graph itself stays authoritative
 * on the server: a live document may move a card or restyle a wire, but it
 * cannot silently alter device actions, evidence, flows, or run results.
 */
export type AppMapCanvasCollaborationEntities = {
  notes: Record<string, { id: string; text: string; position: AppMapPoint }>;
  groups: Record<string, { id: string; name: string; screenIds: string[] }>;
  /** `null` means restore automatic layout / remove an explicit position. */
  screenLayouts: Record<string, { id: string; position: AppMapPoint | null }>;
  /** `null` means restore the automatic connector presentation. */
  connectionPresentations: Record<
    string,
    { id: string; presentation: ConnectionPresentation | null }
  >;
};

export type AppMapCollaborationCollection = keyof AppMapCanvasCollaborationEntities;

/** Provider-neutral data shape for Yjs, Automerge, or a future Relay sync
 * service. Every collection is a stable-id map. Providers should represent a
 * connector presentation as a nested field map and x/y coordinates as atomic
 * point registers, rather than serializing and replacing this whole object. */
export type AppMapCollaborationDocument = {
  format: "relay.app-map-authoring";
  formatVersion: typeof APP_MAP_COLLABORATION_DOCUMENT_VERSION;
  schemaVersion: typeof APP_MAP_SCHEMA_VERSION;
  id: string;
  organizationId: string;
  projectId: string;
  createdAt: number;
  entities: AppMapCanvasCollaborationEntities;
};

/** `null` removes one visual override; omitted fields are left untouched. */
export type ConnectionPresentationPatch = {
  [Key in keyof ConnectionPresentation]?: ConnectionPresentation[Key] | null;
};

/**
 * Typed, field-level changes emitted by a collaboration provider. They are
 * intentionally narrower than `AppMapBatchChange`: the server converts them
 * into a normal revisioned commit, assigns authoritative timestamps, and
 * validates references before publishing a new canonical snapshot.
 */
export type AppMapCollaborationChange =
  | { kind: "note.save"; id: string; text: string; position: AppMapPoint }
  | { kind: "note.remove"; noteId: string }
  | { kind: "group.save"; id: string; name: string; screenIds: string[] }
  | { kind: "group.remove"; groupId: string }
  | { kind: "screen.layout"; screenId: string; position: AppMapPoint | null }
  | { kind: "connection.presentation"; connectionId: string; reset: true }
  | {
      kind: "connection.presentation";
      connectionId: string;
      patch: ConnectionPresentationPatch;
    };

/**
 * The minimal document façade a collaboration provider must implement. Relay
 * owns the document shape and validation; connection and awareness transport
 * stay in separate adapters. `origin` lets a future Yjs UndoManager track
 * local transactions without putting remote collaborator edits in Undo.
 */
export type AppMapCollaborationAdapter<TDocument = unknown> = {
  readonly kind: string;
  create(initial: AppMapCollaborationDocument): TDocument;
  read(document: TDocument): AppMapCollaborationDocument;
  /** Apply only the supplied entity fields inside one CRDT transaction. */
  transact(
    document: TDocument,
    changes: readonly AppMapCollaborationChange[],
    options?: { origin?: unknown },
  ): void;
  observe(document: TDocument, listener: () => void): () => void;
  destroy(document: TDocument): void;
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

export type AppMapErrorCode =
  | "invalid-map"
  | "scope-mismatch"
  | "revision-conflict"
  | "duplicate-id"
  | "missing-reference"
  | "in-use"
  | "proposal-state";

/**
 * Keep the common agent/terminal view of a map useful and bounded. The full
 * App Map—including semantic trees and artifact URIs—remains available from
 * the HTTP resource and UI client; command surfaces normally need topology.
 */
export function summarizeAppMapOperationResult(operationId: string, result: unknown): unknown {
  if (!operationId.startsWith("app-map.")) return result;
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;
  if (operationId === "app-map.list") {
    const appMaps = (result as { appMaps?: unknown }).appMaps;
    if (!Array.isArray(appMaps)) return result;
    const summaries = appMaps.map((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
      const map = value as AppMap;
      if (
        typeof map.id !== "string" ||
        typeof map.name !== "string" ||
        typeof map.revision !== "number" ||
        !map.screens ||
        !map.screenVariants ||
        !map.connections ||
        !map.flows
      )
        return undefined;
      return {
        id: map.id,
        name: map.name,
        ...(map.description ? { description: map.description } : {}),
        revision: map.revision,
        counts: {
          screens: Object.keys(map.screens).length,
          variants: Object.keys(map.screenVariants).length,
          connections: Object.keys(map.connections).length,
          flows: Object.keys(map.flows).length,
        },
        createdAt: map.createdAt,
        updatedAt: map.updatedAt,
      };
    });
    if (summaries.some((summary) => !summary)) return result;
    return { ...(result as Record<string, unknown>), appMaps: summaries };
  }
  const appMap = (result as { appMap?: unknown }).appMap;
  if (!appMap || typeof appMap !== "object" || Array.isArray(appMap)) return result;
  const map = appMap as AppMap;
  if (
    typeof map.id !== "string" ||
    typeof map.name !== "string" ||
    typeof map.revision !== "number" ||
    !map.screens ||
    !map.connections
  )
    return result;

  const byId = <T extends AppMapEntity>(values: Record<string, T>): T[] =>
    Object.values(values).sort((left, right) => left.id.localeCompare(right.id));

  return {
    ...(result as Record<string, unknown>),
    appMap: {
      id: map.id,
      name: map.name,
      ...(map.description ? { description: map.description } : {}),
      revision: map.revision,
      screens: byId(map.screens).map((screen) => ({
        id: screen.id,
        title: screen.title,
        variantCount: screen.variantIds.length,
      })),
      connections: byId(map.connections).map((connection) => ({
        id: connection.id,
        ...(connection.label ? { label: connection.label } : {}),
        fromScreenId: connection.fromScreenId,
        destination: connection.destination,
        state: connection.state,
        actionCount: connection.actions.length,
      })),
      groups: byId(map.groups).map((group) => ({
        id: group.id,
        name: group.name,
        screenIds: group.screenIds,
      })),
      flows: byId(map.flows).map((flow) => ({
        id: flow.id,
        name: flow.name,
        startScreenId: flow.startScreenId,
        ...(flow.setup ? { setup: flow.setup } : {}),
        connectionIds: flow.connectionIds,
      })),
      variables: byId(map.variables ?? {}).map((set) => ({
        id: set.id,
        name: set.name,
        kind: set.kind,
        optionCount: set.options.length,
        options: set.options.map((option) => ({
          id: option.id,
          ...(option.label ? { label: option.label } : {}),
          ...(option.text ? { text: option.text } : {}),
          ...(option.identifier ? { identifier: option.identifier } : {}),
        })),
        sandwich:
          set.apply.kind === "list"
            ? {
                in: Boolean(set.apply.inConnectionId || set.apply.entryPath?.length),
                list: set.options.length > 0,
                out: Boolean(set.apply.outConnectionId || set.apply.exitPath?.length),
              }
            : { toggle: true },
      })),
      tests: byId(map.tests ?? {}).map((work) => ({
        id: work.id,
        name: work.name,
        kind: work.kind,
        ...(work.kind === "path" && work.flowId ? { flowId: work.flowId } : {}),
        ...(work.kind === "tour" && work.rootScreenId ? { rootScreenId: work.rootScreenId } : {}),
        ...(work.kind === "tour" && work.setupFlowId ? { setupFlowId: work.setupFlowId } : {}),
        ...(work.capture ? { capture: work.capture } : {}),
        ...(work.kind === "tour" ? { depth: work.depth ?? 0 } : {}),
        ...(work.kind === "scenario" ? { stepCount: work.steps.length } : {}),
      })),
      combines: byId(map.combines ?? {}).map((combine) => ({
        id: combine.id,
        name: combine.name,
        formula: [
          ...combine.variableIds.map((id) => map.variables?.[id]?.name ?? id),
          ...combine.testIds.map((id) => map.tests?.[id]?.name ?? id),
        ].join(" × "),
        variableIds: combine.variableIds,
        testIds: combine.testIds,
        ...(combine.selected ? { selected: combine.selected } : {}),
        selectedCounts: Object.fromEntries(
          combine.variableIds.map((id) => [
            id,
            combine.selected?.[id]?.length ?? map.variables?.[id]?.options.length ?? 0,
          ]),
        ),
        ...(combine.captures ? { captures: combine.captures } : {}),
        strategy: combine.strategy ?? (combine.variableIds.length > 1 ? "cartesian" : "zip"),
      })),
      counts: {
        screens: Object.keys(map.screens).length,
        variants: Object.keys(map.screenVariants).length,
        connections: Object.keys(map.connections).length,
        groups: Object.keys(map.groups).length,
        caseStacks: Object.keys(map.caseStacks).length,
        variables: Object.keys(map.variables ?? {}).length,
        tests: Object.keys(map.tests ?? {}).length,
        combines: Object.keys(map.combines ?? {}).length,
        routines: Object.keys(map.routines).length,
        flows: Object.keys(map.flows).length,
        runs: Object.keys(map.runs).length,
        targetResults: Object.keys(map.targetResults).length,
        proposals: Object.keys(map.proposals).length,
      },
      createdAt: map.createdAt,
      updatedAt: map.updatedAt,
    },
  };
}
