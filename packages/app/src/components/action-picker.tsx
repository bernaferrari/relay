import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type { RecipeStep } from "../context/server";
import { cn } from "../lib/cn";
import { isTapAction, type EditableActionKind } from "../lib/journey-action-conversion";
import { actionLabelForKind, filterActionGroups } from "./action-catalog";
import { Icon } from "./icon";
import { iconForStep } from "./journey-step-presentation";

export function ActionPicker(props: {
  step: RecipeStep;
  onSelect: (kind: EditableActionKind) => void;
  onOpen?: () => void;
}) {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const groups = createMemo(() => filterActionGroups(query()));
  let root: HTMLDivElement | undefined;
  let search: HTMLInputElement | undefined;

  createEffect(() => {
    if (!open()) return;
    const close = (event: PointerEvent) => {
      if (!root?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close, true);
    onCleanup(() => window.removeEventListener("pointerdown", close, true));
  });

  const selected = (kind: EditableActionKind) =>
    kind === "tap" ? isTapAction(props.step) : props.step.kind === kind;

  return (
    <div
      ref={(element) => {
        root = element;
      }}
      class="relative min-w-0 flex-1"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open()) return;
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      }}
    >
      <button
        type="button"
        class="grid h-[30px] w-full min-w-0 grid-cols-[18px_minmax(0,1fr)_14px] items-center gap-1.5 rounded-l-[5px] px-2 text-left text-[11px] font-normal text-[var(--text-base)] transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-[var(--v2-background-bg-layer-02)] active:scale-[0.99]"
        aria-haspopup="menu"
        aria-expanded={open()}
        onClick={() => {
          props.onOpen?.();
          setOpen((value) => {
            if (value) setQuery("");
            else queueMicrotask(() => search?.focus());
            return !value;
          });
        }}
      >
        <Icon name={iconForStep(props.step)} size={12} />
        <span class="truncate">{actionLabelForKind(props.step.kind)}</span>
        <Icon name="chevron-down" size={11} />
      </button>

      <Show when={open()}>
        <div
          class="ui-pop absolute top-[calc(100%+4px)] right-0 z-30 grid max-h-[min(500px,calc(100vh-180px))] w-[252px] origin-top-right overflow-y-auto rounded-lg border border-[var(--v2-border-border-strong)] bg-surface-raised-stronger-non-alpha p-1 pt-0 shadow-[var(--v2-elevation-overlay)]"
          role="menu"
          aria-label="Change action"
        >
          <label class="sticky top-0 z-10 flex h-9 items-center gap-2 border-b border-[var(--v2-border-border-muted)] bg-surface-raised-stronger-non-alpha px-2">
            <Icon name="search" size={12} />
            <input
              ref={(element) => {
                search = element;
              }}
              class="min-w-0 flex-1 bg-transparent text-[11px] text-[var(--text-strong)] outline-none placeholder:text-[var(--text-weak)]"
              value={query()}
              placeholder="Find an action"
              aria-label="Find an action"
              onInput={(event) => setQuery(event.currentTarget.value)}
            />
          </label>

          <For each={groups()}>
            {(group, groupIndex) => (
              <section
                class={cn(
                  "grid gap-0.5 py-1",
                  groupIndex() > 0 && "border-t border-[var(--v2-border-border-muted)]",
                )}
                role="group"
                aria-label={group.label}
              >
                <span class="px-2 pt-1 pb-0.5 text-[8.5px] font-semibold tracking-[0.1em] text-[var(--text-weak)] uppercase">
                  {group.label}
                </span>
                <For each={group.actions}>
                  {(action) => (
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected(action.kind)}
                      class={cn(
                        "grid min-h-10 grid-cols-[22px_minmax(0,1fr)_16px] items-center gap-1.5 rounded-md px-2 py-1 text-left transition-[background-color,color,transform] duration-100 ease-out active:scale-[0.985]",
                        selected(action.kind)
                          ? "bg-[var(--product-accent-soft)] text-[var(--text-strong)]"
                          : "text-[var(--text-base)] hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--text-strong)]",
                      )}
                      onClick={() => {
                        props.onSelect(action.kind);
                        setOpen(false);
                        setQuery("");
                      }}
                    >
                      <span class="grid size-[22px] place-items-center rounded-md bg-[var(--v2-background-bg-layer-01)] text-[var(--text-weak)]">
                        <Icon name={action.icon} size={12} />
                      </span>
                      <span class="flex min-w-0 flex-col justify-center gap-0.5">
                        <strong class="block truncate text-[10.5px] leading-[1.15] font-medium">
                          {action.label}
                        </strong>
                        <small class="block truncate text-[8.5px] leading-[1.15] font-normal text-[var(--text-weak)]">
                          {action.description}
                        </small>
                      </span>
                      <Show when={selected(action.kind)}>
                        <Icon name="check" size={12} />
                      </Show>
                    </button>
                  )}
                </For>
              </section>
            )}
          </For>

          <Show when={groups().length === 0}>
            <span class="px-3 py-5 text-center text-[10.5px] text-[var(--text-weak)]">
              No matching action
            </span>
          </Show>
        </div>
      </Show>
    </div>
  );
}
