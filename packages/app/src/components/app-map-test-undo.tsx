import { Button } from "@relay/ui/button";

export function AppMapTestUndo(props: {
  message: string;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      class="mx-3 mt-3 flex min-h-11 items-center justify-between gap-3 rounded-lg border border-border-weak-base bg-surface-base px-3 py-2 text-[12px] text-text-strong shadow-sm"
      role="status"
      aria-live="polite"
    >
      <span class="min-w-0 truncate">{props.message}</span>
      <span class="flex shrink-0 items-center gap-1">
        <Button variant="secondary" size="sm" class="min-h-11" onClick={props.onUndo}>
          Undo
        </Button>
        <button
          type="button"
          class="min-h-11 min-w-11 rounded-lg text-text-weak transition-[background-color,color,transform] hover:bg-surface-base-hover hover:text-text-strong active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-border-strong-focus"
          aria-label="Dismiss undo"
          onClick={props.onDismiss}
        >
          ×
        </button>
      </span>
    </div>
  );
}
