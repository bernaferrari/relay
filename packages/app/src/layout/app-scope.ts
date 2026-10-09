import { routeContractForPath } from "../router/route-contract";

export type AppScopeTest = { id: string; appMapId: string };
export type AppScopeRun = { id: string; appMapId?: string; batchId?: string };
export type AppScopeChange = { id: string; appIds?: readonly string[] };
export type AppScopeRecording = { id: string; appMapId?: string };
export type AppScopeSession = { id: string; appMapId?: string };
export type AppScopeBatch = { id: string; appMapId?: string };

export type AppScope =
  | { kind: "all" }
  | { kind: "single"; appId: string }
  | { kind: "multiple"; appIds: readonly string[] }
  | { kind: "workspace" }
  | { kind: "loading" }
  | { kind: "unavailable" };

export function appScopeForLocation(input: {
  pathname: string;
  search: Readonly<Record<string, unknown>>;
  tests?: readonly AppScopeTest[];
  runs?: readonly AppScopeRun[];
  changes?: readonly AppScopeChange[];
  recordings?: readonly AppScopeRecording[];
  sessions?: readonly AppScopeSession[];
  batches?: readonly AppScopeBatch[];
}): string | undefined {
  const scope = appScopeDetailsForLocation(input);
  return scope.kind === "single" ? scope.appId : undefined;
}

export function appScopeDisplayName(
  scope: AppScope,
  apps?: readonly { id: string; name: string }[],
  appsReady = apps !== undefined,
): string {
  if (scope.kind === "single") {
    if (!appsReady) return "Loading app";
    return apps?.find((app) => app.id === scope.appId)?.name ?? "App not found";
  }
  if (scope.kind === "multiple") return "Multiple apps";
  if (scope.kind === "workspace") return "All apps";
  if (scope.kind === "loading") return "Loading app";
  // The page's app couldn't be resolved; don't alarm people with "Unknown".
  if (scope.kind === "unavailable") return "All apps";
  return "All apps";
}

/** Resolve App ownership from the resource first and collection filters second.
 * A stale `?app=` value must never relabel a Test, Run, Recording, Change, or Session. */
export function appScopeDetailsForLocation(input: {
  pathname: string;
  search: Readonly<Record<string, unknown>>;
  tests?: readonly AppScopeTest[];
  runs?: readonly AppScopeRun[];
  changes?: readonly AppScopeChange[];
  recordings?: readonly AppScopeRecording[];
  sessions?: readonly AppScopeSession[];
  batches?: readonly AppScopeBatch[];
}): AppScope {
  const route = routeContractForPath(input.pathname);
  const routeApp = /^\/apps\/([^/]+)/u.exec(input.pathname)?.[1];
  if (routeApp) {
    const appId = decode(routeApp);
    return appId ? { kind: "single", appId } : { kind: "unavailable" };
  }

  // `/tests/new` is a creation route, not a test detail route. Resolve its
  // optional app selector from the query string instead of treating `new` as
  // an entity id and accidentally falling back to all apps.
  if (routeContractForPath(input.pathname)?.id === "/tests/new") {
    return fromSearchApp(input.search);
  }

  const testId = /^\/tests\/([^/]+)/u.exec(input.pathname)?.[1];
  if (testId) {
    return owned(
      input.tests,
      (test) => test.id === decode(testId),
      (test) => test.appMapId,
    );
  }

  const runId = /^\/runs\/([^/]+)(?:\/walkthrough)?$/u.exec(input.pathname)?.[1];
  if (runId) {
    return owned(
      input.runs,
      (run) => run.id === decode(runId),
      (run) => run.appMapId,
    );
  }

  const batchId = /^\/batches\/([^/]+)$/u.exec(input.pathname)?.[1];
  if (batchId) {
    const ownedBatch = input.batches?.find((batch) => batch.id === decode(batchId));
    if (ownedBatch?.appMapId) return { kind: "single", appId: ownedBatch.appMapId };
    if (input.runs === undefined) {
      return input.batches === undefined ? { kind: "loading" } : { kind: "unavailable" };
    }
    const appIds = uniqueAppIds(
      input.runs.filter((run) => run.batchId === decode(batchId)).map((run) => run.appMapId),
    );
    if (appIds.length) return fromAppIds(appIds);
    return input.batches === undefined ? { kind: "loading" } : { kind: "unavailable" };
  }

  const changeId = /^\/changes\/([^/]+)$/u.exec(input.pathname)?.[1];
  if (changeId) {
    if (input.changes === undefined) return { kind: "loading" };
    const change = input.changes.find((item) => item.id === decode(changeId));
    if (!change) return { kind: "unavailable" };
    return fromAppIds(uniqueAppIds(change.appIds));
  }

  const recordingId = /^\/recordings\/([^/]+)(?:\/review)?$/u.exec(input.pathname)?.[1];
  if (recordingId) {
    return owned(
      input.recordings,
      (recording) => recording.id === decode(recordingId),
      (recording) => recording.appMapId,
    );
  }

  const sessionId = /^\/sessions\/([^/]+)$/u.exec(input.pathname)?.[1];
  if (sessionId) {
    return owned(
      input.sessions,
      (session) => session.id === decode(sessionId),
      (session) => session.appMapId,
    );
  }

  if (isWorkspaceRoute(input.pathname)) return { kind: "workspace" };
  return route?.allowedSearchKeys.includes("app")
    ? fromSearchApp(input.search)
    : { kind: "workspace" };
}

function fromSearchApp(search: Readonly<Record<string, unknown>>): AppScope {
  return typeof search.app === "string" && search.app.trim()
    ? { kind: "single", appId: search.app.trim() }
    : { kind: "all" };
}

function owned<T>(
  items: readonly T[] | undefined,
  match: (item: T) => boolean,
  appId: (item: T) => string | undefined,
): AppScope {
  if (items === undefined) return { kind: "loading" };
  const item = items.find(match);
  if (!item) return { kind: "unavailable" };
  const id = appId(item)?.trim();
  return id ? { kind: "single", appId: id } : { kind: "unavailable" };
}

function uniqueAppIds(appIds: readonly (string | undefined)[] | undefined): readonly string[] {
  return [...new Set(appIds?.filter((appId): appId is string => Boolean(appId?.trim())) ?? [])];
}

function fromAppIds(appIds: readonly string[]): AppScope {
  if (appIds.length === 0) return { kind: "unavailable" };
  if (appIds.length === 1) return { kind: "single", appId: appIds[0]! };
  return { kind: "multiple", appIds };
}

function isWorkspaceRoute(pathname: string): boolean {
  return (
    pathname === "/devices" ||
    pathname.startsWith("/devices/") ||
    pathname === "/accounts" ||
    pathname === "/versions" ||
    pathname === "/environments" ||
    pathname.startsWith("/environments/") ||
    pathname === "/sessions" ||
    pathname === "/debug" ||
    pathname.startsWith("/settings/")
  );
}

export function appContextDestination(input: {
  pathname: string;
  search: Readonly<Record<string, unknown>>;
  appId?: string;
}): string {
  const appId = input.appId?.trim();
  if (/^\/apps\/[^/]+\/versions$/u.test(input.pathname)) return "/versions";
  if (/^\/apps\/[^/]+\/accounts$/u.test(input.pathname)) return "/accounts";
  if (input.pathname === "/versions" || input.pathname === "/accounts") return input.pathname;
  const appRoute = /^\/apps\/[^/]+(\/map)?$/u.exec(input.pathname);
  if (appRoute) return appId ? `/apps/${encodeURIComponent(appId)}${appRoute[1] ?? ""}` : "/apps";

  if (isScopeAwareRoute(input.pathname)) {
    return withSearch(input.pathname, { ...input.search, app: appId || undefined });
  }

  const collection = collectionForDetail(input.pathname);
  if (collection) return withSearch(collection, { app: appId || undefined });
  return appId ? `/apps/${encodeURIComponent(appId)}` : "/apps";
}

function isScopeAwareRoute(pathname: string): boolean {
  return (
    pathname === "/home" ||
    pathname === "/tests" ||
    pathname === "/tests/new" ||
    pathname === "/suites" ||
    pathname === "/runs" ||
    pathname === "/changes"
  );
}

function collectionForDetail(pathname: string): "/tests" | "/runs" | "/changes" | undefined {
  if (/^\/(?:tests|recordings)\//u.test(pathname)) return "/tests";
  if (/^\/(?:runs|batches)\//u.test(pathname)) return "/runs";
  if (pathname.startsWith("/changes/")) return "/changes";
  return undefined;
}

function withSearch(pathname: string, search: Readonly<Record<string, unknown>>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (typeof value === "string" && value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function decode(value: string): string | undefined {
  return safeDecodeURIComponent(value);
}

/** Decode a route segment without allowing malformed user-controlled URLs to throw. */
export function safeDecodeURIComponent(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}
