import { type JSX, onMount, onCleanup, createEffect } from "solid-js";
import { useServer } from "../context/server";
import { useCommand, CommandPalette } from "../context/command";
import { Toaster } from "../context/toast";
import { useTheme } from "@relay/ui/theme/context";
import { usePlatform } from "../context/platform";
import { ErrorBanner } from "./error-banner";
import { cn } from "../lib/cn";
import type { SettingsSection } from "../pages/settings";
import { nextAccessibilityOverlayMode } from "../lib/accessibility-overlay-mode";

export type AppView = "workspace" | "settings";

export function Layout(props: {
  children: JSX.Element;
  onOpenSettings: (section?: SettingsSection) => void;
}) {
  const server = useServer();
  const cmd = useCommand();
  const theme = useTheme();
  const platform = usePlatform();

  onMount(() => {
    // Fixed tooltip layer — avoids overflow:auto clipping in step actions.
    // Emil: first tip delays; subsequent tips in a cluster are instant.
    const layer = document.createElement("div");
    layer.className = "tip-layer";
    layer.setAttribute("role", "tooltip");
    layer.hidden = true;
    document.body.appendChild(layer);

    let tipShowTimer: number | undefined;
    let tipLeaveTimer: number | undefined;
    let tipDelayTimer: number | undefined;
    let activeEl: Element | null = null;

    function hideTip() {
      window.clearTimeout(tipDelayTimer);
      layer.removeAttribute("data-show");
      layer.hidden = true;
      layer.textContent = "";
      activeEl = null;
    }

    function placeTip(el: Element) {
      const label = el.getAttribute("data-tip");
      if (!label) {
        hideTip();
        return;
      }
      const r = el.getBoundingClientRect();
      layer.textContent = label;
      layer.hidden = false;
      // Prefer above; flip below near the top of the viewport.
      const above = r.top >= 40;
      layer.style.left = `${r.left + r.width / 2}px`;
      layer.style.top = above ? `${r.top}px` : `${r.bottom}px`;
      layer.dataset.side = above ? "above" : "below";
      void layer.offsetWidth;
      layer.setAttribute("data-show", "1");
    }

    const onTipEnter = (e: Event) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      const el = t.closest("[data-tip]");
      if (!el) return;
      window.clearTimeout(tipLeaveTimer);
      activeEl = el;
      const instant = document.documentElement.hasAttribute("data-tip-instant");
      window.clearTimeout(tipDelayTimer);
      if (instant) {
        placeTip(el);
      } else {
        tipDelayTimer = window.setTimeout(() => {
          if (activeEl === el) placeTip(el);
          document.documentElement.setAttribute("data-tip-instant", "");
        }, 400);
      }
      if (!instant) {
        window.clearTimeout(tipShowTimer);
        tipShowTimer = window.setTimeout(() => {
          document.documentElement.setAttribute("data-tip-instant", "");
        }, 450);
      }
    };
    const onTipLeave = (e: Event) => {
      const t = e.target;
      if (!(t instanceof Element) || !t.closest("[data-tip]")) return;
      const next = "relatedTarget" in e ? (e as MouseEvent | FocusEvent).relatedTarget : null;
      if (next instanceof Element && next.closest("[data-tip]")) {
        const el = next.closest("[data-tip]");
        if (el) {
          activeEl = el;
          if (document.documentElement.hasAttribute("data-tip-instant")) placeTip(el);
        }
        return;
      }
      window.clearTimeout(tipShowTimer);
      window.clearTimeout(tipDelayTimer);
      hideTip();
      tipLeaveTimer = window.setTimeout(() => {
        document.documentElement.removeAttribute("data-tip-instant");
      }, 350);
    };
    const onScroll = () => {
      if (activeEl) placeTip(activeEl);
    };
    document.addEventListener("mouseover", onTipEnter, true);
    document.addEventListener("mouseout", onTipLeave, true);
    document.addEventListener("focusin", onTipEnter, true);
    document.addEventListener("focusout", onTipLeave, true);
    window.addEventListener("scroll", onScroll, true);
    onCleanup(() => {
      document.removeEventListener("mouseover", onTipEnter, true);
      document.removeEventListener("mouseout", onTipLeave, true);
      document.removeEventListener("focusin", onTipEnter, true);
      document.removeEventListener("focusout", onTipLeave, true);
      window.removeEventListener("scroll", onScroll, true);
      window.clearTimeout(tipShowTimer);
      window.clearTimeout(tipDelayTimer);
      hideTip();
      layer.remove();
      window.clearTimeout(tipLeaveTimer);
    });

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
        title: "Save this screen to the map",
        group: "Device",
        keybind: "mod+shift+s",
        run: () => void server.captureUiScreenshot(),
      },
      {
        id: "job.run",
        title: "Run selected path",
        group: "Jobs",
        keybind: "mod+enter",
        disabled: () => !server.selectedAppMapId() || server.health() !== "online",
        run: () => {
          window.dispatchEvent(new CustomEvent("relay:run-app-map"));
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
        title: "Cycle accessibility overlay mode",
        group: "Device",
        keybind: "mod+o",
        run: () =>
          server.setAccessibilityMode(nextAccessibilityOverlayMode(server.accessibilityMode())),
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
        group: "Device",
        run: () => server.togglePlayback(),
      },
      {
        id: "frames.clear",
        title: "Clear captured frames",
        group: "Device",
        run: () => server.clearFrames(),
      },
      {
        id: "log.clear",
        title: "Clear activity log",
        group: "Jobs",
        run: () => server.clearLogs(),
      },
    ]);
    onCleanup(unsub);
  });

  // App Maps and their screens are first-class palette entities. A person or
  // agent can jump to a known runtime state without first navigating panels.
  createEffect(() => {
    const appMaps = server.appMaps();
    const unsub = cmd.register(
      appMaps.flatMap((appMap) => [
        {
          id: `app-map.${appMap.id}`,
          title: appMap.name,
          subtitle: `${Object.keys(appMap.screens).length} screens · Map`,
          group: "Maps",
          run: () => server.setSelectedAppMapId(appMap.id),
        },
        ...Object.values(appMap.screens).map((screen) => ({
          id: `app-map.${appMap.id}.screen.${screen.id}`,
          title: screen.title,
          subtitle: `${appMap.name} · Screen`,
          group: "Screens",
          run: () => {
            server.setSelectedAppMapId(appMap.id);
            window.setTimeout(
              () =>
                window.dispatchEvent(
                  new CustomEvent("relay:reveal-app-map-screen", {
                    detail: { appMapId: appMap.id, screenId: screen.id },
                  }),
                ),
              0,
            );
          },
        })),
      ]),
    );
    onCleanup(unsub);
  });

  return (
    <div
      class={cn(
        "qa relative flex h-full min-h-full min-h-dvh flex-col overflow-hidden",
        "bg-background-weak text-text-strong",
        platform.platform === "desktop" && "qa--desktop",
      )}
    >
      <ErrorBanner />
      <div class="relative flex min-h-0 min-w-0 flex-1 flex-col bg-background-weak text-text-strong text-12-regular">
        {props.children}
      </div>
      <CommandPalette />
      <Toaster />
    </div>
  );
}
