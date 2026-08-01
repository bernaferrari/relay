import { For, Show, createSignal, onMount, onCleanup } from "solid-js";
import { useServer } from "../context/server";
import { Icon } from "./icon";
import { IconButton } from "@relay/ui/icon-button";
import { fmtDur, titleize } from "../lib/job";
import { cn } from "../lib/cn";
import { mono, popover } from "../lib/ui";
import { presentTarget } from "../lib/target-presentation";
import { withRefreshFeedback } from "../lib/refresh-feedback";
import { executionStateLabel } from "../lib/execution-moments";

/**
 * Topbar — brand · device picker · [spacer] · runbar pill · Settings.
 * Height 36px; app-owned drag region; high-contrast status dots.
 */
export function Topbar(props: { onSettings: () => void }) {
  const server = useServer();
  const [deviceOpen, setDeviceOpen] = createSignal(false);
  const [refreshingDevices, setRefreshingDevices] = createSignal(false);

  onMount(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t?.closest?.("[data-pick]")) setDeviceOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    onCleanup(() => document.removeEventListener("mousedown", onDoc));
  });

  const deviceLabel = () => {
    if (server.health() === "offline") return "Connection unavailable";
    const s = server.selectedDevice();
    if (!s) {
      if (server.deviceDiscoveryStatus() === "scanning") return "Discovering devices…";
      return server.isEmptyDevices() ? "No device" : "Select device";
    }
    const d = server.devices().find((x) => x.serial === s);
    return d ? presentTarget(d).displayName : "Select device";
  };

  const statusOn = () =>
    server.health() === "online" && Boolean(server.selectedDevice()) && !server.isEmptyDevices();
  const statusOff = () => server.health() === "offline";
  const pickEmpty = () => server.isEmptyDevices() || !server.selectedDevice();
  async function refreshDevices(): Promise<void> {
    if (refreshingDevices()) return;
    setRefreshingDevices(true);
    try {
      await withRefreshFeedback(async () => {
        await server.pollHealth();
        if (server.health() === "online") await server.refreshDevices();
      });
    } finally {
      setRefreshingDevices(false);
    }
  }

  return (
    <header
      class={cn(
        "desktop-titlebar-drag z-40 flex h-9 shrink-0 flex-row items-center gap-2",
        "bg-v2-background-bg-deep px-3 pl-[var(--traffic-pad,12px)]",
        "text-text-strong",
      )}
    >
      {/* Brand — AB: wordmark only, no candy icon chip */}
      <div class="desktop-titlebar-no-drag mr-2 flex h-7 items-center pr-2">
        <span class="text-14-medium tracking-tight text-text-strong">Stage</span>
      </div>

      {/* Device picker */}
      <div
        class="desktop-titlebar-no-drag relative"
        data-pick
        onKeyDown={(e) => {
          if (e.key === "Escape" && deviceOpen()) {
            e.stopPropagation();
            setDeviceOpen(false);
          }
        }}
      >
        <button
          type="button"
          class={cn(
            "inline-flex h-7 items-center gap-2 rounded-md bg-surface-raised-stronger-non-alpha px-2.5",
            "text-12-medium text-text-strong",
            "ring-1 ring-inset ring-border-weak-base",
            "transition-[background-color,color,box-shadow] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]",
            "hover:bg-surface-raised-base-hover",
            pickEmpty() && "text-text-base",
            deviceOpen() && "bg-surface-base-active",
          )}
          aria-haspopup="listbox"
          aria-expanded={deviceOpen()}
          onClick={() => setDeviceOpen((o) => !o)}
        >
          <span
            class={cn(
              "size-2 shrink-0 rounded-full ring-2 ring-transparent transition-colors",
              statusOff()
                ? "bg-icon-critical-base ring-icon-critical-base/25"
                : statusOn()
                  ? "bg-icon-success-base ring-icon-success-base/25"
                  : "bg-text-weak ring-border-weak-base",
            )}
            aria-hidden="true"
          />
          <span class="max-w-[168px] truncate">{deviceLabel()}</span>
          <span
            class={cn(
              "grid place-items-center text-text-weak transition-transform duration-200",
              deviceOpen() && "rotate-180",
            )}
          >
            <Icon name="chevron-down" size={14} />
          </span>
        </button>
        <Show when={deviceOpen()}>
          <div
            class={cn(
              popover,
              "absolute top-[calc(100%+8px)] left-0 z-[80] min-w-[256px] origin-top-left",
            )}
            role="listbox"
          >
            <Show
              when={server.devices().length > 0}
              fallback={
                <Show
                  when={server.deviceDiscoveryStatus() !== "scanning"}
                  fallback={
                    <div class="px-3 py-3.5 text-center" aria-live="polite">
                      <p class="m-0 text-12-medium text-text-strong">Discovering devices…</p>
                      <p class="mt-1 mb-2 text-12-regular text-text-weak">
                        Checking connected phones and available simulators.
                      </p>
                    </div>
                  }
                >
                  <div class="px-3 py-3.5 text-center">
                    <p class="m-0 text-12-medium text-text-strong">No device connected</p>
                    <p class="mt-1 mb-2 text-12-regular text-text-weak">
                      Connect a phone or start a simulator.
                    </p>
                  </div>
                </Show>
              }
            >
              <For each={server.devices()}>
                {(d) => {
                  const selected = () => server.selectedDevice() === d.serial;
                  const target = () => presentTarget(d);
                  return (
                    <button
                      type="button"
                      role="option"
                      class={cn(
                        "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-text-strong transition-colors",
                        "hover:bg-surface-raised-base-hover",
                        selected() && "bg-surface-base-active",
                      )}
                      aria-selected={selected()}
                      onClick={() => {
                        void server.setSelectedDevice(d.serial);
                        setDeviceOpen(false);
                      }}
                    >
                      <span
                        class={cn(
                          "size-2 shrink-0 rounded-full",
                          d.booted !== false ? "bg-icon-success-base" : "bg-text-weak",
                        )}
                        aria-hidden="true"
                      />
                      <span class="min-w-0 flex-1 text-left">
                        <span class="block text-12-medium text-text-strong">
                          {target().displayName}
                        </span>
                        <span class="mt-px block text-12-regular text-text-weak">
                          {target().kindLabel} · {target().statusLabel}
                        </span>
                      </span>
                      <Show when={selected()}>
                        <span class="ui-check text-text-strong" aria-hidden="true">
                          <Icon name="check" size={13} />
                        </span>
                      </Show>
                    </button>
                  );
                }}
              </For>
            </Show>
            <button
              type="button"
              class={cn(
                "mt-0.5 flex w-full items-center justify-center gap-1.5 rounded-b-[10px] border-t border-border-weak-base",
                "px-2.5 pt-2.5 pb-2 font-medium text-text-strong transition-colors hover:bg-surface-raised-base-hover",
              )}
              disabled={refreshingDevices()}
              aria-busy={refreshingDevices()}
              onClick={() => {
                void refreshDevices();
              }}
            >
              <Icon
                name="refresh"
                size={12}
                class={refreshingDevices() ? "ui-refresh-spin motion-reduce:opacity-70" : undefined}
              />
              Refresh devices
            </button>
          </div>
        </Show>
      </div>

      <span class="flex-1" />

      {/* Active job pill */}
      <Show when={server.activeJob()}>
        {(job) => (
          <div
            class={cn(
              "group/job desktop-titlebar-no-drag inline-flex h-7 max-w-[280px] items-center gap-1.5",
              "rounded-full bg-surface-base py-0 pr-1.5 pl-2 text-text-strong shadow-xs-border-base",
            )}
            role="group"
            aria-label="Active job"
          >
            <span class="grid size-3 shrink-0 place-items-center text-icon-base" aria-hidden="true">
              <Show
                when={server.isPaused()}
                fallback={
                  <span class="size-[10px] animate-spin rounded-full border-[1.5px] border-border-weak-base border-t-text-strong" />
                }
              >
                <Icon name="pause" size={10} />
              </Show>
            </span>
            <button
              type="button"
              class={cn(
                "m-0 max-w-[148px] cursor-pointer truncate rounded-md border-none bg-transparent",
                "px-1 py-px text-12-medium tracking-tight text-text-strong",
                "hover:bg-surface-base-hover",
              )}
              title="Jump to this run"
              onClick={() => {
                const j = job();
                server.setSelectedRecipeId(j.action);
                server.jumpToJob(j.id);
              }}
            >
              {job().title ?? titleize(job().action, server.recipes())}
            </button>
            <span class={cn(mono, "shrink-0 text-12-regular text-text-weak")}>
              <Show when={job().waitingFor} fallback={fmtDur(job(), server.clock())}>
                {executionStateLabel("paused")}
              </Show>
            </span>
            {/* Pause/cancel: reveal on hover — quiet chrome at rest */}
            <span class="flex w-0 items-center gap-0.5 overflow-hidden opacity-0 transition-[width,opacity] group-hover/job:w-12 group-hover/job:opacity-100 group-focus-within/job:w-12 group-focus-within/job:opacity-100">
              <IconButton
                variant="ghost"
                size="normal"
                title={server.isPaused() ? "Resume (Space)" : "Pause (Space)"}
                aria-label={server.isPaused() ? "Resume job" : "Pause job"}
                onClick={() => {
                  const a = server.activeJob();
                  if (!a) return;
                  if (a.status === "paused") void server.resumeJob(a.id);
                  else void server.pauseJob(a.id);
                }}
              >
                <Icon name={server.isPaused() ? "play" : "pause"} size={12} />
              </IconButton>
              <IconButton
                variant="ghost"
                size="normal"
                class="text-icon-critical-base hover:bg-surface-critical-weak"
                title="Cancel (Esc)"
                aria-label="Cancel job"
                onClick={() => {
                  const a = server.activeJob();
                  if (a) void server.cancelJob(a.id);
                }}
              >
                <Icon name="square" size={11} />
              </IconButton>
            </span>
          </div>
        )}
      </Show>

      <IconButton
        variant="ghost"
        size="normal"
        class="desktop-titlebar-no-drag rounded-md"
        data-tip="Settings (⌘,)"
        aria-label="Settings"
        onClick={props.onSettings}
      >
        <Icon name="sliders" size={14} />
      </IconButton>
    </header>
  );
}
