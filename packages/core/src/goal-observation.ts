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

export type CompactGoalObservationInput = {
  goal: string;
  subgoal?: string;
  sessionId: string;
  targetId: string;
  platform: GoalObservationTarget["platform"];
  app?: string;
  configurationId?: string;
  observation: TargetObservation;
  recentActions?: readonly GoalObservationAction[];
  signals?: readonly GoalObservationSignal[];
  capabilities?: readonly GoalObservationCapability[];
  missingEvidence?: readonly string[];
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
    ...(safeText(control.text) && !isEditableControl(control.role, control.identifier)
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
  const editable = isEditableControl(control.role, control.identifier);
  const text = editable ? REDACTED : safeText(control.text);
  return {
    id: `c${index + 1}`,
    kind: "control",
    ...(safeText(control.label) ? { label: safeText(control.label) } : {}),
    ...(text ? { text } : {}),
    ...(safeText(control.role) ? { role: safeText(control.role) } : {}),
    enabled: control.enabled !== false,
    ...(control.selected !== undefined ? { selected: control.selected } : {}),
    target: controlTarget(control),
  };
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
  };
  const candidates = observation.semantics.controls
    .slice(0, 40)
    .map((control, index) => compactCandidate(control, index));
  const base = {
    schemaVersion: 1 as const,
    goal: safeText(input.goal) ?? REDACTED,
    ...(input.subgoal ? { subgoal: safeText(input.subgoal) } : {}),
    target,
    screen: {
      ...(observation.screenCandidate?.fingerprint
        ? { fingerprint: safeText(observation.screenCandidate.fingerprint) }
        : {}),
      semantics: observation.semantics.status,
      ...(observation.semantics.capturedAt ? { capturedAt: observation.semantics.capturedAt } : {}),
    },
    candidates,
    recentActions: (input.recentActions ?? []).slice(-MAX_ACTIONS).map(safeAction),
    signals: (input.signals ?? []).slice(-MAX_SIGNALS).map(safeSignal),
    capabilities: (input.capabilities ?? []).slice(0, MAX_CAPABILITIES).map(safeCapability),
    missingEvidence: (input.missingEvidence ?? [])
      .slice(0, MAX_SIGNALS)
      .map((value) => safeText(value) ?? REDACTED),
    redacted: true as const,
  };
  return {
    ...base,
    observationDigest: canonicalSha256(base),
  };
}
