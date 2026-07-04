import { type JSX, Show, onMount, onCleanup } from "solid-js";
import { Badge } from "@grok-device/ui/badge";
import { Button } from "@grok-device/ui/button";
import { Logo } from "@grok-device/ui/logo";
import { useServer } from "../context/server";
import { useCommand, CommandPalette } from "../context/command";

export type AppView = "workspace" | "settings";

export function Layout(props: {
  view: AppView;
  onNavigate: (view: AppView) => void;
  children: JSX.Element;
}) {
  const server = useServer();
  const cmd = useCommand();

  onMount(() => {
    const unsub = cmd.register([
      {
        id: "nav.workspace",
        title: "Go to workspace",
        group: "Navigation",
        run: () => props.onNavigate("workspace"),
      },
      {
        id: "nav.settings",
        title: "Open settings",
        group: "Navigation",
        keybind: "⌘,",
        run: () => props.onNavigate("settings"),
      },
      {
        id: "device.refresh",
        title: "Refresh devices",
        group: "Device",
        run: () => void server.refreshDevices(),
      },
      {
        id: "device.snapshot",
        title: "Capture UI snapshot",
        group: "Device",
        keybind: "⌘S",
        run: () => void server.captureUiSnapshot(),
      },
      {
        id: "device.screenshot",
        title: "Capture screenshot",
        group: "Device",
        keybind: "⌘⇧S",
        run: () => void server.captureUiScreenshot(),
      },
      {
        id: "job.run",
        title: "Run selected action",
        group: "Jobs",
        keybind: "⌘↵",
        run: () => void server.runSelected(),
      },
      {
        id: "log.clear",
        title: "Clear activity log",
        group: "Jobs",
        run: () => server.clearLogs(),
      },
      {
        id: "tab.actions",
        title: "Tab: Actions",
        group: "Workspace",
        run: () => server.setTab("actions"),
      },
      {
        id: "tab.inspector",
        title: "Tab: Inspector",
        group: "Workspace",
        run: () => server.setTab("inspector"),
      },
      {
        id: "tab.screen",
        title: "Tab: Screen",
        group: "Workspace",
        run: () => server.setTab("screen"),
      },
    ]);
    onCleanup(unsub);
  });

  const healthVariant = () => {
    const h = server.health();
    if (h === "online") return "success" as const;
    if (h === "offline") return "error" as const;
    return "default" as const;
  };

  return (
    <div class="app-shell">
      <header class="app-header">
        <div class="app-header__left">
          <button
            type="button"
            class="logo-btn"
            onClick={() => props.onNavigate("workspace")}
            aria-label="Workspace"
          >
            <Logo />
          </button>
          <Badge variant={healthVariant()}>
            <span class="pill-dot" data-on={server.health() === "online" ? "1" : "0"} />
            {server.health() === "online"
              ? "Server"
              : server.health() === "offline"
                ? "Offline"
                : "…"}
          </Badge>
          <Badge variant={server.sseConnected() ? "success" : "default"}>
            {server.sseConnected() ? "live" : "no-sse"}
          </Badge>
          <Show when={server.selectedDevice()}>
            <span class="header-chip" title="Selected device">
              {server.selectedDevice()}
            </span>
          </Show>
          <Show when={server.running()}>
            <Badge variant="warning">running</Badge>
          </Show>
        </div>
        <div class="app-header__right">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => cmd.setOpen(true)}
            title="Command palette"
          >
            ⌘K
          </Button>
          <Button
            variant="ghost"
            size="sm"
            selected={props.view === "settings"}
            onClick={() => props.onNavigate(props.view === "settings" ? "workspace" : "settings")}
          >
            Settings
          </Button>
        </div>
      </header>
      <div class="app-body">{props.children}</div>
      <CommandPalette />
    </div>
  );
}
