/** Node-free snapshot modes and semantic admission, independently of raster or AX acquisition. */
import type { TargetRuntimeReadiness } from "@relay/protocol";
import type { SnapshotPayload } from "./workspace-capture.js";
import type { TargetContext } from "./target-context.js";
import { rememberedTargetApplication } from "./device-target-applications.js";
import { now } from "./events.js";
import {
  IosNativeViewportUnavailableError,
  observeIosNativeViewport,
} from "./ios-native-viewport.js";
import { observeScreenIdentityForHost } from "./screen-identity.js";
import { currentTargetSupervisorStore } from "./target-supervisor-store.js";
import { targetRuntimeReadiness } from "./target-runtime-readiness.js";

export class SnapshotSemanticsQuarantinedError extends Error {
  readonly code = "TARGET_SEMANTICS_QUARANTINED";

  constructor(readonly serial: string) {
    super(
      "Semantic inspection is quarantined; Relay did not read accessibility controls. Pixels remain independently available.",
    );
    this.name = "SnapshotSemanticsQuarantinedError";
  }
}

export class SnapshotLogicalBoundsUnavailableError extends Error {
  readonly code = "TARGET_IOS_LOGICAL_BOUNDS_UNAVAILABLE";

  constructor(
    readonly reason: IosNativeViewportUnavailableError["reason"] | "unsupported-platform",
  ) {
    super(
      reason === "unsupported-platform"
        ? "Logical bounds observation is available only for an iOS target."
        : "Relay could not prove the current iOS application window bounds.",
    );
    this.name = "SnapshotLogicalBoundsUnavailableError";
  }
}

type SnapshotReadiness = (
  observedAt: number,
  inspectionAt?: number,
) => TargetRuntimeReadiness | undefined;
type BlockedCapture = Pick<
  SnapshotPayload,
  "nodes" | "inspectable" | "source" | "bindingState" | "inspectionError" | "foregroundApp"
>;
type SnapshotMetadata =
  | { kind: "window"; payload: SnapshotPayload }
  | { kind: "semantics"; readiness: SnapshotReadiness }
  | { kind: "pixels-only"; capture: BlockedCapture; readiness: SnapshotReadiness };

function readinessForContext(
  context: TargetContext,
  observedAt: number,
): TargetRuntimeReadiness | undefined {
  return context.kind === "device"
    ? targetRuntimeReadiness({ serial: context.serial, platform: context.platform }, observedAt)
    : undefined;
}

function snapshotReadiness(
  context: TargetContext,
  refusal?: SnapshotSemanticsQuarantinedError,
): SnapshotReadiness {
  return (observedAt, inspectionAt = observedAt) => {
    const readiness = readinessForContext(context, observedAt);
    if (!readiness || !refusal) return readiness;
    return {
      ...readiness,
      semanticControl: {
        mode: "accessibility",
        state: "unavailable",
        freshness: "unproven",
        reason: "probe-failed",
        lastError: { at: inspectionAt, reason: "probe-failed", message: refusal.message },
      },
    };
  };
}

/** Decide the observation mode before AX starts. This never captures pixels or changes quarantine. */
export async function prepareSnapshotMetadata(
  context: TargetContext,
  options?: { logicalBoundsOnly?: boolean; includeVisual?: boolean },
): Promise<SnapshotMetadata> {
  const supervisor = currentTargetSupervisorStore();
  const refusal =
    context.kind === "device" &&
    context.platform === "ios" &&
    supervisor?.health({ id: context.serial, kind: "ios" }).overall === "quarantined"
      ? new SnapshotSemanticsQuarantinedError(context.serial)
      : undefined;
  const readiness = snapshotReadiness(context, refusal);
  if (options?.logicalBoundsOnly) {
    if (context.kind !== "device" || context.platform !== "ios") {
      throw new SnapshotLogicalBoundsUnavailableError("unsupported-platform");
    }
    const foregroundApp =
      (await rememberedTargetApplication(context)) ??
      supervisor?.health({ id: context.serial, kind: "ios" }).context.foregroundApp;
    if (!foregroundApp) throw new SnapshotLogicalBoundsUnavailableError("origin-unavailable");
    let bounds: { width: number; height: number };
    try {
      bounds = await observeIosNativeViewport(context.serial, foregroundApp);
    } catch (error) {
      throw new SnapshotLogicalBoundsUnavailableError(
        error instanceof IosNativeViewportUnavailableError ? error.reason : "bounds-unavailable",
      );
    }
    return {
      kind: "window",
      payload: {
        serial: context.serial,
        capturedAt: now(),
        nodes: [],
        interactive: [],
        inspectable: false,
        source: "pixels-only",
        bounds,
        boundsSource: "current-window",
        foregroundApp,
        app: foregroundApp,
        inspectionError: "Geometry-only observation did not read accessibility controls.",
        screenIdentity: observeScreenIdentityForHost([]),
        readiness: readiness(now()),
      },
    };
  }

  if (!refusal) return { kind: "semantics", readiness };
  if (options?.includeVisual !== true) throw refusal;
  const foregroundApp = await rememberedTargetApplication(context);
  return {
    kind: "pixels-only",
    capture: {
      nodes: [],
      inspectable: false,
      source: "pixels-only",
      bindingState: "unavailable",
      inspectionError: refusal.message,
      ...(foregroundApp ? { foregroundApp } : {}),
    },
    readiness,
  };
}
