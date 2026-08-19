import { For, Show, createMemo, createSignal } from "solid-js";
import type { AppMapVariable } from "@relay/protocol";
import { Button } from "@relay/ui/button";
import { combineValueLabel } from "../lib/app-map-combine-presentation";
import { cn } from "../lib/cn";
import { Icon } from "./icon";

/** Searchable value selection for one matrix Variable. Keeping this out of
 * AppMapCombine prevents a large locale set from turning the inspector into a
 * cloud of dozens of ambiguous chips. */
export function AppMapMatrixValuePicker(props: {
  variable: AppMapVariable;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const [query, setQuery] = createSignal("");
  const selected = createMemo(() => new Set(props.selectedIds));
  const filtered = createMemo(() => {
    const needle = query().trim().toLocaleLowerCase();
    if (!needle) return props.variable.options;
    return props.variable.options.filter((option) =>
      [option.id, option.label, option.text]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase().includes(needle)),
    );
  });

  function toggle(id: string): void {
    props.onChange(
      selected().has(id)
        ? props.selectedIds.filter((candidate) => candidate !== id)
        : [...props.selectedIds, id],
    );
  }

  return (
    <section
      class="grid gap-2 border-t border-[var(--border-weak-base)] px-2 py-2"
      aria-label={`${props.variable.name} values`}
    >
      <div class="flex items-center justify-between gap-2">
        <span class="text-micro tabular-nums text-[var(--text-weak)]">
          {props.selectedIds.length} selected · {props.variable.options.length} available
        </span>
        <div class="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            class="min-h-11 px-2 text-micro"
            disabled={props.selectedIds.length === props.variable.options.length}
            onClick={() => props.onChange(props.variable.options.map((option) => option.id))}
          >
            Select all
          </Button>
          <Button
            variant="ghost"
            size="sm"
            class="min-h-11 px-2 text-micro"
            disabled={props.selectedIds.length === 0}
            onClick={() => props.onChange([])}
          >
            Clear
          </Button>
        </div>
      </div>
      <label class="relative block">
        <span class="sr-only">Search {props.variable.name} values</span>
        <span class="pointer-events-none absolute inset-y-0 left-2.5 grid place-items-center text-[var(--text-weaker)]">
          <Icon name="search" size={12} />
        </span>
        <input
          type="search"
          class="h-11 w-full rounded-lg border border-[var(--border-weak-base)] bg-[var(--surface-raised-stronger-non-alpha)] pr-2.5 pl-8 text-body text-[var(--text-strong)] outline-none transition-[border-color,background-color] duration-hover placeholder:text-[var(--text-weaker)] hover:bg-[var(--surface-base-hover)] focus:border-[var(--border-strong-base)]"
          value={query()}
          placeholder="Search available values"
          onInput={(event) => setQuery(event.currentTarget.value)}
        />
      </label>
      <div
        class="grid max-h-56 grid-cols-1 gap-0.5 overflow-y-auto overscroll-contain sm:grid-cols-2"
        onWheel={(event) => event.stopPropagation()}
      >
        <For each={filtered()}>
          {(option) => {
            const checked = () => selected().has(option.id);
            return (
              <button
                type="button"
                class={cn(
                  "flex min-h-11 items-center gap-2 rounded-lg px-2 text-left transition-[background-color,color] duration-hover focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]",
                  checked()
                    ? "bg-[var(--product-accent-soft)] text-[var(--text-strong)]"
                    : "text-[var(--text-base)] hover:bg-[var(--surface-base-hover)]",
                )}
                aria-pressed={checked()}
                onClick={() => toggle(option.id)}
              >
                <span
                  class={cn(
                    "grid size-4 shrink-0 place-items-center rounded border",
                    checked()
                      ? "border-[var(--text-interactive-base)] bg-[var(--text-interactive-base)] text-[var(--button-primary-foreground,var(--icon-invert-base))]"
                      : "border-[var(--border-strong-base)]",
                  )}
                  aria-hidden="true"
                >
                  <Show when={checked()}>
                    <Icon name="check" size={9} />
                  </Show>
                </span>
                <span class="min-w-0 flex-1 truncate text-caption">
                  {combineValueLabel(option)}
                </span>
                <Show when={option.label && option.id !== option.label}>
                  <code class="truncate text-micro text-[var(--text-weaker)]">{option.id}</code>
                </Show>
              </button>
            );
          }}
        </For>
        <Show when={filtered().length === 0}>
          <p class="col-span-full m-0 px-3 py-5 text-center text-caption text-[var(--text-weak)]">
            No values match “{query()}”.
          </p>
        </Show>
      </div>
    </section>
  );
}
