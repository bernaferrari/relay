import type { AppMapCapturePolicy, AppMapEntity, AssertionSpec } from "./app-map.js";
import type { HumanCheckpointReason, RecipeStep, StepTarget } from "./recipes.js";
import type { ScrollSurfaceTestBinding } from "./scroll-surface.js";

export const APP_MAP_TEST_INTENT_SCHEMA_VERSION = 1 as const;

export const APP_MAP_TEST_INTENT_LIMITS = Object.freeze({
  maxSteps: 200,
  maxDepth: 3,
  maxBranches: 8,
  maxLoopIterations: 20,
  maxIntentLength: 2_000,
  maxNoteLength: 4_000,
  maxCriteria: 20,
  maxScriptLength: 20_000,
  maxCandidates: 12,
} as const);

export type AppMapTestBindingCandidate = {
  kind: "connection" | "screen" | "routine";
  id: string;
  label: string;
};

export type UnresolvedTestBinding = {
  status: "unresolved";
  reason: string;
  candidates?: AppMapTestBindingCandidate[];
};

export type ResolvedTestBinding<T extends object> = { status: "resolved" } & T;

type TestStepBase = {
  /** Stable collaborative identity. Reordering never changes this value. */
  id: string;
  /** Human-authored intent. It is never interpreted by the runtime. */
  intent: string;
  note?: string;
  /** Capture one evidence frame after this authored step completes. */
  capture?: boolean;
  /** A reviewed coverage decision. Disabled steps remain in the document and
   * review history, but the compiler omits them from execution until a later
   * proposal restores them. */
  execution?: {
    status: "disabled";
    reason: string;
    repairTargetId: string;
    decidedBy: string;
    decidedAt: number;
  };
};

export type AppMapTestStepCleanup = {
  kind: "routine";
  routineId: string;
  bindings?: Record<string, string>;
  /** Proven terminal state after the cleanup Routine's mandatory assertions. */
  terminalScreenId: string;
  /** Required so cancellation behavior is never an implicit runner default. */
  onCancel: "run-if-controllable" | "skip";
};

export type AppMapInstructionTestStep = TestStepBase & {
  kind: "instruction";
  binding:
    | UnresolvedTestBinding
    | ResolvedTestBinding<{ kind: "connections"; connectionIds: string[] }>;
  /**
   * An auditable compensating Routine that restores product state after this
   * graph path, whether the primary path passes or fails. The authored
   * cancellation policy is frozen into the compiled recipe; a cleanup may
   * continue only while ownership and target transport remain valid.
   */
  cleanup?: AppMapTestStepCleanup;
};

export type AppMapValidationRecipeStep =
  | Extract<RecipeStep, { kind: "expect" | "expect-set" | "assert-content" }>
  | Extract<RecipeStep, { kind: "evaluate-semantic" }>;

export type AppMapValidationTestStep = TestStepBase & {
  kind: "validation";
  binding:
    | UnresolvedTestBinding
    | ResolvedTestBinding<
        | { kind: "assertion"; assertion: AssertionSpec }
        | { kind: "recipe-step"; step: AppMapValidationRecipeStep }
      >;
};

export type AppMapExtractionTestStep = TestStepBase & {
  kind: "extraction";
  binding:
    | UnresolvedTestBinding
    | ResolvedTestBinding<{
        kind: "extract";
        as: string;
        target: StepTarget;
        role?: "user" | "assistant" | "system";
      }>;
};

export type AppMapManualTestStep = TestStepBase & {
  kind: "manual";
  binding:
    | UnresolvedTestBinding
    | ResolvedTestBinding<{
        kind: "pause";
        message: string;
        reason?: HumanCheckpointReason;
        resumeLabel?: string;
        timeoutMs?: number;
        verifyAfter?: {
          target: StepTarget;
          condition?: "visible" | "gone";
          timeoutMs?: number;
        };
      }>;
};

export type AppMapModuleTestStep = TestStepBase & {
  kind: "module";
  binding:
    | UnresolvedTestBinding
    | ResolvedTestBinding<{
        kind: "routine";
        routineId: string;
        bindings?: Record<string, string>;
      }>;
};

export type AppMapDecisionTestStep = TestStepBase & {
  kind: "decision";
  binding:
    | UnresolvedTestBinding
    | ResolvedTestBinding<{
        kind: "condition";
        input: string;
        operator: "exists" | "equals" | "not-equals" | "contains";
        expected?: string;
      }>;
  thenSteps: AppMapScenarioTestStep[];
  elseSteps?: AppMapScenarioTestStep[];
};

export type AppMapLoopTestStep = TestStepBase & {
  kind: "loop";
  binding: UnresolvedTestBinding | ResolvedTestBinding<{ kind: "repeat"; count: number }>;
  steps: AppMapScenarioTestStep[];
};

export type AppMapScriptTestStep = TestStepBase & {
  kind: "script";
  binding: UnresolvedTestBinding | ResolvedTestBinding<{ kind: "script"; source: string }>;
};

export type AppMapScenarioTestStep =
  | AppMapInstructionTestStep
  | AppMapValidationTestStep
  | AppMapExtractionTestStep
  | AppMapManualTestStep
  | AppMapModuleTestStep
  | AppMapDecisionTestStep
  | AppMapLoopTestStep
  | AppMapScriptTestStep;

export type AppMapScenarioTest = AppMapEntity & {
  name: string;
  kind: "scenario";
  intentSchemaVersion: typeof APP_MAP_TEST_INTENT_SCHEMA_VERSION;
  steps: AppMapScenarioTestStep[];
  capture?: AppMapCapturePolicy;
  /** Logical surface coverage is independent from graph navigation. */
  surfaceBindings?: ScrollSurfaceTestBinding[];
};

/** Semantic, stable-ID edits are the collaboration boundary for Tests.
 * Providers may transport these through HTTP today and CRDT updates later;
 * neither path needs to replace or address steps by array index. */
export type AppMapTestStepBranch = "root" | "then" | "else" | "steps";

export type AppMapTestStepPlacement =
  | { parentStepId?: undefined; branch?: "root" }
  | { parentStepId: string; branch: Exclude<AppMapTestStepBranch, "root"> };

export type AppMapTestStepPatch = {
  intent?: string;
  /** `null` removes the note. */
  note?: string | null;
  capture?: boolean;
  /** `null` removes the compensating Routine. */
  cleanup?: AppMapTestStepCleanup | null;
  /** `null` restores normal execution. */
  execution?: TestStepBase["execution"] | null;
  binding?: AppMapScenarioTestStep["binding"];
};

export type AppMapScenarioTestEdit =
  | { kind: "test.patch"; patch: { name?: string; capture?: AppMapCapturePolicy | null } }
  | {
      kind: "step.add";
      step: AppMapScenarioTestStep;
      placement?: AppMapTestStepPlacement;
      index?: number;
    }
  | { kind: "step.patch"; stepId: string; patch: AppMapTestStepPatch }
  | { kind: "step.remove"; stepId: string }
  | {
      kind: "step.reorder";
      orderedStepIds: string[];
      placement?: AppMapTestStepPlacement;
    }
  | {
      kind: "step.bind";
      stepId: string;
      binding: AppMapScenarioTestStep["binding"];
    }
  | {
      kind: "step.unbind";
      stepId: string;
      reason: string;
      candidates?: AppMapTestBindingCandidate[];
    };

export type AppMapTestStepProvenance = {
  recipeId: string;
  stepIndex: number;
  recipeStepId: string;
  testId: string;
  testStepId: string;
  bindingKind:
    | "connections"
    | "assertion"
    | "recipe-step"
    | "extract"
    | "pause"
    | "routine"
    | "condition"
    | "repeat"
    | "script";
  referencedEntityIds: string[];
};

/** A blocking graph defect found while compiling a Test. These diagnostics are
 * intentionally stable across the app, CLI, and MCP surfaces so an author or
 * agent can repair the exact transition instead of discovering it mid-run. */
export type AppMapTestCompileDiagnostic = {
  code: "unresolved-return";
  severity: "blocker";
  testId: string;
  testStepId: string;
  check: string;
  recipeId: string;
  recipeStepId: string;
  connectionId: string;
  sourceScreenId: string;
  destinationScreenId: string;
  suggestion: string;
  suggestedAction: {
    kind: "teach-return";
    appMapId: string;
    fromScreenId: string;
    destinationScreenId: string;
    blockedConnectionId: string;
  };
};

export type AppMapCompiledTest = {
  schemaVersion: 1;
  appMapId: string;
  appMapRevision: number;
  test: Pick<AppMapScenarioTest, "id" | "name" | "kind" | "intentSchemaVersion">;
  surfaceBindings?: ScrollSurfaceTestBinding[];
  rootRecipeId: string;
  recipes: Record<
    string,
    {
      id: string;
      title: string;
      description?: string;
      parameters: Array<{
        name: string;
        label?: string;
        description?: string;
        default?: string;
        required?: boolean;
      }>;
      steps: RecipeStep[];
    }
  >;
  stepProvenance: AppMapTestStepProvenance[];
  /** Static scheduled root/module accounting for the frozen graph. Branch and
   * repeat bodies remain represented by their control operation; recovery/SOS
   * recipes are intentionally excluded because they execute only on drift. */
  performance: {
    executableOperations: number;
    moduleCalls: number;
    operationCounts: Partial<Record<RecipeStep["kind"], number>>;
    screenshotCount: number;
    destinationProofCount: number;
  };
  startup: { mode: "cold" } | { mode: "verified-checkpoint"; screenId: string };
  omittedSteps?: Array<{
    stepId: string;
    intent: string;
    reason: string;
    repairTargetId: string;
  }>;
};
