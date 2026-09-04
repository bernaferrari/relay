export type AppScopeTest = { id: string; appMapId: string };
export type AppScopeRun = { id: string; appMapId?: string; batchId?: string };
export type AppScopeChange = { id: string; appIds?: readonly string[] };
export type AppScopeRecording = { id: string; appMapId?: string };

export type AppScope =
  | { kind: "all" }
  | { kind: "single"; appId: string }
  | { kind: "multiple"; appIds: readonly string[] };

export function appScopeForLocation(input: {
  pathname: string;
  search: Readonly<Record<string, unknown>>;
  tests?: readonly AppScopeTest[];
  runs?: readonly AppScopeRun[];
  changes?: readonly AppScopeChange[];
  recordings?: readonly AppScopeRecording[];
}): string | undefined {
  const scope = appScopeDetailsForLocation(input);
  return scope.kind === "single" ? scope.appId : undefined;
}

/** Resolve App ownership from the resource first and collection filters second.
 * A stale `?app=` value must never relabel a Test, Run, Recording, or Change. */
export function appScopeDetailsForLocation(input: {
  pathname: string;
  search: Readonly<Record<string, unknown>>;
  tests?: readonly AppScopeTest[];
  runs?: readonly AppScopeRun[];
  changes?: readonly AppScopeChange[];
  recordings?: readonly AppScopeRecording[];
}): AppScope {
  const routeApp = /^\/apps\/([^/]+)/u.exec(input.pathname)?.[1];
  if (routeApp) return single(decode(routeApp));

  const testId = /^\/tests\/([^/]+)/u.exec(input.pathname)?.[1];
  if (testId) return single(input.tests?.find((test) => test.id === decode(testId))?.appMapId);

  const runId = /^\/runs\/([^/]+)$/u.exec(input.pathname)?.[1];
  if (runId) return single(input.runs?.find((run) => run.id === decode(runId))?.appMapId);

  const batchId = /^\/batches\/([^/]+)$/u.exec(input.pathname)?.[1];
  if (batchId) {
    const appIds = uniqueAppIds(
      input.runs?.filter((run) => run.batchId === decode(batchId)).map((run) => run.appMapId),
    );
    return fromAppIds(appIds);
  }

  const changeId = /^\/changes\/([^/]+)$/u.exec(input.pathname)?.[1];
  if (changeId) {
    const appIds = input.changes?.find((change) => change.id === decode(changeId))?.appIds;
    return fromAppIds(uniqueAppIds(appIds));
  }

  const recordingId = /^\/recordings\/([^/]+)(?:\/review)?$/u.exec(input.pathname)?.[1];
  if (recordingId) {
    return single(
      input.recordings?.find((recording) => recording.id === decode(recordingId))?.appMapId,
    );
  }

  if (typeof input.search.app === "string" && input.search.app.trim()) {
    return { kind: "single", appId: input.search.app };
  }
  return { kind: "all" };
}

function single(appId: string | undefined): AppScope {
  return appId ? { kind: "single", appId } : { kind: "all" };
}

function uniqueAppIds(appIds: readonly (string | undefined)[] | undefined): readonly string[] {
  return [...new Set(appIds?.filter((appId): appId is string => Boolean(appId?.trim())) ?? [])];
}

function fromAppIds(appIds: readonly string[]): AppScope {
  if (appIds.length === 0) return { kind: "all" };
  if (appIds.length === 1) return { kind: "single", appId: appIds[0]! };
  return { kind: "multiple", appIds };
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
