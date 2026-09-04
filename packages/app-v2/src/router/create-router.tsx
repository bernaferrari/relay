/** @jsxImportSource react */
import { QueryClient } from "@tanstack/react-query";
import {
  createHashHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
  type RouterHistory,
} from "@tanstack/react-router";
import { OverlayRoot } from "@relay/ui-react";
import {
  createAppResourcesProductService,
  type AppResourcesProductService,
} from "../data/app-resources-product-service";
import {
  createCatalogProductService,
  type CatalogProductService,
} from "../data/catalog-product-service";
import {
  createDeviceProductService,
  type DeviceProductService,
} from "../data/device-product-service";
import {
  createRecordingProductService,
  type RecordingProductService,
} from "../data/recording-product-service";
import { createRunProductService, type RunProductService } from "../data/run-product-service";
import {
  createRunAcrossProductService,
  type RunAcrossProductService,
} from "../data/run-across-product-service";
import { createMapProductService, type MapProductService } from "../data/map-product-service";
import {
  createSettingsProductService,
  type SettingsProductService,
} from "../data/settings-product-service";
import {
  createChangeProductService,
  type ChangeProductService,
} from "../data/change-product-service";
import {
  createTestEditorProductService,
  type TestEditorProductService,
} from "../data/test-editor-product-service";
import { AppShell } from "../layout/app-shell";
import type { Platform } from "../platform/types";
import { NotFoundPage } from "../routes/not-found-page";
import { HomePage } from "../routes/home-page";
import { NewTestPage } from "../routes/new-test-page";
import { AppsPage } from "../routes/apps-page";
import { AppAccountsPage, AppVersionsPage } from "../routes/app-resource-pages";
import { RecordTestPage } from "../routes/record-test-page";
import { ReviewRecordingPage } from "../routes/review-recording-page";
import { RunPage } from "../routes/run-page";
import { RunAcrossPage } from "../routes/run-across-page";
import { BatchPage } from "../routes/batch-page";
import { TestPage } from "../routes/test-page";
import { EditTestPage } from "../routes/edit-test-page";
import { TestsPage } from "../routes/tests-page";
import { RunsPage } from "../routes/runs-page";
import { DevicePage } from "../routes/device-page";
import { DevicesPage } from "../routes/devices-page";
import { SettingsPage } from "../routes/settings-page";
import { ChangesPage } from "../routes/changes-page";
import { ChangePage } from "../routes/change-page";
import { MapPage } from "../routes/map-page";
import { AppPage } from "../routes/app-page";
import { assertAllowedRouteSearch } from "./route-contract";

export type AppRouterContext = {
  platform: Platform;
  appResourcesService: AppResourcesProductService;
  productService: RecordingProductService;
  runService: RunProductService;
  runAcrossService: RunAcrossProductService;
  mapService: MapProductService;
  catalogService: CatalogProductService;
  deviceService: DeviceProductService;
  settingsService: SettingsProductService;
  changeService: ChangeProductService;
  testEditorService: TestEditorProductService;
  queryClient: QueryClient;
};

const rootRoute = createRootRouteWithContext<AppRouterContext>()({
  beforeLoad: ({ location }) => assertAllowedRouteSearch(location.pathname, location.search),
  component: RootLayout,
  notFoundComponent: NotFoundPage,
});

function RootLayout() {
  const { platform } = rootRoute.useRouteContext();
  return (
    <OverlayRoot>
      <AppShell platform={platform} />
    </OverlayRoot>
  );
}

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/home", replace: true });
  },
});

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/home",
  component: HomePage,
});
const appsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/apps",
  component: AppsPage,
});
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/apps/$appId",
  component: AppPage,
});
const appVersionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/apps/$appId/versions",
  component: AppVersionsPage,
});
const appAccountsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/apps/$appId/accounts",
  component: AppAccountsPage,
});
const appMapRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/apps/$appId/map",
  component: MapPage,
});
const testsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tests",
  component: TestsPage,
});
const newTestRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tests/new",
  component: NewTestPage,
});
const testRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tests/$testId",
  component: TestPage,
});
const editTestRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tests/$testId/edit",
  component: EditTestPage,
});
const recordTestRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tests/$testId/record",
  component: RecordTestPage,
});
const runAcrossRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tests/$testId/run-across",
  component: RunAcrossPage,
});
const recordingReviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/recordings/$recordingId/review",
  component: ReviewRecordingPage,
});
const runsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/runs",
  component: RunsPage,
});
const runRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/runs/$runId",
  component: RunPage,
});
const batchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/batches/$batchId",
  component: BatchPage,
});
const changesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/changes",
  component: ChangesPage,
});
const changeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/changes/$changeId",
  component: ChangePage,
});
const devicesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/devices",
  component: DevicesPage,
});
const deviceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/devices/$deviceId",
  component: DevicePage,
});
const settingsGeneralRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/general",
  component: () => <SettingsPage category="general" />,
});
const settingsEvidenceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/evidence",
  component: () => <SettingsPage category="evidence" />,
});
const settingsIntegrationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/integrations",
  component: () => <SettingsPage category="integrations" />,
});
const settingsAppearanceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/appearance",
  component: () => <SettingsPage category="appearance" />,
});
const settingsAdvancedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/advanced",
  component: () => <SettingsPage category="advanced" />,
});
const settingsAboutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/about",
  component: () => <SettingsPage category="about" />,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  homeRoute,
  appsRoute,
  appRoute,
  appVersionsRoute,
  appAccountsRoute,
  appMapRoute,
  testsRoute,
  newTestRoute,
  testRoute,
  editTestRoute,
  recordTestRoute,
  runAcrossRoute,
  recordingReviewRoute,
  runsRoute,
  runRoute,
  batchRoute,
  changesRoute,
  changeRoute,
  devicesRoute,
  deviceRoute,
  settingsGeneralRoute,
  settingsEvidenceRoute,
  settingsIntegrationsRoute,
  settingsAppearanceRoute,
  settingsAdvancedRoute,
  settingsAboutRoute,
]);

export function createAppRouter(options: {
  platform: Platform;
  appResourcesService?: AppResourcesProductService;
  productService?: RecordingProductService;
  runService?: RunProductService;
  runAcrossService?: RunAcrossProductService;
  mapService?: MapProductService;
  catalogService?: CatalogProductService;
  deviceService?: DeviceProductService;
  settingsService?: SettingsProductService;
  changeService?: ChangeProductService;
  testEditorService?: TestEditorProductService;
  queryClient: QueryClient;
  history?: RouterHistory;
}) {
  return createRouter({
    routeTree,
    history: options.history ?? createHashHistory(),
    context: {
      platform: options.platform,
      appResourcesService:
        options.appResourcesService ?? createAppResourcesProductService(options.platform),
      productService: options.productService ?? createRecordingProductService(options.platform),
      runService: options.runService ?? createRunProductService(options.platform),
      runAcrossService: options.runAcrossService ?? createRunAcrossProductService(options.platform),
      mapService: options.mapService ?? createMapProductService(options.platform),
      catalogService: options.catalogService ?? createCatalogProductService(options.platform),
      deviceService: options.deviceService ?? createDeviceProductService(options.platform),
      settingsService: options.settingsService ?? createSettingsProductService(options.platform),
      changeService: options.changeService ?? createChangeProductService(options.platform),
      testEditorService:
        options.testEditorService ?? createTestEditorProductService(options.platform),
      queryClient: options.queryClient,
    },
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}
