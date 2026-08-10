import { For, createEffect, onCleanup } from "solid-js";
import { trapFocus } from "../lib/modal";
import { Icon } from "./icon";

export function KeyboardConnectionChooser(props: {
  sourceTitle: string;
  destinations: Array<{ id: string; title: string }>;
  onChoose: (id: string) => void;
  onCreate: () => void;
  onCancel: () => void;
}) {
  let panel: HTMLElement | undefined;
  createEffect(() => {
    if (!panel) return;
    onCleanup(trapFocus(panel));
  });
  return (
    <aside
      ref={(element) => (panel = element)}
      class="absolute bottom-[calc(76px+env(safe-area-inset-bottom))] left-1/2 z-40 w-[min(420px,calc(100%-32px))] -translate-x-1/2 rounded-[14px] bg-[color-mix(in_srgb,var(--background-base)_96%,transparent)] p-3 shadow-[0_0_0_1px_color-mix(in_srgb,var(--border-strong-base)_76%,transparent),0_18px_48px_rgb(0_0_0/34%)] backdrop-blur-[14px]"
      role="dialog"
      aria-modal="true"
      aria-label={`Path from ${props.sourceTitle}`}
      data-app-map-native-scroll
      onWheel={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        props.onCancel();
      }}
    >
      <div class="flex items-start justify-between gap-3 px-1">
        <div>
          <span class="block text-[9.5px] font-semibold tracking-[0.12em] text-[var(--text-weak)] uppercase">
            Path from
          </span>
          <strong class="mt-1 block text-[12px] font-semibold text-[var(--text-strong)]">
            {props.sourceTitle}
          </strong>
        </div>
        <button
          type="button"
          class="relative grid size-9 place-items-center rounded-[8px] text-[var(--text-weak)] before:absolute before:-inset-1 hover:bg-[var(--surface-base-hover)] hover:text-[var(--text-strong)]"
          aria-label="Cancel path"
          onClick={props.onCancel}
        >
          <Icon name="x" size={12} />
        </button>
      </div>
      <p class="m-0 mt-2 px-1 text-[10.5px]/[1.45] text-[var(--text-weak)]">
        Click a screen on the map, pick one below, or add a new screen. Esc cancels — nothing is
        saved until you choose.
      </p>
      <div class="mt-2 grid max-h-48 gap-1 overflow-y-auto">
        <button
          type="button"
          class="flex min-h-11 items-center gap-2 rounded-[9px] px-2.5 text-left text-[11px] font-medium text-[var(--text-interactive-base)] hover:bg-[var(--product-accent-soft)]"
          onClick={props.onCreate}
        >
          <span class="grid size-7 shrink-0 place-items-center rounded-[7px] bg-[var(--product-accent-soft)]">
            <Icon name="plus" size={12} />
          </span>
          Add a new screen
        </button>
        <For each={props.destinations}>
          {(destination) => (
            <button
              type="button"
              class="flex min-h-11 items-center gap-2 rounded-[9px] px-2.5 text-left text-[11px] text-[var(--text-base)] hover:bg-[var(--surface-base-hover)] hover:text-[var(--text-strong)]"
              onClick={() => props.onChoose(destination.id)}
            >
              <span class="grid size-7 shrink-0 place-items-center rounded-[7px] bg-[var(--product-accent-soft)] text-[var(--text-interactive-base)]">
                <Icon name="smartphone" size={12} />
              </span>
              <span class="min-w-0 flex-1 truncate">Connect to {destination.title}</span>
              <Icon name="arrow-right" size={11} />
            </button>
          )}
        </For>
      </div>
    </aside>
  );
}
