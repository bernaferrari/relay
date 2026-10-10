import { ROUTE_DEFINITIONS, type RouteDefinition, type RoutePattern } from "@relay/product/routes";

type RoutePresentation = {
  path: string;
  eyebrow: string;
  description: string;
  chrome?: "standard" | "immersive";
};

const routePresentations = {
  "/apps": {
    path: "/apps",
    eyebrow: "Workspace",
    description: "Choose the software you want Relay to verify.",
  },
  "/accounts": {
    path: "/accounts",
    eyebrow: "Workspace",
    description: "Saved logins your tests can run as.",
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
    description: "Run a saved journey, or record a new one.",
  },
  "/tests/new": {
    path: "/tests/new",
    eyebrow: "Tests",
    description: "Choose an app and a device, then start.",
  },
  "/tests/:testId": {
    path: "/tests/$testId",
    eyebrow: "Test",
    description: "Review this test before running or editing it.",
  },
  "/apps/:appId/suites/:suiteId": {
    path: "/apps/$appId/suites/$suiteId",
    eyebrow: "Plan",
    description: "Review scope and readiness, then run every case.",
  },
  "/environments": {
    path: "/environments",
    eyebrow: "Workspace",
    description: "Saved browsers you can open, record on, and sign into.",
  },
  "/environments/:profileId": {
    path: "/environments/$profileId",
    eyebrow: "Browser",
    description: "Open this browser, check readiness, and save a sign-in.",
  },
  "/recordings/:recordingId": {
    path: "/recordings/$recordingId",
    eyebrow: "Recording",
    description: "Continue capturing a focused, repeatable journey.",
  },
  "/recordings/:recordingId/review": {
    path: "/recordings/$recordingId/review",
    eyebrow: "Recording",
    description: "Review captured steps and checkpoints before saving a test.",
  },
  "/review": {
    path: "/review",
    eyebrow: "Review",
    description: "Screenshots that changed or are new since they were last approved.",
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
    description: "Open a failed case, or rerun the ones you select.",
  },
  "/devices": {
    path: "/devices",
    eyebrow: "Devices",
    description: "See which browsers and devices are ready to run tests.",
  },
  "/devices/:deviceId": {
    path: "/devices/$deviceId",
    eyebrow: "Devices",
    description: "Review readiness and capabilities for this device.",
  },
  "/settings/general": {
    path: "/settings/general",
    eyebrow: "Settings",
    description: "Configure Relay's workspace behavior.",
  },
  "/settings/evidence": {
    path: "/settings/evidence",
    eyebrow: "Settings",
    description:
      "Choose what future Runs may capture. This is capture policy, not a QA Evidence tab.",
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

export function parentPathForPath(pathname: string): string | undefined {
  const contract = routeContractForPath(pathname);
  if (!contract?.parent) return undefined;
  const currentParts = contract.path.split("/").filter(Boolean);
  const actualParts = pathname.split("/").filter(Boolean);
  const params = new Map<string, string>();
  for (const [index, part] of currentParts.entries()) {
    if (part.startsWith("$") && actualParts[index]) params.set(part.slice(1), actualParts[index]!);
  }
  const parent = routeContract(contract.parent).path;
  return parent.replaceAll(/\$([^/]+)/g, (_, key: string) => params.get(key) ?? "");
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
