import type { DestinationEvidenceSurface } from "@relay/protocol";
import type { SnapshotNode } from "./device.js";
import { now } from "./events.js";
import { observeScreenIdentity, observeVisualScreenFingerprint } from "./screen-identity.js";
import type { ScreenshotPayload } from "./workspace-capture.js";

export const MINIMUM_REVIEW_EVIDENCE_DWELL_MS = 500;
const MAX_OBSERVATIONS = 8;

export type DestinationEvidenceObservation = {
  nodes: SnapshotNode[];
  screenshot?: ScreenshotPayload;
};

export type DestinationEvidenceTiming = {
  surface: DestinationEvidenceSurface;
  observationCount: number;
  stableObservationCount: number;
  navigationMs: number;
  quiescenceMs: number;
  evidenceDwellMs: number;
  minimumEvidenceDwellMs: number;
};

export type StableDestinationEvidence = DestinationEvidenceObservation & {
  timing: DestinationEvidenceTiming;
};

export function requiresReviewEvidenceDwell(surface: DestinationEvidenceSurface): boolean {
  return surface !== "ordinary";
}

function signatures(observation: DestinationEvidenceObservation): {
  semantic: string;
  raster?: string;
} {
  const semantic = observeScreenIdentity(observation.nodes).fingerprint;
  const raster = observation.screenshot
    ? (observation.screenshot.screenMatch?.visualFingerprint ??
      observeVisualScreenFingerprint(Buffer.from(observation.screenshot.base64, "base64")))
    : undefined;
  return { semantic, ...(raster ? { raster } : {}) };
}

/** Wait for consecutive destination observations to agree. Review-sensitive
 * surfaces require both semantic and raster agreement across a real 500ms
 * dwell. Ordinary screens only require semantic quiescence and never inherit
 * a fixed delay. */
export async function awaitStableDestinationEvidence(input: {
  surface?: DestinationEvidenceSurface;
  navigationStartedAt: number;
  initial?: DestinationEvidenceObservation;
  observe: (includeRaster: boolean) => Promise<DestinationEvidenceObservation>;
  wait: (durationMs: number) => Promise<void>;
  clock?: () => number;
}): Promise<StableDestinationEvidence> {
  const surface = input.surface ?? "ordinary";
  const review = requiresReviewEvidenceDwell(surface);
  const clock = input.clock ?? now;
  const startedAt = clock();
  let firstObservedAt: number | undefined;
  let stableSince: number | undefined;
  let requestedDwellMs = 0;
  let previousSignature: ReturnType<typeof signatures> | undefined;
  let stableObservationCount = 0;
  let observationCount = 0;
  let latest: DestinationEvidenceObservation | undefined;
  let latestScreenshot: ScreenshotPayload | undefined;
  let pending = input.initial;

  while (observationCount < MAX_OBSERVATIONS) {
    const observation = pending ?? (await input.observe(review));
    pending = undefined;
    const observedAt = clock();
    firstObservedAt ??= observedAt;
    observationCount += 1;
    latest = observation;
    latestScreenshot = observation.screenshot ?? latestScreenshot;
    const signature = signatures(observation);
    const comparable = !review || Boolean(signature.raster);
    const stable =
      comparable &&
      previousSignature !== undefined &&
      signature.semantic === previousSignature.semantic &&
      (!review || signature.raster === previousSignature.raster);

    if (stable) {
      stableObservationCount += 1;
    } else {
      stableObservationCount = comparable ? 1 : 0;
      stableSince = comparable ? observedAt : undefined;
      requestedDwellMs = 0;
    }
    previousSignature = comparable ? signature : undefined;

    if (stableObservationCount < 2) continue;
    if (!review) {
      return {
        ...observation,
        ...(latestScreenshot ? { screenshot: latestScreenshot } : {}),
        timing: {
          surface,
          observationCount,
          stableObservationCount,
          navigationMs: Math.max(0, (firstObservedAt ?? observedAt) - input.navigationStartedAt),
          quiescenceMs: Math.max(0, observedAt - startedAt),
          evidenceDwellMs: 0,
          minimumEvidenceDwellMs: 0,
        },
      };
    }

    const elapsed = Math.max(0, observedAt - (stableSince ?? observedAt), requestedDwellMs);
    if (elapsed >= MINIMUM_REVIEW_EVIDENCE_DWELL_MS) {
      return {
        ...observation,
        timing: {
          surface,
          observationCount,
          stableObservationCount,
          navigationMs: Math.max(0, (firstObservedAt ?? observedAt) - input.navigationStartedAt),
          quiescenceMs: Math.max(0, observedAt - startedAt, requestedDwellMs),
          evidenceDwellMs: elapsed,
          minimumEvidenceDwellMs: MINIMUM_REVIEW_EVIDENCE_DWELL_MS,
        },
      };
    }
    const remaining = MINIMUM_REVIEW_EVIDENCE_DWELL_MS - elapsed;
    await input.wait(remaining);
    requestedDwellMs += remaining;
  }

  throw new Error(
    `destination-evidence: ${surface} did not produce two stable ${review ? "semantic+raster" : "semantic"} observations`,
    { cause: latest },
  );
}

export function recordDestinationEvidenceTiming(
  artifacts: { kind: string; capturedAt: number; data: unknown }[] | undefined,
  timing: DestinationEvidenceTiming,
  destination: { screenId?: string; label?: string },
): void {
  artifacts?.push({
    kind: "destination-evidence-timing",
    capturedAt: now(),
    data: {
      schemaVersion: 1,
      ...destination,
      ...timing,
    },
  });
}
