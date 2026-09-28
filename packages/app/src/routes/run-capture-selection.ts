import { destIdentityReviewItems } from "@relay/protocol";
import type { ProductRunReportOverview } from "../data/run-product-service";

/** Keep destination evidence separate from incidental frames after the checkpoint. */
export function selectRunCaptureFrames(report: ProductRunReportOverview, requestedCapture: number) {
  const allFrames =
    report.evidence
      .find((section) => section.id === "screenshot")
      ?.items.filter((item) => item.media) ?? [];
  const reviewItems = destIdentityReviewItems(report.captureReview?.items ?? []);
  const destFrameIds = new Set(
    reviewItems.flatMap((item) => (item.framePath ? [item.framePath] : [])),
  );
  const leftoverFrameIds = (() => {
    if (!destFrameIds.size) return new Set<string>();
    const leftover = new Set<string>();
    let seenDest = false;
    for (const item of allFrames) {
      if (destFrameIds.has(item.id)) {
        seenDest = true;
        continue;
      }
      if (seenDest) leftover.add(item.id);
    }
    return leftover;
  })();
  const destFrames = destFrameIds.size
    ? allFrames.filter((item) => destFrameIds.has(item.id))
    : allFrames;
  const listedFrames = leftoverFrameIds.size
    ? allFrames.filter((item) => !leftoverFrameIds.has(item.id))
    : allFrames;
  const reviewMode = reviewItems.length > 0;
  const selectedCapture = Math.min(
    requestedCapture,
    Math.max(0, (reviewMode ? reviewItems.length : listedFrames.length) - 1),
  );
  const selectedReview = reviewItems[selectedCapture];
  return { reviewItems, destFrames, listedFrames, reviewMode, selectedCapture, selectedReview };
}
