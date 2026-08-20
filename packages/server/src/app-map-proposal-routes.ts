import {
  approveAppMapProposal,
  rejectAppMapProposal,
  revertAppMapRepairProposal,
} from "@relay/core";
import type { OperationInput } from "@relay/protocol";
import { json, matchPath, parseJsonBody } from "./http.js";
import type { AppMapRouteInput } from "./app-map-route-input.js";
import { applyRebasableAppMapMutation, proveApprovedProposal } from "./app-map-route-mutations.js";
import { iosMutationOutcomeUnknownPayload } from "./interaction-routes.js";

/**
 * A map proof can retain its last proven source/destination evidence in the
 * typed core error. This route-only pointer gives humans and agents the one
 * explicit next read: capture current pixels, then choose repair or retry.
 */
export function appMapProofOutcomeUnknownReview(input: {
  serial: string;
  appMapId: string;
  proposalId: string;
  connectionId: string;
}) {
  const appMapHref = `/app-maps/${encodeURIComponent(input.appMapId)}`;
  return {
    appMapHref,
    proposalHref: `${appMapHref}/proposals/${encodeURIComponent(input.proposalId)}`,
    connectionId: input.connectionId,
    captureCurrent: {
      method: "GET" as const,
      href: `/screenshot?serial=${encodeURIComponent(input.serial)}&ephemeral=1`,
    },
  };
}

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
      const proof = await proveApprovedProposal(
        scope,
        proposalDecision.appMapId!,
        proposalDecision.proposalId!,
        body,
        appMap,
      );
      appMap = proof.appMap;
      if (proof.terminal) {
        const proofSerial =
          "serial" in body && typeof body.serial === "string" ? body.serial.trim() : "";
        json(response, 200, {
          appMap,
          terminal: "review-needed",
          error: proof.terminal.error.message,
          ...iosMutationOutcomeUnknownPayload(proof.terminal.error, {
            appMapProofReview: appMapProofOutcomeUnknownReview({
              serial: proofSerial,
              appMapId: proposalDecision.appMapId!,
              proposalId: proposalDecision.proposalId!,
              connectionId: proof.terminal.connectionId,
            }),
          }),
        });
        return true;
      }
    }
    json(response, 200, { appMap });
    return true;
  }
  const proposalRevert = matchPath(pathname, "/app-maps/:appMapId/proposals/:proposalId/revert");
  if (method === "POST" && proposalRevert) {
    const body = (await parseJsonBody(request)) as Omit<
      OperationInput<"app-map.proposal.revert">,
      "appMapId" | "proposalId"
    >;
    const appMap = await applyRebasableAppMapMutation(
      scope,
      proposalRevert.appMapId!,
      body.eventId,
      (map, context) =>
        revertAppMapRepairProposal(map, proposalRevert.proposalId!, context, body.reason),
    );
    json(response, 200, { appMap });
    return true;
  }
  return false;
}
