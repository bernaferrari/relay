import { createSignal } from "solid-js";
import type { AppMap } from "@relay/protocol";
import { useServer } from "../context/server";
import { toast } from "../context/toast";

export function useAppMapProposalReview(activeAppMap: () => AppMap | undefined) {
  const server = useServer();
  const [proposalBusyId, setProposalBusyId] = createSignal<string>();
  const [proposalError, setProposalError] = createSignal<string>();

  const decideProposal = async (
    proposalId: string,
    decision: "approve" | "reject",
    reason?: string,
  ) => {
    const appMap = activeAppMap();
    if (!appMap || proposalBusyId()) return false;
    setProposalBusyId(proposalId);
    setProposalError();
    try {
      await server.runAction(`app-map.proposal.${decision}` as const, {
        appMapId: appMap.id,
        proposalId,
        expectedRevision: appMap.revision,
        ...(reason ? { reason } : {}),
      });
      await server.refreshAppMaps();
      toast(
        decision === "approve"
          ? "Proposal added to the map"
          : reason
            ? "Changes sent back with feedback"
            : "Proposal rejected",
        "success",
      );
      return true;
    } catch (error) {
      setProposalError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setProposalBusyId();
    }
  };

  return {
    proposalBusyId,
    proposalError,
    decideProposal,
  };
}
