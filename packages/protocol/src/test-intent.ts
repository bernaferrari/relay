import type { BrowserEngine } from "./browser-case-profile.js";
import type {
  AppMapCapturePolicy,
  AppMapEntity,
  AssertionSpec,
  NormalizedSemanticNode,
} from "./app-map.js";
import type { ReviewedActionIntentBinding, ReviewedLogicalStateBinding } from "./product-intent.js";
import type { HumanCheckpointReason, RecipeStep, StepTarget } from "./recipes.js";
import type { RawAccessibilityTreeEvidence, ScrollSurfaceTestBinding } from "./scroll-surface.js";
import type { TargetCapability, TargetProfile } from "./target-contract.js";

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
   * cancellation policy is frozen into the compiled execution plan; a cleanup may
   * continue only while ownership and target transport remain valid.
   */
  cleanup?: AppMapTestStepCleanup;
};

export type AppMapValidationRecipeStep =
  | Extract<
      RecipeStep,
      {
        kind:
          | "expect"
          | "expect-set"
          | "assert-content"
          | "assert-layout"
          | "wait-response"
          | "identity-ignore";
      }
    >
  | Extract<RecipeStep, { kind: "evaluate-semantic" | "evaluate-visual" }>;

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

export type AppMapScenarioTest = AppMapEntity & {
  name: string;
  kind: "scenario";
  intentSchemaVersion: typeof APP_MAP_TEST_INTENT_SCHEMA_VERSION;
  steps: AppMapScenarioTestStep[];
  /** Exact package/bundle selected during recording setup for this Test. It
   * is frozen into compiled runs; runtime must never derive it from AX. */
  originApplication?: string;
  /** Absent means an intentionally unjoined, legacy single-surface family. */
  family?: AppMapTestFamily;
  capture?: AppMapCapturePolicy;
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

export type AppMapScenarioTestEdit =
  | {
      kind: "test.patch";
      patch: {
        name?: string;
        capture?: AppMapCapturePolicy | null;
        family?: AppMapTestFamily | null;
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
  tree: RawAccessibilityTreeEvidence;
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

/** A device-free review of the frozen plan. Findings are deliberately
 * conservative: this report never guesses geometry, scroll offsets, or a
 * recovery gesture from incomplete evidence. */
export type OfflineTestPreflightFinding = {
  severity: "blocker" | "warning";
  code:
    | "unresolved-return"
    | "selector-absent"
    | "selector-ambiguous"
    | "selector-needs-raw-tree"
    | "raw-evidence-recapture-required"
    | "raw-evidence-variant-selection-required"
    | "raw-evidence-variant-recapture-required"
    | "point-only-selector"
    | "source-observation-missing"
    | "surface-recapture-required";
  recipeId: string;
  recipeStepId?: string;
  screenId?: string;
  message: string;
  /** The immutable source(s) that made this a repair rather than a guess. */
  evidence?: OfflineTestPreflightEvidenceSource[];
  candidates?: Array<
    Pick<import("./app-map.js").NormalizedSemanticNode, "role" | "identifier" | "label" | "value">
  >;
};

/** A content-addressed raw accessibility source frozen into the compiled
 * plan. `reference` is always the inspectable Relay evidence URI; the other
 * fields let a human or an agent verify exactly which immutable blob supplied
 * a selector decision without consulting the current map or device. */
export type OfflineTestPreflightEvidenceSource = {
  reference: string;
  evidenceId?: string;
  sha256?: string;
  /** Present for source-aware compiled plans. These facts identify the exact
   * target/locale Variant that supplied the blob; they are diagnostic facts,
   * never an implicit selector-equivalence rule. */
  variant?: AppMapCompiledRawAccessibilityVariant;
  origin?: AppMapCompiledRawAccessibilitySource["origin"];
};

/** A bounded, read-only fragment of a raw accessibility tree. It deliberately
 * preserves the facts that flattened semantic observations discard: bounds,
 * parentage, and whether a node or its owner was actionable. */
export type OfflineTestPreflightRawCandidate = {
  source: OfflineTestPreflightEvidenceSource;
  relation: "match" | "relation-anchor" | "following-row" | "activation-owner";
  node: {
    /** Position in the frozen raw tree when the platform omitted a native
     * node index. */
    treeOrder: number;
    role?: string;
    identifier?: string;
    label?: string;
    value?: string;
    index?: number;
    parentIndex?: number;
    bounds?: { x: number; y: number; width: number; height: number };
    hittable?: boolean;
    enabled?: boolean;
    visibleToUser?: boolean;
  };
  /** The unique owning row/control whose frozen bounds would receive the
   * activation. This remains diagnostic evidence only. */
  owner?: {
    treeOrder: number;
    index?: number;
    parentIndex?: number;
    bounds: { x: number; y: number; width: number; height: number };
    hittable?: boolean;
  };
};

/** How a frozen raw source relates to an explicitly selected runtime Variant.
 * A source may cross a locale/profile boundary only when a stable identifier
 * or a stable structural relation proves that reuse; translated labels and
 * text never imply this equivalence. */
export type OfflineTestPreflightRawVariantCandidate = {
  variant: AppMapCompiledRawAccessibilityVariant;
  sourceCount: number;
  compatibility:
    | "selected-variant"
    | "stable-identifier-equivalent"
    | "stable-relation-equivalent"
    | "incompatible";
  reason:
    | "selected-runtime-variant"
    | "same-target-platform-and-viewport"
    | "locale-sensitive-selector"
    | "target-platform-or-viewport-mismatch"
    | "stable-selector-not-present"
    | "stable-selector-not-activatable"
    | "selected-variant-needs-own-proof"
    | "no-raw-source";
};

/** The frozen runtime profile scope applied to one offline selector. It is
 * intentionally visible in every scoped decision so humans, agents, and MCP
 * clients can distinguish a missing selected capture from a bad selector. */
export type OfflineTestPreflightRawVariantScope = {
  selectedTargetProfileId?: string;
  /** Present when the compiled Test provided its global frozen profile ledger.
   * This makes the selected runtime shape inspectable even if this individual
   * screen has no Variant for it yet. */
  selectedTargetProfile?: AppMapCompiledRawAccessibilityTargetProfile;
  /** All global saved target/profile identities available to this Test. */
  targetProfileCandidates?: AppMapCompiledRawAccessibilityTargetProfile[];
  selectedVariant?: AppMapCompiledRawAccessibilityVariant;
  candidates: OfflineTestPreflightRawVariantCandidate[];
};

/** A read-only selector decision from the frozen Test plan. Unlike a runtime
 * target resolution, this never grants permission to press the shown bounds;
 * it exists so a person or agent can see exactly what offline evidence did or
 * did not establish before a device lease is requested. */
export type OfflineTestPreflightSelector = {
  recipeId: string;
  recipeStepId?: string;
  screenId?: string;
  stepKind: "tap" | "reveal" | "expect" | "wait-for";
  target: Pick<StepTarget, "identifier" | "ref" | "label" | "role" | "text" | "relation"> & {
    hasPointFallback?: boolean;
  };
  status:
    | "resolved"
    | "absent"
    | "ambiguous"
    | "needs-raw-tree"
    | "raw-evidence-unavailable"
    | "variant-selection-required"
    | "variant-incompatible"
    | "excluded-dynamic-content"
    | "point-only"
    | "source-observation-missing";
  /** The immutable evidence plane that produced this decision. */
  evidence: {
    kind:
      | "raw-accessibility-tree"
      | "screen-observation"
      | "reveal-plan"
      | "dynamic-content-policy"
      | "none";
    references: string[];
    /** Present for raw evidence so a repair can open the exact frozen blob,
     * not a later observation of the same screen. */
    sources?: OfflineTestPreflightEvidenceSource[];
  };
  /** Present when a compile caller selected a runtime profile, or when raw
   * sources span more than one profile and preflight needs that choice before
   * it can make a locale-sensitive selector claim. */
  rawVariantScope?: OfflineTestPreflightRawVariantScope;
  /** Bounded semantic candidates are review context, never an implicit
   * selector rewrite. */
  candidates?: Array<
    Pick<import("./app-map.js").NormalizedSemanticNode, "role" | "identifier" | "label" | "value">
  >;
  /** Raw-tree candidates are intentionally separate from lossy normalized
   * candidates so a heading and its owned Compose row remain distinguishable. */
  rawCandidates?: OfflineTestPreflightRawCandidate[];
  /** Full count before the compact raw-candidate cap was applied. */
  rawCandidateCount?: number;
  /** A unique raw-tree match may identify the activation method and frozen
   * bounds. It remains read-only evidence, not an executable coordinate. */
  resolution?: {
    method: "identifier" | "label" | "text" | "relation" | "point";
    activation?: "snapshot-point";
    snapshotBounds: { x: number; y: number; width: number; height: number };
    provenance?: OfflineTestPreflightEvidenceSource;
  };
  /** A reveal position comes only from an already-frozen logical surface; no
   * scroll offset is ever invented by preflight. */
  revealPositions?: Array<{
    surfaceId: string;
    captureId: string;
    targetOrder: number;
    targetDocumentY: number;
    direction: "up" | "down" | "auto";
  }>;
  detail?: string;
};

/** A static cursor trace. `expected` names the next declared screen, not a
 * live proof. `unknown` records the exact point at which an interaction would
 * require runtime evidence, and `return-required` makes a missing reviewed
 * inverse explicit rather than silently pressing Back. */
export type OfflineTestPreflightCursor = {
  recipeId: string;
  recipeStepId?: string;
  stepIndex: number;
  state: "expected" | "unknown" | "return-required";
  screenId?: string;
  screenTitle?: string;
  reason: string;
};

/** One frozen return contract that is still awaiting an explicit reviewed
 * inverse. This is a review object only; it cannot cause a Back gesture. */
export type OfflineTestPreflightReturn = {
  recipeId: string;
  recipeStepId?: string;
  connectionId: string;
  sourceScreenId: string;
  destinationScreenId: string;
  status: "review-required";
};

export type OfflineTestPreflightReport = {
  schemaVersion: 1;
  mode: "offline-test-preflight";
  appMapId: string;
  appMapRevision: number;
  testId: string;
  planDigest: string;
  /** Deterministic policy input compiled from this exact frozen plan. */
  executionRisk: import("./approval-policy.js").ExecutionRisk;
  summary: {
    recipes: number;
    checkedSelectors: number;
    resolvedSelectors: number;
    /** Dynamic user-generated content that is intentionally not compared or
     * selector-proven offline. Stable entry/exit controls remain checked. */
    excludedDynamicSelectors?: number;
    unknownCursorTransitions: number;
    reviewRequiredReturns: number;
    blockers: number;
    warnings: number;
  };
  /** A deterministic, reviewable record of every selector decision, including
   * successful resolutions that would otherwise be invisible in a clean run. */
  selectors: OfflineTestPreflightSelector[];
  /** The plan's declared/unknown cursor states, scoped to individual recipes
   * so recovery and alternate branches cannot masquerade as one linear run. */
  cursorTimeline: OfflineTestPreflightCursor[];
  /** Explicit unresolved return contracts. Empty means no implicit Back is
   * pending in this frozen plan. */
  returns: OfflineTestPreflightReturn[];
  findings: OfflineTestPreflightFinding[];
};
