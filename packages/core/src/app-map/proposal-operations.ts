import { dropConnection, patchConnection, putConnection } from "./connection-operations.js";
import { appMapFail } from "./errors.js";
import type { AppMap, AppMapMutationContext, ProposalChange } from "./model.js";
import { mutateAppMap } from "./mutation.js";
import { proposalConflictsSince } from "./proposal-conflicts.js";
import { dropScreen, patchScreen, putScreen } from "./screen-operations.js";
import { dropMapGroup, putMapGroup } from "./group-operations.js";

function applyProposalChange(
  draft: AppMap,
  proposalId: string,
  change: ProposalChange,
  at: number,
): void {
  switch (change.kind) {
    case "screen.add":
      putScreen(draft, change.input);
      break;
    case "screen.update":
      patchScreen(draft, change.screenId, change.input, at);
      break;
    case "screen.remove":
      dropScreen(draft, change.screenId, proposalId, at);
      break;
    case "connection.connect":
      putConnection(draft, change.connection);
      break;
    case "connection.update":
      patchConnection(draft, change.connectionId, change.patch, at);
      break;
    case "connection.remove":
      dropConnection(draft, change.connectionId);
      break;
    case "group.save":
      putMapGroup(draft, change.group);
      break;
    case "group.remove":
      dropMapGroup(draft, change.groupId);
      break;
  }
}

export function approveAppMapProposal(
  map: AppMap,
  proposalId: string,
  context: AppMapMutationContext,
  reason?: string,
): AppMap {
  return mutateAppMap(
    map,
    context,
    {
      eventType: "proposal.approved",
      subject: { kind: "proposal", id: proposalId },
      summary: `Approved proposal ${proposalId}`,
    },
    (draft) => {
      const proposal = draft.proposals[proposalId];
      if (!proposal) {
        appMapFail("missing-reference", `Proposal ${proposalId} does not exist`);
      }
      if (proposal.status !== "pending") {
        appMapFail("proposal-state", `Proposal ${proposalId} is already ${proposal.status}`);
      }
      const conflicts = proposalConflictsSince(draft, proposal, proposal.baseRevision + 1);
      if (conflicts.conflict) {
        appMapFail(
          "revision-conflict",
          `Proposal ${proposalId} conflicts with newer changes to ${conflicts.subjects.join(", ")}`,
        );
      }
      for (const change of proposal.changes) {
        applyProposalChange(draft, proposalId, change, context.at);
      }
      proposal.status = "approved";
      proposal.decision = {
        actorId: context.actorId,
        at: context.at,
        ...(reason ? { reason } : {}),
      };
      proposal.updatedAt = context.at;
    },
  );
}

export function rejectAppMapProposal(
  map: AppMap,
  proposalId: string,
  context: AppMapMutationContext,
  reason?: string,
): AppMap {
  return mutateAppMap(
    map,
    context,
    {
      eventType: "proposal.rejected",
      subject: { kind: "proposal", id: proposalId },
      summary: `Rejected proposal ${proposalId}`,
    },
    (draft) => {
      const proposal = draft.proposals[proposalId];
      if (!proposal) {
        appMapFail("missing-reference", `Proposal ${proposalId} does not exist`);
      }
      if (proposal.status !== "pending") {
        appMapFail("proposal-state", `Proposal ${proposalId} is already ${proposal.status}`);
      }
      proposal.status = "rejected";
      proposal.decision = {
        actorId: context.actorId,
        at: context.at,
        ...(reason ? { reason } : {}),
      };
      proposal.updatedAt = context.at;
    },
  );
}
