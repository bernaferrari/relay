import type { ReviewAction } from "./recording-review-presentation";
export function RecordingActionList({ actions }: { actions: readonly ReviewAction[] }) {
  return (
    <ol className="m-0 list-none divide-y divide-border/50 px-1">
      {actions.map((recorded, index) => (
        <li className="flex min-h-11 items-center gap-3 py-2.5" key={recorded.id}>
          <span className="w-5 shrink-0 text-center text-xs tabular-nums text-muted-foreground/70">
            {index + 1}
          </span>
          <span className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <strong className="min-w-0 break-words text-sm font-medium leading-snug">
              {recorded.label ?? recorded.intent}
            </strong>
            {recorded.stepCount === 0 ? (
              <small className="text-xs text-muted-foreground">Screen capture</small>
            ) : null}
          </span>
        </li>
      ))}
    </ol>
  );
}
