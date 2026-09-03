import assert from "node:assert/strict";
import test from "node:test";
import { createStudioRunNavigation } from "./studio-run-navigation";

test("keeps the originating Run when opening its map clears the current selection", () => {
  let selectedRunId: string | null = "run-1";
  let area = "runs";
  const navigation = createStudioRunNavigation({
    currentRunId: () => selectedRunId,
    selectRun: (runId) => {
      selectedRunId = runId;
    },
    setArea: (next) => {
      area = next;
    },
    openMap: () => {
      selectedRunId = null;
      area = "maps";
    },
    openTest: () => undefined,
  });

  navigation.openMapFromRun("map-1");
  assert.equal(navigation.returnToRunId(), "run-1");
  navigation.backToRun("run-1");
  assert.equal(selectedRunId, "run-1");
  assert.equal(area, "runs");
});
