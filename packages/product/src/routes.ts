export type RoutePattern =
  | "/home"
  | "/apps"
  | "/apps/:appId"
  | "/apps/:appId/versions"
  | "/apps/:appId/accounts"
  | "/apps/:appId/map"
  | "/tests"
  | "/tests/new"
  | "/tests/:testId"
  | "/tests/:testId/edit"
  | "/tests/:testId/record"
  | "/tests/:testId/run-across"
  | "/recordings/:recordingId/review"
  | "/runs"
  | "/runs/:runId"
  | "/batches/:batchId"
  | "/changes"
  | "/changes/:changeId"
  | "/devices"
  | "/devices/:deviceId"
  | "/settings/general"
  | "/settings/evidence"
  | "/settings/integrations"
  | "/settings/appearance"
  | "/settings/advanced"
  | "/settings/about";

export type ConcreteRoute = string;
export type ContextualAction =
  | "continue-recording"
  | "review-failure"
  | "prove-current-change"
  | "add-missing-test"
  | "record-first-test"
  | "add-app"
  | "explore-app"
  | "record-test"
  | "run-test"
  | "review-run"
  | "inspect-run"
  | "review-recording"
  | "review-batch"
  | "verify-change"
  | "inspect-change"
  | "connect-device"
  | "inspect-device"
  | "save-settings";
export type Sidebar = "home" | "apps" | "tests" | "runs" | "changes" | "devices" | "settings";
export type RouteDefinition = {
  id: RoutePattern;
  pattern: RoutePattern;
  parent: RoutePattern | null;
  title: string;
  primaryObject:
    | "App"
    | "Test"
    | "Run"
    | "Change"
    | "Device"
    | "Recording"
    | "Report"
    | "Map"
    | null;
  sidebar: Sidebar;
  back: "history";
  allowedSearchKeys: readonly ("status" | "app" | "view" | "step" | "screen" | "section")[];
  primaryAction: ContextualAction | null;
};
type ObjectKind = RouteDefinition["primaryObject"];
const d = (
  id: RoutePattern,
  parent: RoutePattern | null,
  title: string,
  primaryObject: ObjectKind,
  sidebar: Sidebar,
  primaryAction: ContextualAction | null,
  allowedSearchKeys: RouteDefinition["allowedSearchKeys"] = [],
): RouteDefinition => ({
  id,
  pattern: id,
  parent,
  title,
  primaryObject,
  sidebar,
  back: "history",
  allowedSearchKeys,
  primaryAction,
});

export const ROUTE_DEFINITIONS = [
  d("/home", null, "Home", null, "home", null, ["status", "app", "view"]),
  d("/apps", "/home", "Apps", "App", "apps", "add-app"),
  d("/apps/:appId", "/apps", "App", "App", "apps", "explore-app", ["view"]),
  d("/apps/:appId/versions", "/apps/:appId", "Versions", "App", "apps", null, ["status", "view"]),
  d("/apps/:appId/accounts", "/apps/:appId", "Accounts", "App", "apps", null, ["status", "view"]),
  d("/apps/:appId/map", "/apps/:appId", "Map", "Map", "apps", "explore-app", ["view", "screen"]),
  d("/tests", "/home", "Tests", "Test", "tests", "record-test", ["status", "app", "view"]),
  d("/tests/new", "/tests", "New Test", "Test", "tests", "record-test", ["app", "view"]),
  d("/tests/:testId", "/tests", "Test", "Test", "tests", "run-test", ["view", "step", "screen"]),
  d("/tests/:testId/edit", "/tests/:testId", "Edit Test", "Test", "tests", "record-test", [
    "step",
    "screen",
  ]),
  d("/tests/:testId/record", "/tests/:testId", "Record Test", "Test", "tests", "record-test", [
    "screen",
  ]),
  d("/tests/:testId/run-across", "/tests/:testId", "Run Test", "Test", "tests", "run-test", [
    "app",
    "view",
  ]),
  d(
    "/recordings/:recordingId/review",
    "/tests",
    "Review Recording",
    "Recording",
    "tests",
    "review-recording",
    ["view", "step", "screen"],
  ),
  d("/runs", "/home", "Runs", "Run", "runs", "review-run", ["status", "app", "view"]),
  d("/runs/:runId", "/runs", "Run", "Run", "runs", "inspect-run", ["view", "step", "screen"]),
  d("/batches/:batchId", "/runs", "Batch", "Report", "runs", "review-batch", ["status", "view"]),
  d("/changes", "/home", "Changes", "Change", "changes", "verify-change", [
    "status",
    "app",
    "view",
  ]),
  d("/changes/:changeId", "/changes", "Change", "Change", "changes", "inspect-change", ["view"]),
  d("/devices", "/home", "Devices", "Device", "devices", "connect-device", ["status", "view"]),
  d("/devices/:deviceId", "/devices", "Device", "Device", "devices", "inspect-device", ["view"]),
  ...(["general", "evidence", "integrations", "appearance", "advanced", "about"] as const).map(
    (name) =>
      d(
        `/settings/${name}` as RoutePattern,
        "/home",
        name[0]!.toUpperCase() + name.slice(1),
        null,
        "settings",
        null,
        ["section"],
      ),
  ),
] as const satisfies readonly RouteDefinition[];

function matchRoute(
  path: string,
  pattern: RoutePattern,
): Readonly<Record<string, string>> | undefined {
  const actual = path.split("/").filter(Boolean);
  const expected = pattern.split("/").filter(Boolean);
  if (actual.length !== expected.length) return undefined;
  const params: Record<string, string> = {};
  for (const [index, part] of expected.entries()) {
    const value = actual[index];
    if (!value) return undefined;
    if (!part.startsWith(":")) {
      if (part !== value) return undefined;
      continue;
    }
    try {
      params[part.slice(1)] = decodeURIComponent(value);
    } catch {
      return undefined;
    }
  }
  return params;
}
export function routeMeta(path: ConcreteRoute): RouteDefinition {
  const definition = ROUTE_DEFINITIONS.find((item) => matchRoute(path, item.pattern));
  if (!definition) throw new RangeError(`Unknown Product route: ${path}`);
  return definition;
}
export function resolveHomeAction(input: {
  hasApp: boolean;
  hasTests: boolean;
  currentChange?: "covered" | "missing-coverage" | "failed";
  activeRecording: boolean;
}): ContextualAction {
  if (input.activeRecording) return "continue-recording";
  if (input.currentChange === "failed") return "review-failure";
  if (input.currentChange === "covered") return "prove-current-change";
  if (input.currentChange === "missing-coverage") return "add-missing-test";
  if (input.hasApp && !input.hasTests) return "record-first-test";
  return input.hasApp ? "record-test" : "add-app";
}
type Params = {
  appId?: string;
  testId?: string;
  recordingId?: string;
  runId?: string;
  batchId?: string;
  changeId?: string;
  deviceId?: string;
};
function build(pattern: RoutePattern, params: Params): ConcreteRoute {
  return pattern.replace(/:([A-Za-z]+)\b/g, (_, key: keyof Params) => {
    const value = params[key];
    if (!value?.trim()) throw new TypeError(`Missing route parameter: ${key}`);
    return encodeURIComponent(value.trim());
  });
}
export const routeUrls = {
  app: (appId: string) => build("/apps/:appId", { appId }),
  appVersions: (appId: string) => build("/apps/:appId/versions", { appId }),
  appAccounts: (appId: string) => build("/apps/:appId/accounts", { appId }),
  appMap: (appId: string) => build("/apps/:appId/map", { appId }),
  test: (testId: string) => build("/tests/:testId", { testId }),
  testEdit: (testId: string) => build("/tests/:testId/edit", { testId }),
  testRecord: (testId: string) => build("/tests/:testId/record", { testId }),
  testRunAcross: (testId: string) => build("/tests/:testId/run-across", { testId }),
  recordingReview: (recordingId: string) =>
    build("/recordings/:recordingId/review", { recordingId }),
  run: (runId: string) => build("/runs/:runId", { runId }),
  batch: (batchId: string) => build("/batches/:batchId", { batchId }),
  change: (changeId: string) => build("/changes/:changeId", { changeId }),
  device: (deviceId: string) => build("/devices/:deviceId", { deviceId }),
};
export type RouteLoadIntent = {
  route: ConcreteRoute;
  pattern: RoutePattern;
  params: Readonly<Record<string, string>>;
  query?: Readonly<Record<string, string>>;
};
export function routeLoadIntent(
  route: ConcreteRoute | { pattern: RoutePattern; params: Params },
  query?: Readonly<Record<string, string>>,
): RouteLoadIntent {
  const concrete = typeof route === "string" ? route : build(route.pattern, route.params);
  const definition = routeMeta(concrete);
  if (query)
    for (const key of Object.keys(query))
      if (!definition.allowedSearchKeys.includes(key as never))
        throw new TypeError(`Search key is not allowed on ${definition.id}: ${key}`);
  return {
    route: concrete,
    pattern: definition.pattern,
    params: matchRoute(concrete, definition.pattern) ?? {},
    ...(query ? { query: { ...query } } : {}),
  };
}
