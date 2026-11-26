import type { StepTarget } from "../recipes.js";
import type {
  AppMapCompiledRawAccessibilitySource,
  AppMapCompiledRawAccessibilityTargetProfile,
  AppMapCompiledRawAccessibilityVariant,
} from "./test-intent.js";

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
    Pick<
      import("../app-map/app-map.js").NormalizedSemanticNode,
      "role" | "identifier" | "label" | "value"
    >
  >;
};

/** A content-addressed raw accessibility source frozen into the compiled
 * plan. `reference` is always the inspectable Relay evidence URI; the other
 * fields let a human or an agent verify exactly which immutable blob supplied
 * a selector decision without consulting the current map or device. */
export type OfflineTestPreflightEvidenceSource = {
  reference: string;
  recordedEntrance?: {
    actionId: string;
    observationId: string;
    scope: "requested-selector-catalog";
  };
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
    Pick<
      import("../app-map/app-map.js").NormalizedSemanticNode,
      "role" | "identifier" | "label" | "value"
    >
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
  executionRisk: import("../approval-policy.js").ExecutionRisk;
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
