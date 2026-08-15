import type { AppMap, AppMapTest } from "@relay/protocol";
import type { CombineTestColumn } from "./app-map-combine-presentation";

export type TestCandidate = CombineTestColumn & { source: "test"; test: AppMapTest };

export function savedTestId(candidate: TestCandidate): string {
  return candidate.test.id;
}

export function matrixId(variableIds: string[], testIds: string[]): string {
  const slug = [...variableIds, "to", ...testIds]
    .join("-")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return `matrix-${slug || "run"}`;
}

/** Run matrices select saved graph Tests only. Map flows and groups are map
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
