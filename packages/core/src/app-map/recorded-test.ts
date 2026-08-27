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
  sessionId: string;
  connection: Connection;
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
    name: input.connection.label?.trim() || `${input.sourceTitle} to ${input.destinationTitle}`,
    kind: "scenario",
    intentSchemaVersion: APP_MAP_TEST_INTENT_SCHEMA_VERSION,
    capture: { mode: "final-screen" },
    steps: [
      {
        id: stepId(input.sessionId),
        kind: "instruction",
        intent: `Go from ${input.sourceTitle} to ${input.destinationTitle}`,
        capture: true,
        binding: {
          status: "resolved",
          kind: "connections",
          connectionIds: [input.connection.id],
        },
      },
    ],
    createdAt: input.at,
    updatedAt: input.at,
  };
  input.map.tests[test.id] = test;
}
