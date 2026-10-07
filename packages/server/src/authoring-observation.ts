import { createHash } from "node:crypto";
import {
  captureSnapshot,
  listDevices,
  nativeCaptureTargetProfile,
  captureScreenshot,
  cleanupScreenshot,
  isBlankScreenshot,
  observeVisualScreenFingerprint,
  runWithTargetContext,
  type AuthoringObservationRequest,
  type CapturedAuthoringObservation,
  type Device,
  type SnapshotPayload,
  type ScreenshotPayload,
} from "@relay/core";
import type {
  TargetProfile,
  AuthoringCaptureContext,
  AuthoringObservationProof,
  AuthoringSession,
} from "@relay/protocol";
import { deviceFor, targetContext } from "./authoring-device.js";
import {
  semanticProofStatus,
  pixelBracketStatus,
  type SemanticProofStatus,
} from "./authoring-observation-proof.js";
export type AuthoringObservationDependencies = {
  resolveDevice(session: AuthoringSession): Promise<Device>;
  captureSnapshot(device: Device, request?: AuthoringObservationRequest): Promise<SnapshotPayload>;
  captureProfile?(
    session: AuthoringSession,
    bounds: { width: number; height: number },
  ): Promise<TargetProfile | undefined>;
  /** Retry Android semantics through the explicit serial when the shared
   * authoring observation starts with an empty UiAutomation tree. */
  captureSnapshotBySerial?(serial: string): Promise<SnapshotPayload>;
  captureScreenshot(device: Device): Promise<ScreenshotPayload>;
};

export const authoringObservationDependencies: AuthoringObservationDependencies = {
  resolveDevice: deviceFor,
  captureSnapshot: (device, request) =>
    captureSnapshot({
      device,
      ...request,
      ...(request ? { separateRequestedSelectorEvidence: true } : {}),
    }),
  async captureProfile(session, bounds) {
    if (session.target.kind !== "device") return undefined;
    const facts = (await listDevices()).find(
      (item) =>
        item.serial === session.target.targetId && item.platform === session.target.platform,
    );
    if (!facts) return undefined;
    return nativeCaptureTargetProfile({
      ...session.target,
      observedAt: Date.now(),
      viewport: bounds,
      name: facts.name,
      model: facts.kind,
      osVersion: facts.osVersion,
    });
  },
  captureSnapshotBySerial: (serial) => captureSnapshot({ serial }),
  captureScreenshot: (device) =>
    captureScreenshot({
      device,
      caption: "Authoring evidence",
      ephemeral: true,
      includeScreenMatch: false,
    }),
};

/** Every authoring observation copies its pixels into immutable evidence before
 * returning. The workspace capture path is therefore private implementation
 * state, not an evidence reference. Cleanup is deliberately best-effort so a
 * filesystem issue never hides the already-durable authoring result/error. */
export async function disposeAuthoringScreenshots(
  ...screenshots: Array<ScreenshotPayload | undefined>
): Promise<void> {
  const paths = new Set(
    screenshots
      .map((screenshot) => screenshot?.path)
      .filter((path): path is string => Boolean(path)),
  );
  await Promise.all(
    [...paths].map(async (path) => {
      await cleanupScreenshot(path).catch(() => undefined);
    }),
  );
}

/** A PNG-derived screen fingerprint is stable across benign encoder variance;
 * raw bytes are a conservative fallback for failed/fixture decoders. It is
 * deliberately separate from the AX identity so a late tree cannot certify
 * its own visual bracket. */
export function pixelFingerprint(bytes: Uint8Array): string {
  return observeVisualScreenFingerprint(bytes) ?? createHash("sha256").update(bytes).digest("hex");
}

export async function captureAuthoringObservation(
  session: AuthoringSession,
  dependencies: AuthoringObservationDependencies = authoringObservationDependencies,
  request?: AuthoringObservationRequest,
): Promise<CapturedAuthoringObservation> {
  const device = await dependencies.resolveDevice(session);
  return runWithTargetContext(targetContext(session.target), async () => {
    const ios = session.target.kind === "device" && session.target.platform === "ios";
    // A physical Apple device has one XCTest command channel. Issuing the UI
    // tree and fallback screenshot concurrently makes the runner cancel one
    // request, so an otherwise healthy iPad intermittently falls back out of
    // recording. Android, simulators, and browsers keep the faster parallel
    // path because their capture transports are independent.
    let snapshot: SnapshotPayload;
    let screenshot: ScreenshotPayload | undefined;
    let closingScreenshot: ScreenshotPayload | undefined;
    let closingScreenshotBytes: Buffer | undefined;
    try {
      if (ios) {
        // Freeze the pixels first. Native inspection uses the XCTest command
        // channel and may need to recover a missing app session; evidence must
        // still describe what was visibly on the device when this observation
        // began.
        screenshot = await dependencies.captureScreenshot(device);
        const openingBytes = Buffer.from(screenshot.base64, "base64");
        if (isBlankScreenshot(openingBytes)) {
          throw new Error(
            "The device returned a blank screenshot. Recover or relaunch the app, then retry capture; no map screen was saved.",
          );
        }
        snapshot = await dependencies.captureSnapshot(device, request);
        // Do not pay for a second raster when the tree was already unavailable.
        // When it could otherwise become selector or identity evidence, bracket
        // the AX read with a fresh raster. A failed closing capture leaves the
        // primary screenshot usable but deliberately downgrades semantics.
        if (semanticProofStatus(snapshot) === "current") {
          try {
            closingScreenshot = await dependencies.captureScreenshot(device);
            closingScreenshotBytes = Buffer.from(closingScreenshot.base64, "base64");
          } catch {
            closingScreenshot = undefined;
            closingScreenshotBytes = undefined;
          }
        }
      } else {
        // Settle both independently so a successful temporary raster is
        // still available to dispose when the concurrent AX call fails.
        const [snapshotResult, screenshotResult] = await Promise.allSettled([
          dependencies.captureSnapshot(device),
          dependencies.captureScreenshot(device),
        ]);
        if (screenshotResult.status === "fulfilled") screenshot = screenshotResult.value;
        if (snapshotResult.status === "rejected") throw snapshotResult.reason;
        if (screenshotResult.status === "rejected") throw screenshotResult.reason;
        snapshot = snapshotResult.value;
        if (
          session.target.kind === "device" &&
          session.target.platform === "android" &&
          snapshot.nodes.length === 0 &&
          dependencies.captureSnapshotBySerial
        ) {
          try {
            const retry = await dependencies.captureSnapshotBySerial(session.target.targetId);
            if (retry.nodes.length > snapshot.nodes.length) snapshot = retry;
          } catch {
            // Keep the original pixel-backed observation and its honest empty
            // semantics when the bounded retry cannot acquire UiAutomation.
          }
        }
      }
      if (!screenshot) throw new Error("Authoring screenshot capture did not return evidence.");
      // captureScreenshot already bakes iOS orientation; do not normalize again
      // (a second 180° would flip upright frames back).
      const screenshotBytes = Buffer.from(screenshot.base64, "base64");
      if (isBlankScreenshot(screenshotBytes)) {
        throw new Error(
          "The device returned a blank screenshot. Recover or relaunch the app, then retry capture; no map screen was saved.",
        );
      }
      const primaryPixelFingerprint = pixelFingerprint(screenshotBytes);
      const closingPixelFingerprint = closingScreenshotBytes
        ? pixelFingerprint(closingScreenshotBytes)
        : undefined;
      const bracket =
        ios && semanticProofStatus(snapshot) === "current"
          ? {
              status:
                closingScreenshot && closingScreenshotBytes && closingPixelFingerprint
                  ? pixelBracketStatus({
                      before: screenshot,
                      beforeFingerprint: primaryPixelFingerprint,
                      after: closingScreenshot,
                      afterBytes: closingScreenshotBytes,
                      afterFingerprint: closingPixelFingerprint,
                    })
                  : ("unavailable" as const),
              ...(closingScreenshot ? { afterCapturedAt: closingScreenshot.capturedAt } : {}),
              ...(closingPixelFingerprint ? { afterFingerprint: closingPixelFingerprint } : {}),
            }
          : undefined;
      // Authoring always has a screenshot, while native semantics can disappear
      // between two captures on real devices (notably Samsung Settings and
      // custom-rendered apps). Keep one identity modality for the whole Take so
      // a successful replay cannot fail merely because accessibility recovered.
      // The semantic tree remains attached as evidence and is still used by the
      // deterministic resolver; visual identity is only the screen-state key.
      // iOS must never use the delayed AX fingerprint as a stand-in for raster
      // evidence. Other transports retain their established semantic fallback
      // when a test fixture or provider cannot decode the image.
      const fingerprint = ios
        ? primaryPixelFingerprint
        : (observeVisualScreenFingerprint(screenshotBytes) ?? snapshot.screenIdentity.fingerprint);
      const semanticStatus: SemanticProofStatus =
        ios && semanticProofStatus(snapshot) === "current" && bracket?.status !== "coherent"
          ? "stale"
          : semanticProofStatus(snapshot);
      const proof: AuthoringObservationProof = {
        schemaVersion: 1,
        captureOrder: bracket ? "pixels-ax-pixels" : ios ? "pixels-first" : "concurrent",
        pixels: {
          status: "captured",
          capturedAt: screenshot.capturedAt,
          fingerprint: ios ? primaryPixelFingerprint : fingerprint,
          ...(screenshot.width !== undefined ? { width: screenshot.width } : {}),
          ...(screenshot.height !== undefined ? { height: screenshot.height } : {}),
          ...(bracket ? { bracket } : {}),
        },
        semantics: {
          status: semanticStatus,
          capturedAt: snapshot.capturedAt,
          ...(snapshot.inspectable !== false && snapshot.nodes.length > 0
            ? { fingerprint: snapshot.screenIdentity.fingerprint }
            : {}),
        },
      };
      const profile =
        ios && request && snapshot.bounds && dependencies.captureProfile
          ? await dependencies.captureProfile(session, snapshot.bounds).catch(() => undefined)
          : undefined;
      const capture: AuthoringCaptureContext = {
        ...(request && profile?.viewport && profile.platform === "ios"
          ? {
              selectorEntrance: {
                schemaVersion: 1 as const,
                request: {
                  identifiers: [...(request.includeIdentifiers ?? [])],
                  labels: [...(request.includeLabels ?? [])],
                },
                profile: {
                  id: profile.id,
                  targetId: profile.targetId,
                  platform: "ios" as const,
                  viewport: profile.viewport,
                  ...(profile.model ? { model: profile.model } : {}),
                  ...(profile.osVersion ? { osVersion: profile.osVersion } : {}),
                  capabilities: ["snapshot", "screenshot"] as ["snapshot", "screenshot"],
                },
              },
            }
          : {}),
        snapshotSource: snapshot.source,
        inspectable: snapshot.inspectable,
        ...(snapshot.inspectionState ? { inspectionState: snapshot.inspectionState } : {}),
        ...(snapshot.bindingState ? { bindingState: snapshot.bindingState } : {}),
        ...(snapshot.treeApp ? { treeApp: snapshot.treeApp } : {}),
        ...(ios
          ? { visualFingerprint: primaryPixelFingerprint }
          : snapshot.visualFingerprint
            ? { visualFingerprint: snapshot.visualFingerprint }
            : {}),
      };
      return {
        capturedAt: Math.max(
          snapshot.capturedAt,
          screenshot.capturedAt,
          closingScreenshot?.capturedAt ?? Number.NEGATIVE_INFINITY,
        ),
        targetId: session.target.targetId,
        fingerprint,
        proof,
        capture,
        ...(snapshot.foregroundApp ? { foregroundApp: snapshot.foregroundApp } : {}),
        ...(snapshot.bounds ? { bounds: snapshot.bounds } : {}),
        nodes: snapshot.nodes.slice(0, 256) as Array<Record<string, unknown>>,
        ...(snapshot.catalogNodes
          ? { catalogNodes: snapshot.catalogNodes as Array<Record<string, unknown>> }
          : request
            ? {
                catalogNodes: snapshot.nodes.filter(
                  (node) => node.recordingSelectorSupplemental !== true,
                ) as Array<Record<string, unknown>>,
              }
            : {}),
        screenshotCapturedAt: screenshot.capturedAt,
        screenshot: { data: screenshotBytes, mime: screenshot.mime },
        ...(closingScreenshot &&
        closingScreenshotBytes &&
        !screenshotBytes.equals(closingScreenshotBytes)
          ? {
              bracketScreenshot: {
                data: closingScreenshotBytes,
                mime: closingScreenshot.mime,
                capturedAt: closingScreenshot.capturedAt,
              },
            }
          : {}),
      };
    } finally {
      await disposeAuthoringScreenshots(screenshot, closingScreenshot);
    }
  });
}
