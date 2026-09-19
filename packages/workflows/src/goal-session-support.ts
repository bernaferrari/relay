import type {
  CompactGoalObservation,
  GoalFinding,
  GoalObservationAction,
  GoalSessionAction,
  GoalSessionRecord,
  GoalSessionResult,
  GoalSessionStopCode,
  TargetObservation,
} from "@relay/protocol";
import { GOAL_FINDING_SCHEMA_VERSION, GOAL_SESSION_SCHEMA_VERSION } from "@relay/protocol";

export const MAX_ERROR_CHARS = 1_024;
export const MAX_EVIDENCE_REFS = 8;

export function normalizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.trim().slice(0, MAX_ERROR_CHARS) || "Relay operation failed";
}

export function evidenceRefs(
  sessionId: string,
  observation: TargetObservation,
  digest: string,
): string[] {
  const refs = [`goal:${sessionId}:observation:${digest}`];
  const projections = [
    ...(observation.pixels.status === "captured" ? [observation.pixels.artifact] : []),
    observation.semantics.artifact,
  ];
  for (const projection of projections) {
    if (projection.status === "available") refs.push(projection.artifact.id);
  }
  return [...new Set(refs)].slice(0, MAX_EVIDENCE_REFS);
}

export function recentActions(record: GoalSessionRecord): GoalObservationAction[] {
  return record.actions.slice(-20).map((action) => ({
    id: action.id,
    kind: action.interaction.kind,
    outcome:
      action.status === "acknowledged"
        ? "acknowledged"
        : action.status === "unknown"
          ? "unknown"
          : "rejected",
    summary: action.label,
  }));
}

export function observationSignals(observation: TargetObservation) {
  const signals = [] as Array<{
    kind: "error" | "network" | "log" | "missing-evidence" | "runtime";
    severity: "info" | "warning" | "error";
    summary: string;
  }>;
  if (observation.semantics.status !== "current") {
    signals.push({
      kind: "missing-evidence",
      severity: "warning",
      summary: observation.semantics.message ?? "Semantic controls are not current.",
    });
  }
  if (observation.pixels.status !== "captured") {
    signals.push({
      kind: "missing-evidence",
      severity: "warning",
      summary: "Pixels are unavailable.",
    });
  }
  return signals;
}

export function observationCapabilities(observation: TargetObservation) {
  return [
    {
      name: "semantic-control",
      available: observation.semantics.status === "current",
      ...(observation.semantics.status === "current"
        ? {}
        : { reason: "Current semantic control proof is unavailable." }),
    },
    {
      name: "pixels",
      available: observation.pixels.status === "captured",
      ...(observation.pixels.status === "captured"
        ? {}
        : { reason: "Current pixels are unavailable." }),
    },
  ];
}

export function interactionInput(
  record: GoalSessionRecord,
  action: GoalSessionAction,
  targetId?: string,
) {
  const selector = action.interaction.target;
  return {
    serial: targetId ?? record.target.targetId,
    ...(record.laneId ? { laneId: record.laneId } : {}),
    kind: action.interaction.kind,
    ...(selector.identifier ? { identifier: selector.identifier } : {}),
    ...(selector.ref ? { ref: selector.ref } : {}),
    ...(selector.label ? { label: selector.label } : {}),
    ...(selector.point ? { x: selector.point.x, y: selector.point.y } : {}),
  };
}

export function isOutcomeUnknown(error: unknown): boolean {
  const message = normalizeError(error).toLowerCase();
  return message.includes("outcome-unknown") || message.includes("outcome unknown");
}

export function result(record: GoalSessionRecord): GoalSessionResult {
  return {
    schemaVersion: GOAL_SESSION_SCHEMA_VERSION,
    sessionId: record.id,
    goal: record.goal,
    target: record.target,
    status: record.status,
    step: record.step,
    budget: record.budget,
    ...(record.stopReason ? { stopReason: record.stopReason } : {}),
    ...(record.lastObservation ? { lastObservation: record.lastObservation } : {}),
    ...(record.lastDecision ? { lastDecision: record.lastDecision } : {}),
    ...(record.reproduction ? { reproduction: record.reproduction } : {}),
    findings: record.findings ?? [],
    actions: record.actions,
    observations: record.observations,
    ...(record.pendingAction ||
    record.stopReason?.code === "action-uncertain" ||
    record.stopReason?.code === "resume-review-required"
      ? { resumeRequiresReview: true as const }
      : {}),
  };
}

export function reproductionEvidenceRefs(
  sessionId: string,
  reproductionId: string,
  observation: TargetObservation,
  digest: string,
): string[] {
  const refs = [`goal:${sessionId}:reproduction:${reproductionId}:observation:${digest}`];
  const projections = [
    ...(observation.pixels.status === "captured" ? [observation.pixels.artifact] : []),
    observation.semantics.artifact,
  ];
  for (const projection of projections) {
    if (projection.status === "available") refs.push(projection.artifact.id);
  }
  return [...new Set(refs)].slice(0, MAX_EVIDENCE_REFS);
}

export function findingEvidenceRefs(record: GoalSessionRecord): string[] {
  return [
    ...(record.actions.at(-1)?.evidenceRefs ?? []),
    ...(record.observations.at(-1)?.evidenceRefs ?? []),
  ].slice(0, MAX_EVIDENCE_REFS);
}

export function findingForStop(
  record: GoalSessionRecord,
  code: GoalSessionStopCode,
  message: string,
  at: number,
): GoalFinding | undefined {
  if (code === "goal-achieved") return undefined;
  const missingEvidence = code === "observation-unavailable";
  const uncertainMutation = code === "action-uncertain";
  return {
    schemaVersion: GOAL_FINDING_SCHEMA_VERSION,
    id: `finding-${record.id}-${code}`,
    sessionId: record.id,
    kind: missingEvidence
      ? "missing-evidence"
      : uncertainMutation
        ? "possible-issue"
        : "blocked-exploration",
    status: uncertainMutation ? "open" : "blocked",
    title: missingEvidence
      ? "Exploration stopped with missing evidence"
      : uncertainMutation
        ? "Possible issue after an uncertain interaction"
        : "Exploration stopped before the goal was established",
    summary: message.slice(0, MAX_ERROR_CHARS),
    evidenceRefs: findingEvidenceRefs(record),
    source: "goal-runner",
    createdAt: at,
    updatedAt: at,
    requiresReview: true,
  };
}

export function appendFinding(
  record: GoalSessionRecord,
  finding: GoalFinding | undefined,
): GoalSessionRecord {
  if (!finding) return record;
  const findings = [...(record.findings ?? []).filter((item) => item.id !== finding.id), finding];
  return { ...record, findings };
}
