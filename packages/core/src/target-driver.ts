import {
  assertExecutionTargetRef,
  executionTargetRefKey,
  EXECUTION_TARGET_REF_VERSION,
  LOCAL_AGENT_DEVICE_PROVIDER_KEY,
  LOCAL_BROWSER_PROVIDER_KEY,
  type ExecutionTargetDriverCapability,
  type ExecutionTargetDriverCapabilityAvailability,
  type ExecutionTargetProvider,
  type ExecutionTargetRef,
  type LocalAgentDeviceExecutionTargetRef,
} from "@relay/protocol";
import type { Device } from "./device.js";
import { createDeviceForTarget } from "./device-factory.js";
import type { TestJob } from "./session-contract.js";
import { runWithTargetContext, type TargetContext } from "./target-context.js";

/** A small, provider-neutral recovery request. Platform-specific recovery
 * diagnostics stay behind the driver implementation until a caller opts in to
 * its concrete result type. */
export type TargetDriverRecoveryRequest = {
  reason: "connect" | "observe" | "control" | "record" | "auto";
};

export type TargetDriverRecoveryResult = {
  recovered: boolean;
  ready: boolean;
  summary: string;
};

/** The callback runs with the selected target context installed. `device` is
 * Relay's observation facade; canonical control helpers remain the only path
 * to physical input. */
export type TargetDriverSession = Readonly<{
  target: ExecutionTargetRef;
  context: TargetContext;
  device: Device;
}>;

export type TargetDriverTargetRunner = <T>(
  target: ExecutionTargetRef,
  operation: (session: TargetDriverSession) => T | Promise<T>,
) => Promise<T>;

export type TargetDriverBoundTargetSurface = {
  availability(target: ExecutionTargetRef): ExecutionTargetDriverCapabilityAvailability;
  withTarget: TargetDriverTargetRunner;
};

export type TargetDriverInventorySurface = {
  availability(): ExecutionTargetDriverCapabilityAvailability;
  list(): Promise<readonly ExecutionTargetRef[]>;
};

export type TargetDriverRecoverySurface = {
  availability(target: ExecutionTargetRef): ExecutionTargetDriverCapabilityAvailability;
  recover(
    target: ExecutionTargetRef,
    request: TargetDriverRecoveryRequest,
  ): Promise<TargetDriverRecoveryResult>;
};

/**
 * Provider boundary for target inventory, bounded execution, evidence capture,
 * and recovery. Capability availability is derived from an installed operation
 * and a target-support check — it is never a free-standing marketing claim.
 */
export type TargetDriver = {
  readonly provider: ExecutionTargetProvider;
  readonly inventory: TargetDriverInventorySurface;
  readonly control: TargetDriverBoundTargetSurface;
  readonly capture: TargetDriverBoundTargetSurface;
  readonly recovery: TargetDriverRecoverySurface;
};

export type TargetDriverUnavailableReason = Extract<
  ExecutionTargetDriverCapabilityAvailability,
  { state: "unavailable" }
>["reason"];

export class TargetDriverCapabilityUnavailableError extends Error {
  readonly code = "TARGET_DRIVER_CAPABILITY_UNAVAILABLE" as const;

  constructor(
    readonly provider: string,
    readonly capability: ExecutionTargetDriverCapability,
    readonly reason: TargetDriverUnavailableReason,
    readonly target?: ExecutionTargetRef,
  ) {
    super(
      `Target driver ${provider} cannot ${capability}${target ? ` for ${target.targetId}` : ""}: ${reason}`,
    );
    this.name = "TargetDriverCapabilityUnavailableError";
  }
}

export type CreateTargetDriverOptions = {
  provider: ExecutionTargetProvider;
  /** Return a product-safe reason when this provider does not own the target. */
  supportsTarget?: (target: ExecutionTargetRef) => TargetDriverUnavailableReason | undefined;
  list?: () => Promise<readonly ExecutionTargetRef[]>;
  control?: TargetDriverTargetRunner;
  capture?: TargetDriverTargetRunner;
  recover?: (
    target: ExecutionTargetRef,
    request: TargetDriverRecoveryRequest,
  ) => Promise<TargetDriverRecoveryResult>;
};

function unavailable(
  capability: ExecutionTargetDriverCapability,
  reason: TargetDriverUnavailableReason,
): ExecutionTargetDriverCapabilityAvailability {
  return { capability, state: "unavailable", reason };
}

function available(
  capability: ExecutionTargetDriverCapability,
): ExecutionTargetDriverCapabilityAvailability {
  return { capability, state: "available" };
}

function requireProvider(provider: ExecutionTargetProvider): ExecutionTargetProvider {
  if (!provider.key.trim()) throw new Error("Target driver provider key is required");
  if (provider.scope !== "local" && provider.scope !== "remote") {
    throw new Error("Target driver provider scope must be local or remote");
  }
  return Object.freeze({ key: provider.key, scope: provider.scope });
}

function targetAvailability(
  capability: Exclude<ExecutionTargetDriverCapability, "inventory">,
  target: ExecutionTargetRef,
  operation: unknown,
  supportsTarget: (target: ExecutionTargetRef) => TargetDriverUnavailableReason | undefined,
): ExecutionTargetDriverCapabilityAvailability {
  const unsupported = supportsTarget(target);
  if (unsupported) return unavailable(capability, unsupported);
  return operation ? available(capability) : unavailable(capability, "not-configured");
}

function requireAvailable(
  provider: ExecutionTargetProvider,
  availability: ExecutionTargetDriverCapabilityAvailability,
  target?: ExecutionTargetRef,
): void {
  if (availability.state === "available") return;
  throw new TargetDriverCapabilityUnavailableError(
    provider.key,
    availability.capability,
    availability.reason,
    target,
  );
}

/**
 * Build a driver from concrete operation handlers. Supplying no handler makes
 * the corresponding surface unavailable, and a target rejected by
 * `supportsTarget` remains unavailable even if a handler was installed.
 */
export function createTargetDriver(options: CreateTargetDriverOptions): TargetDriver {
  const provider = requireProvider(options.provider);
  const supportsTarget = (
    target: ExecutionTargetRef,
  ): TargetDriverUnavailableReason | undefined => {
    const unsupported = options.supportsTarget?.(target);
    if (unsupported) return unsupported;
    if (target.provider.key !== provider.key || target.provider.scope !== provider.scope) {
      return "provider-mismatch";
    }
    return undefined;
  };
  const inventoryAvailability = () =>
    options.list ? available("inventory") : unavailable("inventory", "not-configured");
  const surface = (
    capability: "control" | "capture",
    runner: TargetDriverTargetRunner | undefined,
  ): TargetDriverBoundTargetSurface => ({
    availability: (target) => targetAvailability(capability, target, runner, supportsTarget),
    withTarget: async (target, operation) => {
      const availability = targetAvailability(capability, target, runner, supportsTarget);
      requireAvailable(provider, availability, target);
      return await runner!(target, operation);
    },
  });
  const recovery: TargetDriverRecoverySurface = {
    availability: (target) =>
      targetAvailability("recovery", target, options.recover, supportsTarget),
    recover: async (target, request) => {
      const availability = targetAvailability("recovery", target, options.recover, supportsTarget);
      requireAvailable(provider, availability, target);
      return await options.recover!(target, request);
    },
  };
  return Object.freeze({
    provider,
    inventory: Object.freeze({
      availability: inventoryAvailability,
      list: async () => {
        const availability = inventoryAvailability();
        requireAvailable(provider, availability);
        return await options.list!();
      },
    }),
    control: Object.freeze(surface("control", options.control)),
    capture: Object.freeze(surface("capture", options.capture)),
    recovery: Object.freeze(recovery),
  });
}

/** Convert current local/browser/cloud context plumbing to the serializable
 * execution contract without changing any existing caller semantics. */
export function executionTargetRefFromTargetContext(context: TargetContext): ExecutionTargetRef {
  switch (context.kind) {
    case "device":
      return {
        schemaVersion: EXECUTION_TARGET_REF_VERSION,
        kind: "local-device",
        provider: { key: LOCAL_AGENT_DEVICE_PROVIDER_KEY, scope: "local" },
        targetId: context.serial,
        platform: context.platform,
        identity: { kind: "device-serial", value: context.serial },
      };
    case "browser":
      return {
        schemaVersion: EXECUTION_TARGET_REF_VERSION,
        kind: "local-browser",
        provider: { key: LOCAL_BROWSER_PROVIDER_KEY, scope: "local" },
        targetId: context.targetId,
        platform: "browser",
        identity: { kind: "browser-target", value: context.targetId },
      };
    case "cloud":
      return {
        schemaVersion: EXECUTION_TARGET_REF_VERSION,
        kind: "provider-session",
        provider: { key: context.provider, scope: "remote" },
        targetId: context.sessionId,
        platform: context.platform,
        identity: { kind: "provider-session", value: context.sessionId },
      };
  }
}

/**
 * Return a canonical target ref for both newly-created jobs and legacy jobs
 * that only carry the older TargetContext projection. The fallback is kept in
 * one place so schedulers and durable stores never have to guess whether a
 * bare serial belongs to a local host or a remote provider.
 */
export function executionTargetRefForJob(
  job: Pick<TestJob, "executionTarget" | "targetContext">,
): ExecutionTargetRef {
  const target = job.executionTarget ?? executionTargetRefFromTargetContext(job.targetContext);
  assertExecutionTargetRef(target);
  return target;
}

/**
 * Stable scheduler identity. Existing local targets retain their familiar
 * serial/browser id for status compatibility. Remote sessions include their
 * provider-scoped ref key, so a provider session can never contend with a
 * coincidentally named local serial.
 */
export function executionTargetSchedulingKey(target: ExecutionTargetRef): string {
  assertExecutionTargetRef(target);
  return target.kind === "provider-session"
    ? `remote:${executionTargetRefKey(target)}`
    : target.identity.value;
}

/** Compatibility bridge for entry points that still use the current local
 * TargetContext. It preserves every existing device/browser/cloud identity and
 * rejects malformed provider references rather than guessing a local target. */
export function targetContextFromExecutionTargetRef(target: ExecutionTargetRef): TargetContext {
  assertExecutionTargetRef(target);
  switch (target.kind) {
    case "local-device":
      return {
        kind: "device",
        platform: target.platform,
        serial: target.identity.value,
      };
    case "local-browser":
      return { kind: "browser", platform: "browser", targetId: target.identity.value };
    case "provider-session":
      return {
        kind: "cloud",
        provider: target.provider.key,
        sessionId: target.identity.value,
        platform: target.platform,
      };
  }
}

function localAgentDeviceSupport(
  target: ExecutionTargetRef,
): TargetDriverUnavailableReason | undefined {
  if (target.kind !== "local-device") return "target-kind-unsupported";
  if (
    target.provider.key !== LOCAL_AGENT_DEVICE_PROVIDER_KEY ||
    target.provider.scope !== "local"
  ) {
    return "provider-mismatch";
  }
  return undefined;
}

export type CreateLocalAgentDeviceTargetDriverOptions = {
  /** Discovery is deliberately injected: listing devices needs an explicit
   * host/session policy and must not silently create an ambient SDK client. */
  list?: () => Promise<readonly LocalAgentDeviceExecutionTargetRef[]>;
  /** Host-specific recovery belongs to the caller until its durable semantics
   * are wired through the scheduler and lease owner. */
  recover?: (
    target: LocalAgentDeviceExecutionTargetRef,
    request: TargetDriverRecoveryRequest,
  ) => Promise<TargetDriverRecoveryResult>;
};

/**
 * Local-first adapter over the working AgentDevice client. It provides bounded
 * control and capture scopes for real local devices today. Inventory and
 * recovery are intentionally unavailable unless a caller installs explicit,
 * host-aware implementations; that prevents a future provider seam from
 * over-claiming cloud or fleet parity.
 */
export function createLocalAgentDeviceTargetDriver(
  options: CreateLocalAgentDeviceTargetDriverOptions = {},
): TargetDriver {
  const withLocalTarget: TargetDriverTargetRunner = async (target, operation) => {
    const context = targetContextFromExecutionTargetRef(target);
    if (context.kind !== "device") {
      throw new TargetDriverCapabilityUnavailableError(
        LOCAL_AGENT_DEVICE_PROVIDER_KEY,
        "control",
        "target-kind-unsupported",
        target,
      );
    }
    return await runWithTargetContext(context, async () => {
      const session: TargetDriverSession = Object.freeze({
        target,
        context,
        device: createDeviceForTarget(context),
      });
      return await operation(session);
    });
  };
  return createTargetDriver({
    provider: { key: LOCAL_AGENT_DEVICE_PROVIDER_KEY, scope: "local" },
    supportsTarget: localAgentDeviceSupport,
    ...(options.list ? { list: options.list } : {}),
    control: withLocalTarget,
    capture: withLocalTarget,
    ...(options.recover
      ? {
          recover: (target, request) => {
            if (target.kind !== "local-device") {
              throw new TargetDriverCapabilityUnavailableError(
                LOCAL_AGENT_DEVICE_PROVIDER_KEY,
                "recovery",
                "target-kind-unsupported",
                target,
              );
            }
            return options.recover!(target, request);
          },
        }
      : {}),
  });
}

/** Default local implementation. It makes no unproven inventory or recovery
 * promise; callers can create a configured driver when those host seams exist. */
export const localAgentDeviceTargetDriver = createLocalAgentDeviceTargetDriver();
