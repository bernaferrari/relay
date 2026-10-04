import type http from "node:http";
import type { OperationInput } from "@relay/protocol";
import {
  completeReconcileReceipt,
  controlTargetIdForBrowserLane,
  readReconcileReceipt,
  rememberReconcileReceipt,
  serializeReconciliation,
} from "@relay/core";
import { HttpError, json, parseJsonBody } from "./http.js";
import { recordAudit, type RequestContext } from "./security.js";
import { durableObservationId, resolveSupervisedRuntimeTarget } from "./target-runtime-support.js";
import {
  assertClientUnknownReviewAllowed,
  completeClientUnknownInputReview,
} from "./target-client-input-review.js";
import type { TargetRuntimeRouteRuntime } from "./target-runtime-routes.js";

/** Exact input reconciliation and durable receipt retrieval share one route
 * boundary. They observe and release fences; they never resend device input. */
export async function handleTargetInputReconciliationRoute(input: {
  method: string;
  pathname: string;
  request: http.IncomingMessage;
  response: http.ServerResponse;
  scope: RequestContext;
  runtime: TargetRuntimeRouteRuntime;
}): Promise<boolean> {
  const { method, pathname, request, response, scope, runtime } = input;

  if (method === "POST" && pathname === "/device/input/reconcile") {
    const body = (await parseJsonBody(request)) as OperationInput<"target.input.reconcile">;
    const serial = typeof body.serial === "string" ? body.serial.trim() : "";
    let mutationId = typeof body.mutationId === "string" ? body.mutationId.trim() : "";
    if (!serial) throw new HttpError(400, "serial is required");
    if (!mutationId) throw new HttpError(400, "mutationId is required");
    if (body.reconcilePending !== undefined && typeof body.reconcilePending !== "boolean") {
      throw new HttpError(400, "reconcilePending must be a boolean");
    }
    if (body.reconcilePending === true && body.clientUnknown !== true) {
      // The person reviewed the screen; bind their decision to the input that
      // is actually pending on this target.
      const target = await resolveSupervisedRuntimeTarget({ serial, runtime });
      const pending = runtime.readTargetHealth(target.id, target.platform).input;
      if (pending.state === "uncertain" && pending.pendingMutationId) {
        mutationId = pending.pendingMutationId;
      }
    }
    if (!new Set(["applied", "not-applied", "ambiguous"]).has(body.outcome)) {
      throw new HttpError(400, "outcome must be applied, not-applied, or ambiguous");
    }
    await runtime.assertTargetControl(scope, controlTargetIdForBrowserLane(serial));
    return serializeReconciliation(serial, async () => {
      const receiptScope = { organizationId: scope.organizationId, projectId: scope.projectId };
      const clientTarget =
        body.clientUnknown === true
          ? await resolveSupervisedRuntimeTarget({ serial, runtime })
          : undefined;
      if (clientTarget) {
        assertClientUnknownReviewAllowed({
          mutationId,
          platform: clientTarget.platform,
          health: runtime.readTargetHealth(clientTarget.id, clientTarget.platform),
          reconcilePending: body.reconcilePending,
        });
      }
      const latest = readReconcileReceipt({ ...receiptScope, serial, mutationId });
      const stored = body.resolutionId
        ? (readReconcileReceipt({
            ...receiptScope,
            serial,
            mutationId,
            resolutionId: body.resolutionId,
          }) ?? (latest?.outcome !== "ambiguous" ? latest : undefined))
        : latest;
      if (stored) {
        // A prepared decision survives a crash between persistence and transition.
        // Recover the fence only; never replay input or take another observation.
        if (!stored.healthSnapshot) {
          const target = await resolveSupervisedRuntimeTarget({ serial, runtime });
          const current = runtime.readTargetHealth(target.id, target.platform);
          if (stored.review) {
            assertClientUnknownReviewAllowed({
              mutationId,
              platform: target.platform,
              health: current,
            });
          }
          if (current.input.pendingMutationId && current.input.pendingMutationId !== mutationId) {
            throw new HttpError(
              409,
              "A newer input needs review before this decision can be recovered",
            );
          }
          const health =
            current.input.state === "uncertain" &&
            current.input.pendingMutationId === mutationId &&
            stored.outcome !== "acknowledged"
              ? runtime.reconcileTargetInput(target.id, target.platform, {
                  mutationId,
                  observationId: stored.observationId!,
                  outcome: stored.outcome,
                })
              : current;
          const completed = completeReconcileReceipt({
            ...receiptScope,
            receipt: stored,
            health: health.input,
            healthSnapshot: { ...health, visibility: "project" },
          });
          Object.assign(stored, completed);
        }
        json(response, 200, {
          health: stored.healthSnapshot ?? {
            input: stored.health ?? { state: "ready" },
            visibility: "project",
          },
          ...(stored.observation ? { observation: stored.observation } : {}),
          mutationId: stored.mutationId,
          outcome: stored.outcome,
          ...(stored.review ? { review: stored.review } : {}),
          resolutionId: stored.resolutionId,
        });
        return true;
      }
      if (clientTarget) {
        const receipt = await completeClientUnknownInputReview({
          scope,
          serial,
          mutationId,
          outcome: body.outcome,
          target: clientTarget,
          runtime,
          ...(body.resolutionId ? { resolutionId: body.resolutionId } : {}),
        });
        json(response, 200, {
          health: receipt.healthSnapshot,
          observation: receipt.observation,
          mutationId: receipt.mutationId,
          outcome: receipt.outcome,
          resolutionId: receipt.resolutionId,
          review: receipt.review,
        });
        return true;
      }
      const resolved = await resolveSupervisedRuntimeTarget({ serial, runtime });
      const before = runtime.readTargetHealth(resolved.id, resolved.platform);
      if (before.input.state !== "uncertain" || before.input.pendingMutationId !== mutationId) {
        throw new HttpError(409, "The target has no matching uncertain mutation to reconcile", {
          code: "TARGET_INPUT_RECONCILIATION_STALE",
        });
      }
      // Capture after authority and pending-id checks, but before releasing the
      // exact mutation fence. The reviewed decision is therefore bound to a
      // fresh immutable observation rather than a caller-supplied evidence id.
      const observation = await runtime.captureTargetObservation(serial);
      const prepared = rememberReconcileReceipt({
        ...receiptScope,
        serial,
        mutationId,
        ...(body.resolutionId ? { resolutionId: body.resolutionId } : {}),
        outcome: body.outcome,
        observationId: durableObservationId(observation),
        observation,
      });
      const health = runtime.reconcileTargetInput(resolved.id, resolved.platform, {
        mutationId,
        observationId: durableObservationId(observation),
        outcome: body.outcome,
      });
      recordAudit(scope, {
        action: "target.input.reconcile",
        resource: mutationId,
        target: serial,
        result: body.outcome === "ambiguous" ? "deny" : "allow",
      });
      const receipt = completeReconcileReceipt({
        ...receiptScope,
        receipt: prepared,
        health: {
          state: health.input.state,
          ...(health.input.pendingMutationId
            ? { pendingMutationId: health.input.pendingMutationId }
            : {}),
          ...(health.input.reason ? { reason: health.input.reason } : {}),
        },
        healthSnapshot: { ...health, visibility: "project" },
      });
      json(response, 200, {
        health: { ...health, visibility: "project" },
        observation,
        mutationId: receipt.mutationId,
        outcome: receipt.outcome,
        resolutionId: receipt.resolutionId,
      });
      return true;
    });
  }

  if (method === "GET" && pathname === "/device/input/receipt") {
    const url = new URL(request.url ?? pathname, "http://relay.local");
    const serial = url.searchParams.get("serial")?.trim() ?? "";
    const mutationId = url.searchParams.get("mutationId")?.trim() ?? "";
    const resolutionId = url.searchParams.get("resolutionId")?.trim() ?? "";
    if (!serial && !resolutionId) throw new HttpError(400, "serial or resolutionId is required");
    const receipt = readReconcileReceipt({
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      ...(resolutionId ? { resolutionId } : {}),
      ...(serial ? { serial } : {}),
      ...(mutationId ? { mutationId } : {}),
    });
    if (!receipt) throw new HttpError(404, "No durable reconciliation receipt for that mutation");
    if (!receipt.healthSnapshot)
      throw new HttpError(
        409,
        "Reconciliation is still completing. Retry the same reconciliation attempt.",
      );
    json(response, 200, {
      receipt: {
        resolutionId: receipt.resolutionId,
        mutationId: receipt.mutationId,
        outcome: receipt.outcome,
        reviewedAt: receipt.reviewedAt,
        ...(receipt.health ? { health: receipt.health } : {}),
        ...(receipt.observation ? { observation: receipt.observation } : {}),
        ...(receipt.review ? { review: receipt.review } : {}),
      },
    });
    return true;
  }

  return false;
}
