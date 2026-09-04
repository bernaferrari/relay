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
import { catalogQueryKeys } from "../data/catalog-queries";
import { recordingQueryKeys } from "../data/recording-queries";
import {
  appContextDestination,
  appScopeDetailsForLocation,
  safeDecodeURIComponent,
} from "./app-scope";

export function AppSwitcher() {
  const router = useRouter();
  const location = useLocation();
  const { productService, catalogService, changeService } = useRouteContext({ from: "__root__" });
  const canListApps = typeof productService.listApps === "function";
  const apps = useQuery({
    queryKey: recordingQueryKeys.apps,
    queryFn: () => productService.listApps(),
    enabled: canListApps,
    staleTime: 30_000,
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
  const scope = appScopeDetailsForLocation({
    pathname: location.pathname,
    search: location.search,
    tests: tests.data,
    runs: runs.data,
    changes: change.data?.state.change ? [change.data.state.change] : undefined,
    recordings: recording.data?.snapshot?.frozen
      ? [
          {
            id: recordingId!,
            appMapId: recording.data.snapshot.frozen.appMapId,
          },
        ]
      : undefined,
  });
  const selectedAppId = scope.kind === "single" ? scope.appId : undefined;
  const selectedApp = apps.data?.find((app) => app.id === selectedAppId);
  const contextName =
    scope.kind === "multiple" ? "Multiple apps" : (selectedApp?.name ?? "All apps");
  const avatar =
    scope.kind === "multiple"
      ? String(scope.appIds.length)
      : (selectedApp?.name.trim().slice(0, 1).toLocaleUpperCase() ?? "R");

  function switchApp(appId?: string) {
    router.history.push(
      appContextDestination({ pathname: location.pathname, search: location.search, appId }),
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="relay-app-switcher"
        aria-label={`App context: ${contextName}`}
      >
        <span className="relay-app-avatar" aria-hidden="true">
          {avatar}
        </span>
        <span className="relay-app-switcher-copy">
          <span className="relay-app-switcher-label">App context</span>
          <span className="relay-app-switcher-name">{contextName}</span>
        </span>
        <span className="relay-app-switcher-chevron" aria-hidden="true">
          ⌄
        </span>
      </DropdownMenuTrigger>

      <DropdownMenuContent sideOffset={6} align="start">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="relay-menu-label">Apps</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => switchApp()}>
            <span>All apps</span>
            {scope.kind === "all" ? <span aria-hidden="true">✓</span> : null}
          </DropdownMenuItem>
          {apps.data?.map((app) => (
            <DropdownMenuItem key={app.id} onClick={() => switchApp(app.id)}>
              <span>{app.name}</span>
              {selectedApp?.id === app.id ? <span aria-hidden="true">✓</span> : null}
            </DropdownMenuItem>
          ))}
          {apps.isError ? (
            <DropdownMenuItem className="relay-menu-note" disabled>
              Apps are temporarily unavailable
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator className="relay-menu-separator" />
          <DropdownMenuItem onClick={() => router.history.push("/apps")}>
            Manage apps
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
