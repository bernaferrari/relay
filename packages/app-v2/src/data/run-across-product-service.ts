import type {
  ProductBatchReport,
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
    cancel: (batchId) => service().then((item) => item.cancel(batchId)),
    getReport: (batchId) => service().then((item) => item.getReport(batchId)),
    exportReport: (batchId) => service().then((item) => item.exportReport(batchId)),
  };
}

// Kept as named type exports for route adapters that want to avoid importing
// the product package in component signatures.
export type {
  ProductBatchReport,
  ProductRunAcrossBatch,
  ProductRunAcrossPreview,
  ProductRunAcrossSetup,
};
