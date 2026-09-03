export { RelayV2App } from "./app";
export { createRelayQueryClient } from "./data/query-client";
export {
  createRecordingProductService,
  type ProductAppOption,
  type ProductRecordingRecovery,
  type ProductRecordingState,
  type RecordingProductService,
} from "./data/recording-product-service";
export { createWebPlatform } from "./platform/web-platform";
export type { DesktopUpdateState, Platform, PlatformStorage } from "./platform/types";
export { createAppRouter, type AppRouter, type AppRouterContext } from "./router/create-router";
export {
  routeContract,
  routeContractForPath,
  routeContracts,
  type ProductRouteId,
  type RouteContract,
} from "./router/route-contract";
