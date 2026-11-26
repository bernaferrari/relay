/** Internal, pure projection helpers for the TargetSupervisor module. */
import type {
  TargetRuntimeCapabilityReadiness,
  TargetRuntimeReadiness,
  TargetSupervisorHealth,
} from "@relay/protocol";
import { isCurrentTargetProof } from "./target-proof-freshness.js";

export type TargetSupervisorPlaneFacts = {
  pixels: {
    state: TargetSupervisorHealth["pixels"]["state"];
    lastCapturedAt?: number;
    durationMs?: number;
    lastError?: string;
    lastErrorAt?: number;
  };
  semantics: {
    state: TargetSupervisorHealth["semantics"]["state"];
    lastCapturedAt?: number;
    durationMs?: number;
    observedNodeCount?: number;
    lastError?: string;
    lastErrorAt?: number;
    invalidatedAt?: number;
  };
};

/** Liveness expires in the projection without altering the durable receipt. */
export function currentTargetSupervisorPlaneFacts(
  state: TargetSupervisorPlaneFacts,
  now: number,
): TargetSupervisorPlaneFacts {
  return {
    pixels: {
      ...state.pixels,
      state:
        state.pixels.state === "ready" && !isCurrentTargetProof(state.pixels.lastCapturedAt, now)
          ? "delayed"
          : state.pixels.state,
    },
    semantics: {
      ...state.semantics,
      state:
        state.semantics.state === "current" &&
        !isCurrentTargetProof(state.semantics.lastCapturedAt, now)
          ? "stale"
          : state.semantics.state,
    },
  };
}

export function initialTargetSupervisorCounters(): TargetSupervisorHealth["counters"] {
  return {
    pixelCaptures: 0,
    semanticTraversals: 0,
    semanticTimeouts: 0,
    semanticWedges: 0,
    uncertainMutations: 0,
    reconciliations: 0,
    recoveryAttempts: 0,
    recoveryFailures: 0,
  };
}

export function summarizeTargetSupervisorLatency(
  samples: readonly number[],
): TargetSupervisorHealth["latency"]["pixels"] {
  if (samples.length === 0) return { count: 0 };
  const total = samples.reduce((sum, value) => sum + value, 0);
  return {
    count: samples.length,
    averageMs: Math.round(total / samples.length),
    maximumMs: Math.max(...samples),
  };
}

export function deriveTargetSupervisorOverall(input: {
  quarantined: boolean;
  needsHuman: boolean;
  recovering: boolean;
  pixels: TargetSupervisorHealth["pixels"]["state"];
  semantics: TargetSupervisorHealth["semantics"]["state"];
  targetInput: TargetSupervisorHealth["input"]["state"];
}): TargetSupervisorHealth["overall"] {
  if (input.quarantined) return "quarantined";
  if (input.needsHuman) return "needs-human";
  if (input.recovering || input.targetInput === "uncertain") return "recovering";
  if (input.pixels === "ready") {
    return input.semantics === "current" && input.targetInput === "ready" ? "ready" : "pixel-only";
  }
  return "starting";
}

export function deriveTargetSupervisorReadiness(
  state: TargetSupervisorPlaneFacts,
  now: number,
): TargetRuntimeReadiness {
  const pixel = pixelReadiness(state.pixels, now);
  return {
    previewPixels: pixel,
    evidenceCapture: { ...structuredClone(pixel), mode: "evidence" },
    semanticControl: semanticReadiness(state.semantics, now),
  };
}

function pixelReadiness(
  pixels: TargetSupervisorPlaneFacts["pixels"],
  now: number,
): TargetRuntimeCapabilityReadiness {
  if (pixels.state === "ready" && pixels.lastCapturedAt !== undefined) {
    return {
      mode: "pixels",
      state: "proven",
      freshness: "current",
      proof: {
        at: pixels.lastCapturedAt,
        ...(pixels.durationMs !== undefined ? { durationMs: pixels.durationMs } : {}),
      },
    };
  }
  return {
    mode: "pixels",
    state: pixels.state === "unavailable" ? "unavailable" : "unproven",
    freshness: "unproven",
    reason: pixels.state === "unavailable" ? "probe-failed" : "not-yet-proven",
    ...(pixels.lastError
      ? {
          lastError: {
            at: pixels.lastErrorAt ?? now,
            reason: "probe-failed" as const,
            message: pixels.lastError,
          },
        }
      : {}),
  };
}

function semanticReadiness(
  semantics: TargetSupervisorPlaneFacts["semantics"],
  now: number,
): TargetRuntimeCapabilityReadiness {
  if (
    (semantics.state === "current" || semantics.state === "stale") &&
    semantics.lastCapturedAt !== undefined
  ) {
    return {
      mode: "accessibility",
      state: "proven",
      freshness: semantics.state === "current" ? "current" : "stale",
      proof: {
        at: semantics.lastCapturedAt,
        ...(semantics.durationMs !== undefined ? { durationMs: semantics.durationMs } : {}),
        ...(semantics.observedNodeCount !== undefined
          ? { observedNodeCount: semantics.observedNodeCount }
          : {}),
      },
      ...(semantics.state === "stale"
        ? {
            invalidated: {
              at: semantics.invalidatedAt ?? semantics.lastCapturedAt,
              reason: "input-changed" as const,
            },
          }
        : {}),
    };
  }
  const inFlight = semantics.state === "refreshing" || semantics.state === "wedged";
  return {
    mode: "accessibility",
    state: "unavailable",
    freshness: "unproven",
    reason: inFlight ? "probe-in-flight" : "probe-failed",
    ...(semantics.lastError
      ? {
          lastError: {
            at: semantics.lastErrorAt ?? now,
            reason: inFlight ? ("probe-in-flight" as const) : ("probe-failed" as const),
            message: semantics.lastError,
          },
        }
      : {}),
  };
}
