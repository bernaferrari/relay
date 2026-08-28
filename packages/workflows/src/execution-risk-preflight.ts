import type { ExecutionRisk } from "@relay/protocol";
import type { WorkflowProblem } from "./types.js";

export function isExecutionRisk(value: unknown): value is ExecutionRisk {
  if (!value || typeof value !== "object") return false;
  const risk = value as Partial<ExecutionRisk>;
  return (
    risk.schemaVersion === 1 &&
    (risk.level === "safe" ||
      risk.level === "guarded" ||
      risk.level === "destructive" ||
      risk.level === "prohibited") &&
    Array.isArray(risk.reasons) &&
    Array.isArray(risk.externalEffects) &&
    (risk.confirmation === "none" ||
      risk.confirmation === "once-per-run" ||
      risk.confirmation === "per-step" ||
      risk.confirmation === "human-only") &&
    Array.isArray(risk.expectedAppBoundaries) &&
    typeof risk.cleanupRequired === "boolean"
  );
}

function primaryReason(risk: ExecutionRisk): string {
  return risk.reasons[0]?.explanation ?? `The frozen Test is classified as ${risk.level}.`;
}

/** Gate only the deterministic risk compiled into the exact frozen preview.
 * Safe Tests remain frictionless. A single explicit consent satisfies only a
 * once-per-run policy; per-step and human-only review cannot be collapsed. */
export function executionRiskPreflightProblem(
  risk: ExecutionRisk,
  confirmRisk: true | undefined,
): WorkflowProblem | undefined {
  if (risk.level === "prohibited") {
    return {
      code: "compile-blocked",
      title: "The Test is prohibited by execution policy",
      detail: primaryReason(risk),
      recovery: "Remove or replace the opaque or prohibited step, then compile a new frozen Test.",
      retryable: false,
      ...(risk.reasons[0]?.code ? { sourceCode: risk.reasons[0].code } : {}),
    };
  }
  if (risk.confirmation === "none") return undefined;
  if (risk.confirmation === "once-per-run" && confirmRisk === true) return undefined;
  return {
    code: "risk-confirmation-required",
    title:
      risk.confirmation === "once-per-run"
        ? "This Test requires explicit risk confirmation"
        : "This Test requires a stronger review boundary",
    detail: primaryReason(risk),
    recovery:
      risk.confirmation === "once-per-run"
        ? "Review the declared external effects, then start this outcome again with explicit risk confirmation."
        : `The ${risk.confirmation} policy cannot be reduced to one outcome-level confirmation. Use a reviewed execution path that can enforce it exactly.`,
    retryable: risk.confirmation === "once-per-run",
    ...(risk.reasons[0]?.code ? { sourceCode: risk.reasons[0].code } : {}),
  };
}
