import { createEffect, type Accessor, type Setter } from "solid-js";
import type { RecordingTake } from "../context/recorder-projection";

export function useRecordingActionSelection(input: {
  take: Accessor<RecordingTake | null>;
  selectedActionId: Accessor<string | undefined>;
  setSelectedActionId: Setter<string | undefined>;
}): void {
  createEffect(() => {
    const take = input.take();
    if (take?.state !== "review") return input.setSelectedActionId(undefined);
    const selected = input.selectedActionId();
    if (!selected || !take.actions.some((action) => action.id === selected)) {
      input.setSelectedActionId(take.actions[0]?.id);
    }
  });
}
