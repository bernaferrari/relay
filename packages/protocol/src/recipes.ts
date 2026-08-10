/** Canonical recipe contract shared by persistence, execution, HTTP, and UI. */
import type { ScreenIdentityObservation } from "./app-map.js";
export type HorizontalCoordinateAnchor = "left" | "center" | "right";
export type VerticalCoordinateAnchor = "top" | "center" | "bottom";

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
    | { kind: "scroll"; direction: "down" | "up"; amount?: number }
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
        aliases?: string[];
        /** Allow navigation and rendering to settle before declaring that the
         * destination differs. Each observation remains evidence. */
        timeoutMs?: number;
        /** Approved semantic observations let dynamic screens retain one
         * identity while their body content changes between executions. */
        observations?: ScreenIdentityObservation[];
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
        /** Walk live child rows on the current screen (depth 0 today). */
        kind: "tour";
        depth?: number;
        screenshot?: boolean;
        maxStops?: number;
        excludeLanguageRows?: boolean;
        /** Mapped list this tour must reach before walking rows. */
        originScreenId?: string;
        originTitle?: string;
        originFingerprint?: string;
        originAliases?: string[];
        /** Recorded In-path, run only when the device is not already on origin. */
        preludeSteps?: Array<Extract<RecipeStep, { kind: "tap" | "key" }>>;
        /** Used when the live tree is missing. Mapped exits + optional points. */
        fallbackStops?: Array<{
          label: string;
          identifier?: string;
          point?: { x: number; y: number };
          /** A mapped checkpoint may be visited without becoming evidence. */
          capture?: boolean;
        }>;
        /** Restrict a deterministic screen test to its mapped fallback stops. */
        mappedStopsOnly?: boolean;
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
