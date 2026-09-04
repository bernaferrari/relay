import { ROUTE_DEFINITIONS, type RouteDefinition, type RoutePattern } from "@relay/product/routes";

type RoutePresentation = {
  path: string;
  eyebrow: string;
  description: string;
  chrome?: "standard" | "immersive";
};

const routePresentations = {
  "/home": {
    path: "/home",
    eyebrow: "Relay",
    description: "See what is ready to verify and continue recent work.",
  },
  "/apps": {
    path: "/apps",
    eyebrow: "Workspace",
    description: "Choose the software you want Relay to verify.",
  },
  "/apps/:appId": {
    path: "/apps/$appId",
    eyebrow: "App",
    description: "Review tests, runs, and verified behavior for this app.",
  },
  "/apps/:appId/versions": {
    path: "/apps/$appId/versions",
    eyebrow: "App",
    description: "Review registered builds and deployments available to this workspace.",
  },
  "/apps/:appId/accounts": {
    path: "/apps/$appId/accounts",
    eyebrow: "App",
    description: "Review saved browser sign-ins available while testing this app.",
  },
  "/apps/:appId/map": {
    path: "/apps/$appId/map",
    eyebrow: "App",
    description: "Explore verified screens and paths when a map is available.",
    chrome: "immersive",
  },
  "/tests": {
    path: "/tests",
    eyebrow: "Library",
    description: "Reviewed journeys that can be run again with confidence.",
  },
  "/tests/new": {
    path: "/tests/new",
    eyebrow: "Tests",
    description: "Choose an app and device to record a repeatable journey.",
  },
  "/tests/:testId": {
    path: "/tests/$testId",
    eyebrow: "Test",
    description: "Review this test before running or editing it.",
  },
  "/tests/:testId/edit": {
    path: "/tests/$testId/edit",
    eyebrow: "Test",
    description: "Refine the reviewed steps and expected checkpoints.",
  },
  "/tests/:testId/record": {
    path: "/tests/$testId/record",
    eyebrow: "Test",
    description: "Record a focused, repeatable journey.",
    chrome: "immersive",
  },
  "/tests/:testId/run-across": {
    path: "/tests/$testId/run-across",
    eyebrow: "Test",
    description: "Choose a data set, preview the exact scope, and run across it deliberately.",
  },
  "/recordings/:recordingId/review": {
    path: "/recordings/$recordingId/review",
    eyebrow: "Recording",
    description: "Review captured steps and checkpoints before saving a test.",
    chrome: "immersive",
  },
  "/runs": {
    path: "/runs",
    eyebrow: "Activity",
    description: "Inspect current and completed test runs.",
  },
  "/runs/:runId": {
    path: "/runs/$runId",
    eyebrow: "Run",
    description: "Review evidence, checkpoints, and failures for this run.",
  },
  "/batches/:batchId": {
    path: "/batches/$batchId",
    eyebrow: "Runs",
    description: "Compare the reports created from one reviewed data set.",
  },
  "/changes": {
    path: "/changes",
    eyebrow: "Verification",
    description: "Connect code changes to the tests and evidence that prove them.",
  },
  "/changes/:changeId": {
    path: "/changes/$changeId",
    eyebrow: "Verification",
    description: "Review the verification plan and its durable evidence.",
  },
  "/devices": {
    path: "/devices",
    eyebrow: "Devices",
    description: "See which browsers and devices are ready to run tests.",
  },
  "/devices/:deviceId": {
    path: "/devices/$deviceId",
    eyebrow: "Devices",
    description: "Review connection health and capabilities for this device.",
  },
  "/settings/general": {
    path: "/settings/general",
    eyebrow: "Settings",
    description: "Configure Relay's workspace behavior.",
  },
  "/settings/evidence": {
    path: "/settings/evidence",
    eyebrow: "Settings",
    description: "Choose how Relay stores and presents run evidence.",
  },
  "/settings/integrations": {
    path: "/settings/integrations",
    eyebrow: "Settings",
    description: "Connect services that identify changes and publish results.",
  },
  "/settings/appearance": {
    path: "/settings/appearance",
    eyebrow: "Settings",
    description: "Choose how Relay looks on this computer.",
  },
  "/settings/advanced": {
    path: "/settings/advanced",
    eyebrow: "Settings",
    description: "Review technical controls and diagnostics.",
  },
  "/settings/about": {
    path: "/settings/about",
    eyebrow: "Settings",
    description: "Version and support information for Relay.",
  },
} as const satisfies Record<RoutePattern, RoutePresentation>;

type RoutePresentations = typeof routePresentations;

export type RouteContract<TId extends RoutePattern = RoutePattern> = RouteDefinition &
  RoutePresentations[TId];
export type ProductRouteId = RoutePattern;

export const routeContracts: readonly RouteContract[] = ROUTE_DEFINITIONS.map((definition) => ({
  ...definition,
  ...routePresentations[definition.id],
}));

export function routeContractForPath(pathname: string): RouteContract | undefined {
  const exact = routeContracts.find((contract) => contract.path === pathname);
  if (exact) return exact;
  return routeContracts.find((contract) => {
    const expression = new RegExp(`^${contract.path.replaceAll(/\$[^/]+/g, "[^/]+")}$`);
    return expression.test(pathname);
  });
}

export function assertAllowedRouteSearch(
  pathname: string,
  search: Readonly<Record<string, unknown>>,
): void {
  const contract = routeContractForPath(pathname);
  if (!contract) return;
  const allowed: ReadonlySet<string> = new Set(contract.allowedSearchKeys);
  const unknown = Object.keys(search).find((key) => !allowed.has(key));
  if (unknown) throw new TypeError(`${unknown} is not supported on ${contract.pattern}.`);
}

export function routeContract<TId extends ProductRouteId>(id: TId): RouteContract<TId> {
  const contract = routeContracts.find((candidate) => candidate.id === id);
  if (!contract) throw new Error(`Unknown route contract: ${id}`);
  return contract as RouteContract<TId>;
}
