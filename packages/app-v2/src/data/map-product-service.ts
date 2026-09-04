import type { ProductMapOverview, ProductMapService } from "@relay/product/map-exploration";
import type { Platform } from "../platform/types";
import { productClientForPlatform } from "./product-client";

export type MapProductService = ProductMapService;

export function createMapProductService(platform: Platform): MapProductService {
  let servicePromise: Promise<ProductMapService> | undefined;
  function service() {
    servicePromise ??= productClientForPlatform(platform).then(async ({ client }) => {
      const { createProductMapService } = await import("@relay/product/map-exploration");
      return createProductMapService(client);
    });
    return servicePromise;
  }
  return {
    get: (appMapId) => service().then((item) => item.get(appMapId)),
  };
}

export type { ProductMapOverview };
