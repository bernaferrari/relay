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
  getRecordingFrame?(uri: string): Promise<{ bytes: Uint8Array; mime: string }>;
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
    async getRecordingFrame(uri) {
      const match = /^relay-evidence:\/\/([a-f\d]{64})$/iu.exec(uri);
      if (!match) throw new Error("Invalid saved screenshot reference");
      const { client } = await productClientForPlatform(platform);
      const resource = await client.binaryResource(
        `/authoring-evidence/${match[1]}?mime=image%2Fpng`,
      );
      return {
        bytes: resource.bytes,
        mime: resource.headers.get("content-type")?.split(";")[0] ?? "image/png",
      };
    },
    listTests: (filter) => catalog().then((service) => service.listTests(filter)),
    getTest: (testId, appMapId) => catalog().then((service) => service.getTest(testId, appMapId)),
    listRuns: (filter) => catalog().then((service) => service.listRuns(filter)),
    listRunsComplete: (filter) =>
      catalog().then((service) =>
        service.listRunsComplete ? service.listRunsComplete(filter) : service.listRuns(filter),
      ),
    getRun: (runId) => catalog().then((service) => service.getRun(runId)),
  };
}
