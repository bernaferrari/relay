import { createSignal, type Accessor } from "solid-js";
import type { MapLibraryArea } from "./map-library-area";

export function createStudioRunNavigation(input: {
  currentRunId: Accessor<string | null>;
  selectRun: (runId: string) => void;
  setArea: (area: MapLibraryArea) => void;
  openMap: (id: string) => void;
  openTest: (id: string) => void;
}) {
  const [returnToRunId, setReturnToRunId] = createSignal<string | null>(null);
  const openFromRun = (open: (id: string) => void, id: string) => {
    const runId = input.currentRunId();
    open(id);
    setReturnToRunId(runId);
  };
  return {
    returnToRunId,
    clearReturn: () => setReturnToRunId(null),
    openMapFromRun: (id: string) => openFromRun(input.openMap, id),
    openTestFromRun: (id: string) => openFromRun(input.openTest, id),
    backToRun: (runId: string) => {
      input.selectRun(runId);
      setReturnToRunId(null);
      input.setArea("runs");
    },
  };
}
