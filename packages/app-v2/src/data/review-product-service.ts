import type {
  CaptureReferenceRegion,
  CaptureReviewAction,
  CaptureReviewItem,
  CaptureReviewQueue,
  ReviewInboxResult,
} from "@relay/protocol";
import type { Platform } from "../platform/types";
import { productClientForPlatform } from "./product-client";

export type ReviewProductService = {
  inbox(input?: { sinceDays?: number; appMapId?: string }): Promise<ReviewInboxResult>;
  /** The screenshot captured by the run. */
  captureImage(runId: string, item: CaptureReviewItem, signal?: AbortSignal): Promise<Blob>;
  /** The approved reference this screenshot is compared with. */
  referenceImage(runId: string, item: CaptureReviewItem, signal?: AbortSignal): Promise<Blob>;
  /** Changed pixels highlighted over the new screenshot. */
  diffImage(runId: string, item: CaptureReviewItem, signal?: AbortSignal): Promise<Blob>;
  review(
    runId: string,
    item: CaptureReviewItem,
    action: CaptureReviewAction,
    note?: string,
  ): Promise<CaptureReviewQueue>;
  setIgnoreRegions(
    runId: string,
    item: CaptureReviewItem,
    regions: CaptureReferenceRegion[],
  ): Promise<CaptureReviewQueue>;
  compare(runId: string): Promise<CaptureReviewQueue>;
};

export const reviewQueryKeys = {
  inbox: (sinceDays = 14, appMapId?: string) =>
    ["review", "inbox", sinceDays, appMapId ?? "all"] as const,
  image: (kind: "capture" | "reference" | "diff", runId: string, item: CaptureReviewItem) =>
    [
      "review",
      "image",
      kind,
      runId,
      item.captureId,
      kind === "capture"
        ? ""
        : `${item.reference?.referenceId ?? ""}:${item.reference?.ignoreRegions?.length ?? 0}`,
    ] as const,
};

async function png(response: Response): Promise<Blob> {
  if (!response.ok) throw new Error(`Screenshot unavailable (${response.status})`);
  return response.blob();
}

function frameFile(item: CaptureReviewItem): string {
  const path = item.framePath ?? "";
  return path.split("/").pop() ?? path;
}

export function createReviewProductService(platform: Platform): ReviewProductService {
  const client = () => productClientForPlatform(platform).then((product) => product.client);
  const run = (runId: string) => `/runs/${encodeURIComponent(runId)}`;
  return {
    async inbox(input = {}) {
      return (await client()).invoke("review.inbox.list", input);
    },
    async captureImage(runId, item, signal) {
      return png(
        await (
          await client()
        ).download(`${run(runId)}/frames/${encodeURIComponent(frameFile(item))}`, signal),
      );
    },
    async referenceImage(runId, item, signal) {
      return png(
        await (
          await client()
        ).download(
          `${run(runId)}/capture-reference/image?captureId=${encodeURIComponent(item.captureId)}`,
          signal,
        ),
      );
    },
    async diffImage(runId, item, signal) {
      return png(
        await (
          await client()
        ).download(
          `${run(runId)}/capture-reference/diff?captureId=${encodeURIComponent(item.captureId)}`,
          signal,
        ),
      );
    },
    async review(runId, item, action, note) {
      const result = await (
        await client()
      ).invoke("run.capture.review", {
        runId,
        captureId: item.captureId,
        action,
        ...(item.imageSha256 ? { imageSha256: item.imageSha256 } : {}),
        ...(note?.trim() ? { note: note.trim() } : {}),
        ...(item.reviewVersion !== undefined ? { expectedReviewVersion: item.reviewVersion } : {}),
      });
      return result.queue;
    },
    async setIgnoreRegions(runId, item, regions) {
      const result = await (
        await client()
      ).invoke("run.capture.reference.ignore-regions.update", {
        runId,
        captureId: item.captureId,
        regions,
      });
      return result.queue;
    },
    async compare(runId) {
      return (await (await client()).invoke("run.capture.reference.compare", { runId })).queue;
    },
  };
}
