import { type JSX, onMount, onCleanup } from "solid-js";
import { useServer } from "../context/server";
import { useCommand, CommandPalette } from "../context/command";
import { Topbar } from "./topbar";

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
        run: () => void server.captureUiSnapshot(),
      },
      {
        id: "device.screenshot",
        title: "Capture screenshot",
        group: "Device",
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
        id: "frames.play",
        title: "Play / pause frame scrubber",
        group: "Stage",
        run: () => server.togglePlayback(),
      },
      {
        id: "frames.clear",
        title: "Clear captured frames",
        group: "Stage",
        run: () => server.clearFrames(),
      },
      {
        id: "log.clear",
        title: "Clear activity log",
        group: "Jobs",
        run: () => server.clearLogs(),
      },
      {
        id: "tab.steps",
        title: "Panel: Steps",
        group: "Workspace",
        run: () => server.setPanelTab("steps"),
      },
      {
        id: "tab.summary",
        title: "Panel: Summary",
        group: "Workspace",
        run: () => server.setPanelTab("summary"),
      },
      {
        id: "tab.inspector",
        title: "Panel: Inspector",
        group: "Workspace",
        run: () => server.setPanelTab("inspector"),
      },
      {
        id: "tab.artifacts",
        title: "Panel: Artifacts",
        group: "Workspace",
        run: () => server.setPanelTab("artifacts"),
      },
    ]);
    onCleanup(unsub);
  });

  return (
    <div class="qa">
      <Topbar
        onSettings={() => props.onNavigate(props.view === "settings" ? "workspace" : "settings")}
      />
      <div class="qa__body">{props.children}</div>
      <CommandPalette />
    </div>
  );
}
