/** @jsxImportSource react */
import { Menu } from "@relay/ui-react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate, useRouteContext } from "@tanstack/react-router";
import { recordingQueryKeys } from "../data/recording-queries";

export function AppSwitcher() {
  const navigate = useNavigate();
  const location = useLocation();
  const { productService } = useRouteContext({ from: "__root__" });
  const canListApps = typeof productService.listApps === "function";
  const apps = useQuery({
    queryKey: recordingQueryKeys.apps,
    queryFn: () => productService.listApps(),
    enabled: canListApps,
    staleTime: 30_000,
  });
  const appRouteId = /^\/apps\/([^/]+)/u.exec(location.pathname)?.[1];
  const selectedApp = apps.data?.find((app) => app.id === appRouteId);
  const contextName = selectedApp?.name ?? "All apps";
  const avatar = selectedApp?.name.trim().slice(0, 1).toLocaleUpperCase() ?? "R";

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
              <Menu.Item className="relay-menu-item" onClick={() => void navigate({ to: "/apps" })}>
                <span>All apps</span>
                {!selectedApp ? <span aria-hidden="true">✓</span> : null}
              </Menu.Item>
              {apps.data?.map((app) => (
                <Menu.Item
                  className="relay-menu-item"
                  key={app.id}
                  onClick={() => void navigate({ to: "/apps/$appId", params: { appId: app.id } })}
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
            </Menu.Group>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
