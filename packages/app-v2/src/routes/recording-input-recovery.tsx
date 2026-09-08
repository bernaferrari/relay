import { Button } from "@relay/ui-react/components/button";
import type {
  RecordingInputOutcome,
  RecordingObservedEffect,
} from "../data/recording-input-outcome";
import { recordingInputRecoveryMessage } from "../data/recording-input-outcome";

export function RecordingInputRecovery({
  issue,
  failure,
  busy,
  onObserve,
}: {
  issue?: string;
  failure?: RecordingInputOutcome;
  busy: boolean;
  onObserve(observed: RecordingObservedEffect): Promise<void>;
}) {
  return (
    <div
      className="mr-auto grid w-full min-w-0 gap-3 rounded-md bg-amber-500/5 p-3"
      role="group"
      aria-label="Check the last interaction"
    >
      <p className="text-sm">
        {issue ?? recordingInputRecoveryMessage({ kind: "unknown", message: "" })}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void onObserve("applied")}
        >
          It applied
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void onObserve("not-observed")}
        >
          It did not apply
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Not sure? Keep it paused to avoid repeating the action.
      </p>
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">Technical details</summary>
        <p className="mt-2 break-words">
          {failure && "message" in failure
            ? failure.message
            : "No additional details were returned."}
        </p>
      </details>
    </div>
  );
}
