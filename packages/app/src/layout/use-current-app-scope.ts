import { useQuery } from "@tanstack/react-query";
import { useLocation, useRouteContext } from "@tanstack/react-router";
import { runQueryKeys } from "../data/run-queries";
import { catalogQueryKeys } from "../data/catalog-queries";
import { recordingQueryKeys } from "../data/recording-queries";
import { appScopeDetailsForLocation, safeDecodeURIComponent } from "./app-scope";

/** One resource-owned App context for the selector and primary destinations. */
export function useCurrentAppScope() {
  const location = useLocation();
  const {
    productService,
    catalogService,
    changeService,
    sessionService,
    runService,
    runAcrossService,
  } = useRouteContext({
    from: "__root__",
  });
  const canListApps = typeof productService.listApps === "function";
  const apps = useQuery({
    queryKey: recordingQueryKeys.apps,
    queryFn: () => productService.listApps(),
    enabled: canListApps,
    staleTime: 30_000,
  });
  const routeTestId = safeDecodeURIComponent(
    /^\/tests\/([^/]+)/u.exec(location.pathname)?.[1] ?? "",
  );
  const testId = routeTestId && routeTestId !== "new" ? routeTestId : undefined;
  const test = useQuery({
    queryKey: runQueryKeys.test(testId ?? "unselected"),
    queryFn: () => runService.getTest(testId!),
    enabled: Boolean(testId),
  });
  const needsCatalogScope = /^\/(?:tests|runs|batches)\//u.test(location.pathname);
  const tests = useQuery({
    queryKey: catalogQueryKeys.tests,
    queryFn: () => catalogService.listTests(),
    enabled: needsCatalogScope,
    staleTime: 30_000,
  });
  const runs = useQuery({
    queryKey: catalogQueryKeys.runs,
    queryFn: () => catalogService.listRuns(),
    enabled: needsCatalogScope,
    staleTime: 15_000,
  });
  const batchId = safeDecodeURIComponent(
    /^\/batches\/([^/]+)$/u.exec(location.pathname)?.[1] ?? "",
  );
  const batch = useQuery({
    queryKey: ["run-across", "batch", batchId ?? "unselected"],
    queryFn: () => runAcrossService.getReport(batchId!),
    enabled: Boolean(batchId),
    staleTime: 30_000,
  });
  const changeId = safeDecodeURIComponent(
    /^\/changes\/([^/]+)$/u.exec(location.pathname)?.[1] ?? "",
  );
  const change = useQuery({
    queryKey: ["change", changeId ?? "unselected"],
    queryFn: () => changeService.open(changeId!),
    enabled: Boolean(changeId),
    staleTime: 15_000,
  });
  const recordingId = safeDecodeURIComponent(
    /^\/recordings\/([^/]+)(?:\/review)?$/u.exec(location.pathname)?.[1] ?? "",
  );
  const recording = useQuery({
    queryKey: recordingQueryKeys.workflow(recordingId ?? "unselected"),
    queryFn: () => productService.inspect(recordingId!),
    enabled: Boolean(recordingId),
    staleTime: 5_000,
  });
  const sessionId = safeDecodeURIComponent(
    /^\/sessions\/([^/]+)$/u.exec(location.pathname)?.[1] ?? "",
  );
  const session = useQuery({
    queryKey: ["app-scope", "session", sessionId ?? "unselected"],
    queryFn: async () => {
      try {
        return (await sessionService.get(sessionId!)) ?? null;
      } catch {
        return null;
      }
    },
    enabled: Boolean(sessionId),
    staleTime: 15_000,
    retry: false,
  });
  const scope = appScopeDetailsForLocation({
    pathname: location.pathname,
    search: location.search,
    tests: test.data ? [test.data] : tests.data,
    runs: runs.data,
    batches: batch.data
      ? [
          {
            id: batch.data.id,
            appMapId: batch.data.setup?.appMapId ?? batch.data.appMapId,
          },
        ]
      : batchId
        ? batch.isFetched
          ? []
          : undefined
        : undefined,
    changes: change.data?.state.change ? [change.data.state.change] : undefined,
    recordings: recording.data?.snapshot?.frozen
      ? [
          {
            id: recordingId!,
            appMapId: recording.data.snapshot.frozen.appMapId,
          },
        ]
      : recordingId
        ? recording.isFetched
          ? []
          : undefined
        : undefined,
    sessions: session.data
      ? [{ id: session.data.id, appMapId: session.data.appMapId }]
      : sessionId
        ? session.isFetched
          ? []
          : undefined
        : undefined,
  });
  const selectedAppId = scope.kind === "single" ? scope.appId : undefined;
  const selectedApp =
    apps.data?.find((app) => app.id === selectedAppId) ??
    (test.data && test.data.appMapId === selectedAppId
      ? { id: test.data.appMapId, name: test.data.appName }
      : undefined) ??
    (batch.data && (batch.data.setup?.appMapId ?? batch.data.appMapId) === selectedAppId
      ? {
          id: batch.data.setup?.appMapId ?? batch.data.appMapId ?? selectedAppId,
          name: batch.data.setup?.appName ?? batch.data.title,
        }
      : undefined);
  return { location, apps, scope, selectedAppId, selectedApp };
}
