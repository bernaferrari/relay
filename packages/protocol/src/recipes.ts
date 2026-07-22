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

export type RecipeStep =
  | {
      kind: "tap";
      target: StepTarget;
      gesture?: "single" | "multi" | "hold";
      tapCount?: number;
      intervalMs?: number;
      durationMs?: number;
      evidence?: RecordedStepEvidence;
      note?: string;
    }
  | {
      kind: "type";
      text: string;
      target?: StepTarget;
      evidence?: RecordedStepEvidence;
      note?: string;
    }
  | { kind: "scroll"; direction: "down" | "up"; amount?: number; note?: string }
  | {
      kind: "swipe";
      from: { x: number; y: number };
      to: { x: number; y: number };
      durationMs?: number;
      evidence?: RecordedStepEvidence;
      note?: string;
    }
  | { kind: "key"; key: "back" | "home"; note?: string }
  | { kind: "sleep"; ms: number; note?: string }
  | {
      kind: "wait-for";
      target: StepTarget;
      timeoutMs?: number;
      evidence?: RecordedStepEvidence;
      note?: string;
    }
  | {
      kind: "wait-response";
      target: StepTarget;
      busyTarget?: StepTarget;
      idleTarget?: StepTarget;
      timeoutMs?: number;
      stableForMs?: number;
      note?: string;
    }
  | {
      kind: "expect";
      target: StepTarget;
      condition: "visible" | "gone";
      timeoutMs?: number;
      evidence?: RecordedStepEvidence;
      note?: string;
    }
  | {
      kind: "extract";
      as: string;
      target: StepTarget;
      role?: "user" | "assistant" | "system";
      note?: string;
    }
  | {
      kind: "assert-content";
      input: string;
      expected: string;
      match: "exact" | "contains" | "not-contains";
      note?: string;
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
      note?: string;
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
      note?: string;
    }
  | { kind: "screenshot"; caption?: string; note?: string }
  | { kind: "flow"; flow: string; note?: string }
  | { kind: "module"; recipeId: string; bindings?: Record<string, string>; note?: string }
  | {
      kind: "branch";
      input: string;
      operator: "exists" | "equals" | "not-equals" | "contains";
      expected?: string;
      thenRecipeId: string;
      elseRecipeId?: string;
      note?: string;
    }
  | { kind: "repeat"; count: number; recipeId: string; note?: string }
  | { kind: "script"; source: string; note?: string }
  | {
      kind: "clipboard";
      action: "write" | "read";
      text?: string;
      expect?: string;
      match?: "exact" | "contains";
      note?: string;
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
      note?: string;
    }
  | {
      kind: "device";
      action: "lock" | "unlock" | "keyboard-dismiss" | "keyboard-enter";
      note?: string;
    }
  | {
      kind: "rotate";
      orientation: "portrait" | "portrait-upside-down" | "landscape-left" | "landscape-right";
      note?: string;
    }
  | {
      kind: "settings";
      setting: "wifi" | "airplane" | "location" | "animations" | "appearance";
      state: "on" | "off" | "light" | "dark" | "toggle";
      note?: string;
    }
  | { kind: "location"; latitude: number; longitude: number; note?: string }
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
      note?: string;
    }
  | {
      kind: "alert";
      action: "get" | "accept" | "dismiss" | "wait";
      timeoutMs?: number;
      note?: string;
    }
  | {
      kind: "network";
      action: "dump" | "log";
      include?: "summary" | "headers" | "body" | "all";
      limit?: number;
      note?: string;
    }
  | {
      kind: "logs";
      action: "start" | "stop" | "mark" | "clear";
      message?: string;
      note?: string;
    };
