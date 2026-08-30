import { cn } from "../lib/cn";
import { testEditorHint } from "../lib/app-map-test-editor-styles";
import { Icon } from "./icon";

export function AppMapTestVariableEmptyState(props: { onCreate?: () => void }) {
  return (
    <button
      type="button"
      class={cn(
        "group flex min-h-20 w-full items-center gap-3 rounded-xl bg-[var(--map-control-surface)] px-4 py-3 text-left shadow-[var(--map-elevation-control)]",
        "transition-[background-color,box-shadow,transform] duration-hover hover:bg-surface-base-hover hover:shadow-[var(--map-elevation-card)] active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-strong-focus",
        "disabled:cursor-default disabled:text-text-weak disabled:shadow-none disabled:hover:bg-[var(--map-control-surface)]",
      )}
      data-app-map-test-combine-strip
      disabled={!props.onCreate}
      onClick={() => props.onCreate?.()}
    >
      <span class="grid size-10 shrink-0 place-items-center rounded-lg bg-surface-base text-text-interactive-base shadow-[var(--map-elevation-chip)]">
        <Icon name="grid" size={16} />
      </span>
      <span class="grid min-w-0 flex-1 gap-1">
        <strong class="text-caption font-semibold text-text-strong">Repeat this Test</strong>
        <span class={cn(testEditorHint, "m-0")}>
          Add a Variable such as Language, Theme, or Account.
        </span>
      </span>
      <span class="flex shrink-0 items-center gap-1 text-caption font-semibold text-text-interactive-base">
        <span class="max-[520px]:hidden">Add</span>
        <Icon name="chevron-right" size={16} />
      </span>
    </button>
  );
}
