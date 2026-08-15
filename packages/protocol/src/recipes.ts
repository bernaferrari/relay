/** Canonical recipe contract shared by persistence, execution, HTTP, and UI. */
import type { ScreenIdentityObservation } from "./app-map.js";
export type HorizontalCoordinateAnchor = "left" | "center" | "right";
export type VerticalCoordinateAnchor = "top" | "center" | "bottom";

/** A semantic element used as the live coordinate system for a deliberate
 * pixel tap. Keep this non-recursive: an anchor must stand on its own instead
 * of silently falling through to another point. */
export type StepPointAnchorTarget = {
  identifier?: string;
  ref?: string;
  label?: string;
  text?: string;
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
  text?: string;
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
    /** Canonical cold path used after a sibling check leaves the shared
     * origin uncertain. One failed recovery blocks only this dependency
     * group instead of cascading misleading failures through the campaign. */
    recovery?: {
      groupId: string;
      recipeId: string;
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
      }
    | {
        kind: "swipe";
        from: StepPoint;
        to: StepPoint;
        durationMs?: number;
      }
    | { kind: "key"; key: "back" | "home" }
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
      }
    | {
        kind: "expect";
        target: StepTarget;
        condition: "visible" | "gone";
        timeoutMs?: number;
      }
    | {
        /** Assert the complete visible option set exposed under a stable
         * accessibility identifier namespace or semantic container. Order does
         * not matter; missing and unexpected options both fail with an explicit
         * diff. */
        kind: "expect-set";
        identifierPrefix?: string;
        scope?: StepTarget;
        labels: string[];
        timeoutMs?: number;
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
        match: "exact" | "contains" | "not-contains";
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
    | { kind: "screenshot"; caption?: string }
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
          | "uninstall";
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
        setting: "wifi" | "airplane" | "location" | "animations" | "appearance";
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
  );
