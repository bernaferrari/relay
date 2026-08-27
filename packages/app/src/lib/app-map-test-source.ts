import type { AppMap, AppMapScenarioTest } from "@relay/protocol";
import {
  applyIntentDocumentToScenarioTest,
  formatIntentDocumentYaml,
  intentDocumentFromScenarioTest,
  parseIntentDocumentYaml,
} from "@relay/workflows";

export type AppMapTestSourceProjection =
  | { kind: "ready"; source: string }
  | { kind: "unsupported"; message: string };

export type AppMapTestSourceApply =
  | { ok: true; test: AppMapScenarioTest }
  | { ok: false; message: string };

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A fail-closed projection over the same canonical Test. Unsupported steps
 * stay untouched in the advanced editor instead of being dropped from YAML. */
export function projectAppMapTestSource(
  map: AppMap,
  test: AppMapScenarioTest,
): AppMapTestSourceProjection {
  try {
    return {
      kind: "ready",
      source: formatIntentDocumentYaml(intentDocumentFromScenarioTest(map, test)),
    };
  } catch (error) {
    return { kind: "unsupported", message: messageFor(error) };
  }
}

/** Parse and bind source in memory before the Test document queues a save. No
 * caller can persist a partial parse or a document for another Test. */
export function applyAppMapTestSource(input: {
  map: AppMap;
  current: AppMapScenarioTest;
  source: string;
  updatedAt?: number;
}): AppMapTestSourceApply {
  try {
    const document = parseIntentDocumentYaml(input.source);
    return {
      ok: true,
      test: applyIntentDocumentToScenarioTest({
        map: input.map,
        current: input.current,
        document,
        updatedAt: input.updatedAt,
      }),
    };
  } catch (error) {
    return { ok: false, message: messageFor(error) };
  }
}
