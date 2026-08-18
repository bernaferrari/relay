import { approveAppMapProposal, rejectAppMapProposal } from "@relay/core";
import type { OperationInput } from "@relay/protocol";
import { json, matchPath, parseJsonBody } from "./http.js";
import type { AppMapRouteInput } from "./app-map-route-input.js";
import { applyRebasableAppMapMutation, proveApprovedProposal } from "./app-map-route-mutations.js";

export async function handleAppMapProposalRoute(input: AppMapRouteInput): Promise<boolean> {
  const { method, pathname, request, response, scope } = input;
  for (const decision of ["approve", "reject"] as const) {
    const proposalDecision = matchPath(
      pathname,
      `/app-maps/:appMapId/proposals/:proposalId/${decision}`,
    );
    if (method !== "POST" || !proposalDecision) continue;
    const body = (await parseJsonBody(request)) as Omit<
      OperationInput<`app-map.proposal.${typeof decision}`>,
      "appMapId" | "proposalId"
    >;
    let appMap = await applyRebasableAppMapMutation(
      scope,
      proposalDecision.appMapId!,
      body.eventId,
      (map, context) =>
        decision === "approve"
          ? approveAppMapProposal(map, proposalDecision.proposalId!, context, body.reason)
          : rejectAppMapProposal(map, proposalDecision.proposalId!, context, body.reason),
    );
    if (decision === "approve") {
      appMap = await proveApprovedProposal(
        scope,
        proposalDecision.appMapId!,
        proposalDecision.proposalId!,
        body,
        appMap,
      );
    }
    json(response, 200, { appMap });
    return true;
  }
  return false;
}
