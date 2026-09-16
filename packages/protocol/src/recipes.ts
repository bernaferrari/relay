/** Canonical recipe contract shared by persistence, execution, HTTP, and UI. */
import type { DestinationEvidenceSurface, ScreenIdentityObservation } from "./app-map.js";
import type {
  ScrollSurfaceDocumentOriginProof,
  ScrollSurfaceViewport,
  SemanticRevealPlan,
} from "./scroll-surface.js";
import type { ReviewedDocumentOriginExecutionReference } from "./reviewed-document-origin.js";
import type { ReviewedExternalEffects } from "./approval-policy.js";
export type HorizontalCoordinateAnchor = "left" | "center" | "right";
export type VerticalCoordinateAnchor = "top" | "center" | "bottom";

/** A semantic element used as the live coordinate system for a deliberate
 * pixel tap. Keep this non-recursive: an anchor must stand on its own instead
 * of silently falling through to another point. */
export type StepPointAnchorTarget = {
  identifier?: string;
  ref?: string;
  label?: string;
  role?: string;
  text?: string;
};

/** A structural selector for controls whose stable accessibility name is
 * published on a nearby heading rather than on the value-bearing row itself.
 * The relationship is resolved from the current tree and never stores the
 * user's value or a viewport coordinate. */
export type StepTargetRelation = {
  kind: "following-row";
  anchor: StepPointAnchorTarget;
};

export type StepPoint = {
  /** Absolute coordinate in the recorded reference bounds. */
  x: number;
  y: number;
  /** Origin used to preserve the offset when the runtime device size changes. */
  anchor?: {
    horizontal: HorizontalCoordinateAnchor;
    vertical: VerticalCoordinateAnchor;
  };
  /** Device size against which x/y and their anchored offsets were authored. */
  referenceBounds?: { width: number; height: number };
  /**
   * Allows this literal coordinate to replace a failed semantic selector.
   * Omitted coordinates are point-only evidence, not silent selector fallbacks.
   */
  fallbackPolicy?: "reviewed";
  /** Re-find this element and preserve the authored fractional position inside
   * its current bounds. This is safer than a viewport coordinate when copy or
   * layout reflows, and fails closed when the element is absent or ambiguous. */
  relativeTo?: {
    target: StepPointAnchorTarget;
    xRatio: number;
    yRatio: number;
  };
};

/** Resolve an authored coordinate against a runtime viewport without changing its anchor. */
export function resolveStepPoint(
  point: StepPoint,
  runtimeBounds: { width: number; height: number },
): { x: number; y: number } {
  const reference = point.referenceBounds;
  const anchor = point.anchor;
  if (!reference || !anchor) return { x: Math.round(point.x), y: Math.round(point.y) };

  const x =
    anchor.horizontal === "right"
      ? runtimeBounds.width - (reference.width - point.x)
      : anchor.horizontal === "center"
        ? runtimeBounds.width / 2 + (point.x - reference.width / 2)
        : point.x;
  const y =
    anchor.vertical === "bottom"
      ? runtimeBounds.height - (reference.height - point.y)
      : anchor.vertical === "center"
        ? runtimeBounds.height / 2 + (point.y - reference.height / 2)
        : point.y;

  return {
    x: Math.max(0, Math.min(runtimeBounds.width, Math.round(x))),
    y: Math.max(0, Math.min(runtimeBounds.height, Math.round(y))),
  };
}

export type StepTarget = {
  /** Stable accessibility/resource identifier; preferred over transient refs and visible copy. */
  identifier?: string;
  ref?: string;
  label?: string;
  /** Stable accessibility role used with a label to disambiguate headings from controls. */
  role?: string;
  text?: string;
  /** Activate the unique actionable row immediately following this stable
   * semantic anchor. Ambiguous/missing structure fails closed. */
  relation?: StepTargetRelation;
  point?: StepPoint;
};

export type RecordedSelectorCandidate = {
  strategy: "identifier" | "ref" | "label" | "text" | "point";
  label: string;
  source: "element" | "ancestor" | "coordinate";
  confidence: "high" | "medium" | "fallback";
  target: StepTarget;
};

export type RecordedNodeEvidence = {
  label?: string;
  value?: string;
  identifier?: string;
  role?: string;
  type?: string;
  ref?: string;
  index?: number;
  parentIndex?: number;
  rect?: { x: number; y: number; width: number; height: number };
};

export type RecordedStepEvidence = {
  id: string;
  recordedAt: number;
  serial?: string;
  /** Capture provenance lets the editor distinguish trustworthy context from a
   * partial recording instead of pretending a missing tree was a real target. */
  capture?: {
    schemaVersion: 1;
    uiTreeCapturedAt?: number;
    screenshotCapturedAt?: number;
    status: "complete" | "partial";
    issues?: ("missing-ui-tree" | "missing-screenshot" | "missing-target")[];
  };
  deviceBounds?: { width: number; height: number };
  pointer?: { x: number; y: number };
  node?: RecordedNodeEvidence;
  ancestors?: RecordedNodeEvidence[];
  /** Interactive nodes from the recorded UI tree, used by the historical picker. */
  nodes?: RecordedNodeEvidence[];
  candidates?: RecordedSelectorCandidate[];
  screenshot?: {
    recipeId: string;
    id: string;
    capturedAt: number;
    mime: "image/png";
    bytes?: number;
    sha256?: string;
  };
};

export type RecipeParameter = {
  name: string;
  label?: string;
  description?: string;
  default?: string;
  required?: boolean;
};

export type HumanCheckpointReason =
  | "authentication"
  | "consent"
  | "verification"
  | "captcha"
  | "permission"
  | "review"
  | "other";

/**
 * Editing metadata is deliberately independent of the action union. A recorded
 * screen is useful context for every action (including scroll and key), even
 * when that action does not execute against a UI target.
 */
export type RecipeStepMetadata = {
  /** Stable editor identity. It survives reordering and is never used by the runner. */
  id?: string;
  /** A human task boundary inside a test. It is editor metadata, never runner behavior. */
  group?: string;
  /** Immutable screen/UI-tree context captured when this step was recorded. */
  evidence?: RecordedStepEvidence;
  note?: string;
  /** Review-owned declaration for real-world effects that cannot be inferred
   * safely from UI copy. It informs policy only and never changes execution. */
  reviewedExternalEffects?: ReviewedExternalEffects;
  /** Best-effort setup/cleanup step. Cancellation always remains fatal. */
  optional?: boolean;
  /**
   * A compiled campaign check boundary. Failure is retained as a first-class
   * result and execution continues with the next sibling check; the owning job
   * still finishes failed after every check has had a chance to run.
   */
  check?: {
    id: string;
    title: string;
    /** Exact screen from which the compiled warm itinerary may begin. A
     * different or unknown runtime cursor must use a source-verified edge
     * confirmation instead of replaying this planned path. */
    warmSourceScreenId?: string;
    /** Ordered graph edges this check must prove. Connection ids are stable
     * circuit keys shared by every check compiled from the same App Map edge. */
    transitionDependencies?: Array<{
      connectionId: string;
      originScreenId: string;
      destination: { kind: "screen"; screenId: string } | { kind: "end" };
      expectedApp?: string;
    }>;
    /** Canonical cold path used after a sibling check leaves the shared
     * origin uncertain. One failed recovery blocks only this dependency
     * group instead of cascading misleading failures through the campaign. */
    recovery?: {
      groupId: string;
      /** Safe single-edge confirmation. It never contains app launch, reset,
       * or campaign setup and may run at most once. */
      recipeId: string;
      /** Exact shared edge confirmed by this canonical recovery. Legacy
       * recipes without it retain group-scoped recovery behavior. */
      transitionId?: string;
      mode?: "warm-transition";
      /** Proposed cold setup retained for SOS/review only. The campaign
       * runner never executes it automatically or merely because a job resumed. */
      coldRecipeId?: string;
    };
    /** Always-run compensating Routine for stateful campaign checks. */
    cleanup?: {
      recipeId: string;
      bindings?: Record<string, string>;
      terminalScreenId: string;
      /** Frozen policy for a cancellation received during the primary path. */
      onCancel: "run-if-controllable" | "skip";
    };
  };
  /** Run this step only when the target is currently present or absent. */
  when?: {
    target: StepTarget;
    condition: "present" | "absent";
    region?: { minX?: number; maxX?: number; minY?: number; maxY?: number };
  };
};

export type RecipeStep = RecipeStepMetadata &
  (
    | {
        kind: "tap";
        target: StepTarget;
        /** Exact application package expected to own the foreground after
         * this tap. Omitted taps must remain inside the current application. */
        expectedApp?: string;
        /** Ordered semantic alternatives for the same intent. The runner only
         * tries these when the primary target cannot be acted on. */
        fallbackTargets?: StepTarget[];
        /** Graph-native provenance used to propose, never silently persist,
         * selector repairs when a reviewed alternative replaces the primary. */
        navigationContract?: {
          connectionId: string;
          expectedScreenId: string;
          expectedFingerprint: string;
          evidenceIds: string[];
        };
        gesture?: "single" | "multi" | "hold";
        tapCount?: number;
        intervalMs?: number;
        durationMs?: number;
      }
    | {
        kind: "type";
        text: string;
        target?: StepTarget;
        mode?: "append" | "replace";
      }
    | {
        kind: "scroll";
        direction: "down" | "up";
        amount?: number;
        /** Scroll until this mapped screen identity is revealed. This makes
         * list navigation resilient to text reflow and viewport changes. */
        until?: {
          screenId: string;
          screenTitle: string;
          fingerprint: string;
          aliases?: string[];
          observations?: ScreenIdentityObservation[];
        };
        maxAttempts?: number;
      }
    | {
        /** Scroll only until a stable accessibility target is present. */
        kind: "reveal";
        target: StepTarget;
        direction?: "up" | "down" | "auto";
        maxAttempts?: number;
        /** Full-surface semantic plans frozen by the App Map compiler. The
         * runtime selects the plan that overlaps the live locale/variant. */
        navigation?: SemanticRevealPlan[];
      }
    | {
        kind: "swipe";
        from: StepPoint;
        to: StepPoint;
        durationMs?: number;
      }
    | { kind: "key"; key: "back" | "home" | "recents" }
    | { kind: "sleep"; ms: number }
    | {
        kind: "wait-for";
        target: StepTarget;
        timeoutMs?: number;
      }
    | {
        kind: "wait-response";
        target: StepTarget;
        busyTarget?: StepTarget;
        idleTarget?: StepTarget;
        timeoutMs?: number;
        stableForMs?: number;
        /** Fail when the response takes longer than this, even if it completes. */
        maxMs?: number;
      }
    | {
        kind: "expect";
        target: StepTarget;
        condition: "visible" | "gone";
        timeoutMs?: number;
      }
    | {
        /** Assert the visible choice list under a stable accessibility identifier
         * namespace or semantic container. Order does not matter. Missing options
         * always fail. Unexpected options fail unless extras is "allow". */
        kind: "expect-set";
        identifierPrefix?: string;
        scope?: StepTarget;
        labels: string[];
        timeoutMs?: number;
        extras?: "forbid" | "allow";
      }
    | {
        /** A graph-native assertion generated by the compiler. It verifies the
         * semantic destination of an edge, independent from screen geometry. */
        kind: "expect-screen";
        screenId: string;
        screenTitle: string;
        fingerprint: string;
        /** Explicit owner for a mapped cross-app handoff. The runner verifies
         * the foreground package before accepting its stable semantic shell. */
        expectedApp?: string;
        aliases?: string[];
        /** Allow navigation and rendering to settle before declaring that the
         * destination differs. Each observation remains evidence. */
        timeoutMs?: number;
        /** Approved semantic observations let dynamic screens retain one
         * identity while their body content changes between executions. */
        observations?: ScreenIdentityObservation[];
        /** Authored dynamic regions copied from the destination screen so
         * identity proofs and visual baselines compare chrome only. */
        ignoreRegions?: Array<{
          x: number;
          y: number;
          width: number;
          height: number;
          name?: string;
        }>;
        /** Compiler diagnostic used when the current hierarchy cannot be left
         * safely because a forward edge has no reviewed inverse. It performs
         * one observation and never mutates the device. */
        returnRequirement?: {
          connectionId: string;
          fromScreenId: string;
          destinationScreenId: string;
        };
        /** Review-sensitive destinations must remain semantically and visually
         * stable before any later Back/Close/cleanup mutation. */
        evidenceSurface?: DestinationEvidenceSurface;
        /**
         * Generated warm-suite source checks may return through the current
         * app hierarchy before replaying their recorded navigation. This is
         * deliberately unavailable on destination checks: a bad action must
         * fail where it landed rather than navigating away from evidence.
         */
        recovery?: {
          strategy: "back";
          maxAttempts?: number;
          /** After one Back reaches a scrollable parent list, return it to
           * its stable top checkpoint before considering another Back. */
          restoreParentViewport?: boolean;
        };
        /** A selective repair may begin only from this freshly re-observed
         * frozen origin. The runner persists the proof and source lineage
         * before any warm edge is allowed to mutate the device. */
        repairCheckpoint?: {
          sourceRunId: string;
          sourceCheckId: string;
          sourceInputDigest: string;
          transitionId?: string;
        };
        /** The compiler marks a scrollable landing whose evidence must cover
         * more than the first viewport. After this expectation verifies, the
         * runner performs one bounded scroll survey and persists every frame
         * with its tree as run evidence. The annotation is evidence-only: a
         * survey failure degrades to a warning and never fails the run. */
        destinationSurvey?: {
          maxScrolls: number;
        };
      }
    | {
        kind: "extract";
        as: string;
        target: StepTarget;
        role?: "user" | "assistant" | "system";
      }
    | {
        kind: "assert-content";
        input: string;
        expected: string;
        match: "exact" | "equals" | "contains" | "not-contains" | "number-equals" | "field";
        field?: string;
      }
    | {
        /** Require two uniquely resolved semantic elements not to overlap. */
        kind: "assert-layout";
        relation: "non-overlap";
        first: StepTarget;
        second: StepTarget;
        timeoutMs?: number;
      }
    | {
        kind: "evaluate-semantic";
        input: string;
        criteria: string[];
        threshold?: number;
        provider?: string;
        model?: string;
        requireAgreement?: boolean;
        secondProvider?: string;
        secondModel?: string;
      }
    | {
        kind: "evaluate-visual";
        criteria: string[];
        threshold?: number;
        provider?: string;
        model?: string;
        requireAgreement?: boolean;
        secondProvider?: string;
        secondModel?: string;
        region?: { x: number; y: number; width: number; height: number };
      }
    | {
        /** Exclude this viewport rectangle from later screen-identity proofs
         * so a changing reply body cannot re-key the same conversation. */
        kind: "identity-ignore";
        region: { x: number; y: number; width: number; height: number };
        name?: string;
      }
    | {
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
      }
    | {
        /** Finish this verification as a reviewable unknown instead of a
         * false pass or a hard failure. A reviewer can approve or reject it
         * later from the run report or CLI. */
        kind: "review";
        capability: string;
        reason: string;
      }
    | {
        kind: "screenshot";
        caption?: string;
        /** Human review of this capture. Omitted means diagnostic/evidence only. */
        review?: {
          mode: "later";
          lookFor?: string;
        };
      }
    | {
        /** Capture and compare one durable logical scroll surface after its
         * mapped destination has been reached. Raw viewports remain the
         * source of truth; the stitched image and merged tree are derived. */
        kind: "capture-surface";
        screenId: string;
        screenTitle: string;
        variantId: string;
        surfaceId: string;
        baselineCaptureId: string;
        reason: string;
        maxScrolls?: number;
        /** Bypass an otherwise eligible immutable surface-comparison cache.
         * Authoring recaptures and investigations can therefore always obtain
         * fresh device evidence. */
        forceRecapture?: boolean;
        /** The compiler freezes whether the selected baseline is safe to use
         * for comparison. A stopped, seam-ambiguous, or unrestored capture is
         * useful raw evidence, never a silently trusted baseline. */
        baselineTrust?: "trusted" | "recapture-required";
        baselineTrustReason?: string;
        /** Frozen first viewport of a completed logical surface. It is an
         * execution guard, not a fallback: a fresh survey may use fast origin
         * restoration only after the live first viewport matches this exact
         * semantic/visual checkpoint. */
        documentOrigin?: ScrollSurfaceViewport;
        /** Evidence-bound provenance required alongside documentOrigin. It
         * is copied only from a validated logical surface; geometry by itself
         * can never enable bounded Android origin restoration. */
        documentOriginProof?: ScrollSurfaceDocumentOriginProof;
        /** A server-reviewed Android origin overlay for legacy/imported raw
         * evidence. It is intentionally distinct from capture provenance;
         * execution reopens its local projection and lifecycle ledger, so a
         * revocation blocks even this already-compiled execution plan. */
        reviewedDocumentOrigin?: ReviewedDocumentOriginExecutionReference;
        baseline?: {
          compositeWidth?: number;
          compositeHeight?: number;
          semanticNodeCount: number;
        };
      }
    | {
        /** Walk live child rows on the current screen (depth 0 today). */
        kind: "tour";
        depth?: number;
        screenshot?: boolean;
        /** Capture the recovered tour origin before walking its child rows. */
        captureOrigin?: boolean;
        /** An immediately preceding compiled setup Flow already verified this
         * origin. This is compiler-owned: it bridges localized labels without
         * weakening identity checks after a child page returns. */
        originVerifiedBySetup?: boolean;
        maxStops?: number;
        excludeLanguageRows?: boolean;
        /** Mapped list this tour must reach before walking rows. */
        originScreenId?: string;
        originTitle?: string;
        originFingerprint?: string;
        originAliases?: string[];
        /** Approved semantics for localized runs. Labels may translate, but
         * stable accessibility identifiers and visible structure must still
         * prove that this is the recorded tour origin. */
        originObservations?: ScreenIdentityObservation[];
        /** Recorded In-path, run only when the device is not already on origin. */
        /** Navigation needed to reach the mapped tour origin. Gestures are
         * preserved so scroll-state checkpoints are reproducible too. */
        preludeSteps?: Array<Extract<RecipeStep, { kind: "tap" | "key" | "swipe" | "scroll" }>>;
        /** Identity of the surface on which the prelude is safe to begin. */
        preludeStartFingerprint?: string;
        preludeStartAliases?: string[];
        /** Used when the live tree is missing. Mapped exits + optional points. */
        fallbackStops?: Array<{
          label: string;
          identifier?: string;
          point?: { x: number; y: number };
          /** A mapped checkpoint may be visited without becoming evidence. */
          capture?: boolean;
          /** This recorded branch only exists in some account/feature states.
           * Its absence is reported and skipped, never tapped by its old
           * coordinate. */
          optional?: boolean;
          evidenceSurface?: DestinationEvidenceSurface;
        }>;
        /**
         * Complete recorded row order for the current surface. These are
         * calibration landmarks only: a mapped subset still taps only
         * `fallbackStops`. They let a translated list preserve the selected
         * row's visual rank without guessing from stale coordinates.
         */
        landmarkStops?: Array<{
          label: string;
          identifier?: string;
          point?: { x: number; y: number };
        }>;
        /** Restrict a deterministic screen test to its mapped fallback stops. */
        mappedStopsOnly?: boolean;
        /** Bounded semantic list search. The runner scans overlapping
         * viewports and seeks live row identities, so translated multiline
         * text never depends on a recorded scroll distance. */
        scrollSearch?: {
          /** Maximum viewports inspected in one direction. */
          maxScrolls?: number;
          /** Fraction of a viewport moved per search step. */
          amount?: number;
        };
        /** A generated coverage tour can finish on its final child. The next
         * warm setup owns returning to its own source. */
        returnAfterLast?: boolean;
      }
    | { kind: "flow"; flow: string }
    | { kind: "module"; recipeId: string; bindings?: Record<string, string> }
    | {
        kind: "branch";
        input: string;
        operator: "exists" | "equals" | "not-equals" | "contains";
        expected?: string;
        thenRecipeId: string;
        elseRecipeId?: string;
      }
    | { kind: "repeat"; count: number; recipeId: string }
    | { kind: "script"; source: string }
    | {
        kind: "clipboard";
        action: "write" | "read" | "paste" | "copy";
        text?: string;
        target?: StepTarget;
        expect?: string;
        match?: "exact" | "contains";
      }
    | {
        kind: "app";
        action:
          | "open"
          | "close"
          | "switcher"
          | "inspect"
          | "assert-installed"
          | "assert-not-installed"
          | "set-locale"
          | "install"
          | "update"
          | "uninstall"
          | "background";
        /** Used with action "background": time spent in the background. */
        backgroundMs?: number;
        app?: string;
        locale?: string;
        url?: string;
        relaunch?: boolean;
        artifact?: string;
        as?: string;
        version?: string;
        versionMatch?: "exact" | "contains";
      }
    | {
        kind: "device";
        action: "lock" | "unlock" | "keyboard-dismiss" | "keyboard-enter";
      }
    | {
        kind: "rotate";
        orientation: "portrait" | "portrait-upside-down" | "landscape-left" | "landscape-right";
      }
    | {
        kind: "settings";
        setting: "wifi" | "airplane" | "mobile-data" | "location" | "animations" | "appearance";
        state: "on" | "off" | "light" | "dark" | "toggle";
      }
    | { kind: "location"; latitude: number; longitude: number }
    | {
        kind: "permission";
        action: "grant" | "deny" | "reset";
        permission:
          | "camera"
          | "microphone"
          | "photos"
          | "contacts"
          | "notifications"
          | "calendar"
          | "location"
          | "location-always"
          | "media-library"
          | "motion"
          | "reminders"
          | "siri";
      }
    | {
        kind: "alert";
        action: "get" | "accept" | "dismiss" | "wait";
        timeoutMs?: number;
      }
    | {
        kind: "network";
        action: "dump" | "log";
        include?: "summary" | "headers" | "body" | "all";
        limit?: number;
      }
    | {
        kind: "logs";
        action: "start" | "stop" | "mark" | "clear";
        message?: string;
      }
    | {
        /** Playwright context.setOffline for a live browser case. */
        kind: "offline";
        state: "on" | "off";
      }
    | {
        kind: "upload";
        file: string;
        target?: StepTarget;
      }
  );
