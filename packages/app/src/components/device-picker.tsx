import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { useServer, type DeviceInfo } from "../context/server";
import { cn } from "../lib/cn";
import { Icon } from "./icon";
import { presentTarget, targetGroupMatchesQuery } from "../lib/target-presentation";
import { withRefreshFeedback } from "../lib/refresh-feedback";

type TargetGroup = { items: DeviceInfo[]; item: DeviceInfo; count: number };

export function DevicePicker(props: { onManageTargets?: () => void }) {
  let trigger: HTMLButtonElement | undefined;
  let dialog: HTMLDivElement | undefined;
  let searchInput: HTMLInputElement | undefined;
  const server = useServer();
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [showUnavailable, setShowUnavailable] = createSignal(false);
  const [refreshing, setRefreshing] = createSignal(false);
  const device = () => server.devices().find((item) => item.serial === server.selectedDevice());
  const online = () => server.health() === "online";
  const ready = () => online() && device()?.booted !== false && Boolean(device());
  const groupedDevices = createMemo<TargetGroup[]>(() => {
    const groups = new Map<string, DeviceInfo[]>();
    for (const item of server.devices()) {
      const target = presentTarget(item);
      const key = `${target.group}:${target.displayName}:${target.kindLabel}`.toLowerCase();
      const existing = groups.get(key) ?? [];
      groups.set(key, [...existing, item]);
    }
    return [...groups.values()].map((items) => ({
      items,
      item:
        items.find((candidate) => candidate.serial === server.selectedDevice()) ??
        items.find((candidate) => candidate.booted !== false) ??
        items[0]!,
      count: items.length,
    }));
  });
  const matchesQuery = (group: TargetGroup) => {
    const needle = query().trim().toLowerCase();
    return !needle || targetGroupMatchesQuery(group.items, needle);
  };
  const readyGroups = createMemo(() =>
    groupedDevices().filter(
      (group) =>
        matchesQuery(group) &&
        (group.item.booted !== false || group.item.serial === server.selectedDevice()),
    ),
  );
  const unavailableGroups = createMemo(() =>
    groupedDevices().filter(
      (group) =>
        matchesQuery(group) &&
        group.item.booted === false &&
        group.item.serial !== server.selectedDevice(),
    ),
  );
  const unavailableExpanded = () => showUnavailable() || query().trim().length > 0;

  async function refreshTargets(): Promise<void> {
    if (refreshing()) return;
    setRefreshing(true);
    try {
      await withRefreshFeedback(() => server.refreshDevices());
    } finally {
      setRefreshing(false);
    }
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
    document.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    onCleanup(() => {
      document.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    });
  });

  return (
    <div class="relative z-30" data-device-picker>
      <button
        ref={(element) => (trigger = element)}
        type="button"
        class={cn(
          "inline-flex h-[34px] cursor-pointer items-center gap-2 rounded-[9px] px-2.5 text-[13px] font-medium text-[var(--relay-text-secondary)] transition-colors",
          "shadow-[inset_0_0_0_1px_var(--relay-line)]",
          "hover:bg-[var(--relay-surface-strong)] hover:text-[var(--relay-text)]",
          "focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--relay-line-strong)]",
          open() && "bg-[var(--relay-surface-strong)] text-[var(--relay-text)]",
        )}
        aria-haspopup="dialog"
        aria-controls="target-picker-dialog"
        aria-expanded={open()}
        onClick={() => (open() ? closePicker() : setOpen(true))}
      >
        <span
          class={cn(
            "inline-block size-1.5 shrink-0 rounded-full",
            ready()
              ? "bg-[var(--relay-green)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--relay-green)_20%,transparent)]"
              : "bg-[var(--relay-amber)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--relay-amber)_18%,transparent)]",
          )}
        />
        <span class="max-w-[180px] truncate">
          {device()?.name ?? (online() ? "No target" : "Connection unavailable")}
        </span>
        <Icon
          name="chevron-down"
          size={13}
          class={cn(
            "ml-px text-[var(--relay-text-tertiary)] transition-transform duration-150",
            open() && "rotate-180",
          )}
        />
      </button>
      <Show when={open()}>
        <div
          ref={(element) => (dialog = element)}
          id="target-picker-dialog"
          class="ui-pop absolute top-[calc(100%+8px)] right-0 z-40 flex max-h-[min(600px,calc(100vh-82px))] w-[340px] origin-top-right flex-col overflow-hidden rounded-[14px] border border-[var(--relay-line-strong)] bg-surface-raised-stronger-non-alpha text-[var(--relay-text)] shadow-[var(--v2-elevation-overlay)]"
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
          <header class="flex shrink-0 items-center justify-between gap-2 px-4 pt-3.5 pb-2.5">
            <span
              id="target-picker-title"
              class="text-[11px] font-semibold tracking-[0.09em] text-[var(--relay-text-tertiary)] uppercase"
            >
              Switch target
            </span>
            <button
              type="button"
              class="grid size-7 shrink-0 place-items-center rounded-md text-[var(--relay-text-tertiary)] transition-colors hover:bg-[var(--relay-surface-strong)] hover:text-[var(--relay-text)]"
              disabled={refreshing()}
              aria-busy={refreshing()}
              aria-label="Refresh targets"
              title="Refresh targets"
              onClick={() => void refreshTargets()}
            >
              <Icon
                name="refresh"
                size={13}
                class={cn(
                  refreshing() &&
                    "origin-center animate-spin motion-reduce:animate-none motion-reduce:opacity-70",
                )}
              />
            </button>
          </header>
          <Show when={server.devices().length > 0}>
            <label class="mx-3 mb-2 flex h-9 shrink-0 items-center gap-2 rounded-[10px] bg-[var(--relay-bg)] px-2.5 text-[var(--relay-text-tertiary)] shadow-[inset_0_0_0_1px_var(--relay-line)] focus-within:shadow-[inset_0_0_0_1px_var(--text-interactive-base)]">
              <Icon name="search" size={14} />
              <span class="sr-only">Filter targets</span>
              <input
                ref={(element) => (searchInput = element)}
                class="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-[var(--relay-text)] outline-none placeholder:text-[var(--relay-text-tertiary)]"
                type="search"
                value={query()}
                placeholder="Search devices and browsers"
                onInput={(event) => setQuery(event.currentTarget.value)}
              />
            </label>
          </Show>
          <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            <Show
              when={server.devices().length > 0}
              fallback={
                <div class="flex flex-col items-center px-4 pt-7 pb-6 text-center">
                  <span class="grid size-11 place-items-center rounded-[12px] bg-[var(--relay-accent-soft)] text-[var(--text-interactive-base)]">
                    <Icon name="smartphone" size={20} />
                  </span>
                  <strong class="mt-3 text-[13px] font-semibold text-[var(--relay-text)]">
                    No target available
                  </strong>
                  <p class="mt-1 mb-0 max-w-[220px] text-[11.5px]/[1.5] text-[var(--relay-text-tertiary)]">
                    Connect a device over USB or Wi-Fi, or add a managed browser.
                  </p>
                </div>
              }
            >
              <Show when={readyGroups().length > 0}>
                <div class="px-2 pt-1.5 pb-1 text-[10px] font-semibold tracking-[0.08em] text-[var(--relay-text-tertiary)] uppercase">
                  Ready
                </div>
                <For each={readyGroups()}>
                  {(group) => (
                    <TargetRow
                      group={group}
                      selected={group.item.serial === server.selectedDevice()}
                      onPick={() => {
                        void server.setSelectedDevice(group.item.serial);
                        closePicker(true);
                      }}
                    />
                  )}
                </For>
              </Show>
              <Show when={unavailableGroups().length > 0}>
                <button
                  type="button"
                  class="mt-1 flex min-h-8 w-full items-center justify-between gap-1.5 rounded-md px-2 text-left text-[10px] font-semibold tracking-[0.08em] text-[var(--relay-text-tertiary)] uppercase transition-colors hover:bg-[var(--relay-surface-strong)] hover:text-[var(--relay-text-secondary)]"
                  aria-expanded={unavailableExpanded()}
                  onClick={() => setShowUnavailable((value) => !value)}
                >
                  <span>Unavailable · {unavailableGroups().length}</span>
                  <Icon
                    name="chevron-down"
                    size={12}
                    class={cn(
                      "transition-transform duration-150",
                      !unavailableExpanded() && "-rotate-90",
                    )}
                  />
                </button>
                <Show when={unavailableExpanded()}>
                  <For each={unavailableGroups()}>
                    {(group) => (
                      <TargetRow
                        group={group}
                        selected={false}
                        onPick={() => {
                          void server.setSelectedDevice(group.item.serial);
                          closePicker(true);
                        }}
                      />
                    )}
                  </For>
                </Show>
              </Show>
              <Show when={readyGroups().length === 0 && unavailableGroups().length === 0}>
                <div class="px-4 py-6 text-center text-[12px] text-[var(--relay-text-tertiary)]">
                  {query() ? `No targets match “${query()}”.` : "No available targets."}
                </div>
              </Show>
            </Show>
          </div>
          <Show when={props.onManageTargets}>
            <footer class="shrink-0 border-t border-[var(--relay-line)] p-1.5">
              <button
                type="button"
                class="flex min-h-9 w-full items-center gap-2 rounded-[9px] px-2.5 text-left text-[12.5px] font-medium text-[var(--relay-text-secondary)] transition-colors hover:bg-[var(--relay-surface-strong)] hover:text-[var(--relay-text)]"
                onClick={() => {
                  closePicker();
                  props.onManageTargets!();
                }}
              >
                <Icon name="sliders" size={14} />
                Manage targets…
              </button>
            </footer>
          </Show>
        </div>
      </Show>
    </div>
  );
}

function TargetRow(props: { group: TargetGroup; selected: boolean; onPick: () => void }) {
  const target = () => presentTarget(props.group.item);
  const available = () => props.group.item.booted !== false;
  return (
    <button
      type="button"
      data-target-option
      aria-current={props.selected ? "true" : undefined}
      class={cn(
        "grid min-h-12 w-full grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left transition-colors",
        "hover:bg-[var(--relay-surface-strong)]",
        "focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-[var(--relay-line-strong)]",
        props.selected &&
          "bg-[color-mix(in_srgb,var(--relay-accent)_14%,transparent)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--relay-accent)_38%,transparent)] hover:bg-[color-mix(in_srgb,var(--relay-accent)_18%,transparent)]",
      )}
      onClick={props.onPick}
    >
      <span
        class={cn(
          "grid size-9 place-items-center rounded-[10px] bg-[var(--relay-surface-raised)] text-[var(--relay-text-secondary)] shadow-[inset_0_0_0_1px_var(--relay-line)]",
          props.selected && "bg-[var(--relay-accent-soft)] text-[var(--text-interactive-base)]",
        )}
        aria-hidden="true"
      >
        <Icon name={props.group.item.platform === "browser" ? "server" : "smartphone"} size={17} />
      </span>
      <span class="min-w-0">
        <strong
          class={cn(
            "block truncate text-[13px]/[1.3] font-medium",
            props.selected ? "text-[var(--relay-text)]" : "text-[var(--relay-text-secondary)]",
          )}
        >
          {target().displayName}
        </strong>
        <small class="mt-px flex items-center gap-1.5 text-[11px]/[1.3] text-[var(--relay-text-tertiary)]">
          <i
            class={cn(
              "size-1.5 shrink-0 rounded-full",
              available() ? "bg-[var(--relay-green)]" : "bg-[var(--relay-amber)]",
            )}
          />
          {target().kindLabel}
          {props.group.count > 1 ? ` · ${props.group.count} instances` : ""}
          {available() ? "" : " · needs start"}
        </small>
      </span>
      <Show when={props.selected}>
        <span class="grid size-5 place-items-center rounded-full bg-[var(--relay-accent)] text-white">
          <Icon name="check" size={12} strokeWidth={3} />
        </span>
      </Show>
    </button>
  );
}
