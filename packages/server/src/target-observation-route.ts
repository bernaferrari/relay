import { createHash } from "node:crypto";
import type http from "node:http";
import {
  captureBrowserDeviceFrame,
  inspectBrowserDevice,
  captureScreenshot,
  captureSnapshot,
  cleanupScreenshot,
  devicePlatformForSerial,
  isBlankScreenshot,
  observeVisualScreenFingerprint,
  persistCapturedAuthoringObservation,
  projectAuthoringEvidenceArtifact,
  managedBrowserTargetIdFromSchedulingKey,
  readTarget,
  type ScreenshotPayload,
  type SnapshotPayload,
} from "@relay/core";
import {
  TARGET_OBSERVATION_MAX_CONTROLS,
  TARGET_OBSERVATION_MAX_PRESENTATION_BYTES,
  type AuthoringObservationProof,
  type AuthoringTarget,
  type TargetObservation,
  type TargetObservationControl,
} from "@relay/protocol";
import { assertTargetObservation } from "./access-control.js";
import { HttpError, json } from "./http.js";
import type { RequestContext } from "./security.js";

type DurableTargetObservationDependencies = {
  platformForSerial(serial: string): Promise<"android" | "ios" | undefined>;
  capturePixels(serial: string): Promise<ScreenshotPayload>;
  captureSemantics(serial: string): Promise<SnapshotPayload>;
  cleanupPixels(path: string): Promise<void>;
  readBrowserTarget?(serial: string): Promise<{ id: string } | null>;
  /** Live DOM semantics for a managed browser target. Absent means the
   * deployment did not open a browser-device session; the observation then
   * reports semantics honestly unavailable. */
  captureBrowserSemantics?(
    targetId: string,
  ): Promise<
    | {
        status: "current";
        capturedAt: number;
        controls: Array<{
          identifier?: string;
          label?: string;
          text?: string;
          role?: string;
          enabled?: boolean;
          selected?: boolean;
          rect?: { x: number; y: number; width: number; height: number };
        }>;
        nodeCount: number;
      }
    | { status: "unavailable"; message: string }
  >;
  captureBrowserPixels?(serial: string): Promise<{
    capturedAt: number;
    mime: "image/jpeg" | "image/png";
    base64: string;
    width: number;
    height: number;
    visualFingerprint: string;
  }>;
};

const defaultDependencies: DurableTargetObservationDependencies = {
  platformForSerial: devicePlatformForSerial,
  capturePixels: (serial) =>
    captureScreenshot({
      serial,
      caption: "Target observation",
      ephemeral: true,
      // A screenshot must never initiate a second semantic traversal. The
      // bounded snapshot below is the operation's only AX request.
      includeScreenMatch: false,
    }),
  captureSemantics: (serial) => captureSnapshot({ serial, interactiveOnly: false }),
  cleanupPixels: cleanupScreenshot,
};

function message(error: unknown, fallback: string): string {
  const value = error instanceof Error ? error.message : fallback;
  return (value.trim() || fallback).slice(0, 480);
}

function pixelFingerprint(bytes: Uint8Array): string {
  return observeVisualScreenFingerprint(bytes) ?? createHash("sha256").update(bytes).digest("hex");
}

function semanticStatus(
  snapshot: SnapshotPayload | undefined,
): "current" | "stale" | "unavailable" {
  if (!snapshot?.inspectable || snapshot.nodes.length === 0) return "unavailable";
  const readiness = snapshot.readiness?.semanticControl;
  if (readiness?.state !== undefined && readiness.state !== "proven") return "unavailable";
  return readiness?.freshness === "stale" ? "stale" : "current";
}

function controls(snapshot: SnapshotPayload | undefined): TargetObservationControl[] {
  return (snapshot?.interactive ?? []).slice(0, TARGET_OBSERVATION_MAX_CONTROLS).map((node) => ({
    ...(node.identifier ? { identifier: node.identifier } : {}),
    ...(node.label ? { label: node.label } : {}),
    ...(node.value ? { text: node.value } : {}),
    ...(node.role || node.type ? { role: node.role ?? node.type } : {}),
    ...(node.enabled !== undefined ? { enabled: node.enabled } : {}),
    ...(node.selected !== undefined ? { selected: node.selected } : {}),
    ...(node.rect ? { rect: node.rect } : {}),
  }));
}

/**
 * Capture both observation planes once and close them over Relay's durable,
 * content-addressed authoring evidence store. This is not an Authoring
 * Session or a Run: it is a small read-only evidence record for the ordinary
 * observe → act → observe loop.
 */
/** Live DOM semantics for a managed browser target via its browser-device
 * session. Any failure — closed session, unstable page — returns honestly
 * unavailable; never an invented current tree. */
async function defaultCaptureBrowserSemantics(
  targetId: string,
): Promise<
  | {
      status: "current";
      capturedAt: number;
      controls: Array<{
        identifier?: string;
        label?: string;
        text?: string;
        role?: string;
        enabled?: boolean;
        selected?: boolean;
        rect?: { x: number; y: number; width: number; height: number };
      }>;
      nodeCount: number;
    }
  | { status: "unavailable"; message: string }
> {
  try {
    const { frame } = await captureBrowserDeviceFrame(targetId);
    const { overlay } = await inspectBrowserDevice(targetId, {
      sessionId: frame.sessionId,
      pageId: frame.pageId,
      expectedSequence: frame.sequence,
    });
    return {
      status: "current",
      capturedAt: overlay.capturedAt,
      nodeCount: overlay.candidates.length,
      controls: overlay.candidates.map((candidate) => ({
        ...(candidate.identifier ? { identifier: candidate.identifier } : {}),
        ...(candidate.label ? { label: candidate.label } : {}),
        ...(candidate.value !== undefined ? { text: candidate.value } : {}),
        role: candidate.role,
        enabled: candidate.enabled,
        selected: candidate.selected,
        rect: candidate.rect,
      })),
    };
  } catch (error) {
    return {
      status: "unavailable",
      message: `Browser semantics unavailable: ${message(error, "browser-device session is not open")}`,
    };
  }
}

async function captureDurableBrowserObservation(
  serial: string,
  dependencies: DurableTargetObservationDependencies,
): Promise<TargetObservation> {
  const capture =
    dependencies.captureBrowserPixels ??
    (async (targetId: string) => {
      const { frame } = await captureBrowserDeviceFrame(targetId);
      return {
        capturedAt: frame.capturedAt,
        mime: frame.mime,
        base64: frame.base64,
        width: frame.width,
        height: frame.height,
        visualFingerprint: frame.visualFingerprint,
      };
    });
  let frame: Awaited<ReturnType<typeof capture>>;
  try {
    frame = await capture(managedBrowserTargetIdFromSchedulingKey(serial) ?? serial);
  } catch (error) {
    throw new HttpError(
      409,
      message(error, "Target input reconciliation requires durable observation evidence"),
      { code: "TARGET_INPUT_RECONCILIATION_EVIDENCE_UNAVAILABLE" },
    );
  }
  const semantics =
    (await (dependencies.captureBrowserSemantics ?? defaultCaptureBrowserSemantics)(
      managedBrowserTargetIdFromSchedulingKey(serial) ?? serial,
    )) ?? { status: "unavailable" as const, message: "Browser semantics were not captured." };
  const bytes = Buffer.from(frame.base64, "base64");
  const persisted = await persistCapturedAuthoringObservation({
    capturedAt: frame.capturedAt,
    targetId: serial,
    fingerprint: frame.visualFingerprint,
    proof: {
      schemaVersion: 1,
      captureOrder: "pixels-first",
      pixels: {
        status: "captured",
        capturedAt: frame.capturedAt,
        fingerprint: frame.visualFingerprint,
        width: frame.width,
        height: frame.height,
      },
      semantics: { status: "unavailable", capturedAt: frame.capturedAt },
    },
    bounds: { width: frame.width, height: frame.height },
    nodes: [],
    screenshotCapturedAt: frame.capturedAt,
    screenshot: { data: bytes, mime: frame.mime },
  });
  const pixelEvidence = persisted.evidence.find((evidence) => evidence.kind === "screenshot");
  const semanticEvidence = persisted.evidence.find((evidence) => evidence.kind === "snapshot");
  if (!pixelEvidence || !semanticEvidence) {
    throw new HttpError(409, "Target input reconciliation requires durable observation evidence", {
      code: "TARGET_INPUT_RECONCILIATION_EVIDENCE_UNAVAILABLE",
    });
  }
  return {
    schemaVersion: 1,
    target: { kind: "browser", platform: "browser", targetId: serial },
    capturedAt: frame.capturedAt,
    pixels: {
      status: "captured",
      capturedAt: frame.capturedAt,
      mime: frame.mime,
      bytes: bytes.byteLength,
      artifact: projectAuthoringEvidenceArtifact(pixelEvidence),
      fingerprint: frame.visualFingerprint,
      width: frame.width,
      height: frame.height,
    },
    semantics:
      semantics.status === "current"
        ? {
            status: "current",
            artifact: projectAuthoringEvidenceArtifact(semanticEvidence),
            capturedAt: semantics.capturedAt,
            nodeCount: semantics.nodeCount,
            controls: semantics.controls,
          }
        : {
            status: "unavailable",
            artifact: projectAuthoringEvidenceArtifact(semanticEvidence),
            capturedAt: frame.capturedAt,
            nodeCount: 0,
            controls: [],
            message: semantics.message,
          },
  };
}

export async function captureDurableTargetObservation(
  serial: string,
  dependencies: DurableTargetObservationDependencies = defaultDependencies,
): Promise<TargetObservation> {
  const platform = await dependencies.platformForSerial(serial);
  if (platform !== "android" && platform !== "ios") {
    const browser =
      (await (
        dependencies.readBrowserTarget ??
        (async (targetId) => {
          const target = await readTarget(
            managedBrowserTargetIdFromSchedulingKey(targetId) ?? targetId,
          );
          return target?.kind === "browser" ? target : null;
        })
      )(serial)) ?? null;
    if (browser) return captureDurableBrowserObservation(serial, dependencies);
    throw new HttpError(404, `Target ${serial} is not a connected Android or iOS device.`);
  }
  const target: AuthoringTarget = { kind: "device", platform, targetId: serial };
  let screenshot: ScreenshotPayload | undefined;
  let screenshotBytes: Buffer | undefined;
  let snapshot: SnapshotPayload | undefined;
  let closingScreenshot: ScreenshotPayload | undefined;
  let closingBytes: Buffer | undefined;
  let pixelFailure: string | undefined;
  let semanticFailure: string | undefined;

  try {
    // Always serialize the planes. Physical iOS has one XCTest command channel,
    // and a platform guess must never make two semantic traversals overlap.
    try {
      screenshot = await dependencies.capturePixels(serial);
      screenshotBytes = Buffer.from(screenshot.base64, "base64");
      if (isBlankScreenshot(screenshotBytes)) {
        pixelFailure = "The target returned a blank screenshot.";
        screenshotBytes = undefined;
      }
    } catch (error) {
      pixelFailure = message(error, "Pixel capture was unavailable.");
    }

    try {
      snapshot = await dependencies.captureSemantics(serial);
      if (!snapshot.inspectable || snapshot.nodes.length === 0) {
        semanticFailure =
          snapshot.inspectionError?.slice(0, 480) || "Semantic inspection was unavailable.";
      }
    } catch (error) {
      semanticFailure = message(error, "Semantic inspection was unavailable.");
    }

    const openingFingerprint = screenshotBytes ? pixelFingerprint(screenshotBytes) : undefined;
    const initialSemanticStatus = semanticStatus(snapshot);
    if (platform === "ios" && openingFingerprint && initialSemanticStatus === "current") {
      try {
        closingScreenshot = await dependencies.capturePixels(serial);
        closingBytes = Buffer.from(closingScreenshot.base64, "base64");
        if (isBlankScreenshot(closingBytes)) closingBytes = undefined;
      } catch {
        closingScreenshot = undefined;
        closingBytes = undefined;
      }
    }
    const closingFingerprint = closingBytes ? pixelFingerprint(closingBytes) : undefined;
    const bracketStatus =
      platform === "ios" && openingFingerprint && initialSemanticStatus === "current"
        ? closingFingerprint &&
          screenshot?.width === closingScreenshot?.width &&
          screenshot?.height === closingScreenshot?.height &&
          openingFingerprint === closingFingerprint
          ? "coherent"
          : closingFingerprint
            ? "changed"
            : "unavailable"
        : undefined;
    const finalSemanticStatus =
      initialSemanticStatus === "current" && platform === "ios" && bracketStatus !== "coherent"
        ? "stale"
        : initialSemanticStatus;
    const fingerprint =
      openingFingerprint ??
      (snapshot?.screenIdentity.fingerprint
        ? snapshot.screenIdentity.fingerprint
        : createHash("sha256").update(`${serial}:${Date.now()}:unavailable`).digest("hex"));
    const capturedAt = Math.max(
      screenshot?.capturedAt ?? 0,
      snapshot?.capturedAt ?? 0,
      closingScreenshot?.capturedAt ?? 0,
      Date.now(),
    );
    const proof: AuthoringObservationProof = {
      schemaVersion: 1,
      captureOrder: bracketStatus ? "pixels-ax-pixels" : "pixels-first",
      pixels: screenshotBytes
        ? {
            status: "captured",
            capturedAt: screenshot!.capturedAt,
            fingerprint,
            ...(screenshot!.width !== undefined ? { width: screenshot!.width } : {}),
            ...(screenshot!.height !== undefined ? { height: screenshot!.height } : {}),
            ...(bracketStatus
              ? {
                  bracket: {
                    status: bracketStatus,
                    ...(closingScreenshot ? { afterCapturedAt: closingScreenshot.capturedAt } : {}),
                    ...(closingFingerprint ? { afterFingerprint: closingFingerprint } : {}),
                  },
                }
              : {}),
          }
        : { status: "unavailable" },
      semantics: {
        status: finalSemanticStatus,
        ...(snapshot ? { capturedAt: snapshot.capturedAt } : {}),
        ...(snapshot?.screenIdentity.fingerprint
          ? { fingerprint: snapshot.screenIdentity.fingerprint }
          : {}),
      },
    };
    const persisted = await persistCapturedAuthoringObservation({
      capturedAt,
      targetId: serial,
      fingerprint,
      proof,
      capture: {
        snapshotSource: snapshot?.source ?? "pixels-only",
        inspectable: snapshot?.inspectable ?? false,
        ...(snapshot?.inspectionState ? { inspectionState: snapshot.inspectionState } : {}),
        ...(snapshot?.bindingState ? { bindingState: snapshot.bindingState } : {}),
        ...(snapshot?.treeApp ? { treeApp: snapshot.treeApp } : {}),
        ...(openingFingerprint ? { visualFingerprint: openingFingerprint } : {}),
      },
      ...(snapshot?.foregroundApp || screenshot?.foregroundApp
        ? { foregroundApp: snapshot?.foregroundApp ?? screenshot?.foregroundApp }
        : {}),
      ...(snapshot?.bounds
        ? { bounds: snapshot.bounds }
        : screenshot?.width !== undefined && screenshot.height !== undefined
          ? { bounds: { width: screenshot.width, height: screenshot.height } }
          : {}),
      nodes: (snapshot?.nodes ?? []).slice(0, 256) as Array<Record<string, unknown>>,
      ...(screenshotBytes && screenshot
        ? {
            screenshotCapturedAt: screenshot.capturedAt,
            screenshot: { data: screenshotBytes, mime: screenshot.mime },
          }
        : {}),
      ...(closingBytes &&
      closingScreenshot &&
      screenshotBytes &&
      !closingBytes.equals(screenshotBytes)
        ? {
            bracketScreenshot: {
              data: closingBytes,
              mime: closingScreenshot.mime,
              capturedAt: closingScreenshot.capturedAt,
            },
          }
        : {}),
    });
    const semanticEvidence = persisted.evidence.find((evidence) => evidence.kind === "snapshot");
    const pixelEvidence = persisted.evidence.find(
      (evidence) =>
        evidence.kind === "screenshot" && evidence.capturedAt === screenshot?.capturedAt,
    );
    if (!semanticEvidence || (screenshotBytes && !pixelEvidence)) {
      throw new Error("Relay could not close the target observation over durable evidence.");
    }
    const readiness = snapshot?.readiness ?? screenshot?.readiness;
    return {
      schemaVersion: 1,
      target,
      capturedAt,
      pixels:
        screenshotBytes && screenshot && pixelEvidence
          ? {
              status: "captured",
              capturedAt: screenshot.capturedAt,
              mime: "image/png",
              bytes: screenshotBytes.byteLength,
              artifact: projectAuthoringEvidenceArtifact(pixelEvidence),
              ...(screenshotBytes.byteLength <= TARGET_OBSERVATION_MAX_PRESENTATION_BYTES
                ? { presentationBase64: screenshotBytes.toString("base64") }
                : {}),
              ...(screenshot.width !== undefined ? { width: screenshot.width } : {}),
              ...(screenshot.height !== undefined ? { height: screenshot.height } : {}),
              ...(openingFingerprint ? { fingerprint: openingFingerprint } : {}),
            }
          : { status: "unavailable", message: pixelFailure ?? "Pixel capture was unavailable." },
      semantics: {
        status: finalSemanticStatus,
        artifact: projectAuthoringEvidenceArtifact(semanticEvidence),
        ...(snapshot ? { capturedAt: snapshot.capturedAt } : {}),
        ...(snapshot?.source ? { source: snapshot.source } : {}),
        ...(snapshot?.androidTreeBackend
          ? { androidTreeBackend: snapshot.androidTreeBackend }
          : {}),
        ...(snapshot?.inspectionState ? { inspectionState: snapshot.inspectionState } : {}),
        ...(snapshot?.screenIdentity.fingerprint
          ? { fingerprint: snapshot.screenIdentity.fingerprint }
          : {}),
        nodeCount: snapshot?.nodes.length ?? 0,
        controls: controls(snapshot),
        ...(finalSemanticStatus === "unavailable"
          ? { message: semanticFailure ?? "Semantic inspection was unavailable." }
          : {}),
      },
      ...(snapshot?.foregroundApp || screenshot?.foregroundApp
        ? { foregroundApp: snapshot?.foregroundApp ?? screenshot?.foregroundApp }
        : {}),
      ...(openingFingerprint
        ? {
            screenCandidate: {
              fingerprint: openingFingerprint,
              confidence: "observed",
            },
          }
        : {}),
      ...(readiness ? { readiness } : {}),
    };
  } finally {
    const paths = new Set(
      [screenshot?.path, closingScreenshot?.path].filter((path): path is string => Boolean(path)),
    );
    await Promise.all(
      [...paths].map((path) => dependencies.cleanupPixels(path).catch(() => undefined)),
    );
  }
}

export async function handleTargetObservationRoute(input: {
  method: string;
  pathname: string;
  url: URL;
  response: http.ServerResponse;
  scope: RequestContext;
}): Promise<boolean> {
  if (input.method !== "GET" || input.pathname !== "/observation") return false;
  const serial = input.url.searchParams.get("serial")?.trim();
  if (!serial) throw new HttpError(400, "serial is required");
  assertTargetObservation(input.scope, serial);
  json(input.response, 200, await captureDurableTargetObservation(serial));
  return true;
}
