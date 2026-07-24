/** Canonical recipe contract shared by persistence, execution, HTTP, and UI. */
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
  ref?: string;
  label?: string;
  text?: string;
  point?: StepPoint;
};

export type RecordedSelectorCandidate = {
  strategy: "ref" | "label" | "text" | "point";
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
};

export type RecipeStep = RecipeStepMetadata &
  (
    | {
        kind: "tap";
        target: StepTarget;
        gesture?: "single" | "multi" | "hold";
        tapCount?: number;
        intervalMs?: number;
        durationMs?: number;
      }
    | {
        kind: "type";
        text: string;
        target?: StepTarget;
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
    | { kind: "screenshot"; caption?: string }
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
        action: "write" | "read";
        text?: string;
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
          | "install"
          | "update"
          | "uninstall";
        app?: string;
        url?: string;
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
