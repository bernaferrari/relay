import type { AppMapScenarioTest } from "./model.js";
import type {
  AppMapTestMutationHistory,
  AppMapTestMutationHistoryEntry,
} from "./test-history-model.js";
import type { ControlStore } from "../collaboration-store.js";

export function readAppMapTestMutationHistory(
  store: ControlStore,
  projectId: string,
  appMapId: string,
  testId: string,
): AppMapTestMutationHistory {
  return store.appMapTestHistory(projectId, appMapId, testId);
}

export function appendAppMapTestMutationHistory(
  store: ControlStore,
  projectId: string,
  appMapId: string,
  testId: string,
  input: Omit<AppMapTestMutationHistoryEntry, "index">,
): AppMapTestMutationHistoryEntry {
  return store.appendAppMapTestHistory(projectId, appMapId, testId, input);
}

export function setAppMapTestHistoryCursor(
  store: ControlStore,
  projectId: string,
  appMapId: string,
  testId: string,
  cursor: number,
  updatedAt: number,
): void {
  store.setAppMapTestHistoryCursor(projectId, appMapId, testId, cursor, updatedAt);
}

/** Test timestamps are audit metadata, not content identity. Restoring a
 * snapshot intentionally assigns a fresh updatedAt, so comparisons ignore it
 * while retaining every authored field and stable child id. */
export function sameAppMapTestContent(
  left: AppMapScenarioTest,
  right: AppMapScenarioTest,
): boolean {
  const normalized = (test: AppMapScenarioTest): AppMapScenarioTest => {
    const copy = structuredClone(test);
    copy.updatedAt = 0;
    return copy;
  };
  return JSON.stringify(normalized(left)) === JSON.stringify(normalized(right));
}
