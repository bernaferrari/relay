import type { ActivityEvent, AppMap, Proposal, ProposalChange } from "./model.js";

type EntityKey = `${"app-map" | "screen" | "connection" | "group"}:${string}`;

function key(kind: "app-map" | "screen" | "connection" | "group", id: string): EntityKey {
  return `${kind}:${id}`;
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
  }
}

export function proposalEntityKeys(proposal: Pick<Proposal, "changes">): Set<EntityKey> {
  return new Set(proposal.changes.flatMap(touchedByChange));
}

function eventEntityKeys(map: AppMap, event: ActivityEvent): Set<EntityKey> {
  if (event.subject.kind === "app-map") return new Set([key("app-map", map.id)]);
  if (
    event.subject.kind === "screen" ||
    event.subject.kind === "connection" ||
    event.subject.kind === "group"
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
  for (const event of Object.values(map.activity)) {
    if (event.afterRevision <= revision) continue;
    for (const touched of eventEntityKeys(map, event)) {
      if (touched.startsWith("app-map:") || proposed.has(touched)) conflicts.add(touched);
    }
  }
  return { conflict: conflicts.size > 0, subjects: [...conflicts].sort() };
}
