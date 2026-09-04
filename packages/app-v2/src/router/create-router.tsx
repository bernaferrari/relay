/** @jsxImportSource react */
import { QueryClient } from "@tanstack/react-query";
import {
  createHashHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
  type RouterHistory,
} from "@tanstack/react-router";
import { OverlayRoot, Skeleton } from "@relay/ui-react";
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
import { assertAllowedRouteSearch } from "./route-contract";

type PreloadableRoute = { preload?: () => Promise<unknown> };

const preloadableRoutes: PreloadableRoute[] = [];

function lazyNamedRoute<TModule extends Record<string, unknown>, TName extends keyof TModule>(
  importer: () => Promise<TModule>,
  name: TName,
) {
  const component = lazyRouteComponent(importer, name);
  preloadableRoutes.push(component as PreloadableRoute);
  return component;
}

const NotFoundPage = lazyNamedRoute(() => import("../routes/not-found-page"), "NotFoundPage");
const HomePage = lazyNamedRoute(() => import("../routes/home-page"), "HomePage");
const AppsPage = lazyNamedRoute(() => import("../routes/apps-page"), "AppsPage");
const AppPage = lazyNamedRoute(() => import("../routes/app-page"), "AppPage");
const AppVersionsPage = lazyNamedRoute(
  () => import("../routes/app-resource-pages"),
  "AppVersionsPage",
);
const AppAccountsPage = lazyNamedRoute(
  () => import("../routes/app-resource-pages"),
  "AppAccountsPage",
);
const MapPage = lazyNamedRoute(() => import("../routes/map-page"), "MapPage");
const TestsPage = lazyNamedRoute(() => import("../routes/tests-page"), "TestsPage");
const NewTestPage = lazyNamedRoute(() => import("../routes/new-test-page"), "NewTestPage");
const TestPage = lazyNamedRoute(() => import("../routes/test-page"), "TestPage");
const EditTestPage = lazyNamedRoute(() => import("../routes/edit-test-page"), "EditTestPage");
const RecordTestPage = lazyNamedRoute(() => import("../routes/record-test-page"), "RecordTestPage");
const RunAcrossPage = lazyNamedRoute(() => import("../routes/run-across-page"), "RunAcrossPage");
const ReviewRecordingPage = lazyNamedRoute(
  () => import("../routes/review-recording-page"),
  "ReviewRecordingPage",
);
const RunsPage = lazyNamedRoute(() => import("../routes/runs-page"), "RunsPage");
const RunPage = lazyNamedRoute(() => import("../routes/run-page"), "RunPage");
const BatchPage = lazyNamedRoute(() => import("../routes/batch-page"), "BatchPage");
const ChangesPage = lazyNamedRoute(() => import("../routes/changes-page"), "ChangesPage");
const ChangePage = lazyNamedRoute(() => import("../routes/change-page"), "ChangePage");
const DevicesPage = lazyNamedRoute(() => import("../routes/devices-page"), "DevicesPage");
const DevicePage = lazyNamedRoute(() => import("../routes/device-page"), "DevicePage");
const SettingsPage = lazyNamedRoute(() => import("../routes/settings-page"), "SettingsPage");

// Route tests assert settled product behavior, not Suspense timing. Production
// keeps the split chunks and TanStack intent preloading; tests eagerly resolve
// the same route registry once so React 19's `use()` boundary is deterministic.
if (import.meta.env.MODE === "test") {
  await Promise.all(preloadableRoutes.map((route) => route.preload?.()));
}

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

function RoutePending() {
  return (
    <section
      className="relay-page relay-route-pending"
      role="status"
      aria-busy="true"
      aria-label="Loading page"
    >
      <span className="relay-visually-hidden">Loading page…</span>
      <Skeleton className="relay-route-pending-eyebrow" />
      <Skeleton className="relay-route-pending-title" />
      <Skeleton className="relay-route-pending-description" />
      <div className="relay-route-pending-content">
        <Skeleton />
        <Skeleton />
      </div>
    </section>
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
    defaultPendingComponent: RoutePending,
    defaultPendingMs: 300,
    defaultPendingMinMs: 300,
    scrollRestoration: true,
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}
