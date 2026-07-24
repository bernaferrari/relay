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
        {/* One line per action. The descriptions doubled every row's height
            for words nobody reads twice, and the search field is a sibling of
            the scroller so rows cannot slide under it. */}
        <div
          class="ui-pop absolute top-[calc(100%+4px)] right-0 z-30 flex max-h-[min(340px,calc(100vh-220px))] w-[224px] origin-top-right flex-col overflow-hidden rounded-lg border border-[var(--v2-border-border-strong)] bg-surface-raised-stronger-non-alpha shadow-[var(--v2-elevation-overlay)]"
          role="menu"
          aria-label="Change action"
        >
          <label class="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--v2-border-border-muted)] px-2.5 text-[var(--text-weak)]">
            <Icon name="search" size={12} />
            <input
              ref={(element) => {
                search = element;
              }}
              class="min-w-0 flex-1 bg-transparent text-[11.5px] text-[var(--text-strong)] outline-none placeholder:text-[var(--text-weak)]"
              value={query()}
              placeholder="Find an action"
              aria-label="Find an action"
              onInput={(event) => setQuery(event.currentTarget.value)}
            />
          </label>

          <div class="min-h-0 flex-1 overflow-y-auto p-1">
            <For each={groups()}>
              {(group) => (
                <section class="grid gap-px" role="group" aria-label={group.label}>
                  <span class="sticky top-0 z-[1] bg-surface-raised-stronger-non-alpha px-2 pt-2 pb-1 text-[9px] font-semibold tracking-[0.1em] text-[var(--text-weaker)] uppercase">
                    {group.label}
                  </span>
                  <For each={group.actions}>
                    {(action) => (
                      <button
                        type="button"
                        role="menuitemradio"
                        aria-checked={selected(action.kind)}
                        title={action.description}
                        class={cn(
                          "grid min-h-8 grid-cols-[18px_minmax(0,1fr)_14px] items-center gap-2 rounded-md px-2 text-left text-[11.5px] font-medium transition-colors duration-100",
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
                        <Icon name={action.icon} size={13} class="justify-self-center" />
                        <span class="truncate">{action.label}</span>
                        <Show when={selected(action.kind)}>
                          <Icon name="check" size={12} class="justify-self-end" />
                        </Show>
                      </button>
                    )}
                  </For>
                </section>
              )}
            </For>

            <Show when={groups().length === 0}>
              <p class="px-3 py-5 text-center text-[11px] text-[var(--text-weak)]">
                No matching action
              </p>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}
