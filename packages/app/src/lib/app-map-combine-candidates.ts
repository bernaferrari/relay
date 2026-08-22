import { combineIdFor, type AppMap, type AppMapTest } from "@relay/protocol";
import type { CombineTestColumn } from "./app-map-combine-presentation";

export type TestCandidate = CombineTestColumn & { source: "test"; test: AppMapTest };

export function savedTestId(candidate: TestCandidate): string {
  return candidate.test.id;
}

export { combineIdFor };

/** Combines select saved graph Tests only. Map flows and groups are map
 * structure, never implicit Test-conversion candidates. */
export function testCandidates(map: AppMap): TestCandidate[] {
  return Object.values(map.tests ?? {}).map((test) => ({
    id: test.id,
    name: test.name,
    kind: "scenario",
    source: "test",
    test,
  }));
}
