import type { AppMapValidationRecipeStep } from "./test-validation-recipe-step.js";
import type { AppMapTestStartingState } from "../routine-effects.js";
import type {
  ExecutionQueue,
  ExecutionQueueDurationQuote,
  IosReadinessDurationQuote,
} from "../execution/execution-queue.js";
import type { RouteVariantConfigurationQuote } from "../route-variant-configuration.js";
import type { BrowserEngine } from "../browser/browser-case-profile.js";
import type {
  AppMapCapturePolicy,
  AppMapEntity,
  AssertionSpec,
  NormalizedSemanticNode,
} from "../app-map/app-map.js";
import type { CaptureReviewPlannedSlot } from "../capture/capture-review.js";
import type {
  ReviewedActionIntentBinding,
  ReviewedLogicalStateBinding,
} from "../product-intent.js";
import type {
  HumanCheckpointReason,
  RecipeStep,
  RequirementActionKind,
  StepTarget,
} from "../recipes.js";
import type { RawAccessibilityTreeEvidence, ScrollSurfaceTestBinding } from "../scroll-surface.js";
import type { TargetCapability, TargetProfile } from "../target/target-contract.js";

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

/** How one cached action's target resolved on the run that saved it. Only
 * semantic strategies are admitted; a coordinate resolution makes the step
 * uncacheable because it can never miss when the UI moves. */
export type PlainEnglishStepCacheResolution = {
  strategy: "identifier" | "ref" | "label" | "text";
  key: string;
};

/** Actions that last carried out a plain-English step, with the proof needed
 * to replay them safely: where they run, how their targets resolved, and the
 * outcome of the run that produced them. */
export type PlainEnglishStepCacheV2 = {
  schemaVersion: 2;
  steps: RecipeStep[];
  runId: string;
  savedAt: number;
  targetKind: "browser" | "device";
  platform?: "android" | "ios";
  viewport?: { width: number; height: number };
  resolution: PlainEnglishStepCacheResolution[];
  verification: { runOutcome: "passed"; checkStepIds?: string[] };
  /** Lineage of the entry this one re-resolved after a saved path no longer
   * matched the screen. */
  healedFrom?: { runId: string; savedAt: number; reason: string };
  hits?: number;
  lastHitAt?: number;
};

/** Legacy entries predate the proof fields. They remain valid document data
 * but compile as absent, so the next run re-caches through the model once. */
export type PlainEnglishStepCacheLegacy = {
  steps: RecipeStep[];
  runId: string;
  savedAt: number;
};

export type UnresolvedTestBinding = {
  status: "unresolved";
  reason: string;
  candidates?: AppMapTestBindingCandidate[];
  /** Run from its words (model taps an Action, a judge decides a Check). */
  fromText?: true;
  /** Actions that last carried out these words; replayed before the model. */
  cache?: PlainEnglishStepCacheLegacy | PlainEnglishStepCacheV2;
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
   * cancellation policy is frozen into the compiled execution plan; a cleanup may
   * continue only while ownership and target transport remain valid.
   */
  cleanup?: AppMapTestStepCleanup;
};

export type { AppMapValidationRecipeStep } from "./test-validation-recipe-step.js";

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

export type AppMapTestViewportClass = "compact" | "medium" | "expanded";

/** Omitted dimensions are wildcards. Each supplied dimension is an allow-list
 * and all supplied dimensions must match the frozen saved target profile. */
export type AppMapTestSurfacePredicate = {
  platforms?: TargetProfile["platform"][];
  browserEngines?: BrowserEngine[];
  viewportClasses?: AppMapTestViewportClass[];
  requiredCapabilities?: TargetCapability[];
};

export type AppMapTestResolvedBinding = Extract<
  AppMapScenarioTestStep["binding"],
  { status: "resolved" }
>;

/** One reviewed implementation of stable Test step IDs for a target surface.
 * The friendly intent and graph structure stay on the Test; only concrete
 * bindings vary. */
export type AppMapTestRouteVariant = {
  id: string;
  revision: number;
  predicate: AppMapTestSurfacePredicate;
  bindings: Record<string, AppMapTestResolvedBinding>;
  reviewedAt: number;
  reviewedBy: string;
};

export type AppMapTestFamily = {
  logicalIntentRevision: number;
  bindingRevision: number;
  routeVariants: AppMapTestRouteVariant[];
};

/** Cross-map same-intent Test. Pointers never record a route on this map.
 * Compile with `ios` / `android` (or a companion-map profile id) follows the
 * companion Test on that App Map instead of disabling Web steps. */
export type AppMapNativeRouteCompanion = {
  platform: "android" | "ios";
  appMapId: string;
  testId: string;
};

/** Provenance when a web compile followed a linked native Test. */
export type AppMapNativeCompanionCompile = AppMapNativeRouteCompanion & {
  requestedFrom: { appMapId: string; testId: string };
};

export type AppMapScenarioTest = AppMapEntity & {
  name: string;
  kind: "scenario";
  intentSchemaVersion: typeof APP_MAP_TEST_INTENT_SCHEMA_VERSION;
  steps: AppMapScenarioTestStep[];
  /** Exact package/bundle selected during recording setup for this Test. It
   * is frozen into compiled runs; runtime must never derive it from AX. */
  originApplication?: string;
  /** Web address a plain-English Test opens before its first step. Recorded
   * steps carry their own entrance and ignore it. */
  startUrl?: string;
  /** Absent means an intentionally unjoined, legacy single-surface family. */
  family?: AppMapTestFamily;
  /** Honest native links. Compile on this map stays unrecorded; ios/android
   * profile compile follows the companion Test on its App Map. */
  nativeRouteCompanions?: AppMapNativeRouteCompanion[];
  capture?: AppMapCapturePolicy;
  /** Entry facts / leftover this Test claims. A following Test cannot treat
   * leftover Settings, sidebar, Private Chat, or signed-out as Home. */
  startingState?: AppMapTestStartingState;
  /** Fast UI / live output / stateful-survival. Dest-end chrome inspect
   * defaults to Fast UI. Absent is undeclared, never an S16 claim. */
  executionQueue?: ExecutionQueue;
  /** Capture-view may reuse leftover dest chrome. Test-action must execute
   * the named opener. Omitted dest-end navigation stays test-action. */
  requirementAction?: RequirementActionKind;
  /** Logical surface coverage is independent from graph navigation. */
  surfaceBindings?: ScrollSurfaceTestBinding[];
  /** Optional exact validation receipt. Legacy Tests without a receipt retain
   * their historical authoring status; once present it is revision-bound. */
  validation?: {
    status: "passed" | "needs-validation";
    appMapRevision: number;
    testUpdatedAt: number;
    validatedAt?: number;
  };
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

/** Bindings accepted by a `step.bind` edit: binding a step always requires a
 * resolved binding; unbinding is the separate `step.unbind` edit. */
export type ResolvedAppMapScenarioTestBinding = Exclude<
  AppMapScenarioTestStep["binding"],
  UnresolvedTestBinding
>;

export type AppMapScenarioTestEdit =
  | {
      kind: "test.patch";
      patch: {
        name?: string;
        capture?: AppMapCapturePolicy | null;
        family?: AppMapTestFamily | null;
        nativeRouteCompanions?: AppMapNativeRouteCompanion[] | null;
        startingState?: AppMapTestStartingState | null;
        executionQueue?: ExecutionQueue | null;
        requirementAction?: RequirementActionKind | null;
      };
    }
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
      binding: ResolvedAppMapScenarioTestBinding;
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

/** Why the frozen graph scheduler kept, deferred, or reordered one check.
 * These codes are part of the compiled-Test contract: the app, CLI, HTTP, and
 * MCP all receive the same explanation without consulting a live target. */
export type AppMapTestExecutionScheduleReason =
  | "reviewed-return-equivalence"
  | "authored-order"
  | "cleanup-boundary"
  | "external-handoff"
  | "cold-reset-branch"
  | "unknown-cursor"
  | "prerequisite-boundary"
  | "unknown-document-position"
  | "conflicting-document-order"
  | "missing-reviewed-return";

/** The narrow proof that lets a scheduler treat a leaf as a sibling of other
 * checks starting from the same screen. It intentionally names only reviewed
 * inverse edges; a coordinate, title, or inferred Back gesture is never
 * enough to establish this equivalence. */
export type AppMapTestReviewedReturnEquivalence = {
  sourceScreenId: string;
  terminalScreenId: string;
  kind: "back" | "connection";
  connectionIds: string[];
};

export type AppMapTestExecutionScheduleCheck = {
  checkId: string;
  recipeId: string;
  authoredIndex: number;
  proposedIndex: number;
  sourceScreenId?: string;
  /** Stable ordinal from the frozen semantic surface. This is the scheduling
   * key; documentY is retained only as an inspectable visual coordinate. */
  semanticDocumentOrder?: number;
  documentY?: number;
  disposition: "scheduled" | "fixed" | "deferred";
  reason: AppMapTestExecutionScheduleReason;
  returnToSource?: AppMapTestReviewedReturnEquivalence;
};

/** A cold fallback is retained for SOS/review but never joins the normal
 * schedule. Keeping it separate from the warm check prevents a proposed order
 * from looking as if Relay may silently reset or relaunch a target. */
export type AppMapTestDeferredScheduleBranch = {
  checkId: string;
  recipeId: string;
  reason: "cold-reset-branch";
};

/** The run-scoped starting contract for a compiled Test. A verified checkpoint
 * is deliberately not a cache hint: Relay proves the live screen before the
 * first suffix operation and stops on a mismatch instead of recovering with a
 * cold app launch. */
export type AppMapTestStartup =
  | { mode: "warm" }
  | { mode: "cold" }
  | { mode: "verified-checkpoint"; screenId: string };

/** The exact target/locale Variant identity frozen beside raw accessibility
 * evidence. This is deliberately independent of visible copy: profile IDs,
 * not translated labels, select a runtime evidence scope. */
export type AppMapCompiledRawAccessibilityVariant = {
  id: string;
  /** Historical provenance keeps run promotions from replacing an authored
   * default source when both share one runtime profile. */
  captureProvenanceKind?: "run";
  /** Optional capture locale, retained so a later localized run cannot win
   * default selection merely because its variant id sorts first. */
  locale?: string;
  /** This is the explicit target/locale source key. Relay never infers a
   * locale from visible text. */
  targetProfileId: string;
  targetId: string;
  platform: TargetProfile["platform"];
  model?: TargetProfile["model"];
  androidAvdName?: TargetProfile["androidAvdName"];
  osVersion?: TargetProfile["osVersion"];
  viewport?: { width: number; height: number };
  browserCaseProfile?: TargetProfile["browserCaseProfile"];
  capabilities?: TargetProfile["capabilities"];
};

/** The immutable runtime identity ledger for a compiled Test. This is global
 * to the Test rather than a property of one screen: a selector on an
 * English-only screen must still require a choice when the Test also contains
 * a Portuguese target profile. Viewport is part of identity because stable
 * selector reuse is only safe at an exact captured shape. */
export type AppMapCompiledRawAccessibilityTargetProfile = Pick<
  TargetProfile,
  "id" | "targetId" | "platform" | "androidAvdName" | "viewport" | "browserCaseProfile"
> &
  Partial<Pick<TargetProfile, "model" | "osVersion">> & {
    capabilities?: readonly TargetCapability[];
  };

/** The saved target/profile binding selected for one queued Test. It is
 * frozen into run-only artifacts after server-side target validation; it
 * never changes the App Map or tries to infer locale from rendered copy. */
export type AppMapCompiledRuntimeTargetProfile = Pick<
  TargetProfile,
  "id" | "targetId" | "platform" | "androidAvdName" | "viewport" | "browserCaseProfile"
> &
  Partial<Pick<TargetProfile, "model" | "osVersion">> & {
    capabilities?: readonly TargetCapability[];
  };

/** One immutable raw AX blob with the exact App Map Variant that supplied it.
 *
 * The tree digest alone is intentionally not a selector-equivalence claim: a
 * single CAS blob can legitimately be attached to multiple profiles or locale
 * variants. Keeping that source identity in the compiled Test lets offline
 * review name the precise capture and gives later compatibility checks enough
 * information to fail closed instead of blessing a translated selector from a
 * different Variant. */
export type AppMapCompiledRawAccessibilitySource = {
  screenId: string;
  variant: AppMapCompiledRawAccessibilityVariant;
  origin:
    | {
        kind: "screen-variant";
        /** Present for new ordinary captures; absence identifies a historical
         * raw reference whose observation binding was never recorded. */
        observationId?: string;
        capturedAt?: number;
      }
    | {
        kind: "scroll-surface-viewport";
        surfaceId: string;
        captureId: string;
        viewportIndex: number;
        capturedAt: number;
      };
  tree: RawAccessibilityTreeEvidence & {
    observationId?: string;
    capturedAt?: number;
  };
};

export type AppMapCompiledTest = {
  schemaVersion: 1;
  appMapId: string;
  appMapRevision: number;
  test: Pick<AppMapScenarioTest, "id" | "name" | "kind" | "intentSchemaVersion">;
  /** Present only on a queued run after Relay bound the selected saved profile
   * to the requested control target and preflighted this exact frozen plan. */
  runtimeTargetProfile?: AppMapCompiledRuntimeTargetProfile;
  /** Immutable Test-family and reviewed-binding provenance selected before
   * target control. Legacy Tests receive an explicit single-surface migration
   * record and are never heuristically joined. */
  testFamily?: {
    schemaVersion: 1;
    mode: "legacy-single-surface" | "reviewed-route-variant";
    testRevision: number;
    logicalIntentRevision: number;
    bindingRevision: number;
    selectedRouteVariant?: {
      id: string;
      revision: number;
      reviewedAt: number;
      reviewedBy: string;
    };
    targetSurface?: {
      targetProfileId: string;
      targetId: string;
      platform: TargetProfile["platform"];
      viewport?: { width: number; height: number };
      viewportClass?: AppMapTestViewportClass;
      browserEngine?: BrowserEngine;
      capabilities: TargetCapability[];
    };
    logicalStateBindings: Array<{ screenId: string } & ReviewedLogicalStateBinding>;
    actionIntentBindings: Array<{ connectionId: string } & ReviewedActionIntentBinding>;
  };
  surfaceBindings?: ScrollSurfaceTestBinding[];
  /** Content-addressed raw AX evidence frozen at compile time, with its
   * source Variant/profile retained beside every blob. This gives offline
   * preflight the exact same geometry that authored this plan; it must never
   * re-read a newer mutable Variant instead. */
  rawAccessibilitySourcesByScreenId?: Record<string, AppMapCompiledRawAccessibilitySource[]>;
  /** Every known target/locale Variant per logical screen, including variants
   * that currently lack a raw tree. This is a frozen selection ledger, not a
   * selector-equivalence claim: offline review uses it to name an exact
   * recapture or retarget when the chosen runtime profile has no evidence. */
  rawAccessibilityVariantsByScreenId?: Record<string, AppMapCompiledRawAccessibilityVariant[]>;
  /** Global frozen target/profile ledger for the entire compiled Test. It is
   * deliberately independent of raw-tree availability and per-screen
   * Variants, so a missing locale capture cannot silently default to another
   * screen's locale. */
  rawAccessibilityTargetProfiles?: AppMapCompiledRawAccessibilityTargetProfile[];
  /** Legacy compiled-plan shape. New compiles emit `rawAccessibilitySourcesByScreenId`;
   * readers keep this only so an already-frozen historical plan can request a
   * clear recapture rather than becoming unreadable. */
  rawAccessibilityTreesByScreenId?: Record<string, RawAccessibilityTreeEvidence[]>;
  /** A device-free proposed order. It never changes the saved Test or grants
   * the runtime permission to cross a cleanup, handoff, or unknown-state
   * boundary; it exists so humans and agents can review a faster route before
   * execution adopts it. */
  executionSchedule?: {
    schemaVersion: 2;
    mode: "authored" | "review-required";
    checks: AppMapTestExecutionScheduleCheck[];
    /** Review-only cold branches, sorted by their authored check order. */
    deferredBranches: AppMapTestDeferredScheduleBranch[];
  };
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
  /** Dest-end connections stay on the origin identity (in-place chrome). After
   * the first dest-end tap, later selectors must use dest-end destination
   * evidence or live wait-for — never the origin unique-variant tree. */
  destEndRecipeIds?: string[];
  /** Frozen dest-end destination observations keyed by compiled recipe id.
   * Present only when dest-end chrome was captured without inventing a dest
   * screen. */
  destEndObservationsByRecipeId?: Record<string, Array<{ nodes: NormalizedSemanticNode[] }>>;
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
  /** Frozen capture-for-review obligations. Caption is display text only. */
  plannedSlots?: readonly CaptureReviewPlannedSlot[];
  /** Resolved Fast UI / live output / stateful-survival queue. Dest-end
   * chrome inspect defaults to fast-ui when the Test omitted it. */
  executionQueue?: ExecutionQueue;
  /** Separate Fast UI / Live output / Stateful-survival duration quotes.
   * Never a three-minute workbook promise. */
  queueQuotes?: ExecutionQueueDurationQuote[];
  /** Android vs iOS vs web dest-ends as separate configurations. Captions
   * are not one Test covering three platforms by name. */
  routeVariantConfigurations?: RouteVariantConfigurationQuote[];
  /** Runner-recover vs dest-wait/product-ready. Probe timeout is not dwell. */
  iosReadiness?: IosReadinessDurationQuote;
  startup: AppMapTestStartup;
  /** Explicit recording origin application, when the Test has one. */
  originApplication?: string;
  omittedSteps?: Array<{
    stepId: string;
    intent: string;
    reason: string;
    repairTargetId: string;
  }>;
};

export type {
  OfflineTestPreflightCursor,
  OfflineTestPreflightEvidenceSource,
  OfflineTestPreflightFinding,
  OfflineTestPreflightRawCandidate,
  OfflineTestPreflightRawVariantCandidate,
  OfflineTestPreflightRawVariantScope,
  OfflineTestPreflightReport,
  OfflineTestPreflightReturn,
  OfflineTestPreflightSavedPathCoverage,
  OfflineTestPreflightSavedPathStep,
  OfflineTestPreflightSelector,
} from "./test-offline-preflight.js";
