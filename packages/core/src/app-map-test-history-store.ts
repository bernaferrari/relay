import type { DatabaseSync } from "node:sqlite";
import {
  appendAppMapTestHistoryRow,
  clearAppMapTestHistoryRedoRows,
  deleteAppMapTestHistoryRows,
  listAppMapTestHistoryRows,
  setAppMapTestHistoryCursorRow,
} from "./app-map-test-history-db.js";
import type {
  AppMapTestMutationHistory,
  AppMapTestMutationHistoryEntry,
} from "./app-map/test-history-model.js";

export type AppMapTestHistoryStore = {
  appMapTestHistory(projectId: string, appMapId: string, testId: string): AppMapTestMutationHistory;
  appendAppMapTestHistory(
    projectId: string,
    appMapId: string,
    testId: string,
    input: Omit<AppMapTestMutationHistoryEntry, "index">,
  ): AppMapTestMutationHistoryEntry;
  clearAppMapTestHistoryRedo(projectId: string, appMapId: string, testId: string): void;
  clearAppMapTestHistory(projectId: string, appMapId: string): void;
  setAppMapTestHistoryCursor(
    projectId: string,
    appMapId: string,
    testId: string,
    cursor: number,
    updatedAt: number,
  ): void;
};

export function createAppMapTestHistoryStore(db: DatabaseSync): AppMapTestHistoryStore {
  return {
    appMapTestHistory(projectId, appMapId, testId) {
      return listAppMapTestHistoryRows(db, projectId, appMapId, testId);
    },
    appendAppMapTestHistory(projectId, appMapId, testId, input) {
      return appendAppMapTestHistoryRow(db, projectId, appMapId, testId, input);
    },
    clearAppMapTestHistoryRedo(projectId, appMapId, testId) {
      clearAppMapTestHistoryRedoRows(db, projectId, appMapId, testId);
    },
    clearAppMapTestHistory(projectId, appMapId) {
      deleteAppMapTestHistoryRows(db, projectId, appMapId);
    },
    setAppMapTestHistoryCursor(projectId, appMapId, testId, cursor, updatedAt) {
      setAppMapTestHistoryCursorRow(db, projectId, appMapId, testId, cursor, updatedAt);
    },
  };
}
