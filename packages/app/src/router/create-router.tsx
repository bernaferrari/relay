/** @jsxImportSource react */
import { ReviewPage } from "../routes/review-page";
import { QueryClient } from "@tanstack/react-query";
import {
  createHashHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
  type AsyncRouteComponent,
  type RouterHistory,
} from "@tanstack/react-router";
import { createElement, type ComponentType } from "react";
import { Skeleton } from "@relay/ui-react/components/skeleton";
import { RouteErrorPage } from "../routes/route-error-page";
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
  createSuiteProfileProductService,
  type SuiteProfileProductService,
} from "../data/suite-profile-product-service";
import {
  createBrowserSpacesProductService,
  type BrowserSpacesProductService,
} from "../data/browser-spaces-product-service";
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
): TModule[TName] extends (props: infer TProps) => unknown ? AsyncRouteComponent<TProps> : never {
  let loaded: ComponentType<Record<string, unknown>> | undefined;
  let loading: Promise<void> | undefined;
  let loadError: unknown;
  const preload = () => {
    loading ??= importer()
      .then((module) => {
        loaded = module[name] as ComponentType<Record<string, unknown>>;
      })
      .catch((error: unknown) => {
        loadError = error;
        throw error;
      });
    return loading;
  };
  const component = (props: Record<string, unknown>) => {
    if (loadError) throw loadError;
    if (!loaded) throw preload();
    return createElement(loaded, props);
  };
  component.preload = preload;
  preloadableRoutes.push(component);
  return component as TModule[TName] extends (props: infer TProps) => unknown
    ? AsyncRouteComponent<TProps>
    : never;
}

const NotFoundPage = lazyNamedRoute(() => import("../routes/not-found-page"), "NotFoundPage");
const AppsPage = lazyNamedRoute(() => import("../routes/apps-page"), "AppsPage");
const AppVersionsPage = lazyNamedRoute(
  () => import("../routes/app-resource-pages"),
  "AppVersionsPage",
);
const AppAccountsPage = lazyNamedRoute(() => import("../routes/accounts-page"), "AppAccountsPage");
const MapPage = lazyNamedRoute(() => import("../routes/map-page"), "MapPage");
const TestsPage = lazyNamedRoute(() => import("../routes/tests-page"), "TestsPage");
const NewTestPage = lazyNamedRoute(() => import("../routes/new-test-page"), "NewTestPage");
const TestPage = lazyNamedRoute(() => import("../routes/test-page"), "TestPage");
const RecordingPage = lazyNamedRoute(() => import("../routes/record-test-page"), "RecordingPage");
const SuitePage = lazyNamedRoute(() => import("../routes/suite-page"), "SuitePage");
const EnvironmentsPage = lazyNamedRoute(
  () => import("../routes/environments-page"),
  "EnvironmentsPage",
);
const EnvironmentPage = lazyNamedRoute(
  () => import("../routes/environment-page"),
  "EnvironmentPage",
);
const ReviewRecordingPage = lazyNamedRoute(
  () => import("../routes/review-recording-page"),
  "ReviewRecordingPage",
);
const RunsPage = lazyNamedRoute(() => import("../routes/runs-page"), "RunsPage");
const RunPage = lazyNamedRoute(() => import("../routes/run-page"), "RunPage");
const BatchPage = lazyNamedRoute(() => import("../routes/batch-page"), "BatchPage");
const DevicesPage = lazyNamedRoute(() => import("../routes/devices-page"), "DevicesPage");
const DevicePage = lazyNamedRoute(() => import("../routes/device-page"), "DevicePage");
const SettingsPage = lazyNamedRoute(() => import("../routes/settings-page"), "SettingsPage");

// Route tests assert settled product behavior, not Suspense timing. Production
// keeps the split chunks and intent preloading; tests eagerly resolve
// the same route registry to assert settled product behavior.
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
  testEditorService: TestEditorProductService;
  suiteProfileService: SuiteProfileProductService;
  browserSpacesService: BrowserSpacesProductService;
  queryClient: QueryClient;
};

const rootRoute = createRootRouteWithContext<AppRouterContext>()({
  beforeLoad: ({ location }) => assertAllowedRouteSearch(location.pathname, location.search),
  component: RootLayout,
  notFoundComponent: NotFoundPage,
});

function RootLayout() {
  const { platform } = rootRoute.useRouteContext();
  return <AppShell platform={platform} />;
}

function RoutePending() {
  return (
    <section
      className="mx-auto w-full px-[clamp(20px,3vw,40px)] pt-7 pb-10 grid content-start gap-3"
      role="status"
      aria-busy="true"
      aria-label="Loading page"
    >
      <span className="sr-only">Loading page…</span>
      <Skeleton className="h-3 w-18" />
      <Skeleton className="mt-0.5 h-10 w-[min(360px,58vw)]" />
      <Skeleton className="h-4.5 w-[min(520px,76vw)]" />
      <div className="mt-8 grid grid-cols-2 gap-3 max-[640px]:grid-cols-1">
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
      </div>
    </section>
  );
}

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/tests", replace: true });
  },
});

const appsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/apps",
  component: AppsPage,
});
const versionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/versions",
  component: AppVersionsPage,
});
const accountsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/accounts",
  component: AppAccountsPage,
});
const appMapRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/apps/$appId/map",
  validateSearch: (
    search: Record<string, unknown>,
  ): { view?: "map" | "screens"; screen?: string; path?: string } => ({
    view: search.view === "screens" ? search.view : undefined,
    screen: typeof search.screen === "string" ? search.screen : undefined,
    path: typeof search.path === "string" ? search.path : undefined,
  }),
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
const recordingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/recordings/$recordingId",
  component: RecordingPage,
});
const suiteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/apps/$appId/suites/$suiteId",
  component: SuitePage,
});
const environmentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/environments",
  component: EnvironmentsPage,
});
const environmentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/environments/$profileId",
  component: EnvironmentPage,
});
const recordingReviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/recordings/$recordingId/review",
  component: ReviewRecordingPage,
  remountDeps: ({ params }) => params.recordingId,
});
const reviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/review",
  component: ReviewPage,
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
const settingsIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  beforeLoad: () => {
    throw redirect({ to: "/settings/general", replace: true });
  },
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
const legacyEvidenceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/evidence",
  beforeLoad: () => {
    // Retired workspace Evidence tab. Inspect a case on the existing Run
    // workbench from Results; capture policy remains /settings/evidence.
    throw redirect({ to: "/runs", replace: true });
  },
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
  appsRoute,
  versionsRoute,
  accountsRoute,
  appMapRoute,
  testsRoute,
  newTestRoute,
  testRoute,
  recordingRoute,
  suiteRoute,
  environmentsRoute,
  environmentRoute,
  recordingReviewRoute,
  reviewRoute,
  runsRoute,
  runRoute,
  batchRoute,
  devicesRoute,
  deviceRoute,
  settingsIndexRoute,
  settingsGeneralRoute,
  settingsEvidenceRoute,
  legacyEvidenceRoute,
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
  testEditorService?: TestEditorProductService;
  suiteProfileService?: SuiteProfileProductService;
  browserSpacesService?: BrowserSpacesProductService;
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
      testEditorService:
        options.testEditorService ?? createTestEditorProductService(options.platform),
      suiteProfileService:
        options.suiteProfileService ?? createSuiteProfileProductService(options.platform),
      browserSpacesService:
        options.browserSpacesService ?? createBrowserSpacesProductService(options.platform),
      queryClient: options.queryClient,
    },
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    defaultPendingComponent: RoutePending,
    defaultErrorComponent: RouteErrorPage,
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
