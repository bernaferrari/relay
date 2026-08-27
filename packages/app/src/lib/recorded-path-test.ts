import type { AppMap, AppMapScenarioTest } from "@relay/protocol";
import { createScenarioTest } from "./app-map-test-editor-model";

function screenTitle(map: AppMap, screenId: string): string {
  return map.screens[screenId]?.title.trim() || "saved screen";
}

/**
 * Turns the first reviewed recording into the smallest useful Test. The
 * connection remains canonical App Map truth; this Test only binds readable
 * intent to that reviewed path and asks the existing runner for evidence at
 * its destination.
 */
export function testFromRecordedPath(input: {
  map: AppMap;
  connectionId: string;
  testId?: string;
  stepId?: string;
  at?: number;
}): AppMapScenarioTest | undefined {
  const connection = input.map.connections[input.connectionId];
  if (!connection || connection.state !== "ready") return undefined;

  const source = screenTitle(input.map, connection.fromScreenId);
  const destination =
    connection.destination.kind === "screen"
      ? screenTitle(input.map, connection.destination.screenId)
      : "Finish";
  const name = connection.label?.trim() || `${source} to ${destination}`;
  const at = input.at ?? Date.now();

  return {
    ...createScenarioTest(input.map, name, input.testId, at),
    capture: { mode: "final-screen" },
    steps: [
      {
        id: input.stepId ?? crypto.randomUUID(),
        kind: "instruction",
        intent: `Go from ${source} to ${destination}`,
        capture: true,
        binding: {
          status: "resolved",
          kind: "connections",
          connectionIds: [connection.id],
        },
      },
    ],
  };
}
