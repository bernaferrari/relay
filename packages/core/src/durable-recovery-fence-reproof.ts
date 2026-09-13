/**
 * Fresh, immutable evidence for releasing a durable worker recovery fence.
 *
 * A process-boundary interruption leaves a target fenced because Relay cannot
 * know what was last sent to the device. This module deliberately does not
 * accept a caller-supplied proof id: it captures a new pixel/semantic/pixel
 * bracket on the exact local target and derives the reproof id from a durable
 * content-addressed manifest. Callers may then use that id to release the
 * journal fence exactly once.
 */
import {
  executionTargetRefKey,
  type AuthoringEvidence,
  type LocalAgentDeviceExecutionTargetRef,
  type LocalBrowserExecutionTargetRef,
  type TargetRuntimeCapabilityReadiness,
} from "@relay/protocol";
import { persistAuthoringEvidence } from "./authoring-evidence.js";
import type { DurableWorkerAssignment } from "./durable-worker-assignments.js";
import {
  cleanupScreenshot,
  isBlankScreenshot,
  type ScreenshotPayload,
  type SnapshotPayload,
} from "./workspace-capture.js";
import { observeVisualScreenFingerprint } from "./screen-identity.js";

export const DURABLE_RECOVERY_FENCE_REPROOF_SCHEMA_VERSION = 1 as const;

export type DurableRecoveryFenceTargetRef =
  | LocalAgentDeviceExecutionTargetRef
  | LocalBrowserExecutionTargetRef;

export type DurableRecoveryFenceReproof = {
  schemaVersion: typeof DURABLE_RECOVERY_FENCE_REPROOF_SCHEMA_VERSION;
  /** Content-addressed identity of the immutable manifest, suitable for the
   * durable worker journal's `reproofId` field. */
  id: string;
  assignmentId: string;
  executionTarget: DurableRecoveryFenceTargetRef;
  capturedAt: number;
  captureOrder: "pixels-ax-pixels";
  pixels: {
    before: AuthoringEvidence;
    after: AuthoringEvidence;
    visualFingerprint: string;
  };
  semantics: {
    evidence: AuthoringEvidence;
    fingerprint: string;
    nodeCount: number;
    capturedAt: number;
  };
  /** The manifest links the exact raw evidence to one assignment and target. */
  manifest: AuthoringEvidence;
  evidenceIds: string[];
};

export type DurableRecoveryFenceReproofCapture = {
  captureScreenshot: () => Promise<ScreenshotPayload>;
  captureSnapshot: () => Promise<SnapshotPayload>;
  cleanupScreenshot?: (path: string) => Promise<void>;
  persistEvidence?: typeof persistAuthoringEvidence;
};

/** Expected, product-safe failures. A caller must leave the fence in place
 * when this is thrown; it is never a prompt to reuse old evidence or retry in
 * the background. */
export class DurableRecoveryFenceReproofError extends Error {
  constructor(
    readonly code:
      | "DURABLE_RECOVERY_FENCE_NOT_RELEASABLE"
      | "DURABLE_RECOVERY_FENCE_TARGET_UNSUPPORTED"
      | "DURABLE_RECOVERY_FENCE_TARGET_MISMATCH"
      | "DURABLE_RECOVERY_FENCE_PIXEL_EVIDENCE_INVALID"
      | "DURABLE_RECOVERY_FENCE_SEMANTIC_EVIDENCE_INVALID"
      | "DURABLE_RECOVERY_FENCE_EVIDENCE_ORDER_INVALID"
      | "DURABLE_RECOVERY_FENCE_EVIDENCE_CHANGED",
    message: string,
  ) {
    super(message);
    this.name = "DurableRecoveryFenceReproofError";
  }
}

function sameLocalTarget(
  expected: DurableRecoveryFenceTargetRef,
  actual: DurableRecoveryFenceTargetRef,
): boolean {
  return executionTargetRefKey(expected) === executionTargetRefKey(actual);
}

/** Fail closed before any new device evidence is captured. */
export function assertDurableRecoveryFenceReproofEligible(input: {
  assignment: DurableWorkerAssignment;
  executionTarget: DurableRecoveryFenceTargetRef;
}): void {
  const { assignment, executionTarget } = input;
  if (
    assignment.status !== "recovery-required" ||
    !assignment.execution ||
    assignment.recoveryFenceRelease
  ) {
    throw new DurableRecoveryFenceReproofError(
      "DURABLE_RECOVERY_FENCE_NOT_RELEASABLE",
      `Durable worker assignment ${assignment.id} has no unreleased recovery fence`,
    );
  }
  if (
    assignment.executionTarget.kind !== "local-device" &&
    assignment.executionTarget.kind !== "local-browser"
  ) {
    throw new DurableRecoveryFenceReproofError(
      "DURABLE_RECOVERY_FENCE_TARGET_UNSUPPORTED",
      "Only a local device or managed browser recovery fence can be released through Relay target recovery",
    );
  }
  if (!sameLocalTarget(assignment.executionTarget, executionTarget)) {
    throw new DurableRecoveryFenceReproofError(
      "DURABLE_RECOVERY_FENCE_TARGET_MISMATCH",
      "The recovered target does not match the durable assignment fence",
    );
  }
}

function requireExactCaptureTarget(
  serial: string | undefined,
  expected: DurableRecoveryFenceTargetRef,
  plane: "screenshot" | "semantic snapshot",
): void {
  if (serial !== expected.identity.value) {
    throw new DurableRecoveryFenceReproofError(
      "DURABLE_RECOVERY_FENCE_TARGET_MISMATCH",
      `Fresh ${plane} evidence did not identify the fenced target`,
    );
  }
}

function requireVisualEvidence(
  screenshot: ScreenshotPayload,
  expected: DurableRecoveryFenceTargetRef,
): { bytes: Buffer; fingerprint: string } {
  requireExactCaptureTarget(screenshot.serial, expected, "screenshot");
  const bytes = Buffer.from(screenshot.base64, "base64");
  const fingerprint = observeVisualScreenFingerprint(bytes);
  if (!bytes.byteLength || isBlankScreenshot(bytes) || !fingerprint) {
    throw new DurableRecoveryFenceReproofError(
      "DURABLE_RECOVERY_FENCE_PIXEL_EVIDENCE_INVALID",
      "Recovery fence release requires a fresh, non-blank screenshot of the fenced target",
    );
  }
  return { bytes, fingerprint };
}

function currentSemanticProof(readiness: TargetRuntimeCapabilityReadiness | undefined): boolean {
  return readiness?.state === "proven" && readiness.freshness === "current";
}

function requireSemanticEvidence(
  snapshot: SnapshotPayload,
  expected: DurableRecoveryFenceTargetRef,
): void {
  requireExactCaptureTarget(snapshot.serial, expected, "semantic snapshot");
  const fingerprintOk = /^[a-f0-9]{64}$/iu.test(snapshot.screenIdentity.fingerprint);
  if (expected.kind === "local-browser") {
    if (snapshot.inspectable !== true || snapshot.nodes.length === 0 || !fingerprintOk) {
      throw new DurableRecoveryFenceReproofError(
        "DURABLE_RECOVERY_FENCE_SEMANTIC_EVIDENCE_INVALID",
        "Recovery fence release requires a fresh, current semantic snapshot of the fenced target",
      );
    }
    return;
  }
  if (
    snapshot.inspectable !== true ||
    snapshot.source === "pixels-only" ||
    snapshot.nodes.length === 0 ||
    !currentSemanticProof(snapshot.readiness?.semanticControl) ||
    !fingerprintOk
  ) {
    throw new DurableRecoveryFenceReproofError(
      "DURABLE_RECOVERY_FENCE_SEMANTIC_EVIDENCE_INVALID",
      "Recovery fence release requires a fresh, current semantic snapshot of the fenced target",
    );
  }
}

function ordered(
  before: ScreenshotPayload,
  snapshot: SnapshotPayload,
  after: ScreenshotPayload,
): boolean {
  return before.capturedAt <= snapshot.capturedAt && snapshot.capturedAt <= after.capturedAt;
}

function reproofId(manifest: AuthoringEvidence): string {
  if (!manifest.sha256) throw new Error("Durable recovery fence manifest is missing integrity");
  return `durable-recovery-fence-reproof:${manifest.sha256}`;
}

function snapshotData(input: {
  assignment: DurableWorkerAssignment;
  target: DurableRecoveryFenceTargetRef;
  snapshot: SnapshotPayload;
  before: AuthoringEvidence;
  semantic: AuthoringEvidence;
  after: AuthoringEvidence;
  visualFingerprint: string;
}): string {
  return JSON.stringify({
    schemaVersion: DURABLE_RECOVERY_FENCE_REPROOF_SCHEMA_VERSION,
    kind: "durable-recovery-fence-reproof",
    assignmentId: input.assignment.id,
    executionTarget: input.target,
    captureOrder: "pixels-ax-pixels",
    pixels: {
      before: {
        id: input.before.id,
        uri: input.before.uri,
        sha256: input.before.sha256,
        capturedAt: input.before.capturedAt,
      },
      after: {
        id: input.after.id,
        uri: input.after.uri,
        sha256: input.after.sha256,
        capturedAt: input.after.capturedAt,
      },
      visualFingerprint: input.visualFingerprint,
    },
    semantics: {
      evidence: {
        id: input.semantic.id,
        uri: input.semantic.uri,
        sha256: input.semantic.sha256,
        capturedAt: input.semantic.capturedAt,
      },
      capturedAt: input.snapshot.capturedAt,
      fingerprint: input.snapshot.screenIdentity.fingerprint,
      inspectable: input.snapshot.inspectable,
      source: input.snapshot.source,
      ...(input.snapshot.inspectionState
        ? { inspectionState: input.snapshot.inspectionState }
        : {}),
      ...(input.snapshot.foregroundApp ? { foregroundApp: input.snapshot.foregroundApp } : {}),
      ...(input.snapshot.treeApp ? { treeApp: input.snapshot.treeApp } : {}),
      ...(input.snapshot.bindingState ? { bindingState: input.snapshot.bindingState } : {}),
      bounds: input.snapshot.bounds,
      nodes: input.snapshot.nodes,
    },
  });
}

/**
 * Capture a strict screenshot → semantic snapshot → screenshot bracket and
 * persist each plane before producing a content-addressed reproof id. The
 * bracket rejects delayed iOS accessibility trees that no longer describe the
 * pixels. There is intentionally no age window or cached-proof input.
 */
export async function captureDurableRecoveryFenceReproof(input: {
  assignment: DurableWorkerAssignment;
  executionTarget: DurableRecoveryFenceTargetRef;
  capture: DurableRecoveryFenceReproofCapture;
}): Promise<DurableRecoveryFenceReproof> {
  assertDurableRecoveryFenceReproofEligible({
    assignment: input.assignment,
    executionTarget: input.executionTarget,
  });
  const cleanup = input.capture.cleanupScreenshot ?? cleanupScreenshot;
  const persist = input.capture.persistEvidence ?? persistAuthoringEvidence;
  let before: ScreenshotPayload | undefined;
  let after: ScreenshotPayload | undefined;
  try {
    before = await input.capture.captureScreenshot();
    const snapshot = await input.capture.captureSnapshot();
    after = await input.capture.captureScreenshot();

    const beforeVisual = requireVisualEvidence(before, input.executionTarget);
    const afterVisual = requireVisualEvidence(after, input.executionTarget);
    requireSemanticEvidence(snapshot, input.executionTarget);
    if (!ordered(before, snapshot, after)) {
      throw new DurableRecoveryFenceReproofError(
        "DURABLE_RECOVERY_FENCE_EVIDENCE_ORDER_INVALID",
        "Recovery fence evidence was not captured around the semantic snapshot",
      );
    }
    if (beforeVisual.fingerprint !== afterVisual.fingerprint) {
      throw new DurableRecoveryFenceReproofError(
        "DURABLE_RECOVERY_FENCE_EVIDENCE_CHANGED",
        "The target pixels changed while semantic evidence was being captured; the recovery fence remains in place",
      );
    }

    const beforeEvidence = await persist({
      kind: "screenshot",
      capturedAt: before.capturedAt,
      data: beforeVisual.bytes,
      mime: before.mime,
    });
    const semanticEvidence = await persist({
      kind: "snapshot",
      capturedAt: snapshot.capturedAt,
      data: JSON.stringify({
        schemaVersion: 1,
        capturedAt: snapshot.capturedAt,
        serial: snapshot.serial,
        source: snapshot.source,
        inspectable: snapshot.inspectable,
        ...(snapshot.inspectionState ? { inspectionState: snapshot.inspectionState } : {}),
        ...(snapshot.foregroundApp ? { foregroundApp: snapshot.foregroundApp } : {}),
        ...(snapshot.treeApp ? { treeApp: snapshot.treeApp } : {}),
        ...(snapshot.bindingState ? { bindingState: snapshot.bindingState } : {}),
        bounds: snapshot.bounds,
        screenIdentity: snapshot.screenIdentity,
        readiness: snapshot.readiness,
        nodes: snapshot.nodes,
      }),
      mime: "application/json",
    });
    const afterEvidence = await persist({
      kind: "screenshot",
      capturedAt: after.capturedAt,
      data: afterVisual.bytes,
      mime: after.mime,
    });
    const manifest = await persist({
      kind: "snapshot",
      capturedAt: after.capturedAt,
      data: snapshotData({
        assignment: input.assignment,
        target: input.executionTarget,
        snapshot,
        before: beforeEvidence,
        semantic: semanticEvidence,
        after: afterEvidence,
        visualFingerprint: beforeVisual.fingerprint,
      }),
      mime: "application/json",
    });
    const id = reproofId(manifest);
    return {
      schemaVersion: DURABLE_RECOVERY_FENCE_REPROOF_SCHEMA_VERSION,
      id,
      assignmentId: input.assignment.id,
      executionTarget: structuredClone(input.executionTarget),
      capturedAt: after.capturedAt,
      captureOrder: "pixels-ax-pixels",
      pixels: {
        before: beforeEvidence,
        after: afterEvidence,
        visualFingerprint: beforeVisual.fingerprint,
      },
      semantics: {
        evidence: semanticEvidence,
        fingerprint: snapshot.screenIdentity.fingerprint,
        nodeCount: snapshot.nodes.length,
        capturedAt: snapshot.capturedAt,
      },
      manifest,
      evidenceIds: [beforeEvidence.id, semanticEvidence.id, afterEvidence.id, manifest.id],
    };
  } finally {
    await Promise.all(
      [before?.path, after?.path]
        .filter((path): path is string => Boolean(path))
        .map(async (path) => cleanup(path).catch(() => undefined)),
    );
  }
}
