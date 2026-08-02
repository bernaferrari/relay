import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { useServer, type DeviceInfo } from "../context/server";
import { cn } from "../lib/cn";
import { Icon } from "./icon";
import { presentTarget, targetGroupMatchesQuery, targetIsReady } from "../lib/target-presentation";
import { withRefreshFeedback } from "../lib/refresh-feedback";

type TargetGroup = { items: DeviceInfo[]; item: DeviceInfo; count: number };

export function DevicePicker(props: {
  onManageTargets?: () => void;
  onOpenLive?: () => void;
  liveOpen?: boolean;
}) {
  let trigger: HTMLButtonElement | undefined;
  let dialog: HTMLDivElement | undefined;
  let searchInput: HTMLInputElement | undefined;
  const server = useServer();
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [showVirtualDevices, setShowVirtualDevices] = createSignal(false);
  const [refreshing, setRefreshing] = createSignal(false);
  const [scanPhase, setScanPhase] = createSignal<"android" | "ios">("android");
  const device = () => server.devices().find((item) => item.serial === server.selectedDevice());
  const online = () => server.health() === "online";
  const scanning = () => server.deviceDiscoveryStatus() === "scanning";
  const ready = () => targetIsReady(device(), online());
  const targetLabel = () => {
    if (device()) return device()!.name;
    if (!online()) return "Relay offline";
    if (scanning()) return scanPhase() === "android" ? "Looking for Android…" : "Checking iOS…";
    return "Choose device";
  };
  const groupedDevices = createMemo<TargetGroup[]>(() => {
    const groups = new Map<string, DeviceInfo[]>();
    for (const item of server.devices()) {
      const target = presentTarget(item);
      const key =
        `${target.group}:${target.displayName}:${target.kindLabel}:${item.osVersion ?? ""}`.toLowerCase();
      const existing = groups.get(key) ?? [];
      groups.set(key, [...existing, item]);
    }
    return [...groups.values()].map((items) => ({
      items,
      item:
        items.find((candidate) => candidate.booted !== false) ??
        items.find((candidate) => candidate.serial === server.selectedDevice()) ??
        items[0]!,
      count: items.length,
    }));
  });
  const matchesQuery = (group: TargetGroup) => {
    const needle = query().trim().toLowerCase();
    return !needle || targetGroupMatchesQuery(group.items, needle);
  };
  const readyGroups = createMemo(() =>
    groupedDevices().filter((group) => matchesQuery(group) && targetIsReady(group.item, true)),
  );
  const attentionGroups = createMemo(() =>
    groupedDevices().filter(
      (group) =>
        matchesQuery(group) &&
        (group.item.connectionState === "unauthorized" || group.item.connectionState === "offline"),
    ),
  );
  const virtualGroups = createMemo(() =>
    groupedDevices().filter(
      (group) =>
        matchesQuery(group) &&
        !targetIsReady(group.item, true) &&
        group.item.connectionState !== "unauthorized" &&
        group.item.connectionState !== "offline",
    ),
  );
  const virtualExpanded = () =>
    showVirtualDevices() ||
    query().trim().length > 0 ||
    virtualGroups().some((group) => group.item.serial === server.selectedDevice());

  createEffect(() => {
    if (!scanning()) {
      setScanPhase("android");
      return;
    }
    setScanPhase("android");
    const phaseTimer = window.setTimeout(() => setScanPhase("ios"), 900);
    onCleanup(() => window.clearTimeout(phaseTimer));
  });

  async function refreshTargets(): Promise<void> {
    if (refreshing()) return;
    setRefreshing(true);
    try {
      await withRefreshFeedback(() => server.refreshDevices());
    } finally {
      setRefreshing(false);
    }
  }

  async function startDevice(serial: string): Promise<void> {
    const booted = await server.bootDevice(serial);
    if (booted) selectTarget(serial);
  }

  async function authorizeDevice(serial: string): Promise<void> {
    const authorized = await server.authorizeDevice(serial);
    if (!authorized) return;
    selectTarget(serial);
  }

  /**
   * Selection is visible immediately, while the control plane refreshes the
   * target's readiness in the background. The event lets an empty journey
   * advance from “Choose a device” to “Preparing” without waiting for the
   * next polling interval.
   */
  function selectTarget(serial: string): void {
    closePicker(true);
    void server.setSelectedDevice(serial).then(() => server.refreshDevices());
    window.dispatchEvent(new CustomEvent("relay:device-selected", { detail: { serial } }));
  }

  const closePicker = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) queueMicrotask(() => trigger?.focus());
  };

  createEffect(() => {
    if (!open()) return;
    queueMicrotask(() => {
      if (server.devices().length > 8) searchInput?.focus();
      else {
        const firstTarget = dialog?.querySelector<HTMLButtonElement>("[data-target-option]");
        (firstTarget ?? dialog?.querySelector<HTMLButtonElement>("button"))?.focus();
      }
    });
  });

  onMount(() => {
    const onPointer = (event: MouseEvent) => {
      if (!(event.target as HTMLElement).closest("[data-device-picker]")) {
        closePicker();
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && open()) closePicker(true);
    };
    // Lets distant surfaces (evidence card, blocked-run toasts) open this
    // picker instead of dead-ending on "choose another device" copy.
    const onOpenRequest = () => {
      setOpen(true);
      queueMicrotask(() => trigger?.scrollIntoView({ block: "nearest" }));
    };
    document.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    window.addEventListener("relay:open-device-picker", onOpenRequest);
    onCleanup(() => {
      document.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("relay:open-device-picker", onOpenRequest);
    });
  });

  return (
    <div class="relative z-[80]" data-device-picker>
      <Show
        when={props.onOpenLive}
        fallback={
          <button
            ref={(element) => (trigger = element)}
            type="button"
            class={cn(
              "relative inline-flex h-10 min-w-0 cursor-pointer items-center gap-2 rounded-[10px] px-3 text-[12px] font-medium text-[var(--text-base)] shadow-[var(--map-elevation-control)] transition-[background-color,color,transform] duration-150",
              "bg-[var(--map-control-surface)] hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--text-strong)] active:scale-[0.96] motion-reduce:active:scale-100",
              open() && "bg-[var(--v2-background-bg-layer-02)] text-[var(--text-strong)]",
            )}
            aria-haspopup="dialog"
            aria-controls="target-picker-dialog"
            aria-expanded={open()}
            onClick={() => (open() ? closePicker() : setOpen(true))}
          >
            <Icon
              name={
                scanning() && !device()
                  ? "refresh"
                  : device()?.platform === "browser"
                    ? "server"
                    : "smartphone"
              }
              size={14}
              class={cn(
                ready() ? "text-[var(--text-base)]" : "text-[var(--text-weak)]",
                device() && !ready() && "text-[var(--icon-warning-base)]",
                scanning() && !device() && "ui-refresh-spin motion-reduce:opacity-70",
              )}
            />
            <span class="max-w-[150px] truncate">{targetLabel()}</span>
            <Icon
              name="chevron-down"
              size={13}
              class={cn(
                "text-[var(--text-weak)] transition-transform duration-150",
                open() && "rotate-180",
              )}
            />
          </button>
        }
      >
        <div
          class={cn(
            "inline-flex h-10 min-w-0 items-stretch overflow-hidden rounded-[11px] bg-[var(--map-control-surface)] shadow-[var(--map-elevation-control)]",
            props.liveOpen && "text-[var(--text-interactive-base)]",
          )}
          role="group"
          aria-label="Live device"
        >
          <button
            type="button"
            class="inline-flex min-w-0 items-center gap-2 px-3 text-[12px] font-medium text-[var(--text-base)] transition-[background-color,color] duration-150 hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--text-strong)]"
            aria-pressed={props.liveOpen}
            aria-label={
              device() ? `${props.liveOpen ? "Hide" : "Show"} ${device()!.name}` : "Choose a device"
            }
            data-tip={device() ? `${props.liveOpen ? "Hide" : "Show"} device · D` : "Choose device"}
            onClick={() => {
              if (device()) props.onOpenLive?.();
              else setOpen(true);
            }}
          >
            <Icon
              name={
                scanning() && !device()
                  ? "refresh"
                  : device()?.platform === "browser"
                    ? "server"
                    : "smartphone"
              }
              size={14}
              class={cn(scanning() && !device() && "ui-refresh-spin motion-reduce:opacity-70")}
            />
            <span class="max-w-[150px] truncate max-[560px]:hidden">{targetLabel()}</span>
          </button>
          <button
            ref={(element) => (trigger = element)}
            type="button"
            class="grid w-9 shrink-0 place-items-center border-l border-[var(--map-divider)] text-[var(--text-weak)] transition-[background-color,color] duration-150 hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--text-strong)]"
            aria-label="Choose device"
            aria-haspopup="dialog"
            aria-controls="target-picker-dialog"
            aria-expanded={open()}
            data-tip="Choose device"
            onClick={() => (open() ? closePicker() : setOpen(true))}
          >
            <Icon
              name="chevron-down"
              size={13}
              class={cn(
                "transition-transform duration-150 motion-reduce:transition-none",
                open() && "rotate-180",
              )}
            />
          </button>
        </div>
      </Show>
      <Show when={open()}>
        <div
          ref={(element) => (dialog = element)}
          id="target-picker-dialog"
          class="ui-pop absolute top-[calc(100%+7px)] right-0 z-[90] flex max-h-[min(520px,calc(100vh-76px))] w-[286px] origin-top-right flex-col overflow-hidden rounded-[11px] border border-[var(--v2-border-border-strong)] bg-surface-raised-stronger-non-alpha text-[var(--text-strong)] shadow-[0_18px_50px_rgb(0_0_0/38%)]"
          role="dialog"
          aria-labelledby="target-picker-title"
          onKeyDown={(event) => {
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
            if ((event.target as HTMLElement).matches("input")) return;
            const options = [
              ...dialog!.querySelectorAll<HTMLButtonElement>("[data-target-option]"),
            ];
            if (options.length === 0) return;
            event.preventDefault();
            const current = options.indexOf(document.activeElement as HTMLButtonElement);
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? options.length - 1
                  : event.key === "ArrowDown"
                    ? (current + 1 + options.length) % options.length
                    : (current - 1 + options.length) % options.length;
            options[next]?.focus();
          }}
        >
          <header class="flex h-12 shrink-0 items-center justify-between gap-3 px-3">
            <span
              id="target-picker-title"
              class="inline-flex min-w-0 items-center gap-4 text-[12px] leading-none font-semibold text-[var(--text-base)]"
            >
              <span class="inline-flex h-6 items-center">Devices</span>
              <Show when={scanning()}>
                <span class="inline-flex h-6 items-center gap-2 rounded-full bg-[var(--v2-background-bg-layer-02)] px-2 text-[10px] leading-none font-normal text-[var(--text-weak)]">
                  <i class="size-1 rounded-full bg-[var(--text-interactive-base)] motion-safe:animate-pulse" />
                  Scanning…
                </span>
              </Show>
            </span>
            <button
              type="button"
              class="relative grid size-7 shrink-0 place-items-center rounded-md text-[var(--text-weak)] transition-colors before:absolute before:-inset-2 hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--text-strong)]"
              disabled={refreshing() || scanning()}
              aria-busy={refreshing() || scanning()}
              aria-label="Refresh devices"
              title="Refresh devices"
              onClick={() => void refreshTargets()}
            >
              <Icon
                name="refresh"
                size={13}
                class={cn(
                  (refreshing() || scanning()) && "ui-refresh-spin motion-reduce:opacity-70",
                )}
              />
            </button>
          </header>
          <Show when={server.devices().length > 0}>
            <label class="mx-2.5 mb-2 flex h-10 shrink-0 items-center gap-2 rounded-lg bg-[var(--v2-background-bg-deep)] px-2.5 text-[var(--text-weak)] shadow-[inset_0_0_0_1px_var(--v2-border-border-muted)] focus-within:shadow-[inset_0_0_0_1px_var(--text-interactive-base)]">
              <Icon name="search" size={14} />
              <span class="sr-only">Filter devices</span>
              <input
                ref={(element) => (searchInput = element)}
                class="min-w-0 flex-1 border-0 bg-transparent text-[14px] text-[var(--text-strong)] outline-none placeholder:text-[var(--text-weak)]"
                type="search"
                value={query()}
                placeholder="Search devices"
                onInput={(event) => setQuery(event.currentTarget.value)}
              />
            </label>
          </Show>
          <div class="min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5">
            <Show
              when={server.devices().length > 0}
              fallback={
                <Show
                  when={!scanning()}
                  fallback={
                    <div
                      class="flex flex-col items-center px-4 pt-7 pb-6 text-center"
                      aria-live="polite"
                    >
                      <span class="grid size-11 place-items-center rounded-[9px] bg-[var(--product-accent-soft)] text-[var(--text-interactive-base)]">
                        <Icon
                          name="refresh"
                          size={20}
                          class="ui-refresh-spin motion-reduce:opacity-70"
                        />
                      </span>
                      <strong class="mt-3 text-[13px] font-semibold text-[var(--text-strong)]">
                        {scanPhase() === "android"
                          ? "Checking Android devices…"
                          : "Checking iOS simulators…"}
                      </strong>
                      <p class="mt-1 mb-0 max-w-[220px] text-[11.5px]/[1.5] text-[var(--text-weak)]">
                        Relay scans each platform separately. Connected devices appear as soon as
                        they answer.
                      </p>
                    </div>
                  }
                >
                  <div class="flex flex-col items-center px-4 pt-7 pb-6 text-center">
                    <span class="grid size-11 place-items-center rounded-[9px] bg-[var(--product-accent-soft)] text-[var(--text-interactive-base)]">
                      <Icon name="smartphone" size={20} />
                    </span>
                    <strong class="mt-3 text-[13px] font-semibold text-[var(--text-strong)]">
                      No devices found
                    </strong>
                    <p class="mt-1 mb-0 max-w-[220px] text-[11.5px]/[1.5] text-[var(--text-weak)]">
                      Connect a phone or start a simulator.
                    </p>
                  </div>
                </Show>
              }
            >
              <For each={attentionGroups()}>
                {(group) => (
                  <TargetRow
                    group={group}
                    selected={group.item.serial === server.selectedDevice()}
                    authorizing={server.authorizingSerial() === group.item.serial}
                    onAuthorize={() => void authorizeDevice(group.item.serial)}
                    onPick={() => undefined}
                  />
                )}
              </For>
              <For each={readyGroups()}>
                {(group) => (
                  <TargetRow
                    group={group}
                    selected={group.items.some((item) => item.serial === server.selectedDevice())}
                    onPick={() => selectTarget(group.item.serial)}
                  />
                )}
              </For>
              <Show when={virtualGroups().length > 0}>
                <button
                  type="button"
                  class="mt-0.5 flex min-h-10 w-full items-center justify-between gap-1.5 rounded-lg px-2.5 text-left text-[11px] font-medium text-[var(--text-base)] transition-colors hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--text-strong)] active:scale-[0.99] motion-reduce:active:scale-100"
                  aria-expanded={virtualExpanded()}
                  onClick={() => setShowVirtualDevices((value) => !value)}
                >
                  <span>Virtual devices</span>
                  <span class="ml-auto tabular-nums text-[10px] text-[var(--text-weak)]">
                    {virtualGroups().length}
                  </span>
                  <Icon
                    name="chevron-down"
                    size={12}
                    class={cn(
                      "transition-transform duration-150",
                      !virtualExpanded() && "-rotate-90",
                    )}
                  />
                </button>
                <Show when={virtualExpanded()}>
                  <For each={virtualGroups()}>
                    {(group) => (
                      <TargetRow
                        group={group}
                        selected={group.items.some(
                          (item) => item.serial === server.selectedDevice(),
                        )}
                        starting={server.bootingSerial() === group.item.serial}
                        onStart={() => void startDevice(group.item.serial)}
                        onPick={() => selectTarget(group.item.serial)}
                      />
                    )}
                  </For>
                </Show>
              </Show>
              <Show
                when={
                  readyGroups().length === 0 &&
                  attentionGroups().length === 0 &&
                  virtualGroups().length === 0
                }
              >
                <div class="px-4 py-6 text-center text-[12px] text-[var(--text-weak)]">
                  {query() ? `No devices match “${query()}”.` : "No devices available."}
                </div>
              </Show>
            </Show>
          </div>
          <Show when={props.onManageTargets}>
            <footer class="shrink-0 border-t border-[var(--v2-border-border-muted)] p-1">
              <button
                type="button"
                class="flex min-h-10 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[12px] font-medium text-[var(--text-base)] transition-colors hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--text-strong)]"
                onClick={() => {
                  closePicker();
                  props.onManageTargets!();
                }}
              >
                <Icon name="sliders" size={14} />
                Device settings…
              </button>
            </footer>
          </Show>
        </div>
      </Show>
    </div>
  );
}

function TargetRow(props: {
  group: TargetGroup;
  selected: boolean;
  onPick: () => void;
  onStart?: () => void;
  starting?: boolean;
  onAuthorize?: () => void;
  authorizing?: boolean;
}) {
  const target = () => presentTarget(props.group.item);
  const available = () => targetIsReady(props.group.item, true);
  const startable = () =>
    !available() && props.onStart && /simulator|emulator/i.test(target().kindLabel);
  const authorizable = () =>
    props.group.item.connectionState === "unauthorized" && Boolean(props.onAuthorize);
  const status = () => {
    if (props.starting) return "Starting…";
    if (props.authorizing) return "Check your phone…";
    if (!available()) {
      return /simulator|emulator/i.test(target().kindLabel)
        ? "Virtual device"
        : target().statusLabel;
    }
    const platform = props.group.item.osVersion
      ? `${target().platformLabel} ${props.group.item.osVersion}`
      : target().platformLabel;
    return props.group.count > 1 ? `${platform} · ${props.group.count}` : platform;
  };
  return (
    <div
      class={cn(
        "group/target relative grid min-h-11 w-full grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-2 py-1 transition-colors",
        "hover:bg-[var(--v2-background-bg-layer-02)] focus-within:bg-[var(--v2-background-bg-layer-02)]",
        props.selected && "bg-[var(--v2-background-bg-layer-02)]",
      )}
    >
      <span
        class={cn(
          "grid size-[22px] place-items-center text-[var(--text-weak)]",
          props.selected && "text-[var(--text-interactive-base)]",
        )}
        aria-hidden="true"
      >
        <Icon name={props.group.item.platform === "browser" ? "server" : "smartphone"} size={14} />
      </span>
      <button
        type="button"
        data-target-option={available() || authorizable() ? "" : undefined}
        aria-current={props.selected ? "true" : undefined}
        aria-label={`${target().displayName}, ${status()}`}
        disabled={!available() && !authorizable()}
        class="min-w-0 truncate rounded text-left text-[12px]/[1.3] font-medium text-[var(--text-base)] enabled:cursor-pointer enabled:after:absolute enabled:after:inset-0 enabled:after:content-[''] enabled:hover:text-[var(--text-strong)] enabled:active:scale-[0.99] disabled:cursor-default focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-[var(--v2-border-border-strong)] motion-reduce:enabled:active:scale-100"
        onClick={() => (available() ? props.onPick() : props.onAuthorize?.())}
      >
        {target().displayName}
      </button>
      <span class="relative z-[1] flex items-center gap-1">
        <Show when={startable()}>
          <button
            type="button"
            class={cn(
              "rounded-md px-2 py-1 text-[10.5px] font-semibold text-[var(--text-interactive-base)] active:scale-[0.96] motion-reduce:active:scale-100",
              "shadow-[inset_0_0_0_1px_var(--v2-border-border-muted)] transition-colors",
              "hover:bg-[var(--product-accent-soft)]",
              props.starting && "pointer-events-none",
            )}
            aria-label={`Start ${target().displayName}`}
            disabled={props.starting}
            onClick={(event) => {
              event.stopPropagation();
              props.onStart?.();
            }}
          >
            {props.starting ? "Starting…" : "Start"}
          </button>
        </Show>
        <Show when={!startable()}>
          <small
            class={cn(
              "max-w-[112px] truncate text-[10.5px] text-[var(--text-weak)]",
              !available() && "text-[var(--icon-warning-base)]",
            )}
          >
            {status()}
          </small>
        </Show>
        <Show when={props.selected}>
          <span class="grid size-5 place-items-center text-[var(--text-interactive-base)]">
            <Icon name="check" size={13} strokeWidth={2.5} />
          </span>
        </Show>
      </span>
    </div>
  );
}
