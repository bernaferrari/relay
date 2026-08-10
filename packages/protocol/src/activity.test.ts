import assert from "node:assert/strict";
import test from "node:test";
import { parseActivityExportResponse } from "./activity.js";

const record = {
  schemaVersion: 1,
  activityId: "10ab398c-82ea-4c49-a556-7c068ce13175",
  actorId: "agent:reviewer",
  actorKind: "agent",
  organizationId: "acme",
  projectId: "mobile",
  operationId: "app-map.update",
  requestId: "request-1",
  timestamp: 100,
  eventType: "operation.succeeded",
  resourceKind: "app-map",
  resourceId: "settings",
  summary: "Update map succeeded",
  outcome: "succeeded",
  durationMs: 12,
  statusCode: 200,
};

const response = {
  export: {
    manifest: {
      schemaVersion: 1,
      generatedAt: 200,
      organizationId: "acme",
      projectId: "mobile",
      recordCount: 1,
      firstTimestamp: 100,
      lastTimestamp: 100,
      sha256: "a".repeat(64),
    },
    records: [record],
  },
};

test("activity exports enforce manifest scope and record count", () => {
  assert.equal(parseActivityExportResponse(response).export.records[0]?.outcome, "succeeded");
  assert.throws(
    () =>
      parseActivityExportResponse({
        ...response,
        export: { ...response.export, manifest: { ...response.export.manifest, recordCount: 2 } },
      }),
    /recordCount/,
  );
  assert.throws(
    () =>
      parseActivityExportResponse({
        ...response,
        export: {
          ...response.export,
          records: [{ ...record, projectId: "other" }],
        },
      }),
    /scope/,
  );
  assert.throws(
    () =>
      parseActivityExportResponse({
        ...response,
        export: {
          ...response.export,
          records: [{ ...record, statusCode: 42 }],
        },
      }),
    /statusCode/,
  );
});
