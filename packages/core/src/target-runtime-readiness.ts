/**
 * Per-target runtime capability facts.
 *
 * This intentionally does not probe a device. Discovery is cheap and safe;
 * an XCTest tree read is neither. Instead, a successful capture records a
 * short-lived proof and target summaries report the distinction between a
 * usable pixel path, named accessibility control, and evidence capture.
 */
import type {
  TargetRuntimeCapabilityMode,
  TargetRuntimeCapabilityReason,
  TargetRuntimeCapabilityReadiness,
  TargetRuntimeCapabilityState,
  TargetRuntimeReadiness,
} from "@relay/protocol";
import type { DevicePlatform, SnapshotNode } from "./device.js";
import { currentTargetSupervisorStore } from "./target-supervisor-store.js";

export type RuntimeReadinessTarget = {
  serial: string;
  platform: DevicePlatform;
  kind?: string | null;
  booted?: boolean | null;
  developerMode?: "enabled" | "disabled";
  developerServicesAvailable?: boolean;
};

export type RuntimeReadinessCapability = keyof TargetRuntimeReadiness;

function supervisedTarget(target: Pick<RuntimeReadinessTarget, "platform" | "serial">) {
  return { id: target.serial, kind: target.platform } as const;
}

type RuntimeProbe = {
  state: Exclude<TargetRuntimeCapabilityState, "unproven">;
  mode: TargetRuntimeCapabilityMode;
  /**
   * Local observation order, never sent over the wire. A slow iOS tree can
   * finish after a newer pixel capture; wall-clock completion time alone
   * cannot tell us which surface the tree actually observed.
   */
  observationEpoch?: number;
  proof?: NonNullable<TargetRuntimeCapabilityReadiness["proof"]>;
  lastError?: NonNullable<TargetRuntimeCapabilityReadiness["lastError"]>;
  invalidated?: NonNullable<TargetRuntimeCapabilityReadiness["invalidated"]>;
  reason?: TargetRuntimeCapabilityReason;
  nextProbeAt?: number;
  /** Internal only: grow repeated iOS XCTest failures without leaking retry policy into UI. */
  retryDelayMs?: number;
};

type TargetProbes = {
  capabilities: Partial<Record<RuntimeReadinessCapability, RuntimeProbe>>;
  /** Never exposed: it only tells Relay whether a newer pixel frame invalidates AX geometry. */
  visualFingerprint?: { value: string; at: number; observationEpoch?: number };
  /**
   * A user mutation or changed frame can occur while XCTest is still reading.
   * Keep that fence until a semantic request begun after it supplies a proof.
   */
  semanticInvalidation?: {
    at: number;
    reason: "input-changed" | "visual-changed";
    observationEpoch?: number;
  };
  /** Monotonic only within this in-memory target session. */
  nextObservationEpoch?: number;
};

/**
 * A target can be unplugged, locked, or lose its XCTest session at any time.
 * Keep a proof brief enough that discovery cannot quietly turn yesterday's
 * successful snapshot into a green control state.
 */
export const TARGET_RUNTIME_READINESS_TTL_MS = 2 * 60_000;
/** A tree is not a video stream. Back off only real failed iOS AX probes; a
 * due time permits one recovery probe but never asks UI to poll indefinitely. */
export const IOS_SEMANTIC_PROBE_INITIAL_COOLDOWN_MS = 15_000;
export const IOS_SEMANTIC_PROBE_MAX_COOLDOWN_MS = 60_000;

const probesByTarget = new Map<string, TargetProbes>();

function targetKey(target: Pick<RuntimeReadinessTarget, "platform" | "serial">): string {
  return `${target.platform}:${target.serial}`;
}

/**
 * Allocate a local order token before starting an observation. It deliberately
 * models request order, not completion order: XCTest can return an old tree
 * after a newer pixel frame has already arrived.
 */
export function beginTargetRuntimeObservation(
  target: Pick<RuntimeReadinessTarget, "platform" | "serial">,
): number {
  const key = targetKey(target);
  const targetProbes = probesByTarget.get(key) ?? { capabilities: {} };
  const next = (targetProbes.nextObservationEpoch ?? 0) + 1;
  targetProbes.nextObservationEpoch = next;
  probesByTarget.set(key, targetProbes);
  return next;
}

function isSimulator(target: RuntimeReadinessTarget): boolean {
  return /simulator|emulator/i.test(target.kind ?? "");
}

function modeFor(capability: RuntimeReadinessCapability): TargetRuntimeCapabilityMode {
  switch (capability) {
    case "previewPixels":
      return "pixels";
    case "semanticControl":
      return "accessibility";
    case "evidenceCapture":
      return "evidence";
  }
}

function unproven(capability: RuntimeReadinessCapability): TargetRuntimeCapabilityReadiness {
  return {
    mode: modeFor(capability),
    state: "unproven",
    freshness: "unproven",
    reason: "not-yet-proven",
  };
}

function unavailable(
  capability: RuntimeReadinessCapability,
  reason: TargetRuntimeCapabilityReason,
): TargetRuntimeCapabilityReadiness {
  return { mode: modeFor(capability), state: "unavailable", freshness: "unproven", reason };
}

function cloneReadiness(value: TargetRuntimeCapabilityReadiness): TargetRuntimeCapabilityReadiness {
  return {
    ...value,
    ...(value.proof ? { proof: { ...value.proof } } : {}),
    ...(value.lastError ? { lastError: { ...value.lastError } } : {}),
    ...(value.invalidated ? { invalidated: { ...value.invalidated } } : {}),
  };
}

function staticReadiness(
  target: RuntimeReadinessTarget,
): Partial<Record<RuntimeReadinessCapability, TargetRuntimeCapabilityReadiness>> {
  if (isSimulator(target) && target.booted === false) {
    return {
      previewPixels: unavailable("previewPixels", "target-stopped"),
      semanticControl: unavailable("semanticControl", "target-stopped"),
      evidenceCapture: unavailable("evidenceCapture", "target-stopped"),
    };
  }
  if (target.platform !== "ios") return {};
  if (target.developerMode === "disabled") {
    return { semanticControl: unavailable("semanticControl", "developer-mode-disabled") };
  }
  if (target.developerServicesAvailable === false) {
    return {
      semanticControl: unavailable("semanticControl", "developer-services-unavailable"),
    };
  }
  return {};
}

function liveProbe(
  target: RuntimeReadinessTarget,
  capability: RuntimeReadinessCapability,
  observedAt: number,
): TargetRuntimeCapabilityReadiness | undefined {
  const key = targetKey(target);
  const targetProbes = probesByTarget.get(key);
  const probe = targetProbes?.capabilities[capability];
  if (!probe) return undefined;
  const probeAt = probe.proof?.at ?? probe.lastError?.at;
  if (
    probeAt !== undefined &&
    (probeAt > observedAt || observedAt - probeAt <= TARGET_RUNTIME_READINESS_TTL_MS)
  ) {
    return {
      mode: probe.mode,
      state: probe.state,
      freshness: probe.state === "proven" ? (probe.invalidated ? "stale" : "current") : "unproven",
      ...(probe.proof ? { proof: { ...probe.proof } } : {}),
      ...(probe.lastError ? { lastError: { ...probe.lastError } } : {}),
      ...(probe.invalidated ? { invalidated: { ...probe.invalidated } } : {}),
      ...(probe.reason ? { reason: probe.reason } : {}),
      ...(probe.nextProbeAt !== undefined ? { nextProbeAt: probe.nextProbeAt } : {}),
    };
  }
  delete targetProbes!.capabilities[capability];
  if (
    Object.keys(targetProbes!.capabilities).length === 0 &&
    targetProbes!.visualFingerprint === undefined
  ) {
    probesByTarget.delete(key);
  }
  return undefined;
}

function clearExpiredVisualFingerprint(target: RuntimeReadinessTarget, observedAt: number): void {
  const key = targetKey(target);
  const targetProbes = probesByTarget.get(key);
  const fingerprint = targetProbes?.visualFingerprint;
  if (
    !targetProbes ||
    !fingerprint ||
    fingerprint.at > observedAt ||
    observedAt - fingerprint.at <= TARGET_RUNTIME_READINESS_TTL_MS
  ) {
    return;
  }
  delete targetProbes.visualFingerprint;
  if (Object.keys(targetProbes.capabilities).length === 0) probesByTarget.delete(key);
}

/**
 * Returns a truthful current state without touching the target. `proven` is
 * only ever emitted after an operation records a live result; an attached or
 * booted device starts `unproven`, never implicitly ready.
 */
export function targetRuntimeReadiness(
  target: RuntimeReadinessTarget,
  observedAt = Date.now(),
): TargetRuntimeReadiness {
  clearExpiredVisualFingerprint(target, observedAt);
  const staticFacts = staticReadiness(target);
  const resolve = (capability: RuntimeReadinessCapability): TargetRuntimeCapabilityReadiness =>
    cloneReadiness(
      staticFacts[capability] ?? liveProbe(target, capability, observedAt) ?? unproven(capability),
    );
  return {
    previewPixels: resolve("previewPixels"),
    semanticControl: resolve("semanticControl"),
    evidenceCapture: resolve("evidenceCapture"),
  };
}

/** Record one bounded probe result. Public operations should prefer the
 * focused helpers below so state labels remain coherent across the product. */
export function recordTargetRuntimeCapability(
  target: Pick<RuntimeReadinessTarget, "platform" | "serial">,
  capability: RuntimeReadinessCapability,
  state: Exclude<TargetRuntimeCapabilityState, "unproven">,
  options?: {
    at?: number;
    durationMs?: number;
    observedNodeCount?: number;
    reason?: TargetRuntimeCapabilityReason;
    errorMessage?: string;
    /** Request-order token from beginTargetRuntimeObservation. */
    observationEpoch?: number;
  },
): void {
  const at = options?.at ?? Date.now();
  const key = targetKey(target);
  const targetProbes = probesByTarget.get(key) ?? { capabilities: {} };
  const previous = targetProbes.capabilities[capability];
  if (
    options?.observationEpoch !== undefined &&
    previous?.observationEpoch !== undefined &&
    options.observationEpoch < previous.observationEpoch
  ) {
    return;
  }
  const reason = options?.reason ?? "probe-failed";
  const retryableSemanticFailure =
    state === "unavailable" &&
    capability === "semanticControl" &&
    target.platform === "ios" &&
    reason === "probe-failed";
  const retryDelayMs = retryableSemanticFailure
    ? Math.min(
        IOS_SEMANTIC_PROBE_MAX_COOLDOWN_MS,
        previous?.state === "unavailable" && previous.retryDelayMs
          ? previous.retryDelayMs * 2
          : IOS_SEMANTIC_PROBE_INITIAL_COOLDOWN_MS,
      )
    : undefined;
  targetProbes.capabilities[capability] = {
    state,
    mode: modeFor(capability),
    ...(options?.observationEpoch !== undefined
      ? { observationEpoch: options.observationEpoch }
      : {}),
    ...(state === "proven"
      ? {
          proof: {
            at,
            ...(options?.observedNodeCount !== undefined
              ? { observedNodeCount: options.observedNodeCount }
              : {}),
            ...(options?.durationMs !== undefined ? { durationMs: options.durationMs } : {}),
          },
        }
      : {
          reason,
          lastError: {
            at,
            reason,
            ...(options?.observedNodeCount !== undefined
              ? { observedNodeCount: options.observedNodeCount }
              : {}),
            ...(options?.durationMs !== undefined ? { durationMs: options.durationMs } : {}),
            ...(options?.errorMessage?.trim()
              ? { message: options.errorMessage.trim().slice(0, 480) }
              : {}),
          },
          ...(retryDelayMs !== undefined ? { nextProbeAt: at + retryDelayMs, retryDelayMs } : {}),
        }),
  };
  probesByTarget.set(key, targetProbes);
}

/** A successful screenshot proves both the live preview and visual-evidence
 * paths; it says nothing about XCTest accessibility control. */
export function recordTargetPixelCapture(
  target: Pick<RuntimeReadinessTarget, "platform" | "serial">,
  options?: {
    at?: number;
    durationMs?: number;
    visualFingerprint?: string;
    /** Request-order token from beginTargetRuntimeObservation. */
    observationEpoch?: number;
  },
): void {
  const at = options?.at ?? Date.now();
  const key = targetKey(target);
  const targetProbes = probesByTarget.get(key) ?? { capabilities: {} };
  const fingerprint = options?.visualFingerprint?.trim();
  const previous = targetProbes.visualFingerprint;
  if (
    options?.observationEpoch !== undefined &&
    previous?.observationEpoch !== undefined &&
    options.observationEpoch < previous.observationEpoch
  ) {
    return;
  }
  const previousIsCurrent =
    previous && (previous.at > at || at - previous.at <= TARGET_RUNTIME_READINESS_TTL_MS);
  const changed = Boolean(fingerprint && previousIsCurrent && previous.value !== fingerprint);
  if (fingerprint) {
    targetProbes.visualFingerprint = {
      value: fingerprint,
      at,
      ...(options?.observationEpoch !== undefined
        ? { observationEpoch: options.observationEpoch }
        : {}),
    };
  }
  probesByTarget.set(key, targetProbes);
  recordTargetRuntimeCapability(target, "previewPixels", "proven", {
    at,
    durationMs: options?.durationMs,
    observationEpoch: options?.observationEpoch,
  });
  recordTargetRuntimeCapability(target, "evidenceCapture", "proven", {
    at,
    durationMs: options?.durationMs,
    observationEpoch: options?.observationEpoch,
  });
  currentTargetSupervisorStore()?.recordPixelCapture(supervisedTarget(target), {
    durationMs: options?.durationMs,
    ...(fingerprint ? { fingerprint } : {}),
  });
  if (changed) {
    invalidateTargetSemanticControl(target, "visual-changed", at, options?.observationEpoch);
  }
}

/**
 * Input and changed pixels invalidate only the semantic plane. The latest
 * preview remains valid pixel evidence, but its old AX geometry must be
 * rendered stale/hidden until one event-driven snapshot proves a new tree.
 */
export function invalidateTargetSemanticControl(
  target: Pick<RuntimeReadinessTarget, "platform" | "serial">,
  reason: "input-changed" | "visual-changed",
  at = Date.now(),
  observationEpoch?: number,
): void {
  const key = targetKey(target);
  const targetProbes = probesByTarget.get(key) ?? { capabilities: {} };
  probesByTarget.set(key, targetProbes);
  // Inputs have no separate capture request, so they get their own fence.
  // This prevents a tree that began before the tap from returning afterward
  // and being accidentally promoted to current.
  const invalidationEpoch = observationEpoch ?? beginTargetRuntimeObservation(target);
  const semantic = targetProbes.capabilities.semanticControl;
  // A visual capture that was started before this semantic request may finish
  // later. It is historical evidence, not a reason to hide the newer tree.
  if (
    semantic?.proof &&
    semantic.state === "proven" &&
    observationEpoch !== undefined &&
    semantic.observationEpoch !== undefined &&
    invalidationEpoch <= semantic.observationEpoch
  ) {
    return;
  }
  const invalidation = { at, reason, observationEpoch: invalidationEpoch };
  if (
    targetProbes.semanticInvalidation &&
    !isNewerInvalidation(invalidation, targetProbes.semanticInvalidation)
  ) {
    return;
  }
  targetProbes.semanticInvalidation = invalidation;
  probesByTarget.set(key, targetProbes);
  applyPendingSemanticInvalidation(target);
  currentTargetSupervisorStore()?.invalidateSemantics(
    supervisedTarget(target),
    reason === "input-changed"
      ? "Confirmed input invalidated the previous semantic proof."
      : "Changed pixels invalidated the previous semantic proof.",
  );
}

/**
 * Check that one exact semantic proof still owns the target. Geometry caches
 * use this private-runtime fact instead of treating a target-wide `current`
 * flag as proof that their older rectangles are still safe.
 */
export function hasCurrentTargetSemanticProof(
  target: Pick<RuntimeReadinessTarget, "platform" | "serial">,
  proof: { at: number; observationEpoch?: number },
  observedAt = Date.now(),
): boolean {
  const readiness = targetRuntimeReadiness(target, observedAt).semanticControl;
  if (
    readiness.state !== "proven" ||
    readiness.freshness !== "current" ||
    readiness.proof?.at !== proof.at
  ) {
    return false;
  }
  const stored = probesByTarget.get(targetKey(target))?.capabilities.semanticControl;
  return (
    proof.observationEpoch === undefined || stored?.observationEpoch === proof.observationEpoch
  );
}

function isNewerInvalidation(
  candidate: NonNullable<TargetProbes["semanticInvalidation"]>,
  current: NonNullable<TargetProbes["semanticInvalidation"]>,
): boolean {
  if (candidate.observationEpoch !== undefined && current.observationEpoch !== undefined) {
    return candidate.observationEpoch > current.observationEpoch;
  }
  if (candidate.observationEpoch !== undefined) return true;
  if (current.observationEpoch !== undefined) return false;
  return candidate.at > current.at;
}

function semanticPredatesInvalidation(
  semantic: RuntimeProbe,
  invalidation: NonNullable<TargetProbes["semanticInvalidation"]>,
): boolean {
  if (!semantic.proof) return false;
  if (semantic.observationEpoch !== undefined && invalidation.observationEpoch !== undefined) {
    return semantic.observationEpoch <= invalidation.observationEpoch;
  }
  return semantic.proof.at <= invalidation.at;
}

function applyPendingSemanticInvalidation(
  target: Pick<RuntimeReadinessTarget, "platform" | "serial">,
): void {
  const targetProbes = probesByTarget.get(targetKey(target));
  if (!targetProbes) return;
  const semantic = targetProbes?.capabilities.semanticControl;
  const visual = targetProbes?.visualFingerprint;
  if (!semantic?.proof || semantic.state !== "proven") return;

  if (
    visual?.observationEpoch !== undefined &&
    semantic.observationEpoch !== undefined &&
    visual.observationEpoch > semantic.observationEpoch
  ) {
    const visualInvalidation = {
      at: visual.at,
      reason: "visual-changed" as const,
      observationEpoch: visual.observationEpoch,
    };
    if (
      !targetProbes.semanticInvalidation ||
      isNewerInvalidation(visualInvalidation, targetProbes.semanticInvalidation)
    ) {
      targetProbes.semanticInvalidation = visualInvalidation;
    }
  }

  const invalidation = targetProbes.semanticInvalidation;
  if (!invalidation) return;
  if (semanticPredatesInvalidation(semantic, invalidation)) {
    semantic.invalidated = { at: invalidation.at, reason: invalidation.reason };
    return;
  }
  // This proof started after the input/frame fence and replaces it. Any older
  // async tree will be rejected by its lower observation epoch.
  delete targetProbes.semanticInvalidation;
}

/**
 * A named, visible node with geometry is enough to prove the semantic query
 * channel. It does not claim every selector is safe to tap: individual
 * actions still go through Relay's ambiguity and region checks.
 */
export function hasUsableSemanticAccessibility(nodes: readonly SnapshotNode[]): boolean {
  return nodes.some((node) => {
    const role = (node.role ?? node.type ?? "").trim().toLocaleLowerCase();
    if (role === "application" || role === "window") return false;
    if (node.enabled === false || node.visibleToUser === false) return false;
    const rect = node.rect;
    if (!rect || rect.width <= 0 || rect.height <= 0) return false;
    return Boolean(
      node.identifier?.trim() || node.ref?.trim() || node.label?.trim() || node.value?.trim(),
    );
  });
}

/**
 * Record the result of one snapshot traversal. An empty/root-only tree is an
 * actual failed semantic probe, while pixels and evidence retain their own
 * independent status.
 */
export function recordTargetSemanticSnapshot(
  target: Pick<RuntimeReadinessTarget, "platform" | "serial">,
  input: {
    inspectable: boolean;
    nodes: readonly SnapshotNode[];
    at?: number;
    durationMs?: number;
    errorMessage?: string;
    observationEpoch?: number;
  },
): void {
  recordTargetRuntimeCapability(
    target,
    "semanticControl",
    input.inspectable && hasUsableSemanticAccessibility(input.nodes) ? "proven" : "unavailable",
    {
      at: input.at,
      durationMs: input.durationMs,
      observedNodeCount: input.nodes.length,
      errorMessage: input.errorMessage,
      observationEpoch: input.observationEpoch,
    },
  );
  applyPendingSemanticInvalidation(target);
  const readiness = targetRuntimeReadiness(target, input.at ?? Date.now()).semanticControl;
  currentTargetSupervisorStore()?.recordSemanticReceipt(supervisedTarget(target), {
    state:
      readiness.state === "proven"
        ? readiness.freshness === "stale"
          ? "stale"
          : "current"
        : "unavailable",
    durationMs: input.durationMs,
    reason: input.errorMessage,
    ...(input.nodes.find((node) => node.bundleId)?.bundleId
      ? { foregroundApp: input.nodes.find((node) => node.bundleId)!.bundleId }
      : {}),
  });
}

/**
 * A bounded iOS wait elapsed while XCTest continues its uncancellable tree
 * traversal. This is not a failed runner and must not schedule another probe:
 * a second traversal would compete with the one already in flight.
 */
export function recordTargetSemanticProbeInFlight(
  target: Pick<RuntimeReadinessTarget, "platform" | "serial">,
  input?: {
    at?: number;
    durationMs?: number;
    errorMessage?: string;
    observationEpoch?: number;
  },
): void {
  recordTargetRuntimeCapability(target, "semanticControl", "unavailable", {
    at: input?.at,
    durationMs: input?.durationMs,
    reason: "probe-in-flight",
    errorMessage: input?.errorMessage,
    observationEpoch: input?.observationEpoch,
  });
  currentTargetSupervisorStore()?.recordSemanticReceipt(supervisedTarget(target), {
    state: "in-flight",
    durationMs: input?.durationMs,
    reason: input?.errorMessage,
  });
}

/**
 * The native snapshot flight settled (its `.finally` path). A usable tree is
 * fresh semantic proof right now: record it immediately instead of leaving
 * `probe-in-flight` stuck until the readiness TTL expires. Stale or unusable
 * trees stay with the capture path, which owns their truthful failure labels.
 */
export function recordTargetSemanticFlightSettled(
  target: Pick<RuntimeReadinessTarget, "platform" | "serial">,
  input: {
    nodes: readonly SnapshotNode[];
    at?: number;
    durationMs?: number;
    staleAfterInput?: boolean;
  },
): void {
  if (!hasUsableSemanticAccessibility(input.nodes)) return;
  if (!input.staleAfterInput) {
    recordTargetRuntimeCapability(target, "semanticControl", "proven", {
      at: input.at,
      observedNodeCount: input.nodes.length,
      ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
    });
    applyPendingSemanticInvalidation(target);
  }
  const readiness = input.staleAfterInput
    ? undefined
    : targetRuntimeReadiness(target, input.at ?? Date.now()).semanticControl;
  currentTargetSupervisorStore()?.recordSemanticReceipt(supervisedTarget(target), {
    state: input.staleAfterInput || readiness?.freshness === "stale" ? "stale" : "current",
    durationMs: input.durationMs,
    ...(input.nodes.find((node) => node.bundleId)?.bundleId
      ? { foregroundApp: input.nodes.find((node) => node.bundleId)!.bundleId }
      : {}),
  });
}

/** Record one capture's semantic outcome without forcing callers to reason
 * about whether a bounded iOS timeout is a runner failure. */
export function recordTargetSemanticCapture(
  target: Pick<RuntimeReadinessTarget, "platform" | "serial">,
  input: {
    inspectable: boolean;
    nodes: readonly SnapshotNode[];
    inFlight?: boolean;
    at?: number;
    durationMs?: number;
    errorMessage?: string;
    observationEpoch?: number;
  },
): void {
  if (input.inFlight) {
    recordTargetSemanticProbeInFlight(target, input);
    return;
  }
  recordTargetSemanticSnapshot(target, input);
}

/** Test/process-lifecycle seam. Runtime evidence is deliberately ephemeral and
 * should reset when the server restarts rather than becoming stale readiness. */
export function resetTargetRuntimeReadiness(): void {
  probesByTarget.clear();
}
