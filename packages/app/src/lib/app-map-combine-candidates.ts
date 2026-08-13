import type { AppMap, AppMapTest, Flow, MapGroup } from "@relay/protocol";
import type { CombineTestColumn } from "./app-map-combine-presentation";

export type TestCandidate = CombineTestColumn &
  (
    | { source: "test"; test: AppMapTest }
    | { source: "flow"; flow: Flow }
    | { source: "group"; group: MapGroup }
  );

export function savedTestId(candidate: TestCandidate): string {
  return candidate.source === "test"
    ? candidate.test.id
    : candidate.source === "flow"
      ? `flow-${candidate.flow.id}`
      : `group-${candidate.group.id}`;
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

export function testCandidates(map: AppMap): TestCandidate[] {
  const candidates: TestCandidate[] = Object.values(map.tests ?? {}).map((test) => ({
    id: test.id,
    name: test.name,
    kind: test.kind,
    source: "test",
    test,
    screenCount: test.kind === "tour" ? test.screenIds?.length : undefined,
  }));
  const referencedFlows = new Set(
    candidates.flatMap((candidate) =>
      candidate.source === "test" && candidate.test.kind === "path" && candidate.test.flowId
        ? [candidate.test.flowId]
        : [],
    ),
  );
  for (const flow of Object.values(map.flows ?? {})) {
    if (!flow.connectionIds.length || referencedFlows.has(flow.id)) continue;
    candidates.push({ id: flow.id, name: flow.name, kind: "path", source: "flow", flow });
  }
  for (const group of Object.values(map.groups ?? {})) {
    if (!group.screenIds.length) continue;
    candidates.push({
      id: group.id,
      name: group.name,
      kind: "tour",
      source: "group",
      group,
      screenCount: group.screenIds.length,
    });
  }
  return candidates;
}

export function tourRootScreenId(map: AppMap, candidate: TestCandidate): string | undefined {
  if (candidate.source !== "group") return undefined;
  return [...candidate.group.screenIds].sort((left, right) => {
    const outgoing = (screenId: string) =>
      Object.values(map.connections).filter(
        (connection) =>
          connection.fromScreenId === screenId &&
          connection.destination.kind === "screen" &&
          candidate.group.screenIds.includes(connection.destination.screenId),
      ).length;
    return outgoing(right) - outgoing(left);
  })[0];
}
