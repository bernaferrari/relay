/** @jsxImportSource react */
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@relay/ui-react/components/dropdown-menu";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useRouter, useRouteContext } from "@tanstack/react-router";
import { Map, ChevronDown } from "lucide-react";
import { SidebarMenuButton } from "@relay/ui-react/components/sidebar";
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

  function switchApp(appId?: string) {
    router.history.push(
      appContextDestination({ pathname: location.pathname, search: location.search, appId }),
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="relay-app-switcher flex min-h-14 w-full items-center gap-3 rounded-lg border border-border/60 bg-sidebar-accent/40 px-3 py-2.5 text-left text-foreground transition-colors hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-ring motion-reduce:transition-none"
          aria-label={`App: ${contextName}`}
        >
          <span className="relay-app-switcher-copy flex min-w-0 flex-1 flex-col gap-1">
            <span className="relay-app-switcher-label text-xs font-normal leading-4 text-muted-foreground">
              Workspace
            </span>
            <span className="relay-app-switcher-name truncate text-sm font-medium leading-5">
              {contextName}
            </span>
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </DropdownMenuTrigger>

        <DropdownMenuContent
          sideOffset={8}
          align="start"
          className="w-80 max-w-[calc(100vw-2rem)] max-h-[min(28rem,70vh)] p-1.5"
        >
          <DropdownMenuGroup>
            <DropdownMenuLabel className="px-3 py-2 text-xs font-medium text-muted-foreground">
              Workspace
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={
                scope.kind === "all" || scope.kind === "workspace" ? "__all" : (selectedAppId ?? "")
              }
              onValueChange={(value) => switchApp(value === "__all" ? undefined : value)}
            >
              <DropdownMenuRadioItem value="__all" className="min-h-14 py-2.5 pl-3 pr-8">
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="text-sm font-medium">All apps</span>
                  <span className="text-xs text-muted-foreground">Tests and runs across apps</span>
                </span>
              </DropdownMenuRadioItem>
              {apps.data?.map((app) => (
                <DropdownMenuRadioItem
                  key={app.id}
                  value={app.id}
                  className="min-h-12 py-3 pl-3 pr-8"
                >
                  <span className="whitespace-normal text-sm leading-5">{app.name}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
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
      <nav aria-label="App navigation" className="pt-1.5">
        {selectedAppId ? (
          <SidebarMenuButton
            render={<Link to="/apps/$appId/map" params={{ appId: selectedAppId }} />}
            isActive={/^\/apps\/[^/]+\/map/.test(location.pathname)}
            aria-current={/^\/apps\/[^/]+\/map/.test(location.pathname) ? "page" : undefined}
            className="min-h-9 gap-2.5 px-[11px] text-[13px] font-medium"
          >
            <Map className="size-[17px] text-muted-foreground" aria-hidden="true" />
            App map
          </SidebarMenuButton>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <SidebarMenuButton className="min-h-9 gap-2.5 px-[11px] text-[13px] font-medium" />
              }
              aria-label="App map"
            >
              <Map className="size-[17px] text-muted-foreground" aria-hidden="true" />
              <span className="flex-1 text-left">App map</span>
              <ChevronDown className="size-3 text-muted-foreground" aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              sideOffset={8}
              className="w-80 max-w-[calc(100vw-2rem)] max-h-[min(28rem,70vh)] p-1.5"
            >
              <DropdownMenuGroup>
                <DropdownMenuLabel className="px-3 py-2 text-xs font-medium text-muted-foreground">
                  Choose an app to map
                </DropdownMenuLabel>
                {apps.data?.map((app) => (
                  <MapPickerItem
                    key={app.id}
                    app={app}
                    onSelect={() => router.history.push(`/apps/${encodeURIComponent(app.id)}/map`)}
                  />
                ))}
                {apps.isPending ? (
                  <DropdownMenuItem disabled>Loading apps…</DropdownMenuItem>
                ) : null}
                {apps.isError ? (
                  <DropdownMenuItem onClick={() => void apps.refetch()}>
                    Couldn’t load apps · Retry
                  </DropdownMenuItem>
                ) : null}
                {apps.isSuccess && !apps.data.length ? (
                  <DropdownMenuItem onClick={() => router.history.push("/apps")}>
                    Add an app
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </nav>
    </>
  );
}

function MapPickerItem({
  app,
  onSelect,
}: {
  app: { id: string; name: string };
  onSelect: () => void;
}) {
  const { mapService } = useRouteContext({ from: "__root__" });
  const map = useQuery({
    queryKey: ["map", app.id],
    queryFn: () => mapService.get(app.id),
    staleTime: 30_000,
    retry: false,
  });
  const count = map.data?.screens.length;
  return (
    <DropdownMenuItem
      onClick={onSelect}
      className="min-h-16 flex-col items-start justify-center gap-1 rounded-md px-3 py-2.5"
    >
      <span className="w-full whitespace-normal text-sm font-medium leading-5">{app.name}</span>
      <span className="text-xs leading-4 text-muted-foreground tabular-nums">
        {count !== undefined
          ? `${count} ${count === 1 ? "screen" : "screens"}`
          : map.isError
            ? "Screen count unavailable"
            : "Loading screens…"}
      </span>
    </DropdownMenuItem>
  );
}
