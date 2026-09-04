import type {
  ProductCatalog,
  ProductRunDetail,
  ProductRunFilter,
  ProductRunSummary,
  ProductTestDetail,
  ProductTestFilter,
  ProductTestSummary,
} from "@relay/product/catalog";
import type { Platform } from "../platform/types";
import { productClientForPlatform } from "./product-client";

/** Framework-neutral data seam for the Tests and Runs indexes/details. */
export type CatalogProductService = ProductCatalog & {
  listTests(filter?: ProductTestFilter): Promise<readonly ProductTestSummary[]>;
  getTest(testId: string, appMapId?: string): Promise<ProductTestDetail | undefined>;
  listRuns(filter?: ProductRunFilter): Promise<readonly ProductRunSummary[]>;
  getRun(runId: string): Promise<ProductRunDetail | undefined>;
};

export function createCatalogProductService(platform: Platform): CatalogProductService {
  let catalogPromise: Promise<ProductCatalog> | undefined;
  function catalog() {
    catalogPromise ??= Promise.all([
      productClientForPlatform(platform),
      import("@relay/product/catalog"),
    ]).then(([{ client }, { createProductCatalog }]) => createProductCatalog(client));
    return catalogPromise;
  }
  return {
    listTests: (filter) => catalog().then((service) => service.listTests(filter)),
    getTest: (testId, appMapId) => catalog().then((service) => service.getTest(testId, appMapId)),
    listRuns: (filter) => catalog().then((service) => service.listRuns(filter)),
    getRun: (runId) => catalog().then((service) => service.getRun(runId)),
  };
}
