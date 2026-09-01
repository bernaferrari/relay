import type http from "node:http";
import { canonicalSha256, verifyDurableChangeVerification } from "@relay/core";
import type { ChangeVerification, OperationInput } from "@relay/protocol";
import { HttpError, json, matchPath, parseJsonBody } from "./http.js";
import { recordAudit, type RequestContext } from "./security.js";
import type { ChangeVerificationRouteRuntime } from "./change-verification-routes.js";
import type { ChangeVerificationScope } from "@relay/core";

/** The merge-check recovery path is deliberately isolated from the larger
 * Proof lifecycle router. It owns only one exact immutable publication intent
 * and cannot advance, replace, or otherwise mutate the Proof itself. */
export async function handleChangeProofPublicationRecoveryRoute(input: {
  method: string;
  pathname: string;
  request: http.IncomingMessage;
  response: http.ServerResponse;
  requestContext: RequestContext;
  scope: ChangeVerificationScope;
  actorId: string;
  requestId?: string;
  at: number;
  runtime: ChangeVerificationRouteRuntime;
  currentProof: (proofId: string) => Promise<ChangeVerification>;
  publishTerminalProof: (proof: ChangeVerification) => Promise<void>;
  routeError: (error: unknown) => never;
}): Promise<boolean> {
  const match = matchPath(input.pathname, "/proofs/:proofId/publications/:publicationId/retry");
  if (input.method !== "POST" || !match) return false;
  if (!input.requestId) throw new HttpError(400, "Actor-aware operation context is required");

  const body = (await parseJsonBody(input.request)) as OperationInput<"proof.publication.retry">;
  const current = await input.currentProof(match.proofId!);
  const publicationId = match.publicationId!;
  const record = (await input.runtime.publicationOutbox(input.scope)).find(
    (candidate) => candidate.id === publicationId,
  );
  if (!record || record.proofId !== current.id) {
    throw new HttpError(404, "Proof publication was not found");
  }
  // Dynamic path identities are validated by the operation router and are
  // not repeated in the HTTP body produced by RelayClient.
  if (body.expectedProofVersion !== record.proofVersion) {
    throw new HttpError(409, "Merge-check recovery does not identify this exact Proof revision", {
      code: "OUTBOX_INTENT_CONFLICT",
    });
  }
  const historicalProof = (await input.runtime.history(input.scope, current.id)).find(
    (candidate) => candidate.version === record.proofVersion,
  );
  if (!historicalProof) {
    throw new HttpError(409, "The immutable Proof revision for this merge check is unavailable", {
      code: "OUTBOX_INTENT_CONFLICT",
    });
  }

  const reconciled = await input.runtime.reconcilePublication({
    ...input.scope,
    id: publicationId,
    at: input.at,
  });
  if (reconciled?.status === "published") {
    recordAudit(input.requestContext, {
      action: "proof.publication.retry",
      resource: publicationId,
      result: "allow",
    });
    json(input.response, 200, {
      proof: current,
      publication: reconciled,
      disposition: record.status === "published" ? "already-published" : "reconciled",
    });
    return true;
  }

  const requestDigest = canonicalSha256({
    proofId: current.id,
    body: { ...body, publicationId },
  });
  try {
    await input.runtime.recoverPublication({
      ...input.scope,
      id: publicationId,
      proofId: current.id,
      proofVersion: body.expectedProofVersion,
      actorId: input.actorId,
      requestId: input.requestId,
      requestDigest,
      at: input.at,
    });
    await input.publishTerminalProof(verifyDurableChangeVerification(historicalProof));
  } catch (error) {
    input.routeError(error);
  }
  const publication = (await input.runtime.publicationOutbox(input.scope)).find(
    (candidate) => candidate.id === publicationId,
  );
  if (!publication) throw new HttpError(404, "Proof publication was not found");
  recordAudit(input.requestContext, {
    action: "proof.publication.retry",
    resource: publicationId,
    result: "allow",
  });
  json(input.response, 200, { proof: current, publication, disposition: "accepted" });
  return true;
}
