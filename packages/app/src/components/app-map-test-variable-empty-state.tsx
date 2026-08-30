import { cn } from "../lib/cn";
import { testEditorHint } from "../lib/app-map-test-editor-styles";
import { Icon } from "./icon";

export function AppMapTestVariableEmptyState(props: { onCreate?: () => void }) {
  return (
    <button
      type="button"
      class={cn(
        "group flex min-h-20 w-full items-center gap-3 rounded-xl border border-border-weak-base bg-background-base px-4 py-3 text-left",
        "transition-[background-color,border-color] duration-hover hover:border-border-strong-base hover:bg-surface-base-hover motion-reduce:transition-none",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-strong-focus",
        "disabled:cursor-default disabled:hover:border-border-weak-base disabled:hover:bg-background-base",
      )}
      data-app-map-test-combine-strip
      disabled={!props.onCreate}
      onClick={() => props.onCreate?.()}
    >
      <span class="grid size-10 shrink-0 place-items-center rounded-lg bg-surface-base text-text-interactive-base">
        <Icon name="grid" size={16} />
      </span>
      <span class="grid min-w-0 flex-1 gap-0.5">
        <span class="text-micro font-semibold tracking-[0.06em] text-text-weaker uppercase">
          Repeat this Test
        </span>
        <strong class="text-caption font-semibold text-text-strong">Add a Variable</strong>
        <span class={cn(testEditorHint, "m-0")}>Language, Theme, Account, or another value.</span>
      </span>
      <Icon
        name="chevron-right"
        size={16}
        class="shrink-0 text-text-weaker group-hover:text-text-strong"
      />
    </button>
  );
}
