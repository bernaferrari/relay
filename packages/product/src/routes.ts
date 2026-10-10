export type RoutePattern =
  | "/apps"
  | "/apps/:appId"
  | "/versions"
  | "/accounts"
  | "/apps/:appId/map"
  | "/tests"
  | "/tests/new"
  | "/tests/:testId"
  | "/tests/:testId/edit"
  | "/apps/:appId/suites/:suiteId"
  | "/environments"
  | "/environments/:profileId"
  | "/sessions"
  | "/sessions/:sessionId"
  | "/recordings/:recordingId"
  | "/recordings/:recordingId/review"
  | "/review"
  | "/runs"
  | "/runs/:runId"
  | "/batches/:batchId"
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
  | "inspect-session"
  | "create-suite"
  | "run-suite"
  | "add-environment"
  | "inspect-environment"
  | "review-batch"
  | "connect-device"
  | "inspect-device"
  | "save-settings";
export type Sidebar = "apps" | "accounts" | "tests" | "sessions" | "runs" | "devices" | "settings";
export type RouteDefinition = {
  id: RoutePattern;
  pattern: RoutePattern;
  parent: RoutePattern | null;
  title: string;
  primaryObject:
    | "App"
    | "Test"
    | "Run"
    | "Device"
    | "Session"
    | "Plan"
    | "Environment"
    | "Recording"
    | "Report"
    | "Map"
    | null;
  sidebar: Sidebar;
  back: "history";
  allowedSearchKeys: readonly (
    | "plan"
    | "planApp"
    | "item"
    | "filter"
    | "status"
    | "app"
    | "site"
    | "account"
    | "view"
    | "step"
    | "at"
    | "attempt"
    | "screen"
    | "path"
    | "target"
    | "targetKind"
    | "originApplication"
    | "runId"
    | "session"
    | "section"
    | "replayJob"
    | "reportView"
    | "capture"
    | "state"
    | "variant"
    | "type"
    | "q"
    | "result"
    | "returnTo"
    | "run"
    | "setup"
    | "url"
  )[];
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
  d("/apps", "/tests", "Apps", "App", "apps", "add-app"),
  d("/apps/:appId", "/apps", "App", "App", "apps", "explore-app", ["view"]),
  d("/versions", "/tests", "Versions", null, "apps", null, ["status", "view"]),
  d("/accounts", "/tests", "Accounts", null, "accounts", null, ["status", "view"]),
  d("/apps/:appId/map", "/apps/:appId", "Map", "Map", "apps", "explore-app", [
    "view",
    "screen",
    "path",
  ]),
  d("/tests", null, "Tests", "Test", "tests", "record-test", [
    "status",
    "app",
    "view",
    "q",
    "result",
    "plan",
    "planApp",
  ]),
  d("/tests/new", "/tests", "New test", "Test", "tests", "record-test", [
    "app",
    "site",
    "account",
    "view",
    "path",
    "target",
    "originApplication",
    "targetKind",
  ]),
  d("/tests/:testId", "/tests", "Test", "Test", "tests", "run-test", [
    "app",
    "plan",
    "planApp",
    "target",
    "setup",
    "view",
    "step",
    "screen",
    "run",
  ]),
  d("/tests/:testId/edit", "/tests/:testId", "Edit test", "Test", "tests", "record-test", [
    "app",
    "step",
    "screen",
    "session",
  ]),
  d("/apps/:appId/suites/:suiteId", "/tests", "Plan", "Plan", "tests", "run-suite", [
    "view",
    "target",
  ]),
  d("/environments", "/tests", "Environments", "Environment", "devices", "add-environment", [
    "status",
    "view",
    "returnTo",
  ]),
  d(
    "/environments/:profileId",
    "/environments",
    "Environment",
    "Environment",
    "devices",
    "inspect-environment",
    ["view", "returnTo"],
  ),
  d("/sessions", "/tests", "Activity", "Session", "sessions", "inspect-session", [
    "status",
    "target",
    "q",
  ]),
  d("/sessions/:sessionId", "/sessions", "Session", "Session", "sessions", "inspect-session", [
    "view",
  ]),
  d("/recordings/:recordingId", "/tests", "Recording", "Recording", "tests", "continue-recording", [
    "view",
    "screen",
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
  d("/review", "/runs", "Review", "Run", "runs", "review-run", ["app", "view", "item", "filter"]),
  d("/runs", "/tests", "Runs", "Run", "runs", "review-run", ["status", "app", "view", "q"]),
  d("/runs/:runId", "/runs", "Run", "Run", "runs", "inspect-run", [
    "returnTo",
    "plan",
    "planApp",
    "app",
    "view",
    "step",
    "at",
    "attempt",
    "screen",
    "replayJob",
    "reportView",
    "capture",
  ]),
  d("/batches/:batchId", "/runs", "Batch", "Report", "runs", "review-batch", [
    "status",
    "view",
    "returnTo",
  ]),
  d("/devices", "/tests", "Devices", "Device", "devices", "connect-device", [
    "status",
    "type",
    "view",
    "returnTo",
    "q",
  ]),
  d("/devices/:deviceId", "/devices", "Device", "Device", "devices", "inspect-device", ["view"]),
  ...(["general", "evidence", "integrations", "appearance", "advanced", "about"] as const).map(
    (name) =>
      d(
        `/settings/${name}` as RoutePattern,
        "/tests",
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
  suiteId?: string;
  profileId?: string;
  recordingId?: string;
  sessionId?: string;
  runId?: string;
  batchId?: string;
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
  versions: () => "/versions",
  accounts: () => "/accounts",
  appMap: (appId: string) => build("/apps/:appId/map", { appId }),
  test: (testId: string) => build("/tests/:testId", { testId }),
  testEdit: (testId: string) => build("/tests/:testId/edit", { testId }),
  suite: (appId: string, suiteId: string) =>
    build("/apps/:appId/suites/:suiteId", { appId, suiteId }),
  environments: () => "/environments",
  environment: (profileId: string) => build("/environments/:profileId", { profileId }),
  sessions: () => "/sessions",
  session: (sessionId: string) => build("/sessions/:sessionId", { sessionId }),
  recording: (recordingId: string) => build("/recordings/:recordingId", { recordingId }),
  recordingReview: (recordingId: string) =>
    build("/recordings/:recordingId/review", { recordingId }),
  run: (runId: string) => build("/runs/:runId", { runId }),
  batch: (batchId: string) => build("/batches/:batchId", { batchId }),
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
