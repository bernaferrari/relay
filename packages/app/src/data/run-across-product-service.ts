import type {
  ProductBatchFailureClusterReport,
  ProductBatchReport,
  ProductBatchResultIdentity,
  ProductBatchSelection,
  ProductBatchSelectionInput,
  ProductBatchTriageInput,
  ProductRunAcrossBatch,
  ProductRunAcrossPreview,
  ProductRunAcrossService,
  ProductRunAcrossSetup,
  ProductRunAcrossStartInput,
} from "@relay/product/run-across";
import { previewProductRunAcross } from "@relay/product/run-across";
import type { Platform } from "../platform/types";
import { productClientForPlatform } from "./product-client";

export type RunAcrossProductService = ProductRunAcrossService;
export type RunAcrossArtifactService = RunAcrossProductService;

export function createRunAcrossProductService(platform: Platform): RunAcrossProductService {
  let servicePromise: Promise<ProductRunAcrossService> | undefined;
  function service() {
    servicePromise ??= productClientForPlatform(platform).then(async ({ client }) => {
      const { createProductRunAcrossService } = await import("@relay/product/run-across");
      return createProductRunAcrossService(client);
    });
    return servicePromise;
  }
  return {
    getSetup: (appMapId, testId) => service().then((item) => item.getSetup(appMapId, testId)),
    preview: previewProductRunAcross,
    startPilot: (input: ProductRunAcrossStartInput) =>
      service().then((item) => item.startPilot(input)),
    continue: (batchId) => service().then((item) => item.continue(batchId)),
    inspect: (batchId) => service().then((item) => item.inspect(batchId)),
    getFailureClusters: (batchId, filters) =>
      service().then((item) => item.getFailureClusters(batchId, filters)),
    select: (batchId, input) => service().then((item) => item.select(batchId, input)),
    rerun: (batchId, input) => service().then((item) => item.rerun(batchId, input)),
    triage: (batchId, input) => service().then((item) => item.triage(batchId, input)),
    cancel: (batchId) => service().then((item) => item.cancel(batchId)),
    getReport: (batchId) => service().then((item) => item.getReport(batchId)),
    getFindings: (batchId) => service().then((item) => item.getFindings(batchId)),
    getCaptureReview: (batchId) =>
      service().then((item) => {
        if (!item.getCaptureReview) throw new Error("Plan capture review is unavailable.");
        return item.getCaptureReview(batchId);
      }),
    reviewCaptures: (batchId, input) =>
      service().then((item) => {
        if (!item.reviewCaptures) throw new Error("Plan capture review is unavailable.");
        return item.reviewCaptures(batchId, input);
      }),
    exportReport: (batchId) => service().then((item) => item.exportReport(batchId)),
    downloadExport: async (batchId) => {
      const { client } = await productClientForPlatform(platform);
      const response = await client.download(
        `/jobs/combine/${encodeURIComponent(batchId)}/export?download=archive`,
      );
      if (!response.ok)
        throw new Error(
          `Export download failed (${response.status}). The export may have expired.`,
        );
      return response.blob();
    },
  };
}

// Kept as named type exports for route adapters that want to avoid importing
// the product package in component signatures.
export type {
  ProductBatchReport,
  ProductBatchFailureClusterReport,
  ProductBatchResultIdentity,
  ProductBatchSelection,
  ProductBatchSelectionInput,
  ProductBatchTriageInput,
  ProductRunAcrossBatch,
  ProductRunAcrossPreview,
  ProductRunAcrossSetup,
};
