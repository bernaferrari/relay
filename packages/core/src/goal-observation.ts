import { GOAL_OBSERVATION_MAX_CANDIDATES, GOAL_OBSERVATION_SCHEMA_VERSION } from "@relay/protocol";
import type {
  CompactGoalObservation,
  GoalObservationAction,
  GoalObservationCapability,
  GoalObservationCandidate,
  GoalObservationSignal,
  GoalObservationTarget,
  TargetObservation,
} from "@relay/protocol";
import { canonicalSha256 } from "./canonical-json.js";
import { REDACTED, redactSensitiveEvidenceValue } from "./redaction.js";

const MAX_ACTIONS = 20;
const MAX_SIGNALS = 20;
const MAX_CAPABILITIES = 32;
const EDITABLE_CONTROL = /(?:text(?:box|field)?|textarea|input|editable|password|email)/iu;

/** Editable controls are never tap-authoritative in the goal loop; their
 * values are dispatch-time data, not model-facing state. */
export function isEditableGoalControl(
  role: string | undefined,
  identifier: string | undefined,
): boolean {
  return EDITABLE_CONTROL.test(`${role ?? ""} ${identifier ?? ""}`);
}

export type CompactGoalObservationInput = {
  goal: string;
  subgoal?: string;
  sessionId: string;
  targetId: string;
  platform: GoalObservationTarget["platform"];
  app?: string;
  configurationId?: string;
  runtimeSessionId?: string;
  observation: TargetObservation;
  recentActions?: readonly GoalObservationAction[];
  signals?: readonly GoalObservationSignal[];
  capabilities?: readonly GoalObservationCapability[];
  missingEvidence?: readonly string[];
  /** Reference keys of the task's value map (never the values). */
  valueRefs?: readonly string[];
};

function safeText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const redacted = redactSensitiveEvidenceValue(value);
  return typeof redacted === "string" ? redacted : REDACTED;
}

function safeFinite(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isEditableControl(role: string | undefined, identifier: string | undefined): boolean {
  return EDITABLE_CONTROL.test(`${role ?? ""} ${identifier ?? ""}`);
}

function controlTarget(control: TargetObservation["semantics"]["controls"][number]) {
  const target = {
    ...(safeText(control.identifier) ? { identifier: safeText(control.identifier) } : {}),
    ...(safeText(control.label) ? { label: safeText(control.label) } : {}),
    ...(safeText(control.text) && !isEditableGoalControl(control.role, control.identifier)
      ? { text: safeText(control.text) }
      : {}),
    ...(control.rect
      ? {
          point: {
            x: safeFinite(control.rect.x + control.rect.width / 2) ?? 0,
            y: safeFinite(control.rect.y + control.rect.height / 2) ?? 0,
          },
        }
      : {}),
  };
  return target;
}

function compactCandidate(
  control: TargetObservation["semantics"]["controls"][number],
  index: number,
): GoalObservationCandidate {
  const editable = isEditableGoalControl(control.role, control.identifier);
  const text = editable ? REDACTED : safeText(control.text);
  const enabledAssumed = control.enabled === undefined;
  return {
    id: `c${index + 1}`,
    kind: "control",
    ...(safeText(control.label) ? { label: safeText(control.label) } : {}),
    ...(text ? { text } : {}),
    ...(safeText(control.role) ? { role: safeText(control.role) } : {}),
    enabled: enabledAssumed ? true : control.enabled === true,
    ...(enabledAssumed ? { enabledAssumed: true as const } : {}),
    ...(editable ? { editable: true as const } : {}),
    ...(control.selected !== undefined ? { selected: control.selected } : {}),
    target: controlTarget(control),
  };
}

/** Non-control candidates every observation offers: navigation back, gentle
 * scrolling, a bounded wait, and an explicit named capture. These are loop
 * primitives dispatched through existing operations — never model code.
 * Scrolling needs real viewport coordinates, so it is offered only when the
 * observation carries them. */
function syntheticCandidates(observation: TargetObservation): GoalObservationCandidate[] {
  const viewport =
    observation.pixels.status === "captured" &&
    typeof observation.pixels.width === "number" &&
    typeof observation.pixels.height === "number"
      ? { width: observation.pixels.width, height: observation.pixels.height }
      : undefined;
  const center = viewport
    ? { x: Math.round(viewport.width / 2), y: Math.round(viewport.height / 2) }
    : undefined;
  const scrollTargets = center
    ? [
        {
          id: "sys-scroll-down",
          kind: "scroll" as const,
          label: "Scroll down",
          enabled: true,
          target: { point: center },
        },
        {
          id: "sys-scroll-up",
          kind: "scroll" as const,
          label: "Scroll up",
          enabled: true,
          target: { point: center },
        },
      ]
    : [];
  return [
    { id: "sys-back", kind: "back", label: "Go back", enabled: true, target: {} },
    ...scrollTargets,
    {
      id: "sys-wait",
      kind: "wait",
      label: "Wait briefly for the screen to settle",
      enabled: true,
      target: {},
    },
    {
      id: "sys-capture",
      kind: "other",
      label: "Capture the current screen for review",
      enabled: true,
      target: {},
    },
  ];
}

function safeAction(action: GoalObservationAction): GoalObservationAction {
  return {
    id: safeText(action.id) ?? REDACTED,
    kind: safeText(action.kind) ?? REDACTED,
    outcome: action.outcome,
    summary: safeText(action.summary) ?? REDACTED,
  };
}

function safeSignal(signal: GoalObservationSignal): GoalObservationSignal {
  return {
    kind: signal.kind,
    severity: signal.severity,
    summary: safeText(signal.summary) ?? REDACTED,
  };
}

function safeCapability(capability: GoalObservationCapability): GoalObservationCapability {
  return {
    name: safeText(capability.name) ?? REDACTED,
    available: capability.available,
    ...(capability.reason ? { reason: safeText(capability.reason) } : {}),
  };
}

/**
 * Project one native/browser observation into the small text-only state that a
 * model adapter may receive. This module never includes pixels, artifact
 * locations, raw traces, or editable values.
 */
export function compactGoalObservation(input: CompactGoalObservationInput): CompactGoalObservation {
  const observation = input.observation;
  const target: GoalObservationTarget = {
    sessionId: safeText(input.sessionId) ?? REDACTED,
    targetId: safeText(input.targetId) ?? REDACTED,
    platform: input.platform,
    ...(input.app ? { app: safeText(input.app) } : {}),
    ...(input.configurationId ? { configurationId: safeText(input.configurationId) } : {}),
    ...(input.runtimeSessionId
      ? { runtimeSessionId: safeText(input.runtimeSessionId) ?? REDACTED }
      : {}),
  };
  const keptControls = observation.semantics.controls.slice(0, GOAL_OBSERVATION_MAX_CANDIDATES);
  const candidates = [
    ...keptControls.map((control, index) => compactCandidate(control, index)),
    ...syntheticCandidates(observation),
  ];
  const candidatesOmitted = Math.max(
    0,
    observation.semantics.controls.length - keptControls.length,
  );
  const base = {
    schemaVersion: GOAL_OBSERVATION_SCHEMA_VERSION,
    goal: safeText(input.goal) ?? REDACTED,
    ...(input.subgoal ? { subgoal: safeText(input.subgoal) } : {}),
    target,
    screen: {
      ...(observation.screenCandidate?.fingerprint
        ? { fingerprint: safeText(observation.screenCandidate.fingerprint) }
        : {}),
      semantics: observation.semantics.status,
      ...(observation.semantics.capturedAt ? { capturedAt: observation.semantics.capturedAt } : {}),
      pixels: observation.pixels.status,
      ...(observation.pixels.status === "captured"
        ? { pixelsCapturedAt: observation.pixels.capturedAt }
        : {}),
    },
    candidates,
    omissions: {
      // Counts cover observed controls only; synthetic loop primitives are
      // additional and never counted against the control cap.
      candidatesKept: keptControls.length,
      candidatesOmitted,
    },
    recentActions: (input.recentActions ?? []).slice(-MAX_ACTIONS).map(safeAction),
    signals: (input.signals ?? []).slice(-MAX_SIGNALS).map(safeSignal),
    capabilities: (input.capabilities ?? []).slice(0, MAX_CAPABILITIES).map(safeCapability),
    missingEvidence: (input.missingEvidence ?? [])
      .slice(0, MAX_SIGNALS)
      .map((value) => safeText(value) ?? REDACTED),
    ...(input.valueRefs && input.valueRefs.length > 0
      ? { valueRefs: input.valueRefs.map((value) => safeText(value) ?? REDACTED) }
      : {}),
    redacted: true as const,
  };
  return {
    ...base,
    observationDigest: canonicalSha256(base),
  };
}
