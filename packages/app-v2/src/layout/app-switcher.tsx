/** @jsxImportSource react */
import { Menu } from "@relay/ui-react";
import { useNavigate } from "@tanstack/react-router";

export function AppSwitcher() {
  const navigate = useNavigate();

  return (
    <Menu.Root>
      <Menu.Trigger className="relay-app-switcher" aria-label="Choose an app">
        <span className="relay-app-avatar" aria-hidden="true">
          R
        </span>
        <span className="relay-app-switcher-copy">
          <span className="relay-app-switcher-label">App</span>
          <span className="relay-app-switcher-name">No app selected</span>
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
                Manage apps
              </Menu.Item>
            </Menu.Group>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
