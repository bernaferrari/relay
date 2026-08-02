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

export type Screen = AppMapEntity & {
  title: string;
  description?: string;
  identity?: ScreenIdentity;
  position?: AppMapPoint;
  variantIds: string[];
};

export type AppMapPatch = { name?: string };

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
  baseline?: BaselineProvenance;
};

type ActionMetadata = { id: string; label?: string };

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
    | { kind: "tap"; target: StepTarget }
    | { kind: "text"; text: string; target?: StepTarget }
    | { kind: "gesture"; gesture: GestureSpec }
    | { kind: "back" }
    | { kind: "home" }
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
  state: "draft" | "ready";
  actions: ActionSpec[];
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
  connectionIds: string[];
};

export type AppMapCompiledStepProvenance = {
  recipeId: string;
  stepIndex: number;
  stepId: string;
  origin: "action" | "destination";
  ownerKind: "connection" | "routine";
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
  /** Half-open range in the root recipe: [start, end). */
  compiledStepRange: readonly [start: number, end: number];
};

/** Immutable execution plan compiled from one exact App Map revision. */
export type AppMapCompiledFlow = {
  schemaVersion: 1;
  appMapId: string;
  appMapRevision: number;
  flow: Pick<Flow, "id" | "name" | "startScreenId">;
  rootRecipeId: string;
  recipes: Record<string, AppMapCompiledRecipe>;
  connections: AppMapCompiledConnection[];
  terminal: ConnectionDestination | { kind: "screen"; screenId: string };
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
  state?: Connection["state"];
  actions?: ActionSpec[];
};

export type ProposalChange =
  | { kind: "screen.add"; input: AddScreenInput }
  | { kind: "screen.update"; screenId: string; input: UpdateScreenInput }
  | { kind: "screen.remove"; screenId: string }
  | { kind: "connection.connect"; connection: Connection }
  | { kind: "connection.update"; connectionId: string; patch: ConnectionPatch }
  | { kind: "connection.remove"; connectionId: string };

export type ProposalDecision = { actorId: string; at: number; reason?: string };

export type Proposal = AppMapEntity & {
  title: string;
  description?: string;
  status: "pending" | "approved" | "rejected";
  baseRevision: number;
  changes: ProposalChange[];
  decision?: ProposalDecision;
};

export type ActivitySubjectKind =
  | "app-map"
  | "screen"
  | "connection"
  | "flow"
  | "routine"
  | "proposal";

export type ActivityEvent = AppMapScope & {
  id: string;
  actorId: string;
  actorKind: ActorKind;
  eventType:
    | "app-map.updated"
    | "screen.added"
    | "screen.updated"
    | "screen.removed"
    | "connection.connected"
    | "connection.updated"
    | "connection.removed"
    | "flow.saved"
    | "flow.removed"
    | "routine.saved"
    | "routine.removed"
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
  revision: number;
  screens: Record<string, Screen>;
  screenVariants: Record<string, ScreenVariant>;
  connections: Record<string, Connection>;
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
  ownerKind: "connection" | "routine";
  ownerId: string;
  actionId: string;
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
  | "screenVariants"
  | "connections"
  | "routines"
  | "flows"
  | "runs"
  | "targetResults"
  | "proposals"
  | "activity"
> & {
  screens: Screen[];
  screenVariants: ScreenVariant[];
  connections: Connection[];
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
