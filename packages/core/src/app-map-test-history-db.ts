import type { DatabaseSync } from "node:sqlite";
import type { AppMapTestMutationHistoryEntry } from "./app-map/test-history-model.js";

export function ensureAppMapTestHistorySchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_map_test_history (
      project_id TEXT NOT NULL,
      app_map_id TEXT NOT NULL,
      test_id TEXT NOT NULL,
      entry_index INTEGER NOT NULL CHECK (entry_index >= 1),
      event_id TEXT NOT NULL,
      before_revision INTEGER NOT NULL CHECK (before_revision >= 0),
      after_revision INTEGER NOT NULL CHECK (after_revision = before_revision + 1),
      before_document TEXT NOT NULL,
      after_document TEXT NOT NULL,
      touched TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (project_id, app_map_id, test_id, entry_index),
      UNIQUE (project_id, app_map_id, test_id, event_id)
    );
    CREATE TABLE IF NOT EXISTS app_map_test_history_state (
      project_id TEXT NOT NULL,
      app_map_id TEXT NOT NULL,
      test_id TEXT NOT NULL,
      cursor INTEGER NOT NULL CHECK (cursor >= 0),
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (project_id, app_map_id, test_id)
    );
    CREATE INDEX IF NOT EXISTS app_map_test_history_scope
      ON app_map_test_history(project_id, app_map_id, test_id, entry_index);
  `);
}

export function listAppMapTestHistoryRows(
  db: DatabaseSync,
  projectId: string,
  appMapId: string,
  testId: string,
): { cursor: number; entries: AppMapTestMutationHistoryEntry[] } {
  const rows = db
    .prepare(
      `SELECT entry_index, event_id, before_revision, after_revision,
              before_document, after_document, touched, created_at
       FROM app_map_test_history
       WHERE project_id = ? AND app_map_id = ? AND test_id = ?
       ORDER BY entry_index`,
    )
    .all(projectId, appMapId, testId) as Array<{
    entry_index: number;
    event_id: string;
    before_revision: number;
    after_revision: number;
    before_document: string;
    after_document: string;
    touched: string;
    created_at: number;
  }>;
  const state = db
    .prepare(
      `SELECT cursor FROM app_map_test_history_state
       WHERE project_id = ? AND app_map_id = ? AND test_id = ?`,
    )
    .get(projectId, appMapId, testId) as { cursor?: number } | undefined;
  const maxIndex = rows.at(-1)?.entry_index ?? 0;
  const cursor = state?.cursor === undefined ? maxIndex : Number(state.cursor);
  return {
    cursor,
    entries: rows.map((row) => ({
      index: Number(row.entry_index),
      eventId: row.event_id,
      beforeRevision: Number(row.before_revision),
      afterRevision: Number(row.after_revision),
      before: JSON.parse(row.before_document),
      after: JSON.parse(row.after_document),
      touched: JSON.parse(row.touched),
      at: Number(row.created_at),
    })),
  };
}

export function appendAppMapTestHistoryRow(
  db: DatabaseSync,
  projectId: string,
  appMapId: string,
  testId: string,
  input: Omit<AppMapTestMutationHistoryEntry, "index">,
): AppMapTestMutationHistoryEntry {
  const existing = listAppMapTestHistoryRows(db, projectId, appMapId, testId);
  const nextIndex = existing.cursor + 1;
  db.prepare(
    `DELETE FROM app_map_test_history
     WHERE project_id = ? AND app_map_id = ? AND test_id = ? AND entry_index > ?`,
  ).run(projectId, appMapId, testId, existing.cursor);
  db.prepare(
    `INSERT INTO app_map_test_history(
       project_id, app_map_id, test_id, entry_index, event_id,
       before_revision, after_revision, before_document, after_document, touched, created_at
     ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    projectId,
    appMapId,
    testId,
    nextIndex,
    input.eventId,
    input.beforeRevision,
    input.afterRevision,
    JSON.stringify(input.before),
    JSON.stringify(input.after),
    JSON.stringify(input.touched),
    input.at,
  );
  db.prepare(
    `INSERT INTO app_map_test_history_state(project_id, app_map_id, test_id, cursor, updated_at)
     VALUES(?, ?, ?, ?, ?)
     ON CONFLICT(project_id, app_map_id, test_id) DO UPDATE SET
       cursor = excluded.cursor,
       updated_at = excluded.updated_at`,
  ).run(projectId, appMapId, testId, nextIndex, input.at);
  return { ...input, index: nextIndex };
}

export function clearAppMapTestHistoryRedoRows(
  db: DatabaseSync,
  projectId: string,
  appMapId: string,
  testId: string,
): void {
  const state = listAppMapTestHistoryRows(db, projectId, appMapId, testId);
  if (state.entries.some((entry) => entry.index > state.cursor)) {
    db.prepare(
      `DELETE FROM app_map_test_history
       WHERE project_id = ? AND app_map_id = ? AND test_id = ? AND entry_index > ?`,
    ).run(projectId, appMapId, testId, state.cursor);
  }
}

export function deleteAppMapTestHistoryRows(
  db: DatabaseSync,
  projectId: string,
  appMapId: string,
): void {
  db.prepare("DELETE FROM app_map_test_history WHERE project_id = ? AND app_map_id = ?").run(
    projectId,
    appMapId,
  );
  db.prepare("DELETE FROM app_map_test_history_state WHERE project_id = ? AND app_map_id = ?").run(
    projectId,
    appMapId,
  );
}

export function setAppMapTestHistoryCursorRow(
  db: DatabaseSync,
  projectId: string,
  appMapId: string,
  testId: string,
  cursor: number,
  updatedAt: number,
): void {
  const state = listAppMapTestHistoryRows(db, projectId, appMapId, testId);
  if (cursor < 0 || cursor > state.entries.length) {
    throw new Error(`App Map Test history cursor ${cursor} is outside 0..${state.entries.length}`);
  }
  db.prepare(
    `INSERT INTO app_map_test_history_state(project_id, app_map_id, test_id, cursor, updated_at)
     VALUES(?, ?, ?, ?, ?)
     ON CONFLICT(project_id, app_map_id, test_id) DO UPDATE SET
       cursor = excluded.cursor,
       updated_at = excluded.updated_at`,
  ).run(projectId, appMapId, testId, cursor, updatedAt);
}
