import type { AppMapScenarioTest } from "./model.js";

/** One server-owned reversible Test edit. The journal stores the resulting
 * domain snapshots, never UI commands or editor implementation details. */
export type AppMapTestMutationHistoryEntry = {
  index: number;
  eventId: string;
  beforeRevision: number;
  afterRevision: number;
  before: AppMapScenarioTest;
  after: AppMapScenarioTest;
  touched: string[];
  at: number;
};

export type AppMapTestMutationHistory = {
  cursor: number;
  entries: AppMapTestMutationHistoryEntry[];
};
