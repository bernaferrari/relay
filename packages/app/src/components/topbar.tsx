import { For, Show, createSignal, onMount, onCleanup } from "solid-js";
import { useServer } from "../context/server";
import { Icon } from "./icon";
import { fmtDur, titleize } from "../lib/job";
import { cn } from "../lib/cn";
import { btnGhost, mono } from "../lib/ui";

/**
 * Topbar (plan 012) — brand · device picker · [spacer] · runbar pill (active
 * job) · Settings (icon-only). The Run button lives in the run pane header
 * (whose title is now the recipe switcher); the rail toggle + ⌘B are gone.
 * Electron titlebar-drag regions stay on the wrapper + no-drag on interactive
 * elements.
 */
export function Topbar(props: { onSettings: () => void }) {
  const server = useServer();
  const [deviceOpen, setDeviceOpen] = createSignal(false);

  onMount(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t?.closest?.("[data-pick]")) setDeviceOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    onCleanup(() => document.removeEventListener("mousedown", onDoc));
  });

  const deviceLabel = () => {
    if (server.health() === "offline") return "Offline";
    const s = server.selectedDevice();
    if (!s) return server.isEmptyDevices() ? "No device" : "Select device";
    const d = server.devices().find((x) => x.serial === s);
    return d?.name ?? s;
  };

  const statusOn = () =>
    server.health() === "online" && Boolean(server.selectedDevice()) && !server.isEmptyDevices();
  const statusWarn = () =>
    server.health() !== "offline" && (server.isEmptyDevices() || !server.selectedDevice());
  const statusOff = () => server.health() === "offline";
  const pickEmpty = () => server.isEmptyDevices() || !server.selectedDevice();

  return (
    <header
      class={cn(
        "desktop-titlebar-drag z-40 flex h-[46px] shrink-0 flex-row items-center gap-2",
        "border-b border-border bg-deep/90 px-3 pl-[var(--traffic-pad,12px)]",
        "backdrop-blur-md backdrop-saturate-150",
      )}
    >
      <div class="desktop-titlebar-no-drag mr-1.5 flex h-[30px] items-center gap-2.5 border-r border-border pr-3">
        <span
          class="grid size-[22px] place-items-center rounded-[7px] bg-accent/15 text-accent-soft"
          aria-hidden="true"
        >
          <Icon name="smartphone" size={12} strokeWidth={2} />
        </span>
        <span class="text-[13.5px] font-semibold tracking-tight text-text">Specimen</span>
      </div>

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
            "inline-flex h-7 items-center gap-2 rounded-control border border-border bg-layer-1",
            "px-2 pl-2.5 text-body font-medium text-text transition-colors",
            "hover:border-border-strong hover:bg-layer-2",
            pickEmpty() && "text-text-faint",
          )}
          aria-haspopup="listbox"
          aria-expanded={deviceOpen()}
          onClick={() => setDeviceOpen((o) => !o)}
        >
          <span
            class={cn(
              "size-2 shrink-0 rounded-full transition-colors",
              statusOff()
                ? "bg-fail"
                : statusOn()
                  ? "bg-pass shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-pass)_22%,transparent)]"
                  : statusWarn()
                    ? "bg-heal"
                    : "bg-text-faint",
            )}
            aria-hidden="true"
          />
          <span class="max-w-[168px] truncate text-meta">{deviceLabel()}</span>
          <span
            class={cn(
              "grid place-items-center text-text-faint transition-transform duration-200",
              deviceOpen() && "rotate-180",
            )}
          >
            <Icon name="chevron-down" size={14} />
          </span>
        </button>
        <Show when={deviceOpen()}>
          <div
            class={cn(
              "absolute top-[calc(100%+8px)] left-0 z-[80] min-w-[248px] rounded-card border border-border",
              "bg-layer-1 p-1.5 shadow-[0_16px_48px_rgb(0_0_0/0.32)]",
            )}
            role="listbox"
          >
            <Show
              when={server.devices().length > 0}
              fallback={
                <div class="px-3 py-3.5 text-center">
                  <p class="m-0 text-body font-semibold text-text">No devices</p>
                  <p class="mt-1 mb-2 text-meta text-text-faint">Connect a phone, then refresh.</p>
                  <code
                    class={cn(
                      mono,
                      "inline-block rounded-md bg-layer-2 px-2 py-0.5 text-meta text-accent-soft",
                    )}
                  >
                    adb devices
                  </code>
                </div>
              }
            >
              <For each={server.devices()}>
                {(d) => {
                  const selected = () => server.selectedDevice() === d.serial;
                  return (
                    <button
                      type="button"
                      role="option"
                      class={cn(
                        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-text transition-colors",
                        "hover:bg-hover",
                        selected() && "bg-accent/10",
                      )}
                      aria-selected={selected()}
                      onClick={() => {
                        void server.setSelectedDevice(d.serial);
                        setDeviceOpen(false);
                      }}
                    >
                      <span
                        class={cn(
                          "size-2 shrink-0 rounded-full bg-text-faint",
                          d.booted !== false && "bg-pass",
                        )}
                      />
                      <span class="min-w-0 text-left">
                        <span class="block text-body font-medium">{d.name ?? d.serial}</span>
                        <span class={cn(mono, "mt-px block text-meta text-text-faint")}>
                          {d.serial}
                        </span>
                      </span>
                    </button>
                  );
                }}
              </For>
            </Show>
            <button
              type="button"
              class={cn(
                "mt-0.5 flex w-full items-center justify-center rounded-b-[10px] border-t border-border",
                "px-2.5 pt-2.5 pb-2 font-medium text-accent-soft transition-colors hover:bg-hover",
              )}
              onClick={() => {
                void (async () => {
                  await server.pollHealth();
                  if (server.health() === "online") await server.refreshDevices();
                })();
                setDeviceOpen(false);
              }}
            >
              Refresh devices
            </button>
          </div>
        </Show>
      </div>

      <span class="flex-1" />

      <Show when={server.activeJob()}>
        {(job) => (
          <div
            class={cn(
              "desktop-titlebar-no-drag inline-flex h-7 max-w-[320px] items-center gap-1.5",
              "rounded-full border border-accent/40 bg-accent/10 py-0 pr-1 pl-2.5 text-text",
            )}
            role="group"
            aria-label="Active job"
          >
            <span class="grid size-3.5 shrink-0 place-items-center text-accent" aria-hidden="true">
              <Show
                when={server.isPaused()}
                fallback={
                  <span class="size-[11px] animate-spin rounded-full border-[1.5px] border-accent/35 border-t-accent" />
                }
              >
                <Icon name="pause" size={10} />
              </Show>
            </span>
            <button
              type="button"
              class={cn(
                "m-0 max-w-[160px] cursor-pointer truncate rounded-[5px] border-none bg-transparent",
                "px-1.5 py-px text-body font-medium tracking-tight text-text",
                "hover:bg-hover hover:text-accent-soft",
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
            <span class={cn(mono, "shrink-0 text-meta text-text-faint")}>
              {fmtDur(job(), server.clock())}
            </span>
            <button
              type="button"
              class="grid size-[22px] shrink-0 place-items-center rounded-full text-text transition-colors hover:bg-hover"
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
            </button>
            <button
              type="button"
              class={cn(
                "grid size-[22px] shrink-0 place-items-center rounded-full text-fail transition-colors",
                "hover:bg-[var(--v2-state-bg-danger)]",
              )}
              title="Cancel (Esc)"
              aria-label="Cancel job"
              onClick={() => {
                const a = server.activeJob();
                if (a) void server.cancelJob(a.id);
              }}
            >
              <Icon name="square" size={11} />
            </button>
          </div>
        )}
      </Show>
      <button
        type="button"
        class={cn(btnGhost, "desktop-titlebar-no-drag h-[30px] shrink-0 px-[7px]")}
        data-tip="Settings (⌘,)"
        aria-label="Settings"
        onClick={props.onSettings}
      >
        <Icon name="sliders" size={15} />
      </button>
    </header>
  );
}
