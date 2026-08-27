import { randomUUID } from "node:crypto";
import type {
  AuthoringCaptureContext,
  AuthoringEvidence,
  AuthoringObservation,
  AuthoringObservationProof,
} from "@relay/protocol";
import { persistAuthoringEvidence } from "./authoring-evidence.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

export type CapturedAuthoringObservation = {
  capturedAt: number;
  targetId: string;
  fingerprint: string;
  proof?: AuthoringObservationProof;
  /** Platform capture provenance kept for offline optimization and audit. */
  capture?: AuthoringCaptureContext;
  foregroundApp?: string;
  bounds?: { width: number; height: number };
  nodes?: Array<Record<string, unknown>>;
  /** Timestamp of the primary pixel evidence. `capturedAt` remains the
   * complete observation boundary, which may be later than this raster after
   * an iOS pixels → AX → pixels bracket. */
  screenshotCapturedAt?: number;
  screenshot?: { data: Uint8Array; mime: string };
  /** The closing iOS raster when it differs from the primary frame. It is
   * retained as immutable diagnostic evidence, never substituted for the
   * opening frame that established the observation's screen fingerprint. */
  bracketScreenshot?: { data: Uint8Array; mime: string; capturedAt: number };
};

function observationId(capturedAt: number, fingerprint: string): string {
  // Captures can share a millisecond and visual fingerprint (especially a
  // fast intentional observe). A durable action link must never resolve to a
  // different capture just because the two endpoints happened to look alike.
  return `observation-${capturedAt.toString(36)}-${fingerprint.slice(0, 12)}-${randomUUID()}`;
}

function fallbackObservationProof(
  captured: CapturedAuthoringObservation,
): AuthoringObservationProof {
  const pixelCapturedAt = captured.screenshotCapturedAt ?? captured.capturedAt;
  return {
    schemaVersion: 1,
    captureOrder: "concurrent",
    pixels: captured.screenshot
      ? { status: "captured", capturedAt: pixelCapturedAt, fingerprint: captured.fingerprint }
      : { status: "unavailable" },
    semantics:
      captured.nodes && captured.nodes.length > 0
        ? { status: "current", capturedAt: captured.capturedAt, fingerprint: captured.fingerprint }
        : { status: "unavailable", capturedAt: captured.capturedAt },
  };
}

export async function persistCapturedAuthoringObservation(
  captured: CapturedAuthoringObservation,
): Promise<{ observation: AuthoringObservation; evidence: AuthoringEvidence[] }> {
  const proof = clone(captured.proof ?? fallbackObservationProof(captured));
  const semanticCapturedAt = proof.semantics.capturedAt ?? captured.capturedAt;
  const primaryPixelCapturedAt =
    captured.screenshotCapturedAt ?? proof.pixels.capturedAt ?? captured.capturedAt;
  const snapshot = await persistAuthoringEvidence({
    kind: "snapshot",
    // A snapshot is the semantic plane, not the enclosing observation. Keep
    // its own timestamp so a delayed iOS tree is auditable offline.
    capturedAt: semanticCapturedAt,
    data: JSON.stringify({
      schemaVersion: 1,
      capturedAt: semanticCapturedAt,
      observationCapturedAt: captured.capturedAt,
      targetId: captured.targetId,
      fingerprint: captured.fingerprint,
      proof,
      ...(captured.capture ? { capture: captured.capture } : {}),
      ...(captured.foregroundApp ? { foregroundApp: captured.foregroundApp } : {}),
      bounds: captured.bounds,
      nodes: captured.nodes?.slice(0, 256) ?? [],
    }),
    mime: "application/json",
  });
  const evidence = [snapshot];
  if (captured.screenshot) {
    evidence.push(
      await persistAuthoringEvidence({
        kind: "screenshot",
        capturedAt: primaryPixelCapturedAt,
        data: captured.screenshot.data,
        mime: captured.screenshot.mime,
      }),
    );
  }
  if (captured.bracketScreenshot) {
    evidence.push(
      await persistAuthoringEvidence({
        kind: "screenshot",
        capturedAt: captured.bracketScreenshot.capturedAt,
        data: captured.bracketScreenshot.data,
        mime: captured.bracketScreenshot.mime,
      }),
    );
  }
  const id = observationId(captured.capturedAt, captured.fingerprint);
  return {
    observation: {
      id,
      capturedAt: captured.capturedAt,
      screen: {
        id,
        fingerprint: captured.fingerprint,
        // The screen fingerprint is a pixel claim, so give it the primary
        // raster's timestamp rather than the later semantic/bracket boundary.
        capturedAt: primaryPixelCapturedAt,
        source: "recording",
        deviceId: captured.targetId,
      },
      evidenceIds: evidence.map((item) => item.id),
      proof,
      ...(captured.capture ? { capture: clone(captured.capture) } : {}),
      ...(captured.bounds ? { bounds: { ...captured.bounds } } : {}),
      ...(captured.foregroundApp ? { foregroundApp: captured.foregroundApp } : {}),
      ...(captured.nodes ? { nodes: clone(captured.nodes.slice(0, 256)) } : {}),
    },
    evidence,
  };
}
