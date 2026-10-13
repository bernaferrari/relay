import {
  captureReviewIdentityFramePaths,
  captureReviewLeftoverFramePaths,
  destIdentityReviewItems,
  isCaptureReviewLeftoverCaption,
  isCaptureReviewOpenerCaption,
  resolveCaptureReviewQueue,
} from "@relay/protocol";

function field(frame: unknown, key: "path" | "caption"): string {
  const value =
    frame && typeof frame === "object" ? (frame as Record<string, unknown>)[key] : undefined;
  return typeof value === "string" ? value.trim() : "";
}

/** Prefer destination evidence without discarding retained images in the review queue. */
export function destWaitForEvidenceFrames(
  frames: unknown[],
  leftoverBesideDest = false,
  artifacts: Array<{ kind?: string; data?: unknown }> = [],
  captureStepPaths: ReadonlySet<string> = new Set(),
): unknown[] {
  const destPhasePaths = new Set(captureReviewIdentityFramePaths(artifacts));
  const leftoverPaths = new Set(captureReviewLeftoverFramePaths(artifacts));
  const reviewPaths = new Set(
    destIdentityReviewItems(resolveCaptureReviewQueue({ artifacts }).items).flatMap((item) =>
      item.framePath && !leftoverPaths.has(item.framePath) ? [item.framePath] : [],
    ),
  );
  for (const preferred of [destPhasePaths, captureStepPaths]) {
    if (!preferred.size) continue;
    const retained = frames.filter(
      (frame) => preferred.has(field(frame, "path")) || reviewPaths.has(field(frame, "path")),
    );
    if (retained.length) return retained;
  }
  const dest = frames.filter((frame) => !isCaptureReviewLeftoverCaption(field(frame, "caption")));
  const leftover = frames.filter((frame) =>
    isCaptureReviewLeftoverCaption(field(frame, "caption")),
  );
  if (!(dest.length && (leftover.length || leftoverBesideDest))) return frames;
  const withoutOpeners = dest.filter(
    (frame) => !isCaptureReviewOpenerCaption(field(frame, "caption")),
  );
  return withoutOpeners.length ? withoutOpeners : dest;
}
