import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import type { CompatibilityMatrix } from "@relay/protocol";
import { useServer, type DeviceInfo } from "../context/server";
import { cn } from "../lib/cn";
import { Icon } from "./icon";
import { presentTarget, targetGroupMatchesQuery, targetIsReady } from "../lib/target-presentation";
import { withRefreshFeedback } from "../lib/refresh-feedback";
import type { WorkspaceController } from "../lib/workspace-controller";

type TargetGroup = { items: DeviceInfo[]; item: DeviceInfo; count: number };

export function DevicePicker(props: {
  onManageTargets?: () => void;
  onOpenLive?: () => void;
  liveOpen?: boolean;
  targetSets?: readonly CompatibilityMatrix[];
  activeTargetSetId?: string;
  onChooseTargetSet?: (targetSetId?: string) => void;
  workspaceController?: WorkspaceController;
}) {
  let trigger: HTMLButtonElement | undefined;
  let dialog: HTMLDivElement | undefined;
  let searchInput: HTMLInputElement | undefined;
  const server = useServer();
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [showVirtualDevices, setShowVirtualDevices] = createSignal(false);
  const [refreshing, setRefreshing] = createSignal(false);
  const device = () => server.devices().find((item) => item.serial === server.selectedDevice());
  const [rememberedDevice, setRememberedDevice] = createSignal<DeviceInfo>();
  const presentedDevice = () => device() ?? rememberedDevice();
  const activeTargetSet = () =>
    props.targetSets?.find((targetSet) => targetSet.id === props.activeTargetSetId);
  const online = () => server.health() === "online";
  const scanning = () => server.deviceDiscoveryStatus() === "scanning";
  const ready = () => targetIsReady(presentedDevice(), online());
  const targetLabel = () => {
    if (activeTargetSet()) return activeTargetSet()!.name;
    if (presentedDevice()) return presentedDevice()!.name;
    if (!online()) return "Relay offline";
    if (scanning()) return "Scanning devices…";
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
  const setupGroups = createMemo(() =>
    groupedDevices().filter(
      (group) =>
        matchesQuery(group) &&
        !targetIsReady(group.item, true) &&
        group.item.connectionState !== "unauthorized" &&
        group.item.connectionState !== "offline" &&
        group.item.platform !== "browser" &&
        !/simulator|emulator/i.test(String(group.item.kind ?? "")),
    ),
  );
  const virtualGroups = createMemo(() =>
    groupedDevices().filter(
      (group) =>
        matchesQuery(group) &&
        !targetIsReady(group.item, true) &&
        group.item.connectionState !== "unauthorized" &&
        group.item.connectionState !== "offline" &&
        /simulator|emulator/i.test(String(group.item.kind ?? "")),
    ),
  );
  const virtualExpanded = () =>
    showVirtualDevices() ||
    query().trim().length > 0 ||
    virtualGroups().some((group) => group.item.serial === server.selectedDevice());

  createEffect(() => {
    const serial = server.selectedDevice();
    const current = device();
    if (!serial) {
      setRememberedDevice();
      return;
    }
    if (current) setRememberedDevice(current);
    else if (!scanning()) setRememberedDevice();
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

  /** Selection is visible immediately while the control plane refreshes the
   * target's readiness in the background. The typed workspace notification
   * lets the active editor advance without waiting for the next poll. */
  function selectTarget(serial: string): void {
    closePicker(true);
    props.onChooseTargetSet?.();
    void server.setSelectedDevice(serial).then(() => server.refreshDevices());
    props.workspaceController?.publish({ kind: "target.selected", targetId: serial });
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
        (firstTarget ?? dialog?.querySelector<HTMLButtonElement>("button:not(:disabled)"))?.focus();
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
    // Distant surfaces use the typed workspace command so target selection
    // cannot race or duplicate an untyped window event listener.
    const onOpenRequest = () => {
      setOpen(true);
      queueMicrotask(() => trigger?.scrollIntoView({ block: "nearest" }));
    };
    const disconnectWorkspace = props.workspaceController?.connect({
      chooseTarget: onOpenRequest,
    });
    document.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    onCleanup(() => {
      document.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
      disconnectWorkspace?.();
    });
  });

  return (
    <div class="relative z-[var(--z-shell-rail)]" data-device-picker>
      <Show
        when={props.onOpenLive}
        fallback={
          <button
            ref={(element) => (trigger = element)}
            type="button"
            class={cn(
              "relative inline-flex h-10 min-w-0 cursor-pointer items-center gap-2 rounded-xl px-3 text-caption font-medium text-[var(--text-base)] shadow-[var(--map-elevation-control)] transition-[background-color,color,transform] duration-hover",
              "bg-[var(--map-control-surface)] hover:bg-[var(--surface-base-hover)] hover:text-[var(--text-strong)] active:scale-[0.96] motion-reduce:active:scale-100",
              open() && "bg-[var(--surface-base-hover)] text-[var(--text-strong)]",
            )}
            aria-haspopup="dialog"
            aria-controls="target-picker-dialog"
            aria-expanded={open()}
            onClick={() => (open() ? closePicker() : setOpen(true))}
          >
            <Icon
              name={
                activeTargetSet()
                  ? "grid"
                  : scanning() && !presentedDevice()
                    ? "refresh"
                    : presentedDevice()?.platform === "browser"
                      ? "server"
                      : "smartphone"
              }
              size={14}
              class={cn(
                ready() ? "text-[var(--text-base)]" : "text-[var(--text-weak)]",
                presentedDevice() && !ready() && "text-[var(--icon-warning-base)]",
                scanning() && !presentedDevice() && "ui-refresh-spin motion-reduce:opacity-70",
              )}
            />
            <span class="max-w-[150px] truncate">{targetLabel()}</span>
            <Icon
              name="chevron-down"
              size={13}
              class={cn(
                "text-[var(--text-weak)] transition-transform duration-hover",
                open() && "rotate-180",
              )}
            />
          </button>
        }
      >
        <div
          class={cn(
            "inline-flex h-10 min-w-0 items-stretch overflow-hidden rounded-xl bg-[var(--map-control-surface)] shadow-[var(--map-elevation-control)]",
            props.liveOpen && "text-[var(--text-interactive-base)]",
          )}
          role="group"
          aria-label="Live device"
        >
          <button
            type="button"
            class="inline-flex min-w-0 items-center gap-2 px-3 text-caption font-medium text-[var(--text-base)] transition-[background-color,color] duration-hover hover:bg-[var(--surface-base-hover)] hover:text-[var(--text-strong)]"
            aria-pressed={props.liveOpen}
            aria-label={
              activeTargetSet()
                ? `Choose run target, currently ${activeTargetSet()!.name}`
                : presentedDevice()
                  ? `${props.liveOpen ? "Hide" : "Show"} ${presentedDevice()!.name}`
                  : "Choose a device"
            }
            data-tip={
              presentedDevice() ? `${props.liveOpen ? "Hide" : "Show"} device · D` : "Choose device"
            }
            onClick={(event) => {
              if (activeTargetSet()) {
                trigger = event.currentTarget;
                setOpen(true);
              } else if (presentedDevice()) props.onOpenLive?.();
              else {
                trigger = event.currentTarget;
                setOpen(true);
              }
            }}
          >
            <Icon
              name={
                activeTargetSet()
                  ? "grid"
                  : scanning() && !presentedDevice()
                    ? "refresh"
                    : presentedDevice()?.platform === "browser"
                      ? "server"
                      : "smartphone"
              }
              size={14}
              class={cn(
                scanning() && !presentedDevice() && "ui-refresh-spin motion-reduce:opacity-70",
              )}
            />
            {/* The workspace modes and proof action are higher-level navigation.
                At compact desktop widths the device name used to overrun them,
                leaving visually separate controls with overlapping hit targets.
                Keep the labelled trigger for assistive tech and reveal the name
                again as soon as the shell has room. */}
            <span class="max-w-[150px] truncate max-[1320px]:hidden">{targetLabel()}</span>
          </button>
          <button
            ref={(element) => (trigger = element)}
            type="button"
            class="grid w-9 shrink-0 place-items-center border-l border-[var(--map-divider)] text-[var(--text-weak)] transition-[background-color,color] duration-hover hover:bg-[var(--surface-base-hover)] hover:text-[var(--text-strong)]"
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
                "transition-transform duration-hover motion-reduce:transition-none",
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
          class="ui-pop absolute top-[calc(100%+7px)] right-0 z-[var(--z-scrim)] flex max-h-[min(520px,calc(100vh-76px))] w-[286px] origin-top-right flex-col overflow-hidden rounded-xl bg-surface-raised-stronger-non-alpha text-[var(--text-strong)] shadow-[var(--map-elevation-panel)]"
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
              class="inline-flex min-w-0 items-center gap-4 text-caption leading-none font-semibold text-[var(--text-base)]"
            >
              <span class="inline-flex h-6 items-center">Devices</span>
            </span>
            <button
              type="button"
              class="relative grid size-7 shrink-0 place-items-center rounded-md text-[var(--text-weak)] transition-colors before:absolute before:-inset-2 hover:bg-[var(--surface-base-hover)] hover:text-[var(--text-strong)]"
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
            <label class="group/device-search mx-2.5 mb-2 flex h-10 shrink-0 items-center gap-2 rounded-lg bg-[var(--background-deep)] px-2.5 text-[var(--text-weak)] shadow-[inset_0_0_0_1px_var(--border-weak-base)] transition-colors focus-within:bg-[var(--surface-base)]">
              <Icon
                name="search"
                size={14}
                class="transition-colors group-focus-within/device-search:text-[var(--text-interactive-base)]"
              />
              <span class="sr-only">Filter devices</span>
              <input
                ref={(element) => (searchInput = element)}
                class="min-w-0 flex-1 border-0 bg-transparent text-body text-[var(--text-strong)] outline-none placeholder:text-[var(--text-weak)]"
                data-focus-contained
                type="search"
                value={query()}
                placeholder="Search devices"
                onInput={(event) => setQuery(event.currentTarget.value)}
              />
            </label>
          </Show>
          <div class="min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5">
            <Show when={(props.targetSets?.length ?? 0) > 0}>
              <section class="mb-1 border-b border-[var(--border-weak-base)] pb-1">
                <span class="block px-2.5 pt-1 pb-1.5 text-micro font-semibold tracking-[0.08em] text-[var(--text-weak)] uppercase">
                  Target sets
                </span>
                <For each={props.targetSets}>
                  {(targetSet) => (
                    <button
                      type="button"
                      data-target-option
                      class={cn(
                        "flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left transition-colors hover:bg-[var(--surface-base-hover)]",
                        props.activeTargetSetId === targetSet.id &&
                          "bg-[var(--surface-base-hover)]",
                      )}
                      aria-current={props.activeTargetSetId === targetSet.id ? "true" : undefined}
                      onClick={() => {
                        closePicker(true);
                        props.onChooseTargetSet?.(targetSet.id);
                      }}
                    >
                      <span class="grid size-[22px] place-items-center text-[var(--text-weak)]">
                        <Icon name="grid" size={14} />
                      </span>
                      <span class="min-w-0 flex-1 truncate text-caption font-medium text-[var(--text-base)]">
                        {targetSet.name}
                      </span>
                      <span class="text-micro text-[var(--text-weak)]">Parallel</span>
                    </button>
                  )}
                </For>
              </section>
            </Show>
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
                      <span class="grid size-11 place-items-center rounded-xl bg-[var(--product-accent-soft)] text-[var(--text-interactive-base)]">
                        <Icon
                          name="refresh"
                          size={20}
                          class="ui-refresh-spin motion-reduce:opacity-70"
                        />
                      </span>
                      <strong class="mt-3 text-body font-semibold text-[var(--text-strong)]">
                        Looking for devices…
                      </strong>
                      <p class="mt-1 mb-0 max-w-[220px] text-caption/[1.5] text-[var(--text-weak)]">
                        Checking connected devices and simulators.
                      </p>
                    </div>
                  }
                >
                  <div class="flex flex-col items-center px-4 pt-7 pb-6 text-center">
                    <span class="grid size-11 place-items-center rounded-xl bg-[var(--product-accent-soft)] text-[var(--text-interactive-base)]">
                      <Icon name="smartphone" size={20} />
                    </span>
                    <strong class="mt-3 text-body font-semibold text-[var(--text-strong)]">
                      No devices found
                    </strong>
                    <p class="mt-1 mb-0 max-w-[240px] text-caption/[1.5] text-[var(--text-weak)]">
                      Plug in a phone over USB, start an iOS Simulator / Android emulator, or open
                      device setup for signing help.
                    </p>
                    <div class="mt-3 flex flex-wrap items-center justify-center gap-2">
                      <button
                        type="button"
                        class="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-[var(--product-accent-soft)] px-3 text-caption font-semibold text-[var(--text-interactive-base)] transition-colors hover:bg-[color-mix(in_srgb,var(--text-interactive-base)_18%,transparent)]"
                        onClick={() => {
                          setOpen(false);
                          props.workspaceController?.request({
                            kind: "settings.open",
                            section: "devices",
                          });
                        }}
                      >
                        Open device setup
                      </button>
                      <Show when={props.onManageTargets}>
                        <button
                          type="button"
                          class="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-caption font-medium text-[var(--text-base)] transition-colors hover:bg-[var(--surface-base-hover)] hover:text-[var(--text-strong)]"
                          onClick={() => {
                            setOpen(false);
                            props.onManageTargets?.();
                          }}
                        >
                          Browser targets
                        </button>
                      </Show>
                    </div>
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
                    onPick={() => selectTarget(group.item.serial)}
                  />
                )}
              </For>
              <For each={setupGroups()}>
                {(group) => (
                  <TargetRow
                    group={group}
                    selected={group.items.some((item) => item.serial === server.selectedDevice())}
                    onPick={() => selectTarget(group.item.serial)}
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
                  class="mt-0.5 flex min-h-10 w-full items-center justify-between gap-1.5 rounded-lg px-2.5 text-left text-caption font-medium text-[var(--text-base)] transition-colors hover:bg-[var(--surface-base-hover)] hover:text-[var(--text-strong)] active:scale-[0.99] motion-reduce:active:scale-100"
                  aria-expanded={virtualExpanded()}
                  onClick={() => setShowVirtualDevices((value) => !value)}
                >
                  <span>Virtual devices</span>
                  <span class="ml-auto tabular-nums text-micro text-[var(--text-weak)]">
                    {virtualGroups().length}
                  </span>
                  <Icon
                    name="chevron-down"
                    size={12}
                    class={cn(
                      "transition-transform duration-hover",
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
                  setupGroups().length === 0 &&
                  virtualGroups().length === 0
                }
              >
                <div class="px-4 py-6 text-center text-caption text-[var(--text-weak)]">
                  {query() ? `No devices match “${query()}”.` : "No devices available."}
                </div>
              </Show>
            </Show>
          </div>
          <Show when={props.onManageTargets}>
            <footer class="shrink-0 border-t border-[var(--border-weak-base)] p-1">
              <button
                type="button"
                class="flex min-h-10 w-full items-center gap-2 rounded-lg px-2.5 text-left text-caption font-medium text-[var(--text-base)] transition-colors hover:bg-[var(--surface-base-hover)] hover:text-[var(--text-strong)]"
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
  const physical = () =>
    props.group.item.platform !== "browser" &&
    !/simulator|emulator/i.test(String(props.group.item.kind ?? ""));
  const startable = () =>
    !available() && props.onStart && /simulator|emulator/i.test(target().kindLabel);
  const authorizable = () =>
    props.group.item.connectionState === "unauthorized" && Boolean(props.onAuthorize);
  const pickable = () => available() || physical() || authorizable();
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
        "hover:bg-[var(--surface-base-hover)] focus-within:bg-[var(--surface-base-hover)]",
        props.selected && "bg-[color-mix(in_srgb,var(--text-interactive-base)_7%,transparent)]",
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
        data-target-option={pickable() ? "" : undefined}
        aria-current={props.selected ? "true" : undefined}
        aria-label={`${target().displayName}, ${status()}`}
        disabled={!pickable()}
        class="min-w-0 truncate rounded text-left text-caption/[1.3] font-medium text-[var(--text-base)] enabled:cursor-pointer enabled:after:absolute enabled:after:inset-0 enabled:after:content-[''] enabled:hover:text-[var(--text-strong)] disabled:cursor-default focus-visible:outline-none"
        onClick={() => (authorizable() ? props.onAuthorize?.() : props.onPick())}
      >
        {target().displayName}
      </button>
      <span class="relative z-[1] flex items-center gap-1">
        <Show when={startable()}>
          <button
            type="button"
            class={cn(
              "rounded-md px-2 py-1 text-micro font-semibold text-[var(--text-interactive-base)] active:scale-[0.96] motion-reduce:active:scale-100",
              "shadow-[inset_0_0_0_1px_var(--border-weak-base)] transition-colors",
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
              "max-w-[112px] truncate text-micro text-[var(--text-weak)]",
              !available() && "text-[var(--icon-warning-base)]",
            )}
          >
            {status()}
          </small>
        </Show>
      </span>
    </div>
  );
}
