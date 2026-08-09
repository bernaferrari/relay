import type { RecipeParameter, RecipeStep, StepPoint, StepTarget } from "./recipes.js";
import type { ActorKind } from "./coordination.js";
import type { ScreenIdentity, TargetProfile } from "./index.js";

export const APP_MAP_SCHEMA_VERSION = 1 as const;

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

export type Connection = AppMapEntity & {
  fromScreenId: string;
  destination: ConnectionDestination;
  label?: string;
  caseStackId?: string;
  state: "draft" | "ready";
  actions: ActionSpec[];
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

/** A test you can bind to variables. Path = recorded flow. Tour = live children. */
export type AppMapTest = AppMapEntity & {
  name: string;
  kind: "path" | "tour";
  flowId?: string;
  rootScreenId?: string;
  depth?: number;
  screenshotEach?: boolean;
};

/** Figma-like binding: variables × tests. Extra variables are M×N×O; extra tests run in order. */
export type AppMapCombine = AppMapEntity & {
  name: string;
  variableIds: string[];
  testIds: string[];
  strategy?: CaseExpansionStrategy;
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
};

/** Public intent-level inputs. Relay owns scope and audit timestamps so a
 * human, CLI, or agent never has to manufacture persistence metadata. */
export type CreateScreenInput = Pick<Screen, "id" | "title"> &
  Partial<Pick<Screen, "description" | "identity" | "position">>;

export type CreateConnectionInput = Pick<Connection, "id" | "fromScreenId" | "destination"> &
  Partial<Pick<Connection, "label" | "caseStackId" | "state" | "actions">>;

export type SaveRoutineInput = Pick<Routine, "name" | "actions"> &
  Partial<Pick<Routine, "description" | "parameters">>;

export type SaveFlowInput = Pick<Flow, "name" | "startScreenId" | "connectionIds"> &
  Partial<Pick<Flow, "setup">>;

/** One atomic, reviewable authoring change. The desktop, CLI, HTTP API, and
 * agents use this same vocabulary so a canvas gesture cannot partially save. */
export type AppMapBatchChange =
  | { kind: "screen.add"; input: AddScreenInput }
  | { kind: "screen.update"; screenId: string; input: UpdateScreenInput }
  | { kind: "screen.remove"; screenId: string }
  | { kind: "connection.create"; connection: Connection }
  | { kind: "connection.update"; connectionId: string; patch: ConnectionPatch }
  | { kind: "connection.remove"; connectionId: string }
  | { kind: "group.save"; group: MapGroup }
  | { kind: "group.remove"; groupId: string }
  | { kind: "flow.save"; flow: Flow }
  | { kind: "flow.remove"; flowId: string };

export type ProposalChange =
  | { kind: "screen.add"; input: AddScreenInput }
  | { kind: "screen.update"; screenId: string; input: UpdateScreenInput }
  | { kind: "screen.remove"; screenId: string }
  | { kind: "connection.connect"; connection: Connection }
  | { kind: "connection.update"; connectionId: string; patch: ConnectionPatch }
  | { kind: "connection.remove"; connectionId: string }
  | { kind: "group.save"; group: MapGroup }
  | { kind: "group.remove"; groupId: string };

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
        ...(work.flowId ? { flowId: work.flowId } : {}),
        ...(work.rootScreenId ? { rootScreenId: work.rootScreenId } : {}),
        depth: work.depth ?? (work.kind === "tour" ? 0 : undefined),
      })),
      combines: byId(map.combines ?? {}).map((combine) => ({
        id: combine.id,
        name: combine.name,
        formula: [...combine.variableIds, ...combine.testIds].join(" × "),
        variableIds: combine.variableIds,
        testIds: combine.testIds,
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
