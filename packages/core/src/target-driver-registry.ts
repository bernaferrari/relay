/**
 * Runtime registry for explicitly installed target drivers.
 *
 * A provider-session reference is only an immutable identity. This registry
 * is the separate, host-owned proof that Relay has concrete handlers for that
 * identity. It is intentionally process-local: neither credentials nor a
 * provider implementation can be serialized into a run or a job.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import {
  assertExecutionTargetRef,
  executionTargetRefKey,
  type ExecutionTargetDriverCapability,
  type ExecutionTargetProvider,
  type ExecutionTargetRef,
} from "@relay/protocol";
import {
  createLocalAgentDeviceTargetDriver,
  TargetDriverCapabilityUnavailableError,
  type TargetDriver,
  type TargetDriverRecoveryRequest,
  type TargetDriverRecoveryResult,
  type TargetDriverSession,
} from "./target-driver.js";

type TargetDriverBoundCapability = "control" | "capture" | "recovery";
type ProviderSessionExecutionTarget = Extract<ExecutionTargetRef, { kind: "provider-session" }>;

function providerRegistryKey(provider: ExecutionTargetProvider): string {
  return JSON.stringify([provider.scope, provider.key]);
}

function unavailable(
  target: ExecutionTargetRef,
  capability: TargetDriverBoundCapability,
  reason: "not-configured" | "provider-mismatch" | "target-kind-unsupported",
): TargetDriverCapabilityUnavailableError {
  return new TargetDriverCapabilityUnavailableError(
    target.provider.key,
    capability,
    reason,
    target,
  );
}

/**
 * An explicit set of drivers available to one execution host. A duplicate
 * registration is an error rather than an implicit replacement. Host rotation
 * is deliberately an unregister/register operation; admitted jobs retain an
 * exact driver plan while later admissions see the replacement.
 */
export class TargetDriverRegistry {
  readonly #drivers = new Map<string, TargetDriver>();

  constructor(drivers: readonly TargetDriver[] = []) {
    for (const driver of drivers) this.register(driver);
  }

  register(driver: TargetDriver): void {
    const key = providerRegistryKey(driver.provider);
    if (this.#drivers.has(key)) {
      throw new Error(
        `A target driver is already registered for ${driver.provider.scope}:${driver.provider.key}`,
      );
    }
    this.#drivers.set(key, driver);
  }

  unregister(provider: ExecutionTargetProvider): boolean {
    return this.#drivers.delete(providerRegistryKey(provider));
  }

  list(): readonly ExecutionTargetProvider[] {
    return [...this.#drivers.values()]
      .map((driver) => structuredClone(driver.provider))
      .sort((left, right) =>
        `${left.scope}:${left.key}`.localeCompare(`${right.scope}:${right.key}`),
      );
  }

  /** Return the exact provider driver or fail before a local adapter can be
   * considered. This function intentionally only accepts provider sessions;
   * local device/browser behavior retains its established local-first path. */
  requireProviderDriver(
    target: ExecutionTargetRef,
    capability: TargetDriverBoundCapability,
  ): TargetDriver {
    assertExecutionTargetRef(target);
    if (target.kind !== "provider-session") {
      throw unavailable(target, capability, "target-kind-unsupported");
    }
    const driver = this.#drivers.get(providerRegistryKey(target.provider));
    if (!driver) throw unavailable(target, capability, "not-configured");
    if (
      driver.provider.key !== target.provider.key ||
      driver.provider.scope !== target.provider.scope
    ) {
      // This should be unreachable while keys are canonical, but retaining the
      // explicit guard makes an accidental registry implementation change
      // fail closed instead of selecting a local driver.
      throw unavailable(target, capability, "provider-mismatch");
    }
    return driver;
  }
}

/** Local targets are deliberately the only default registration. Remote
 * drivers must be passed by the host through `runWithTargetDriverRegistry`.
 */
export const defaultTargetDriverRegistry = new TargetDriverRegistry([
  createLocalAgentDeviceTargetDriver(),
]);

const targetDriverRegistries = new AsyncLocalStorage<TargetDriverRegistry>();

/** Execute one request/admission under a host-selected driver registry. Queue
 * admission converts this ambient registry into an exact driver plan, so later
 * scheduler execution cannot resolve against a replacement provider driver. */
export function runWithTargetDriverRegistry<T>(
  registry: TargetDriverRegistry,
  operation: () => Promise<T>,
): Promise<T>;
export function runWithTargetDriverRegistry<T>(
  registry: TargetDriverRegistry,
  operation: () => T,
): T;
export function runWithTargetDriverRegistry<T>(
  registry: TargetDriverRegistry,
  operation: () => Promise<T> | T,
): Promise<T> | T {
  return targetDriverRegistries.run(registry, operation);
}

export function currentTargetDriverRegistry(): TargetDriverRegistry {
  return targetDriverRegistries.getStore() ?? defaultTargetDriverRegistry;
}

function requireCapability(
  target: ExecutionTargetRef,
  driver: TargetDriver,
  capability: Exclude<TargetDriverBoundCapability, "recovery">,
): void {
  const availability = driver[capability].availability(target);
  if (availability.state === "available") return;
  throw unavailable(target, capability, availability.reason);
}

/**
 * Queue-time admission for a provider job. Both control and capture are
 * required because Relay's immutable run record always needs command and
 * evidence boundaries; accepting just one would yield a remote job that can
 * start but cannot produce a trustworthy execution record.
 */
export function assertProviderTargetExecutionAdmission(
  target: ExecutionTargetRef,
  registry = currentTargetDriverRegistry(),
): TargetDriver {
  const driver = registry.requireProviderDriver(target, "control");
  requireCapability(target, driver, "control");
  requireCapability(target, driver, "capture");
  return driver;
}

export type ProviderTargetExecutionSession = Readonly<{
  driver: TargetDriver;
  control: TargetDriverSession;
  capture: TargetDriverSession;
}>;

/**
 * A process-local admission record for one provider job. The target is cloned
 * and frozen, and `driver` is the exact object whose control/capture
 * availability passed at queue admission. Registry rotation affects later
 * admissions only; it can never replace this driver's queued work.
 */
export type ProviderTargetExecutionPlan = Readonly<{
  target: ProviderSessionExecutionTarget;
  driver: TargetDriver;
  capabilities: readonly ["control", "capture"];
}>;

const admittedProviderExecutionPlans = new WeakSet<ProviderTargetExecutionPlan>();
const providerExecutionCapabilities = Object.freeze(["control", "capture"] as const);

function freezeProviderSessionTarget(target: ExecutionTargetRef): ProviderSessionExecutionTarget {
  if (target.kind !== "provider-session") {
    throw new Error("Provider execution plans require a provider-session target");
  }
  const clone = structuredClone(target);
  return Object.freeze({
    ...clone,
    provider: Object.freeze({ ...clone.provider }),
    identity: Object.freeze({ ...clone.identity }),
  }) as ProviderSessionExecutionTarget;
}

/** Freeze the exact provider driver that passed control and capture admission.
 * The plan is runtime-only: callers must not persist a driver or credentials. */
export function createProviderTargetExecutionPlan(
  target: ExecutionTargetRef,
  registry = currentTargetDriverRegistry(),
): ProviderTargetExecutionPlan {
  const driver = assertProviderTargetExecutionAdmission(target, registry);
  const plan = Object.freeze({
    target: freezeProviderSessionTarget(target),
    driver,
    capabilities: providerExecutionCapabilities,
  }) as ProviderTargetExecutionPlan;
  admittedProviderExecutionPlans.add(plan);
  return plan;
}

function assertAdmittedProviderExecutionPlan(plan: ProviderTargetExecutionPlan): void {
  if (!admittedProviderExecutionPlans.has(plan)) {
    throw new Error("Provider execution plan was not admitted by this Relay process");
  }
  if (
    plan.driver.provider.key !== plan.target.provider.key ||
    plan.driver.provider.scope !== plan.target.provider.scope
  ) {
    throw unavailable(plan.target, "control", "provider-mismatch");
  }
}

/** Enter an already-admitted plan without consulting a mutable registry. A
 * retired plan may run through its admitted driver, or fail its own capability
 * check; it can never be redirected to a replacement under the same key. */
export async function withProviderTargetExecutionPlan<T>(
  plan: ProviderTargetExecutionPlan,
  operation: (session: ProviderTargetExecutionSession) => Promise<T>,
): Promise<T> {
  assertAdmittedProviderExecutionPlan(plan);
  requireCapability(plan.target, plan.driver, "control");
  requireCapability(plan.target, plan.driver, "capture");
  return await plan.driver.control.withTarget(plan.target, async (control) => {
    assertSessionOwnsTarget(plan.target, control, "control");
    return await plan.driver.capture.withTarget(plan.target, async (capture) => {
      assertSessionOwnsTarget(plan.target, capture, "capture");
      return await operation(Object.freeze({ driver: plan.driver, control, capture }));
    });
  });
}

function assertSessionOwnsTarget(
  target: ExecutionTargetRef,
  session: TargetDriverSession,
  capability: ExecutionTargetDriverCapability,
): void {
  if (executionTargetRefKey(session.target) !== executionTargetRefKey(target)) {
    throw new Error(
      `Registered provider driver returned a ${capability} session for a different execution target`,
    );
  }
  if (session.context.kind !== "cloud" || session.context.provider !== target.provider.key) {
    throw new Error(`Registered provider driver returned an invalid ${capability} target context`);
  }
}

/**
 * Enter both provider-owned scopes before Relay executes a remote job. The
 * callback receives no local AgentDevice client; a provider driver must supply
 * the complete `Device` facade itself. This is the hard no-local-fallback
 * boundary used by session execution.
 */
export async function withProviderTargetExecution<T>(
  target: ExecutionTargetRef,
  operation: (session: ProviderTargetExecutionSession) => Promise<T>,
  registry = currentTargetDriverRegistry(),
): Promise<T> {
  return await withProviderTargetExecutionPlan(
    createProviderTargetExecutionPlan(target, registry),
    operation,
  );
}

/** Provider recovery is intentionally capability-scoped. A driver that can
 * execute a session but does not implement recovery is rejected rather than
 * falling through to local `agent-device` recovery. */
export async function recoverProviderTarget(
  target: ExecutionTargetRef,
  request: TargetDriverRecoveryRequest,
  registry = currentTargetDriverRegistry(),
): Promise<TargetDriverRecoveryResult> {
  const driver = registry.requireProviderDriver(target, "recovery");
  const availability = driver.recovery.availability(target);
  if (availability.state !== "available") {
    throw unavailable(target, "recovery", availability.reason);
  }
  return await driver.recovery.recover(target, request);
}
