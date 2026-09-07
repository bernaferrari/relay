/** @jsxImportSource react */
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@relay/ui-react/components/dropdown-menu";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useRouter, useRouteContext } from "@tanstack/react-router";
import { runQueryKeys } from "../data/run-queries";
import { catalogQueryKeys } from "../data/catalog-queries";
import { recordingQueryKeys } from "../data/recording-queries";
import {
  appContextDestination,
  appScopeDetailsForLocation,
  appScopeDisplayName,
  safeDecodeURIComponent,
} from "./app-scope";

export function AppSwitcher() {
  const router = useRouter();
  const location = useLocation();
  const { productService, catalogService, changeService, sessionService, runService } =
    useRouteContext({
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
      : undefined);
  const contextName =
    selectedApp?.name ?? appScopeDisplayName(scope, apps.data, apps.isSuccess || apps.isError);
  const avatar =
    scope.kind === "multiple"
      ? String(scope.appIds.length)
      : scope.kind === "single"
        ? (selectedApp?.name.trim().slice(0, 1).toLocaleUpperCase() ?? "A")
        : scope.kind === "all"
          ? "A"
          : "R";

  function switchApp(appId?: string) {
    router.history.push(
      appContextDestination({ pathname: location.pathname, search: location.search, appId }),
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="relay-app-switcher focus-visible:outline-2 focus-visible:outline-[var(--relay-focus-ring)] focus-visible:outline-offset-2 grid min-h-[50px] w-full grid-cols-[30px_minmax(0,1fr)_18px] items-center gap-[9px] rounded-[var(--radius-lg)] border border-[var(--border-weak-base)] bg-[var(--surface-raised-strong)] px-[9px] py-1.5 text-left text-[var(--text-strong)] shadow-[0_1px_2px_color-mix(in_srgb,black_4%,transparent)]"
        aria-label={`App: ${contextName}`}
      >
        <span
          className="relay-app-avatar grid h-[30px] w-[30px] place-items-center rounded-[var(--radius-lg)] bg-[var(--button-primary-base)] text-xs font-semibold text-[var(--button-primary-foreground)]"
          aria-hidden="true"
        >
          {avatar}
        </span>
        <span className="relay-app-switcher-copy flex min-w-0 flex-col">
          <span className="relay-app-switcher-label text-[10px] font-semibold uppercase leading-[1.2] tracking-[0.06em] text-[var(--text-weaker)]">
            App
          </span>
          <span className="relay-app-switcher-name overflow-hidden text-xs leading-[1.35] text-ellipsis whitespace-nowrap">
            {contextName}
          </span>
        </span>
        <span
          className="relay-app-switcher-chevron text-center text-[13px] text-[var(--text-weak)]"
          aria-hidden="true"
        >
          ⌄
        </span>
      </DropdownMenuTrigger>

      <DropdownMenuContent sideOffset={6} align="start">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="relay-menu-label block px-2.5 pb-1.5 pt-[7px] text-[10px] font-semibold uppercase leading-[1.2] tracking-[0.06em] text-[var(--text-weaker)]">
            Apps
          </DropdownMenuLabel>
          <DropdownMenuItem
            className="relay-menu-item focus-visible:outline-2 focus-visible:outline-[var(--relay-focus-ring)] focus-visible:outline-offset-2 flex justify-between gap-4"
            onClick={() => switchApp()}
          >
            <span>All apps</span>
            {scope.kind === "all" ? <span aria-hidden="true">✓</span> : null}
          </DropdownMenuItem>
          {apps.data?.map((app) => (
            <DropdownMenuItem
              key={app.id}
              className="relay-menu-item focus-visible:outline-2 focus-visible:outline-[var(--relay-focus-ring)] focus-visible:outline-offset-2 flex justify-between gap-4"
              onClick={() => switchApp(app.id)}
            >
              <span>{app.name}</span>
              {selectedApp?.id === app.id ? <span aria-hidden="true">✓</span> : null}
            </DropdownMenuItem>
          ))}
          {apps.isError ? (
            <DropdownMenuItem
              className="relay-menu-note flex min-h-11 items-center px-2.5 text-xs text-[var(--text-weaker)]"
              disabled
            >
              Apps are temporarily unavailable
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator className="relay-menu-separator my-2 ml-1.5 mr-1.5 mt-2 h-px bg-[var(--border-weak-base)]" />
          <DropdownMenuItem
            className="relay-menu-item focus-visible:outline-2 focus-visible:outline-[var(--relay-focus-ring)] focus-visible:outline-offset-2 flex justify-between gap-4"
            onClick={() => router.history.push("/apps")}
          >
            Manage apps
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
