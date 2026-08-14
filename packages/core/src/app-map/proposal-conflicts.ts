import type { ActivityEvent, AppMap, Proposal, ProposalChange } from "./model.js";

type EntityKind = "app-map" | "screen" | "connection" | "group" | "test";
type EntityKey = `${EntityKind}:${string}`;

function key(kind: EntityKind, id: string): EntityKey {
  return `${kind}:${id}`;
}

function testEditKeys(
  testId: string,
  edit: Extract<ProposalChange, { kind: "test.edit" }>["edits"][number],
): EntityKey[] {
  const testKey = key("test", testId);
  switch (edit.kind) {
    case "test.patch":
      return [`${testKey}:metadata`];
    case "step.add":
      return [
        `${testKey}:step:${edit.step.id}`,
        `${testKey}:siblings:${edit.placement?.parentStepId ?? "root"}:${edit.placement?.branch ?? "root"}`,
      ];
    case "step.remove":
      return [`${testKey}:step:${edit.stepId}`];
    case "step.reorder":
      return [
        `${testKey}:siblings:${edit.placement?.parentStepId ?? "root"}:${edit.placement?.branch ?? "root"}`,
      ];
    case "step.patch":
    case "step.bind":
    case "step.unbind":
      return [`${testKey}:step:${edit.stepId}`];
  }
}

export function scenarioTestEditEntityKeys(
  testId: string,
  edits: Extract<ProposalChange, { kind: "test.edit" }>["edits"],
): EntityKey[] {
  return [...new Set(edits.flatMap((edit) => testEditKeys(testId, edit)))].sort();
}

function touchedByChange(change: ProposalChange): EntityKey[] {
  switch (change.kind) {
    case "screen.add":
      return [key("screen", change.input.screen.id)];
    case "screen.update":
    case "screen.remove":
      return [key("screen", change.screenId)];
    case "connection.connect":
      return [key("connection", change.connection.id)];
    case "connection.update":
    case "connection.remove":
      return [key("connection", change.connectionId)];
    case "group.save":
      return [key("group", change.group.id)];
    case "group.remove":
      return [key("group", change.groupId)];
    case "test.edit":
      return scenarioTestEditEntityKeys(change.testId, change.edits);
  }
}

export function proposalEntityKeys(proposal: Pick<Proposal, "changes">): Set<EntityKey> {
  return new Set(proposal.changes.flatMap(touchedByChange));
}

function eventEntityKeys(map: AppMap, event: ActivityEvent): Set<EntityKey> {
  if (event.touched?.length) return new Set(event.touched as EntityKey[]);
  if (event.subject.kind === "app-map") return new Set([key("app-map", map.id)]);
  if (
    event.subject.kind === "screen" ||
    event.subject.kind === "connection" ||
    event.subject.kind === "group" ||
    event.subject.kind === "test"
  ) {
    return new Set([key(event.subject.kind, event.subject.id)]);
  }
  if (event.eventType === "proposal.approved") {
    const proposal = map.proposals[event.subject.id];
    if (proposal) return proposalEntityKeys(proposal);
  }
  return new Set();
}

/**
 * A proposal may move to the latest map revision when intervening work is
 * unrelated. This keeps parallel agents useful without hiding real conflicts.
 */
export function proposalConflictsSince(
  map: AppMap,
  proposal: Pick<Proposal, "changes">,
  revision: number,
): { conflict: boolean; subjects: string[] } {
  const proposed = proposalEntityKeys(proposal);
  const conflicts = new Set<string>();
  const overlaps = (left: EntityKey, right: EntityKey) =>
    left === right || left.startsWith(`${right}:`) || right.startsWith(`${left}:`);
  for (const event of Object.values(map.activity)) {
    if (event.afterRevision <= revision) continue;
    for (const touched of eventEntityKeys(map, event)) {
      if (
        touched.startsWith("app-map:") ||
        [...proposed].some((candidate) => overlaps(touched, candidate))
      ) {
        conflicts.add(touched);
      }
    }
  }
  return { conflict: conflicts.size > 0, subjects: [...conflicts].sort() };
}
