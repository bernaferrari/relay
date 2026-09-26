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
          className="flex min-h-11 w-full items-center gap-2.5 rounded-lg border border-border bg-card px-2 py-1.5 text-left text-foreground shadow-xs transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring motion-reduce:transition-none"
          aria-label={`App: ${contextName}`}
        >
          <span
            aria-hidden="true"
            className="flex size-7 shrink-0 items-center justify-center rounded-md bg-brand-soft text-xs font-semibold text-brand"
          >
            {contextName.trim().charAt(0).toUpperCase() || "A"}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-xs leading-4 text-muted-foreground">App</span>
            <span className="truncate text-sm font-medium leading-5">{contextName}</span>
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
              Choose an app
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
                className="flex min-h-11 items-center px-2.5 text-xs text-muted-foreground"
                disabled
              >
                Apps are temporarily unavailable
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator className="my-2 ml-1.5 mr-1.5 mt-2 h-px bg-border" />
            <DropdownMenuItem
              className="focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 flex justify-between gap-4"
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
            className="min-h-9 gap-2.5 px-2.5 text-sm font-medium"
          >
            <Map className="size-4 text-muted-foreground" aria-hidden="true" />
            App map
          </SidebarMenuButton>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<SidebarMenuButton className="min-h-9 gap-2.5 px-2.5 text-sm font-medium" />}
              aria-label="App map"
            >
              <Map className="size-4 text-muted-foreground" aria-hidden="true" />
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
  return (
    <DropdownMenuItem onClick={onSelect} className="min-h-10 rounded-md px-3 py-2">
      <span className="w-full whitespace-normal text-sm font-medium leading-5">{app.name}</span>
    </DropdownMenuItem>
  );
}
