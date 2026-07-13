import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { useServer } from "../context/server";
import { cn } from "../lib/cn";
import { Icon } from "./icon";
import { presentTarget, targetGroupMatchesQuery } from "../lib/target-presentation";
import { withRefreshFeedback } from "../lib/refresh-feedback";

export function DevicePicker() {
  let trigger: HTMLButtonElement | undefined;
  let dialog: HTMLDivElement | undefined;
  let searchInput: HTMLInputElement | undefined;
  const server = useServer();
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [detailsId, setDetailsId] = createSignal<string | null>(null);
  const [showUnavailable, setShowUnavailable] = createSignal(false);
  const [refreshing, setRefreshing] = createSignal(false);
  const device = () => server.devices().find((item) => item.serial === server.selectedDevice());
  const groupedDevices = createMemo(() => {
    const groups = new Map<string, ReturnType<typeof server.devices>>();
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
  const visibleDevices = createMemo(() => {
    const needle = query().trim().toLowerCase();
    if (needle)
      return groupedDevices().filter(({ items }) => targetGroupMatchesQuery(items, needle));
    if (showUnavailable()) return groupedDevices();
    return groupedDevices().filter(
      ({ item }) => item.booted !== false || item.serial === server.selectedDevice(),
    );
  });
  const hiddenCount = createMemo(() => groupedDevices().length - visibleDevices().length);

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
    setDetailsId(null);
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
    <div class="relay-device-picker" data-device-picker>
      <button
        ref={(element) => (trigger = element)}
        type="button"
        class={cn("relay-device-status", open() && "is-open")}
        aria-haspopup="dialog"
        aria-controls="target-picker-dialog"
        aria-expanded={open()}
        onClick={() => (open() ? closePicker() : setOpen(true))}
      >
        <span
          class={cn(
            "relay-health",
            server.health() === "online" &&
              device()?.booted !== false &&
              Boolean(device()) &&
              "is-online",
          )}
        />
        <span>
          {device()?.name ??
            (server.health() === "online" ? "No target" : "Connection unavailable")}
        </span>
        <Icon
          name="chevron-down"
          size={13}
          class={cn("relay-device-status__chevron", open() && "is-open")}
        />
      </button>
      <Show when={open()}>
        <div
          ref={(element) => (dialog = element)}
          id="target-picker-dialog"
          class="relay-device-menu"
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
          <div class="relay-device-menu__head">
            <span id="target-picker-title">Targets</span>
            <button
              type="button"
              disabled={refreshing()}
              aria-busy={refreshing()}
              onClick={() => void refreshTargets()}
            >
              <Icon
                name="refresh"
                size={13}
                class={refreshing() ? "relay-refresh-icon is-spinning" : "relay-refresh-icon"}
              />{" "}
              Refresh
            </button>
          </div>
          <Show when={server.devices().length > 8}>
            <label class="relay-device-menu__search">
              <Icon name="search" size={14} />
              <span class="sr-only">Search targets</span>
              <input
                ref={(element) => (searchInput = element)}
                type="search"
                value={query()}
                placeholder="Search targets"
                onInput={(event) => setQuery(event.currentTarget.value)}
              />
            </label>
          </Show>
          <Show
            when={server.devices().length > 0}
            fallback={
              <div class="relay-device-menu__empty">
                <span>
                  <Icon name="smartphone" size={18} />
                </span>
                <strong>No target available</strong>
                <p>Connect a device, or add a managed browser in Settings.</p>
              </div>
            }
          >
            <For each={visibleDevices()}>
              {({ item }) => {
                const target = () => presentTarget(item);
                return (
                  <div class="relative">
                    <button
                      type="button"
                      data-target-option
                      aria-current={item.serial === server.selectedDevice() ? "true" : undefined}
                      class={cn(
                        "m-0.5 grid min-h-12 w-[calc(100%-44px)] grid-cols-[28px_minmax(0,1fr)_14px] items-center gap-2 rounded-lg px-2 py-1 text-left transition-colors duration-100 hover:bg-surface-base-hover focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-border-strong-focus",
                        item.serial === server.selectedDevice() && "bg-surface-base-active",
                      )}
                      onClick={() => {
                        void server.setSelectedDevice(item.serial);
                        closePicker(true);
                      }}
                    >
                      <span class="grid size-7 place-items-center rounded-lg bg-surface-weak text-text-weak">
                        <Icon
                          name={item.platform === "browser" ? "server" : "smartphone"}
                          size={16}
                        />
                      </span>
                      <span class="min-w-0">
                        <span class="flex min-w-0 items-center gap-1.5">
                          <strong class="truncate text-[13px]/[1.25] font-[550] text-text-base">
                            {target().displayName}
                          </strong>
                          <Show when={item.booted === false}>
                            <b class="shrink-0 rounded-sm bg-surface-warning-base px-1.5 text-[9px]/4 font-bold text-text-on-warning-base">
                              Unavailable
                            </b>
                          </Show>
                        </span>
                        <small class="mt-0.5 block truncate text-[11px]/[1.25] text-text-weak">
                          {target().kindLabel}
                        </small>
                      </span>
                      <Show when={item.serial === server.selectedDevice()}>
                        <Icon name="check" size={15} />
                      </Show>
                    </button>
                    <button
                      type="button"
                      class="absolute top-1 right-0 grid size-10 place-items-center rounded-lg text-text-weaker transition-colors hover:bg-surface-base-hover hover:text-text-base focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-border-strong-focus"
                      aria-label={`Show details for ${target().displayName}`}
                      aria-expanded={detailsId() === item.serial}
                      onClick={() =>
                        setDetailsId((id) => (id === item.serial ? null : item.serial))
                      }
                    >
                      <Icon name="info" size={13} />
                    </button>
                    <Show when={detailsId() === item.serial}>
                      <dl class="mr-2 mb-2 ml-12 grid gap-2 rounded-lg border border-border-weak-base bg-background-base px-2.5 py-2">
                        <For each={target().details}>
                          {(detail) => (
                            <div class="grid grid-cols-[58px_minmax(0,1fr)] gap-2 text-[10px]/[1.25]">
                              <dt class="truncate text-text-weaker">{detail.label}</dt>
                              <dd class="m-0 truncate font-mono text-text-weak">{detail.value}</dd>
                            </div>
                          )}
                        </For>
                      </dl>
                    </Show>
                  </div>
                );
              }}
            </For>
            <Show when={visibleDevices().length === 0}>
              <div class="relay-device-menu__empty">
                {query() ? `No targets match “${query()}”.` : "No available targets."}
              </div>
            </Show>
            <Show when={!query() && hiddenCount() > 0}>
              <button
                type="button"
                class="relay-device-menu__unavailable"
                onClick={() => setShowUnavailable(true)}
              >
                Show {hiddenCount()} unavailable target{hiddenCount() === 1 ? "" : "s"}
              </button>
            </Show>
            <Show when={!query() && showUnavailable() && groupedDevices().length > 1}>
              <button
                type="button"
                class="relay-device-menu__unavailable"
                onClick={() => setShowUnavailable(false)}
              >
                Hide unavailable targets
              </button>
            </Show>
          </Show>
        </div>
      </Show>
    </div>
  );
}
