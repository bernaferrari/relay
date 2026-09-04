/** @jsxImportSource react */
import { Menu } from "@relay/ui-react";
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
    <Menu.Root>
      <Menu.Trigger className="relay-app-switcher" aria-label={`App context: ${contextName}`}>
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
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className="relay-menu-positioner" sideOffset={6} align="start">
          <Menu.Popup className="relay-overlay-popup relay-menu-popup">
            <Menu.Group>
              <Menu.GroupLabel className="relay-menu-label">Apps</Menu.GroupLabel>
              <Menu.Item className="relay-menu-item" onClick={() => switchApp()}>
                <span>All apps</span>
                {scope.kind === "all" ? <span aria-hidden="true">✓</span> : null}
              </Menu.Item>
              {apps.data?.map((app) => (
                <Menu.Item
                  className="relay-menu-item"
                  key={app.id}
                  onClick={() => switchApp(app.id)}
                >
                  <span>{app.name}</span>
                  {selectedApp?.id === app.id ? <span aria-hidden="true">✓</span> : null}
                </Menu.Item>
              ))}
              {apps.isError ? (
                <Menu.Item className="relay-menu-note" disabled>
                  Apps are temporarily unavailable
                </Menu.Item>
              ) : null}
              <Menu.Separator className="relay-menu-separator" />
              <Menu.Item className="relay-menu-item" onClick={() => router.history.push("/apps")}>
                Manage apps
              </Menu.Item>
            </Menu.Group>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
