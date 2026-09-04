export type AppScopeTest = { id: string; appMapId: string };
export type AppScopeRun = { id: string; appMapId?: string; batchId?: string };

export function appScopeForLocation(input: {
  pathname: string;
  search: Readonly<Record<string, unknown>>;
  tests?: readonly AppScopeTest[];
  runs?: readonly AppScopeRun[];
}): string | undefined {
  const routeApp = /^\/apps\/([^/]+)/u.exec(input.pathname)?.[1];
  if (routeApp) return decode(routeApp);
  if (typeof input.search.app === "string" && input.search.app.trim()) return input.search.app;

  const testId = /^\/tests\/([^/]+)/u.exec(input.pathname)?.[1];
  if (testId) return input.tests?.find((test) => test.id === decode(testId))?.appMapId;

  const runId = /^\/runs\/([^/]+)$/u.exec(input.pathname)?.[1];
  if (runId) return input.runs?.find((run) => run.id === decode(runId))?.appMapId;

  const batchId = /^\/batches\/([^/]+)$/u.exec(input.pathname)?.[1];
  if (batchId)
    return input.runs?.find((run) => run.batchId === decode(batchId) && run.appMapId)?.appMapId;
  return undefined;
}

export function appContextDestination(input: {
  pathname: string;
  search: Readonly<Record<string, unknown>>;
  appId?: string;
}): string {
  const appId = input.appId?.trim();
  const appRoute = /^\/apps\/[^/]+(\/versions|\/accounts|\/map)?$/u.exec(input.pathname);
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
    pathname === "/runs" ||
    pathname === "/changes" ||
    /^\/tests\/[^/]+\/run-across$/u.test(pathname)
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
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}
