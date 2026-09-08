import { createHash } from "node:crypto";
import { APP_MAP_TEST_INTENT_SCHEMA_VERSION, type AppMapScenarioTest } from "@relay/protocol";
import type { AppMap, Connection } from "./model.js";
import { appMapFail } from "./errors.js";

function stepId(sessionId: string): string {
  return `step-${createHash("sha256").update(`${sessionId}:test`).digest("hex").slice(0, 16)}`;
}

/** Attach the smallest runnable Test to a Connection while both still live in
 * the draft of one atomic App Map mutation. */
export function attachRecordedTest(input: {
  map: AppMap;
  testId: string;
  testName: string;
  sessionId: string;
  connection: Connection;
  connections?: Connection[];
  sourceTitle: string;
  destinationTitle: string;
  at: number;
}): void {
  if (input.map.tests[input.testId]) {
    appMapFail("invalid-map", `Test ${input.testId} already exists`);
  }
  const scope = {
    organizationId: input.map.organizationId,
    projectId: input.map.projectId,
    appMapId: input.map.id,
  };
  const test: AppMapScenarioTest = {
    ...scope,
    id: input.testId,
    name: input.testName.trim(),
    kind: "scenario",
    intentSchemaVersion: APP_MAP_TEST_INTENT_SCHEMA_VERSION,
    capture: { mode: "final-screen" },
    steps: (input.connections ?? [input.connection]).map((connection, index) => ({
      id: stepId(`${input.sessionId}:${index}`),
      kind: "instruction",
      intent:
        connection.label ??
        `Go to ${connection.destination.kind === "screen" ? (input.map.screens[connection.destination.screenId]?.title ?? "screen") : "finish"}`,
      capture: true,
      binding: {
        status: "resolved",
        kind: "connections",
        connectionIds: [connection.id],
      },
    })),
    createdAt: input.at,
    updatedAt: input.at,
  };
  input.map.tests[test.id] = test;
}
