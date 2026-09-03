import type http from "node:http";
import {
  advanceChangeVerification,
  ChangeVerificationConflictError,
  ChangeVerificationNotFoundError,
  createChangeVerification,
  changeProofCaseResultFromPersistedRun,
  currentOperationContext,
  listChangeVerifications,
  listChangeProofPublicationOutbox,
  reconcileChangeProofPublicationOutbox,
  requestChangeProofPublicationRecovery,
  now,
  readChangeProofPublications,
  readChangeVerification,
  readChangeVerificationHistory,
  readPersistedRun,
  supersedeChangeVerification,
  ChangeProofIntegrityError,
  canonicalSha256,
  summarizeChangeProofExecution,
  ChangeProofExecutionError,
  ChangeProofConfirmationError,
  ChangeProofPublicationOutboxError,
  verifyDurableChangeVerification,
  type AdvanceChangeVerificationInput,
  type ChangeVerificationScope,
  type ChangeProofCellExecutor,
  type ChangeProofExecutionCoordinator,
  type AuthoritativeWebDeploymentLookup,
  changeProofExecutionPreview,
} from "@relay/core";
import {
  CHANGE_VERIFICATION_STATES,
  type ChangeVerification,
  type OperationInput,
} from "@relay/protocol";
import { HttpError, json, matchPath, parseJsonBody } from "./http.js";
import { recordAudit, type RequestContext } from "./security.js";
import {
  changeVerificationScope as scopeOf,
  scopedChangeProofId as scopedProofId,
} from "./change-verification-route-identity.js";
import {
  processTerminalChangeProofPublication,
  type ChangeProofTerminalPublisher,
} from "./change-proof-publication-worker.js";
import {
  defaultProofExecutionCoordinator,
  proofExecutionCoordinator,
} from "./change-proof-execution-runtime.js";
import {
  prepareCurrentChangeVerification,
  proofPreparationStartInput,
} from "./change-proof-preparation.js";
import { handleChangeProofPublicationRecoveryRoute } from "./change-proof-publication-recovery-route.js";
import { handleChangeProofExecutionRoutes } from "./change-proof-execution-routes.js";
import { applyProofSetup, inspectProofSetup, previewProofSetup } from "./proof-guided-setup.js";
import {
  proofRequestDigest as requestDigest,
  sameProofStartIntent as sameStartIntent,
} from "./change-verification-route-intent.js";

export type ChangeVerificationRouteRuntime = {
  now: typeof now;
  create: typeof createChangeVerification;
  read: typeof readChangeVerification;
  history: typeof readChangeVerificationHistory;
  list: typeof listChangeVerifications;
  publications: typeof readChangeProofPublications;
  publicationOutbox: typeof listChangeProofPublicationOutbox;
  reconcilePublication: typeof reconcileChangeProofPublicationOutbox;
  recoverPublication: typeof requestChangeProofPublicationRecovery;
  advance: typeof advanceChangeVerification;
  supersede: typeof supersedeChangeVerification;
  readRun: typeof readPersistedRun;
  caseResultFromRun: typeof changeProofCaseResultFromPersistedRun;
  /** Optional host-configured provider boundary supplied by the embedding server. */
  publishTerminal?: ChangeProofTerminalPublisher;
  publicationDetailsUrl?: string;
  /** Durable server-owned cell lifecycle. The executor is the adapter to the
   * existing App Map Test/session enqueue path; this route never reimplements
   * target control. */
  executionCoordinator: ChangeProofExecutionCoordinator;
  executeCell?: ChangeProofCellExecutor;
  /** The canonical App Map Test executor starts a Test from its first step and
   * therefore cannot safely resume an exact human-only boundary. Hosts may
   * opt in only when their executor has a true step/checkpoint resume seam. */
  supportsHumanInterventionResume?: boolean;
  /** Host-owned deployment provider used by guided setup and exact web Build
   * ingestion. The route never accepts caller-supplied provider facts. */
  lookupWebDeployment?: AuthoritativeWebDeploymentLookup;
  prepare: typeof prepareCurrentChangeVerification;
};

const defaultRuntime: ChangeVerificationRouteRuntime = {
  now,
  create: createChangeVerification,
  read: readChangeVerification,
  history: readChangeVerificationHistory,
  list: listChangeVerifications,
  publications: readChangeProofPublications,
  publicationOutbox: listChangeProofPublicationOutbox,
  reconcilePublication: reconcileChangeProofPublicationOutbox,
  recoverPublication: requestChangeProofPublicationRecovery,
  advance: advanceChangeVerification,
  supersede: supersedeChangeVerification,
  readRun: readPersistedRun,
  caseResultFromRun: changeProofCaseResultFromPersistedRun,
  executionCoordinator: defaultProofExecutionCoordinator,
  prepare: prepareCurrentChangeVerification,
};

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

async function publishTerminalProof(
  runtime: ChangeVerificationRouteRuntime,
  scope: ChangeVerificationScope,
  proof: ChangeVerification,
): Promise<void> {
  if (
    runtime.publishTerminal &&
    ["proved", "rejected", "needs-review", "insufficient-evidence", "superseded"].includes(
      proof.state,
    )
  ) {
    await processTerminalChangeProofPublication({
      scope,
      proof,
      publish: runtime.publishTerminal,
    });
  }
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
  if (error instanceof ChangeProofPublicationOutboxError) {
    throw new HttpError(error.code === "OUTBOX_NOT_FOUND" ? 404 : 409, error.message, {
      code: error.code,
    });
  }
  if (error instanceof ChangeProofExecutionError) {
    const status = error.code === "PROOF_EXECUTION_NOT_FOUND" ? 404 : 409;
    throw new HttpError(status, error.message, { code: error.code });
  }
  if (error instanceof ChangeProofConfirmationError) {
    throw new HttpError(409, error.message, { code: error.code });
  }
  if (error instanceof ChangeProofIntegrityError) {
    throw new HttpError(error.code === "POLICY_UNSUPPORTED" ? 400 : 409, error.message, {
      code: error.code,
    });
  }
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
  try {
    return verifyDurableChangeVerification(proof);
  } catch (error) {
    routeError(error);
  }
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
      ...(runtime.publishTerminal
        ? {
            publication: {
              provider: "github" as const,
              ...(runtime.publicationDetailsUrl
                ? { detailsUrl: runtime.publicationDetailsUrl }
                : {}),
            },
          }
        : {}),
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
  const runtime = {
    ...defaultRuntime,
    ...input.runtime,
    executionCoordinator: proofExecutionCoordinator(input.runtime),
  };
  const operation = currentOperationContext();
  const actorId = operation?.actorId ?? input.scope.subject;
  const requestId = operation?.requestId;
  const at = runtime.now();
  const scope = scopeOf(input.scope);

  if (input.method === "GET" && input.pathname === "/proofs/setup") {
    const baseRef = new URL(
      input.request.url ?? "/proofs/setup",
      "http://relay.local",
    ).searchParams.get("baseRef");
    try {
      json(
        input.response,
        200,
        await inspectProofSetup({
          projectId: scope.projectId,
          ...(baseRef ? { baseRef } : {}),
        }),
      );
    } catch (error) {
      throw new HttpError(
        409,
        error instanceof Error ? error.message : "Proof setup inspection failed",
        {
          code: "PROOF_SETUP_BLOCKED",
        },
      );
    }
    return true;
  }

  if (input.method === "POST" && input.pathname === "/proofs/setup/preview") {
    const body = (await parseJsonBody(input.request)) as OperationInput<"proof.setup.preview">;
    try {
      json(
        input.response,
        200,
        await previewProofSetup({
          projectId: scope.projectId,
          intent: body,
          ...(runtime.lookupWebDeployment
            ? { lookupWebDeployment: runtime.lookupWebDeployment }
            : {}),
        }),
      );
    } catch (error) {
      throw new HttpError(
        409,
        error instanceof Error ? error.message : "Proof setup preview failed",
        {
          code: "PROOF_SETUP_PREVIEW_BLOCKED",
        },
      );
    }
    return true;
  }

  if (input.method === "POST" && input.pathname === "/proofs/setup/apply") {
    if (!requestId) throw new HttpError(400, "Actor-aware operation context is required");
    const body = (await parseJsonBody(input.request)) as OperationInput<"proof.setup.apply">;
    if (body.confirm !== true) throw new HttpError(400, "confirm must be true");
    try {
      const result = await applyProofSetup({
        projectId: scope.projectId,
        request: body,
        ...(runtime.lookupWebDeployment
          ? { lookupWebDeployment: runtime.lookupWebDeployment }
          : {}),
      });
      recordAudit(input.scope, {
        action: "proof.setup.apply",
        resource: result.registeredBuild.id,
        result: "allow",
      });
      json(input.response, 200, result);
    } catch (error) {
      throw new HttpError(
        409,
        error instanceof Error ? error.message : "Proof setup apply failed",
        {
          code: "PROOF_SETUP_APPLY_BLOCKED",
        },
      );
    }
    return true;
  }

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
    let proofs: ChangeVerification[];
    try {
      proofs = (await runtime.list(scope))
        .map(verifyDurableChangeVerification)
        .filter((proof) => !state || proof.state === state)
        .slice(0, Number.isFinite(limit) ? limit : 50);
    } catch (error) {
      routeError(error);
    }
    json(input.response, 200, { proofs });
    return true;
  }

  if (input.method === "POST" && input.pathname === "/proofs/prepare") {
    if (!requestId) throw new HttpError(400, "Actor-aware operation context is required");
    const body = (await parseJsonBody(input.request)) as OperationInput<"proof.prepare">;
    let prepared: Awaited<ReturnType<ChangeVerificationRouteRuntime["prepare"]>>;
    try {
      prepared = await runtime.prepare({
        projectId: scope.projectId,
        request: body,
        ...(runtime.lookupWebDeployment
          ? { lookupWebDeployment: runtime.lookupWebDeployment }
          : {}),
      });
    } catch (error) {
      throw new HttpError(
        409,
        error instanceof Error ? error.message : "The current change could not be prepared",
        { code: "PROOF_PREPARATION_BLOCKED" },
      );
    }
    const start = proofPreparationStartInput(prepared.plan);
    const intentDigest = canonicalSha256(start);
    const stableId = scopedProofId(input.scope, `prepare:${intentDigest}`);
    const activeStates = new Set<ChangeVerification["state"]>([
      "planning",
      "awaiting-build",
      "needs-review",
      "ready",
      "running-pilot",
      "awaiting-expansion",
      "running",
    ]);
    const stable = await runtime.read(scope, stableId);
    if (stable && activeStates.has(stable.state)) {
      if (!sameStartIntent(stable, stable.requestedBy, start)) {
        throw new HttpError(409, "Prepared Proof identity conflicts with another plan", {
          code: "PROOF_PREPARATION_CONFLICT",
        });
      }
      json(input.response, 200, {
        proof: verifyDurableChangeVerification(stable),
        plan: prepared.plan,
        disposition: "existing",
        nextAction: stable.smallestNextVerification ?? start.smallestNextVerification!,
        blockers: [
          ...new Set([
            ...prepared.blockers,
            ...prepared.plan.coverageGaps.map(({ reason }) => reason),
          ]),
        ],
      });
      return true;
    }
    // Terminal Proofs are immutable audit records. A deliberate new request
    // for the same exact revision gets a new request-scoped identity rather
    // than mutating or silently reusing the terminal decision.
    const proofId = stable
      ? scopedProofId(input.scope, `prepare:${intentDigest}:${requestId}`)
      : stableId;
    const digest = requestDigest(undefined, { request: body, prepared: start });
    try {
      const proof = await runtime.create({
        ...scope,
        id: proofId,
        ...start,
        requestedBy: actorId,
        actorId,
        requestId,
        requestDigest: digest,
        at,
        ...(runtime.publishTerminal
          ? {
              publication: {
                provider: "github" as const,
                ...(runtime.publicationDetailsUrl
                  ? { detailsUrl: runtime.publicationDetailsUrl }
                  : {}),
              },
            }
          : {}),
      });
      recordAudit(input.scope, { action: "proof.prepare", resource: proof.id, result: "allow" });
      json(input.response, 201, {
        proof,
        plan: prepared.plan,
        disposition: "created",
        nextAction: proof.smallestNextVerification ?? start.smallestNextVerification!,
        blockers: [
          ...new Set([
            ...prepared.blockers,
            ...prepared.plan.coverageGaps.map(({ reason }) => reason),
          ]),
        ],
      });
      return true;
    } catch (error) {
      if (!(error instanceof ChangeVerificationConflictError) || error.code !== "PROOF_EXISTS") {
        routeError(error);
      }
      const existing = await currentProof(runtime, scope, proofId);
      const creation = (await runtime.history(scope, proofId))[0];
      if (!creation || creation.lastMutation.requestDigest !== digest) {
        throw new HttpError(409, "Proof preparation request is already bound to another intent", {
          code: "PROOF_REQUEST_CONFLICT",
        });
      }
      json(input.response, 200, {
        proof: existing,
        plan: prepared.plan,
        disposition: "existing",
        nextAction: existing.smallestNextVerification ?? start.smallestNextVerification!,
        blockers: [
          ...new Set([
            ...prepared.blockers,
            ...prepared.plan.coverageGaps.map(({ reason }) => reason),
          ]),
        ],
      });
      return true;
    }
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
        ...(runtime.publishTerminal
          ? {
              publication: {
                provider: "github" as const,
                ...(runtime.publicationDetailsUrl
                  ? { detailsUrl: runtime.publicationDetailsUrl }
                  : {}),
              },
            }
          : {}),
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
    const publications = await runtime.publications(scope, proof.id);
    const publicationOutbox = (await runtime.publicationOutbox(scope)).filter(
      (record) => record.proofId === proof.id,
    );
    const execution = await runtime.executionCoordinator.read(scope, proof.id);
    let executionPreview;
    try {
      executionPreview = changeProofExecutionPreview(proof);
    } catch {
      // Legacy/incomplete planning documents remain inspectable. They simply
      // cannot be confirmed or executed until a new complete preview exists.
    }
    json(input.response, 200, {
      proof,
      publications,
      publicationOutbox,
      ...(executionPreview ? { executionPreview } : {}),
      ...(execution ? { execution: summarizeChangeProofExecution(execution) } : {}),
      ...(includeHistory === "true"
        ? {
            history: (await runtime.history(scope, proof.id))
              .map(verifyDurableChangeVerification)
              .slice(-100),
          }
        : {}),
    });
    return true;
  }

  if (
    await handleChangeProofExecutionRoutes({
      method: input.method,
      pathname: input.pathname,
      request: input.request,
      response: input.response,
      requestContext: input.scope,
      scope,
      runtime,
      ...(operation ? { operation } : {}),
      actorId,
      ...(requestId ? { requestId } : {}),
      at,
      currentProof: (proofId) => currentProof(runtime, scope, proofId),
      advanceProof: (proof, advanceInput) => advanceProof(runtime, proof, advanceInput),
      replayedReceipt: (proof, mutationRequestId, action, digest) =>
        replayedReceipt(runtime, scope, proof, mutationRequestId, action, digest),
      publishTerminalProof: (proof) => publishTerminalProof(runtime, scope, proof),
      routeError,
    })
  ) {
    return true;
  }

  if (
    await handleChangeProofPublicationRecoveryRoute({
      method: input.method,
      pathname: input.pathname,
      request: input.request,
      response: input.response,
      requestContext: input.scope,
      scope,
      actorId,
      ...(requestId ? { requestId } : {}),
      at,
      runtime,
      currentProof: (proofId) => currentProof(runtime, scope, proofId),
      publishTerminalProof: (proof) => publishTerminalProof(runtime, scope, proof),
      routeError,
    })
  ) {
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
    if (current.version !== body.expectedVersion) {
      routeError(
        new ChangeVerificationConflictError("PROOF_STALE", "Change Verification version is stale"),
      );
    }
    // Fence the durable execution before publishing cancellation. The runner
    // rechecks this record immediately before target dispatch, so a cancelled
    // Proof cannot admit a new mutation in the route/coordinator gap.
    await runtime.executionCoordinator.cancel({
      ...scope,
      proofId: current.id,
      actorId,
      reason: body.reason,
      at,
      transitionProof: false,
    });
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
      await publishTerminalProof(runtime, scope, current);
      json(input.response, 200, {
        previous: current,
        replacement,
        receipt: replay,
      });
      return true;
    }
    const execution = await runtime.executionCoordinator.read(scope, current.id);
    if (execution && !["completed", "cancelled", "uncertain"].includes(execution.status)) {
      throw new HttpError(409, "Cancel the active Proof execution before rerunning its cases", {
        code: "PROOF_EXECUTION_ACTIVE",
      });
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
        ...(runtime.publishTerminal
          ? {
              publication: {
                provider: "github" as const,
                ...(runtime.publicationDetailsUrl
                  ? { detailsUrl: runtime.publicationDetailsUrl }
                  : {}),
              },
            }
          : {}),
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
      await publishTerminalProof(runtime, scope, result.previous);
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
