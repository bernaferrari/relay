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
  createSessionProductService,
  type SessionProductService,
} from "../data/session-product-service";
import {
  createSuiteProfileProductService,
  type SuiteProfileProductService,
} from "../data/suite-profile-product-service";
import {
  createBrowserSpacesProductService,
  type BrowserSpacesProductService,
} from "../data/browser-spaces-product-service";
import {
  createLiveTestEditorProductService,
  type LiveTestEditorProductService,
} from "../data/live-test-editor-product-service";
import {
  createChangeProductService,
  type ChangeProductService,
} from "../data/change-product-service";
import {
  createTestEditorProductService,
  type TestEditorProductService,
} from "../data/test-editor-product-service";
import {
  createAgentDebugProductService,
  type AgentDebugProductService,
} from "../data/agent-debug-product-service";
import { createGoalProductService, type GoalProductService } from "../data/goal-product-service";
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
const AppPage = lazyNamedRoute(() => import("../routes/app-page"), "AppPage");
const AppVersionsPage = lazyNamedRoute(
  () => import("../routes/app-resource-pages"),
  "AppVersionsPage",
);
const AppAccountsPage = lazyNamedRoute(() => import("../routes/accounts-page"), "AppAccountsPage");
const MapPage = lazyNamedRoute(() => import("../routes/map-page"), "MapPage");
const TestsPage = lazyNamedRoute(() => import("../routes/tests-page"), "TestsPage");
const NewTestPage = lazyNamedRoute(() => import("../routes/new-test-page"), "NewTestPage");
const TestPage = lazyNamedRoute(() => import("../routes/test-page"), "TestPage");
const EditTestPage = lazyNamedRoute(() => import("../routes/edit-test-page"), "EditTestPage");
const RecordTestPage = lazyNamedRoute(() => import("../routes/record-test-page"), "RecordTestPage");
const RecordingPage = lazyNamedRoute(() => import("../routes/record-test-page"), "RecordingPage");
const RunAcrossPage = lazyNamedRoute(() => import("../routes/run-across-page"), "RunAcrossPage");
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
const SessionsPage = lazyNamedRoute(() => import("../routes/sessions-page"), "SessionsPage");
const SessionPage = lazyNamedRoute(() => import("../routes/session-page"), "SessionPage");
const RunsPage = lazyNamedRoute(() => import("../routes/runs-page"), "RunsPage");
const RunPage = lazyNamedRoute(() => import("../routes/run-page"), "RunPage");
const RunWalkthroughPage = lazyNamedRoute(
  () => import("../routes/run-walkthrough-page"),
  "RunWalkthroughPage",
);
const BatchPage = lazyNamedRoute(() => import("../routes/batch-page"), "BatchPage");
const ChangesPage = lazyNamedRoute(() => import("../routes/changes-page"), "ChangesPage");
const ChangePage = lazyNamedRoute(() => import("../routes/change-page"), "ChangePage");
const DevicesPage = lazyNamedRoute(() => import("../routes/devices-page"), "DevicesPage");
const DevicePage = lazyNamedRoute(() => import("../routes/device-page"), "DevicePage");
const SettingsPage = lazyNamedRoute(() => import("../routes/settings-page"), "SettingsPage");
const AgentDebugPage = lazyNamedRoute(() => import("../routes/agent-debug-page"), "AgentDebugPage");
const GoalPage = lazyNamedRoute(() => import("../routes/goal-page"), "GoalPage");
const PrototypeWorkbenchPage = lazyNamedRoute(
  () => import("../routes/prototype-workbench"),
  "PrototypeWorkbenchPage",
);

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
  changeService: ChangeProductService;
  testEditorService: TestEditorProductService;
  sessionService: SessionProductService;
  suiteProfileService: SuiteProfileProductService;
  browserSpacesService: BrowserSpacesProductService;
  liveTestEditorService: LiveTestEditorProductService;
  agentDebugService: AgentDebugProductService;
  goalService: GoalProductService;
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

// Tests is home: what needs you, your plans, and your tests.
const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/home",
  beforeLoad: () => {
    throw redirect({ to: "/tests", replace: true });
  },
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
  beforeLoad: () => {
    throw redirect({ to: "/versions", replace: true });
  },
});
const appAccountsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/apps/$appId/accounts",
  beforeLoad: () => {
    throw redirect({ to: "/accounts", replace: true });
  },
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
  ): { view?: "map" | "paths" | "screens"; screen?: string; path?: string } => ({
    view: search.view === "screens" || search.view === "paths" ? search.view : undefined,
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
const recordingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/recordings/$recordingId",
  component: RecordingPage,
});
const runAcrossRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tests/$testId/run-across",
  component: RunAcrossPage,
});
const suitesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/suites",
  // Keep old Plan links on the Plans view of the Test library.
  beforeLoad: () => {
    throw redirect({ to: "/tests", search: { view: "plans" }, replace: true });
  },
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
const sessionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sessions",
  component: SessionsPage,
});
const sessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sessions/$sessionId",
  component: SessionPage,
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
const runWalkthroughRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/runs/$runId/walkthrough",
  validateSearch: (
    search: Record<string, unknown>,
  ): { state?: string; variant?: string; capture?: string } => ({
    ...(typeof search.state === "string" && search.state ? { state: search.state } : {}),
    ...(typeof search.variant === "string" && search.variant ? { variant: search.variant } : {}),
    ...(typeof search.capture === "string" && search.capture ? { capture: search.capture } : {}),
  }),
  component: RunWalkthroughPage,
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
const agentDebugRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/debug",
  component: AgentDebugPage,
});
const goalsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/goals",
  component: GoalPage,
});
const prototypeWorkbenchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/prototype/workbench",
  component: PrototypeWorkbenchPage,
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
  homeRoute,
  appsRoute,
  appRoute,
  appVersionsRoute,
  appAccountsRoute,
  versionsRoute,
  accountsRoute,
  appMapRoute,
  testsRoute,
  newTestRoute,
  testRoute,
  editTestRoute,
  recordTestRoute,
  recordingRoute,
  runAcrossRoute,
  suitesRoute,
  suiteRoute,
  environmentsRoute,
  environmentRoute,
  recordingReviewRoute,
  sessionsRoute,
  sessionRoute,
  reviewRoute,
  runsRoute,
  runRoute,
  runWalkthroughRoute,
  batchRoute,
  changesRoute,
  changeRoute,
  devicesRoute,
  deviceRoute,
  agentDebugRoute,
  goalsRoute,
  prototypeWorkbenchRoute,
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
  changeService?: ChangeProductService;
  testEditorService?: TestEditorProductService;
  sessionService?: SessionProductService;
  suiteProfileService?: SuiteProfileProductService;
  browserSpacesService?: BrowserSpacesProductService;
  liveTestEditorService?: LiveTestEditorProductService;
  agentDebugService?: AgentDebugProductService;
  goalService?: GoalProductService;
  queryClient: QueryClient;
  history?: RouterHistory;
}) {
  const productService = options.productService ?? createRecordingProductService(options.platform);
  const testEditorService =
    options.testEditorService ?? createTestEditorProductService(options.platform);
  const sessionService = options.sessionService ?? createSessionProductService(options.platform);
  return createRouter({
    routeTree,
    history: options.history ?? createHashHistory(),
    context: {
      platform: options.platform,
      appResourcesService:
        options.appResourcesService ?? createAppResourcesProductService(options.platform),
      productService,
      runService: options.runService ?? createRunProductService(options.platform),
      runAcrossService: options.runAcrossService ?? createRunAcrossProductService(options.platform),
      mapService: options.mapService ?? createMapProductService(options.platform),
      catalogService: options.catalogService ?? createCatalogProductService(options.platform),
      deviceService: options.deviceService ?? createDeviceProductService(options.platform),
      settingsService: options.settingsService ?? createSettingsProductService(options.platform),
      changeService: options.changeService ?? createChangeProductService(options.platform),
      testEditorService,
      sessionService,
      suiteProfileService:
        options.suiteProfileService ?? createSuiteProfileProductService(options.platform),
      browserSpacesService:
        options.browserSpacesService ?? createBrowserSpacesProductService(options.platform),
      liveTestEditorService:
        options.liveTestEditorService ??
        createLiveTestEditorProductService({
          editor: testEditorService,
          sessions: sessionService,
          recording: productService,
        }),
      agentDebugService:
        options.agentDebugService ?? createAgentDebugProductService(options.platform),
      goalService: options.goalService ?? createGoalProductService(options.platform),
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
