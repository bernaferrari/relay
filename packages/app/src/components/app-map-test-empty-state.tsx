import { EmptyState } from "./empty-state";

export function AppMapTestEmptyState(props: {
  hasTests: boolean;
  recordingAvailable: boolean;
  creating: boolean;
  onRecord?: () => void;
  onCreate: () => void;
}) {
  return (
    <div class="grid min-h-full place-items-center px-5 py-10">
      <EmptyState
        size="lg"
        icon="edit"
        title={props.hasTests ? "No Test open" : "No Tests yet"}
        description={
          props.hasTests
            ? "Pick one from the switcher to read its steps here, or start a new Test."
            : props.recordingAvailable
              ? "Use the app normally, add checkpoints, review the recording, then approve one replayable Test."
              : "A Test is what you run once — a path through this map, written as readable intent and bound to reviewed screens."
        }
        actionLabel={
          props.recordingAvailable ? "Record test" : props.creating ? "Creating…" : "Create Test"
        }
        onAction={props.onRecord ?? props.onCreate}
        secondaryLabel={props.recordingAvailable ? "Start a blank Test" : undefined}
        onSecondary={props.recordingAvailable ? props.onCreate : undefined}
      />
    </div>
  );
}
