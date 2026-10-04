import { Button } from "@relay/ui-react/components/button";
import { ScrollArea } from "@relay/ui-react/components/scroll-area";
import { LoaderCircle } from "lucide-react";
import type { ComponentProps } from "react";
import type {
  RecordingInputOutcome,
  RecordingObservedEffect,
} from "../data/recording-input-outcome";
import { RecordingActionList } from "./recording-action-list";
import { RecordingInputRecovery } from "./recording-input-recovery";
import { RecordingProblem } from "./recording-shared";
import type { ReviewAction } from "./recording-review-presentation";

type RecordingRecovery = ComponentProps<typeof RecordingProblem>["recovery"];

export function RecordingTimelineSidebar({
  captureReady,
  recoveryKind,
  liveIssue,
  failure,
  liveInputBusy,
  canRecord,
  onObserve,
  onRefresh,
  recordingError,
  actionError,
  recovery,
  onRetry,
  retrying,
  checking,
  recordedActions,
}: {
  captureReady: boolean;
  recoveryKind: RecordingInputOutcome["kind"];
  liveIssue?: string;
  failure?: RecordingInputOutcome;
  liveInputBusy: boolean;
  canRecord: boolean;
  onObserve(observed: RecordingObservedEffect): Promise<void>;
  onRefresh(): void;
  recordingError?: unknown;
  actionError?: unknown;
  recovery?: RecordingRecovery;
  onRetry(): void;
  retrying: boolean;
  checking: boolean;
  recordedActions: readonly ReviewAction[];
}) {
  const hasRecovery = recoveryKind === "unknown" || recoveryKind === "refresh-failed";

  return (
    <aside
      className="grid h-full min-h-0 min-w-0 grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden"
      aria-labelledby="capture-timeline-title"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-1 pb-2">
        <h2 id="capture-timeline-title" className="text-sm font-medium">
          Recorded steps
          {liveInputBusy ? (
            <LoaderCircle
              className="ms-2 inline size-3.5 animate-spin text-muted-foreground motion-reduce:animate-none"
              aria-label="Saving step"
            />
          ) : null}
        </h2>
        <span className="text-xs tabular-nums text-muted-foreground">{recordedActions.length}</span>
      </div>
      <div>
        {captureReady && hasRecovery ? (
          <div className="m-3 grid gap-3" aria-label="Recording controls">
            {recoveryKind === "unknown" ? (
              <RecordingInputRecovery
                issue={liveIssue}
                failure={failure}
                busy={liveInputBusy || !canRecord}
                onObserve={onObserve}
              />
            ) : null}
            {recoveryKind === "refresh-failed" ? (
              <Button variant="outline" disabled={liveInputBusy} onClick={onRefresh}>
                Refresh recording
              </Button>
            ) : null}
          </div>
        ) : null}
        {recordingError || actionError || recovery ? (
          <RecordingProblem
            operation="recording"
            className="m-3"
            error={recordingError ?? actionError}
            recovery={recovery}
            onRetry={onRetry}
            retrying={retrying}
            checking={checking}
          />
        ) : (
          <span />
        )}
      </div>
      {recordedActions.length ? (
        <ScrollArea className="min-h-0">
          <RecordingActionList actions={recordedActions} />
        </ScrollArea>
      ) : (
        <div className="grid min-h-44 place-items-center px-4 text-center text-sm text-muted-foreground">
          <p>{captureReady ? "Taps and typing appear here." : "No recorded steps yet."}</p>
        </div>
      )}
    </aside>
  );
}
