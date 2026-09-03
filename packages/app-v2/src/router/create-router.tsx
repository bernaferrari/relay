/** @jsxImportSource react */
import { QueryClient } from "@tanstack/react-query";
import {
  createHashHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  type RouterHistory,
} from "@tanstack/react-router";
import { OverlayRoot } from "@relay/ui-react";
import {
  createRecordingProductService,
  type RecordingProductService,
} from "../data/recording-product-service";
import { AppShell } from "../layout/app-shell";
import type { Platform } from "../platform/types";
import { NotFoundPage } from "../routes/not-found-page";
import { NewTestPage } from "../routes/new-test-page";
import { PlaceholderPage } from "../routes/placeholder-page";
import { RecordTestPage } from "../routes/record-test-page";
import { ReviewRecordingPage } from "../routes/review-recording-page";
import { assertAllowedRouteSearch, routeContract, type ProductRouteId } from "./route-contract";

export type AppRouterContext = {
  platform: Platform;
  productService: RecordingProductService;
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

function placeholderComponent(id: ProductRouteId) {
  const contract = routeContract(id);
  return () => <PlaceholderPage contract={contract} />;
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
  component: placeholderComponent("/home"),
});
const appsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/apps",
  component: placeholderComponent("/apps"),
});
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/apps/$appId",
  component: placeholderComponent("/apps/:appId"),
});
const appVersionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/apps/$appId/versions",
  component: placeholderComponent("/apps/:appId/versions"),
});
const appAccountsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/apps/$appId/accounts",
  component: placeholderComponent("/apps/:appId/accounts"),
});
const appMapRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/apps/$appId/map",
  component: placeholderComponent("/apps/:appId/map"),
});
const testsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tests",
  component: placeholderComponent("/tests"),
});
const newTestRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tests/new",
  component: NewTestPage,
});
const testRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tests/$testId",
  component: placeholderComponent("/tests/:testId"),
});
const editTestRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tests/$testId/edit",
  component: placeholderComponent("/tests/:testId/edit"),
});
const recordTestRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tests/$testId/record",
  component: RecordTestPage,
});
const runAcrossRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tests/$testId/run-across",
  component: placeholderComponent("/tests/:testId/run-across"),
});
const recordingReviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/recordings/$recordingId/review",
  component: ReviewRecordingPage,
});
const runsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/runs",
  component: placeholderComponent("/runs"),
});
const runRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/runs/$runId",
  component: placeholderComponent("/runs/:runId"),
});
const batchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/batches/$batchId",
  component: placeholderComponent("/batches/:batchId"),
});
const changesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/changes",
  component: placeholderComponent("/changes"),
});
const changeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/changes/$changeId",
  component: placeholderComponent("/changes/:changeId"),
});
const devicesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/devices",
  component: placeholderComponent("/devices"),
});
const deviceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/devices/$deviceId",
  component: placeholderComponent("/devices/:deviceId"),
});
const settingsGeneralRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/general",
  component: placeholderComponent("/settings/general"),
});
const settingsEvidenceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/evidence",
  component: placeholderComponent("/settings/evidence"),
});
const settingsIntegrationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/integrations",
  component: placeholderComponent("/settings/integrations"),
});
const settingsAppearanceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/appearance",
  component: placeholderComponent("/settings/appearance"),
});
const settingsAdvancedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/advanced",
  component: placeholderComponent("/settings/advanced"),
});
const settingsAboutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/about",
  component: placeholderComponent("/settings/about"),
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
  productService?: RecordingProductService;
  queryClient: QueryClient;
  history?: RouterHistory;
}) {
  return createRouter({
    routeTree,
    history: options.history ?? createHashHistory(),
    context: {
      platform: options.platform,
      productService: options.productService ?? createRecordingProductService(options.platform),
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
