import { assertExecutionTargetRef, type ExecutionTargetRef } from "@relay/protocol";
import {
  TargetDriverCapabilityUnavailableError,
  executionTargetRefForJob,
  type EnqueueJobInput,
  type PersistedRun,
  type TestJob,
} from "@relay/core";
import { HttpError } from "./http.js";
import { recordAudit, type RequestContext } from "./security.js";

/** Local lease assertion is deliberately string-shaped because the existing
 * AgentDevice lease store only owns local serial/browser identities. Provider
 * sessions must go through the typed boundary below instead. */
export type AssertLocalTargetControl = (
  scope: RequestContext,
  targetId?: string,
) => Promise<unknown>;

function invalidFrozenTargetHttpError(source: "job" | "run" | "enqueue"): HttpError {
  return new HttpError(409, `The ${source} has an invalid frozen execution target.`, {
    code: "EXECUTION_TARGET_INVALID",
    recovery:
      "Inspect the immutable execution record and create a new run on an explicitly selected target. Relay will not reinterpret an invalid target as a local device.",
  });
}

function validatedTarget(
  target: ExecutionTargetRef,
  source: "job" | "run" | "enqueue",
): ExecutionTargetRef {
  try {
    assertExecutionTargetRef(target);
    return target;
  } catch {
    throw invalidFrozenTargetHttpError(source);
  }
}

/**
 * Typed public result for a provider target that has no installed Relay
 * control driver. This is intentionally emitted before any local lease lookup
 * so a provider session id can never contend with, renew, or mint a local
 * device lease that happens to use the same text.
 */
export function providerTargetControlUnavailable(target: ExecutionTargetRef): HttpError {
  const unavailable = new TargetDriverCapabilityUnavailableError(
    target.provider.key,
    "control",
    "not-configured",
    target,
  );
  return new HttpError(
    409,
    `No registered Relay control driver is available for ${target.provider.key} session ${target.targetId}.`,
    {
      code: unavailable.code,
      capability: unavailable.capability,
      reason: unavailable.reason,
      provider: structuredClone(target.provider),
      target: structuredClone(target),
      recovery:
        "Register a control-capable driver for this provider session, then retry. Relay will not fall back to a local device lease.",
    },
  );
}

/**
 * Route-level control admission for an immutable execution target. Local
 * targets retain the established lease path; a provider session fails at the
 * provider boundary until a concrete driver is registered by the execution
 * host. Keeping this branch here makes retry/replay/repair agree on the same
 * no-local-fallback rule.
 */
export async function assertExecutionTargetRouteControl(input: {
  scope: RequestContext;
  target: ExecutionTargetRef;
  assertLocalTargetControl: AssertLocalTargetControl;
  source: "job" | "run" | "enqueue";
}): Promise<void> {
  const target = validatedTarget(input.target, input.source);
  if (target.kind === "provider-session") {
    recordAudit(input.scope, {
      action: "target.control",
      resource: "provider-driver",
      target: `${target.provider.key}:${target.targetId}`,
      result: "deny",
    });
    throw providerTargetControlUnavailable(target);
  }
  await input.assertLocalTargetControl(input.scope, target.identity.value);
}

/** Use a queued job's canonical target rather than its lossy serial/browser
 * compatibility fields. `executionTargetRefForJob` also upgrades an older
 * cloud TargetContext to a provider-session ref rather than guessing local. */
export async function assertJobExecutionTargetRouteControl(input: {
  scope: RequestContext;
  job: TestJob;
  assertLocalTargetControl: AssertLocalTargetControl;
}): Promise<void> {
  let target: ExecutionTargetRef;
  try {
    target = executionTargetRefForJob(input.job);
  } catch {
    throw invalidFrozenTargetHttpError("job");
  }
  await assertExecutionTargetRouteControl({
    scope: input.scope,
    target,
    assertLocalTargetControl: input.assertLocalTargetControl,
    source: "job",
  });
}

/** A persisted v5 target is authoritative. Older run records without one
 * retain the existing local-only compatibility projection. */
export async function assertPersistedRunExecutionTargetRouteControl(input: {
  scope: RequestContext;
  run: Pick<PersistedRun, "executionTarget" | "serial">;
  assertLocalTargetControl: AssertLocalTargetControl;
}): Promise<void> {
  if (!input.run.executionTarget) {
    await input.assertLocalTargetControl(input.scope, input.run.serial);
    return;
  }
  await assertExecutionTargetRouteControl({
    scope: input.scope,
    target: input.run.executionTarget,
    assertLocalTargetControl: input.assertLocalTargetControl,
    source: "run",
  });
}

/** Selective repair constructs a fresh recipe but must inherit the original
 * execution target. Check the generated enqueue input, not a legacy source
 * run serial, so a remote iOS repair remains remote all the way to the driver
 * boundary. */
export async function assertEnqueueExecutionTargetRouteControl(input: {
  scope: RequestContext;
  enqueue: Pick<EnqueueJobInput, "executionTarget" | "serial" | "browserTargetId">;
  assertLocalTargetControl: AssertLocalTargetControl;
}): Promise<void> {
  if (!input.enqueue.executionTarget) {
    await input.assertLocalTargetControl(
      input.scope,
      input.enqueue.browserTargetId ?? input.enqueue.serial,
    );
    return;
  }
  await assertExecutionTargetRouteControl({
    scope: input.scope,
    target: input.enqueue.executionTarget,
    assertLocalTargetControl: input.assertLocalTargetControl,
    source: "enqueue",
  });
}
