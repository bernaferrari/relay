import { RecordingActionIcon } from "./recording-action-icon";
import type { ReviewAction } from "./recording-review-presentation";
export function RecordingActionList({ actions }: { actions: readonly ReviewAction[] }) {
  return (
    <ol className="grid list-none gap-0.5 p-2">
      {actions.map((recorded, index) => (
        <li className="flex items-center gap-2 rounded-md px-2 py-2" key={recorded.id}>
          <span className="grid size-6 shrink-0 place-items-center rounded-md bg-muted text-xs tabular-nums text-muted-foreground">
            {index + 1}
          </span>
          <RecordingActionIcon action={recorded} />
          <span className="grid min-w-0 gap-0.5">
            <strong className="break-words text-sm font-medium leading-snug">
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
