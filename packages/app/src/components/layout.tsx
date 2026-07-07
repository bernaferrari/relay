import { type JSX, onMount, onCleanup, createEffect } from "solid-js";
import { useServer } from "../context/server";
import { useCommand, CommandPalette } from "../context/command";
import { Toaster } from "../context/toast";
import { useTheme } from "@grok-device/ui/theme/context";
import { usePlatform } from "../context/platform";
import { Topbar } from "./topbar";
import { ErrorBanner } from "./error-banner";

export type AppView = "workspace" | "settings";

export function Layout(props: { children: JSX.Element; onOpenSettings: () => void }) {
  const server = useServer();
  const cmd = useCommand();
  const theme = useTheme();
  const platform = usePlatform();

  onMount(() => {
    const unsub = cmd.register([
      {
        id: "nav.settings",
        title: "Open settings",
        group: "Navigation",
        keybind: "mod+,",
        run: () => props.onOpenSettings(),
      },
      {
        id: "appearance.scheme.light",
        title: "Color scheme: Light",
        group: "Appearance",
        run: () => theme.setColorScheme("light"),
      },
      {
        id: "appearance.scheme.dark",
        title: "Color scheme: Dark",
        group: "Appearance",
        run: () => theme.setColorScheme("dark"),
      },
      {
        id: "appearance.scheme.system",
        title: "Color scheme: System",
        group: "Appearance",
        run: () => theme.setColorScheme("system"),
      },
      {
        id: "device.refresh",
        title: "Refresh devices",
        group: "Device",
        keybind: "mod+r",
        run: () => void server.refreshDevices(),
      },
      {
        id: "device.snapshot",
        title: "Refresh UI snapshot",
        group: "Device",
        keybind: "mod+shift+i",
        run: () => void server.captureUiSnapshot(),
      },
      {
        id: "device.screenshot",
        title: "Capture screenshot",
        group: "Device",
        keybind: "mod+shift+s",
        run: () => void server.captureUiScreenshot(),
      },
      {
        id: "job.run",
        title: "Run / queue selected recipe",
        group: "Jobs",
        keybind: "mod+enter",
        disabled: () => !server.selectedRecipe() || server.health() !== "online",
        run: () => {
          const r = server.selectedRecipe();
          if (r) void server.runRecipeRemote(r.id);
        },
      },
      {
        id: "queue.clear",
        title: "Cancel all queued jobs",
        group: "Jobs",
        disabled: () => server.queuedJobs().length === 0,
        run: () => {
          for (const q of server.queuedJobs()) void server.cancelJob(q.id);
        },
      },
      {
        id: "job.retry",
        title: "Retry / heal selected job",
        group: "Jobs",
        keybind: "mod+shift+r",
        run: () => void server.retrySelectedJob(),
      },
      {
        id: "job.cancel",
        title: "Cancel running job",
        group: "Jobs",
        keybind: "escape",
        disabled: () => {
          const a = server.activeJob?.();
          return !a || (a.status !== "running" && a.status !== "paused");
        },
        run: () => {
          const a = server.activeJob?.();
          if (a) void server.cancelJob(a.id);
          else void server.cancelJob();
        },
      },
      {
        id: "job.pause",
        title: "Pause running job",
        group: "Jobs",
        keybind: "space",
        disabled: () => server.activeJob?.()?.status !== "running",
        run: () => {
          const a = server.activeJob?.();
          if (a?.status === "running") void server.pauseJob(a.id);
        },
      },
      {
        id: "job.resume",
        title: "Resume paused job",
        group: "Jobs",
        keybind: "space",
        disabled: () => server.activeJob?.()?.status !== "paused",
        run: () => {
          const a = server.activeJob?.();
          if (a?.status === "paused") void server.resumeJob(a.id);
        },
      },
      {
        id: "device.overlays",
        title: "Toggle hover-inspect on stage",
        group: "Device",
        keybind: "mod+o",
        run: () => server.setShowOverlays(!server.showOverlays()),
      },
      {
        id: "runs.refresh",
        title: "Refresh disk runs",
        group: "Artifacts",
        run: () => void server.refreshRuns(),
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
        keybind: "mod+1",
        run: () => server.setPanelTab("steps"),
      },
      {
        id: "tab.summary",
        title: "Panel: Summary",
        group: "Workspace",
        keybind: "mod+2",
        run: () => server.setPanelTab("summary"),
      },
      {
        id: "tab.inspector",
        title: "Panel: Inspector",
        group: "Workspace",
        keybind: "mod+3",
        run: () => server.setPanelTab("inspector"),
      },
      {
        id: "tab.artifacts",
        title: "Panel: Artifacts",
        group: "Workspace",
        keybind: "mod+4",
        run: () => server.setPanelTab("artifacts"),
      },
      {
        id: "server.retry",
        title: "Retry server connection",
        group: "Server",
        run: () => void server.retryConnection(),
      },
      {
        id: "command.palette",
        title: "Command palette",
        group: "Navigation",
        keybind: "mod+k",
        run: () => cmd.setOpen(true),
      },
      {
        id: "layout.toggle",
        title: "Layout: switch deck ⇄ classic",
        group: "Workspace",
        run: () => void server.setLayout(server.layout() === "deck" ? "classic" : "deck"),
      },
      {
        id: "drawer.toggle",
        title: "Toggle sidebar / drawer (⌘B)",
        group: "Workspace",
        keybind: "mod+b",
        run: () => server.setDrawerOpen(!server.drawerOpen()),
      },
    ]);
    onCleanup(unsub);
  });

  // Register recipe commands whenever the catalog changes (searchable in palette)
  createEffect(() => {
    const recipes = server.recipes();
    const unsub = cmd.register(
      recipes.map((r) => ({
        id: `recipe.${r.id}`,
        title: r.title,
        subtitle: r.id,
        group:
          r.source === "custom"
            ? "Recipes"
            : r.id.startsWith("login-") || r.id === "logout" || r.id.startsWith("grok")
              ? "Grok"
              : "Play Store",
        run: () => {
          server.setSelectedRecipeId(r.id);
          server.setPanelTab("steps");
        },
      })),
    );
    onCleanup(unsub);
  });

  return (
    <div class="qa" classList={{ "qa--desktop": platform.platform === "desktop" }}>
      <Topbar onSettings={() => props.onOpenSettings()} />
      <ErrorBanner />
      <div class="qa__body">{props.children}</div>
      <CommandPalette />
      <Toaster />
    </div>
  );
}
