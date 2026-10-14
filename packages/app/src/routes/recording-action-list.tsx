import type { ReviewAction } from "./recording-review-presentation";
import { RecordingActionIcon } from "./recording-action-icon";

/** Live steps use the same row as review and saved Tests: number, gesture, title. */
export function RecordingActionList({ actions }: { actions: readonly ReviewAction[] }) {
  return (
    <ol className="m-0 grid list-none divide-y divide-border p-0">
      {actions.map((recorded, index) => (
        <li
          className={`grid min-h-12 grid-cols-[20px_16px_minmax(0,1fr)] items-center gap-2.5 px-3 py-2.5 ${index === actions.length - 1 ? "animate-in fade-in slide-in-from-bottom-1 duration-300 motion-reduce:animate-none" : ""}`}
          key={recorded.id}
        >
          <span className="text-center text-xs tabular-nums text-muted-foreground">
            {index + 1}
          </span>
          <span
            className="flex justify-center text-muted-foreground [&_svg]:size-4"
            aria-hidden="true"
          >
            <RecordingActionIcon action={recorded} />
          </span>
          <span className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
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
