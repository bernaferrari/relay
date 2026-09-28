import type { TargetSupervisorCheckpoint, TargetSupervisorContext } from "./target-supervisor.js";

export function boundedText(value: string): string {
  const normalized = value.trim().replace(/\s+/gu, " ");
  return (normalized || "No detail was provided.").slice(0, 480);
}

export function boundedId(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized.slice(0, 512);
}

export function normalizedContext(value: TargetSupervisorContext): TargetSupervisorContext {
  return {
    ...(value.foregroundApp?.trim()
      ? { foregroundApp: value.foregroundApp.trim().slice(0, 512) }
      : {}),
    ...(value.screenFingerprint?.trim()
      ? { screenFingerprint: value.screenFingerprint.trim().slice(0, 256) }
      : {}),
    ...(value.runCursor
      ? {
          runCursor: {
            runId: boundedId(value.runCursor.runId, "Run id"),
            ...(value.runCursor.stepId?.trim()
              ? { stepId: value.runCursor.stepId.trim().slice(0, 512) }
              : {}),
            ...(value.runCursor.index !== undefined &&
            Number.isSafeInteger(value.runCursor.index) &&
            value.runCursor.index >= 0
              ? { index: value.runCursor.index }
              : {}),
          },
        }
      : {}),
  };
}

export function finiteDuration(value: number | undefined): number | undefined {
  return value === undefined ? undefined : Math.max(0, Number.isFinite(value) ? value : 0);
}

export function cloneCheckpoint(value: TargetSupervisorCheckpoint): TargetSupervisorCheckpoint {
  return structuredClone(value);
}

export function validateCheckpoint(value: TargetSupervisorCheckpoint): void {
  if (value.schemaVersion !== 1) throw new Error("TargetSupervisor checkpoint is unsupported");
  if (!value.target.id.trim()) throw new Error("TargetSupervisor target id is required");
  if (!Number.isSafeInteger(value.targetEpoch) || value.targetEpoch < 1) {
    throw new Error("TargetSupervisor target epoch is invalid");
  }
  if (!Number.isSafeInteger(value.semanticSessionEpoch) || value.semanticSessionEpoch < 1) {
    throw new Error("TargetSupervisor semantic session epoch is invalid");
  }
  if (value.semantics.traversal && value.semantics.traversal.targetEpoch !== value.targetEpoch) {
    throw new Error("TargetSupervisor traversal belongs to another target epoch");
  }
}
