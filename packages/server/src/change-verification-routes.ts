import { createHash } from "node:crypto";
import type http from "node:http";
import {
  advanceChangeVerification,
  ChangeVerificationConflictError,
  ChangeVerificationNotFoundError,
  createChangeVerification,
  currentOperationContext,
  listChangeVerifications,
  now,
  readChangeVerification,
  readChangeVerificationHistory,
  supersedeChangeVerification,
  type AdvanceChangeVerificationInput,
  type ChangeVerificationScope,
} from "@relay/core";
import {
  CHANGE_VERIFICATION_STATES,
  type ChangeVerification,
  type OperationInput,
} from "@relay/protocol";
import { HttpError, json, matchPath, parseJsonBody } from "./http.js";
import { recordAudit, type RequestContext } from "./security.js";

export type ChangeVerificationRouteRuntime = {
  now: typeof now;
  create: typeof createChangeVerification;
  read: typeof readChangeVerification;
  history: typeof readChangeVerificationHistory;
  list: typeof listChangeVerifications;
  advance: typeof advanceChangeVerification;
  supersede: typeof supersedeChangeVerification;
};

const defaultRuntime: ChangeVerificationRouteRuntime = {
  now,
  create: createChangeVerification,
  read: readChangeVerification,
  history: readChangeVerificationHistory,
  list: listChangeVerifications,
  advance: advanceChangeVerification,
  supersede: supersedeChangeVerification,
};

function scopeOf(scope: RequestContext): ChangeVerificationScope {
  return { organizationId: scope.organizationId, projectId: scope.projectId };
}

function scopedProofId(scope: RequestContext, requestId: string): string {
  const digest = createHash("sha256")
    .update(scope.organizationId, "utf8")
    .update("\0")
    .update(scope.projectId, "utf8")
    .update("\0")
    .update(requestId, "utf8")
    .digest("hex");
  return `proof_${digest}`;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function requestDigest(proofId: string | undefined, body: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256")
    .update(canonicalJson(proofId ? { proofId, body } : body), "utf8")
    .digest("hex")}`;
}

function sameStartIntent(
  proof: ChangeVerification,
  actorId: string,
  body: OperationInput<"proof.start">,
): boolean {
  return (
    proof.requestedBy === actorId &&
    sameValue(proof.change, body.change) &&
    sameValue(proof.builds, body.builds ?? []) &&
    sameValue(proof.selection, body.selection ?? { affectedJourneys: [], targetCases: [] }) &&
    sameValue(proof.policy, body.policy) &&
    sameValue(proof.coverageGaps, body.coverageGaps ?? []) &&
    sameValue(proof.residualRisk, body.residualRisk ?? []) &&
    sameValue(proof.smallestNextVerification, body.smallestNextVerification)
  );
}

function idempotentMutation(
  proof: ChangeVerification,
  requestId: string,
  action: ChangeVerification["lastMutation"]["action"],
  digest: ChangeVerification["lastMutation"]["requestDigest"],
): boolean {
  return (
    proof.lastMutation.requestId === requestId &&
    proof.lastMutation.action === action &&
    proof.lastMutation.requestDigest === digest
  );
}

function mutationOutput(proof: ChangeVerification) {
  return { proof, receipt: proof.lastMutation };
}

async function replayedReceipt(
  runtime: ChangeVerificationRouteRuntime,
  scope: ChangeVerificationScope,
  proof: ChangeVerification,
  requestId: string,
  action: ChangeVerification["lastMutation"]["action"],
  digest: ChangeVerification["lastMutation"]["requestDigest"],
): Promise<ChangeVerification["lastMutation"] | undefined> {
  if (idempotentMutation(proof, requestId, action, digest)) return proof.lastMutation;
  const history = await runtime.history(scope, proof.id);
  const receipt = history.find(
    (version) =>
      version.lastMutation.requestId === requestId && version.lastMutation.action === action,
  )?.lastMutation;
  if (receipt && receipt.requestDigest !== digest) {
    throw new HttpError(409, "Proof request id is already bound to another intent", {
      code: "PROOF_REQUEST_CONFLICT",
    });
  }
  return receipt;
}

function routeError(error: unknown): never {
  if (error instanceof ChangeVerificationNotFoundError) {
    throw new HttpError(404, "Proof not found");
  }
  if (error instanceof ChangeVerificationConflictError) {
    throw new HttpError(409, error.message, { code: error.code });
  }
  throw error;
}

async function currentProof(
  runtime: ChangeVerificationRouteRuntime,
  scope: ChangeVerificationScope,
  proofId: string,
): Promise<ChangeVerification> {
  const proof = await runtime.read(scope, proofId);
  if (!proof) throw new HttpError(404, "Proof not found");
  return proof;
}

async function advanceProof(
  runtime: ChangeVerificationRouteRuntime,
  current: ChangeVerification,
  input: Omit<AdvanceChangeVerificationInput, keyof ChangeVerificationScope | "proofId">,
): Promise<ChangeVerification> {
  try {
    return await runtime.advance({
      organizationId: current.organizationId,
      projectId: current.projectId,
      proofId: current.id,
      ...input,
    });
  } catch (error) {
    routeError(error);
  }
}

export async function handleChangeVerificationRoute(input: {
  method: string;
  pathname: string;
  request: http.IncomingMessage;
  response: http.ServerResponse;
  scope: RequestContext;
  runtime?: Partial<ChangeVerificationRouteRuntime>;
}): Promise<boolean> {
  const runtime = { ...defaultRuntime, ...input.runtime };
  const operation = currentOperationContext();
  const actorId = operation?.actorId ?? input.scope.subject;
  const requestId = operation?.requestId;
  const at = runtime.now();
  const scope = scopeOf(input.scope);

  if (input.method === "GET" && input.pathname === "/proofs") {
    const state = new URL(input.request.url ?? "/proofs", "http://relay.local").searchParams.get(
      "state",
    ) as ChangeVerification["state"] | null;
    const limitValue = new URL(
      input.request.url ?? "/proofs",
      "http://relay.local",
    ).searchParams.get("limit");
    if (state && !CHANGE_VERIFICATION_STATES.includes(state)) {
      throw new HttpError(400, "Proof state filter is invalid");
    }
    if (limitValue && !/^\d+$/u.test(limitValue)) {
      throw new HttpError(400, "Proof list limit must be a positive integer");
    }
    const limit = limitValue ? Math.min(100, Math.max(1, Number(limitValue))) : 50;
    const proofs = (await runtime.list(scope))
      .filter((proof) => !state || proof.state === state)
      .slice(0, Number.isFinite(limit) ? limit : 50);
    json(input.response, 200, { proofs });
    return true;
  }

  if (input.method === "POST" && input.pathname === "/proofs") {
    if (!requestId) throw new HttpError(400, "Actor-aware operation context is required");
    const body = (await parseJsonBody(input.request)) as OperationInput<"proof.start">;
    const digest = requestDigest(undefined, body);
    const proofId = scopedProofId(input.scope, requestId);
    try {
      const proof = await runtime.create({
        ...scope,
        id: proofId,
        change: body.change,
        builds: body.builds,
        selection: body.selection,
        policy: body.policy,
        coverageGaps: body.coverageGaps,
        residualRisk: body.residualRisk,
        smallestNextVerification: body.smallestNextVerification,
        requestedBy: actorId,
        actorId,
        requestId,
        requestDigest: digest,
        at,
      });
      recordAudit(input.scope, { action: "proof.start", resource: proof.id, result: "allow" });
      json(input.response, 201, { ...mutationOutput(proof), disposition: "created" });
      return true;
    } catch (error) {
      if (!(error instanceof ChangeVerificationConflictError) || error.code !== "PROOF_EXISTS") {
        routeError(error);
      }
      const existing = await currentProof(runtime, scope, proofId);
      const creation = (await runtime.history(scope, proofId))[0];
      if (!creation || !sameStartIntent(creation, actorId, body)) {
        throw new HttpError(409, "Proof request id is already bound to another change", {
          code: "PROOF_REQUEST_CONFLICT",
        });
      }
      json(input.response, 200, {
        proof: existing,
        receipt: creation.lastMutation,
        disposition: "existing",
      });
      return true;
    }
  }

  const getMatch = matchPath(input.pathname, "/proofs/:proofId");
  if (input.method === "GET" && getMatch) {
    const proof = await currentProof(runtime, scope, getMatch.proofId!);
    const includeHistory = new URL(
      input.request.url ?? input.pathname,
      "http://relay.local",
    ).searchParams.get("includeHistory");
    recordAudit(input.scope, { action: "proof.read", resource: proof.id, result: "allow" });
    json(input.response, 200, {
      proof,
      ...(includeHistory === "true"
        ? { history: (await runtime.history(scope, proof.id)).slice(-100) }
        : {}),
    });
    return true;
  }

  const approveMatch = matchPath(input.pathname, "/proofs/:proofId/plan/approve");
  if (input.method === "POST" && approveMatch) {
    if (!requestId) throw new HttpError(400, "Actor-aware operation context is required");
    if (operation?.actorKind !== "human") {
      throw new HttpError(403, "Verification Plan approval requires a human actor");
    }
    const body = (await parseJsonBody(input.request)) as OperationInput<"proof.plan.approve">;
    const current = await currentProof(runtime, scope, approveMatch.proofId!);
    if (current.coverageGaps.length) {
      throw new HttpError(409, "Verification Plan has unresolved coverage gaps", {
        code: "PROOF_COVERAGE_GAPS",
        coverageGapCount: current.coverageGaps.length,
      });
    }
    const digest = requestDigest(current.id, body);
    const replay = await replayedReceipt(
      runtime,
      scope,
      current,
      requestId,
      "approve-plan",
      digest,
    );
    if (replay) {
      json(input.response, 200, { proof: current, receipt: replay });
      return true;
    }
    const proof = await advanceProof(runtime, current, {
      expectedVersion: body.expectedVersion,
      state: "ready",
      actorId,
      requestId,
      requestDigest: digest,
      action: "approve-plan",
      at,
      planApproval: {
        decisionId: body.decisionId,
        approvedBy: actorId,
        approvedAt: at,
        reason: body.reason,
      },
      smallestNextVerification: {
        kind: "run-pilot",
        reason: "The frozen Verification Plan is approved and ready for its pilot.",
      },
    });
    recordAudit(input.scope, { action: "proof.plan.approve", resource: proof.id, result: "allow" });
    json(input.response, 200, mutationOutput(proof));
    return true;
  }

  const continueMatch = matchPath(input.pathname, "/proofs/:proofId/continue");
  if (input.method === "POST" && continueMatch) {
    if (!requestId) throw new HttpError(400, "Actor-aware operation context is required");
    const body = (await parseJsonBody(input.request)) as OperationInput<"proof.continue">;
    const current = await currentProof(runtime, scope, continueMatch.proofId!);
    const digest = requestDigest(current.id, body);
    const replay = await replayedReceipt(runtime, scope, current, requestId, body.action, digest);
    if (replay) {
      json(input.response, 200, { proof: current, receipt: replay });
      return true;
    }
    const common = {
      expectedVersion: body.expectedVersion,
      actorId,
      requestId,
      requestDigest: digest,
      action: body.action,
      at,
    } as const;
    const proof =
      body.action === "revise-plan"
        ? await advanceProof(runtime, current, {
            ...common,
            state: body.builds!.length ? "planning" : "awaiting-build",
            builds: body.builds!,
            selection: body.selection!,
            planApproval: null,
            coverageGaps: body.coverageGaps,
            residualRisk: body.residualRisk,
            smallestNextVerification: body.smallestNextVerification ?? {
              kind: body.builds!.length ? "approve-plan" : "provide-build",
              reason: body.builds!.length
                ? "Review and approve the revised Verification Plan."
                : "Provide an exact build for the current head.",
            },
          })
        : body.action === "request-plan-review"
          ? await advanceProof(runtime, current, {
              ...common,
              state: "needs-review",
              smallestNextVerification: { kind: "review", reason: body.reason! },
            })
          : await advanceProof(runtime, current, {
              ...common,
              state: current.builds.length ? "planning" : "awaiting-build",
              planApproval: null,
              smallestNextVerification: {
                kind: current.builds.length ? "approve-plan" : "provide-build",
                reason: body.reason!,
              },
            });
    recordAudit(input.scope, { action: "proof.continue", resource: proof.id, result: "allow" });
    json(input.response, 200, mutationOutput(proof));
    return true;
  }

  const cancelMatch = matchPath(input.pathname, "/proofs/:proofId/cancel");
  if (input.method === "POST" && cancelMatch) {
    if (!requestId) throw new HttpError(400, "Actor-aware operation context is required");
    const body = (await parseJsonBody(input.request)) as OperationInput<"proof.cancel">;
    const current = await currentProof(runtime, scope, cancelMatch.proofId!);
    const digest = requestDigest(current.id, body);
    const replay = await replayedReceipt(runtime, scope, current, requestId, "cancel", digest);
    if (replay) {
      json(input.response, 200, { proof: current, receipt: replay });
      return true;
    }
    const proof = await advanceProof(runtime, current, {
      expectedVersion: body.expectedVersion,
      state: "cancelled",
      actorId,
      requestId,
      requestDigest: digest,
      action: "cancel",
      at,
      cancellation: { reason: body.reason, cancelledBy: actorId, cancelledAt: at },
      smallestNextVerification: {
        kind: "none",
        reason: "This Proof was explicitly cancelled and cannot authorize merge.",
      },
    });
    recordAudit(input.scope, { action: "proof.cancel", resource: proof.id, result: "allow" });
    json(input.response, 200, mutationOutput(proof));
    return true;
  }

  const rerunMatch = matchPath(input.pathname, "/proofs/:proofId/rerun-affected");
  if (input.method === "POST" && rerunMatch) {
    if (!requestId) throw new HttpError(400, "Actor-aware operation context is required");
    const body = (await parseJsonBody(input.request)) as OperationInput<"proof.rerun-affected">;
    const current = await currentProof(runtime, scope, rerunMatch.proofId!);
    const digest = requestDigest(current.id, body);
    const replay = await replayedReceipt(
      runtime,
      scope,
      current,
      requestId,
      "rerun-affected",
      digest,
    );
    if (replay) {
      const replacementId = current.supersededByProofId;
      if (!replacementId) throw new HttpError(409, "Supersession receipt is incomplete");
      const replacement = await currentProof(runtime, scope, replacementId);
      json(input.response, 200, {
        previous: current,
        replacement,
        receipt: replay,
      });
      return true;
    }
    try {
      const result = await runtime.supersede({
        ...scope,
        proofId: current.id,
        expectedVersion: body.expectedVersion,
        actorId,
        requestId,
        requestDigest: digest,
        at,
        replacement: {
          id: scopedProofId(input.scope, requestId),
          change: body.change,
          builds: body.builds,
          selection: body.selection,
          policy: body.policy ?? current.policy,
          coverageGaps: body.coverageGaps,
          residualRisk: body.residualRisk,
          smallestNextVerification: body.smallestNextVerification,
          requestedBy: actorId,
          actorId,
          requestId,
          requestDigest: digest,
          action: "rerun-affected",
          at,
        },
      });
      recordAudit(input.scope, {
        action: "proof.rerun-affected",
        resource: result.replacement.id,
        result: "allow",
      });
      json(input.response, 201, {
        ...result,
        receipt: result.previous.lastMutation,
      });
      return true;
    } catch (error) {
      routeError(error);
    }
  }

  return false;
}
