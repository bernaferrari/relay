/**
 * Provider-neutral identity for a target that can execute Relay work.
 *
 * This is intentionally narrower than a target profile: it answers where an
 * operation runs, not what Relay happened to observe there. Keeping identity
 * independent from inventory/readiness lets a future provider be introduced
 * without teaching every persisted recipe about provider-specific session
 * handles.
 */
export const EXECUTION_TARGET_REF_VERSION = 1 as const;

/** Stable key for the local AgentDevice adapter; not a host name or serial. */
export const LOCAL_AGENT_DEVICE_PROVIDER_KEY = "relay.local.agent-device" as const;

/** Stable key for Relay's managed local-browser adapter. */
export const LOCAL_BROWSER_PROVIDER_KEY = "relay.local.browser" as const;

export type ExecutionTargetProviderScope = "local" | "remote";

/** Provider identity is explicit so a serial is never accidentally treated as
 * globally unique across a local host and a future device farm. */
export type ExecutionTargetProvider = {
  key: string;
  scope: ExecutionTargetProviderScope;
};

export type ExecutionTargetIdentity =
  | { kind: "device-serial"; value: string }
  | { kind: "browser-target"; value: string }
  | { kind: "provider-session"; value: string };

/** A physical Android or iOS target controlled by the local AgentDevice host. */
export type LocalAgentDeviceExecutionTargetRef = {
  schemaVersion: typeof EXECUTION_TARGET_REF_VERSION;
  kind: "local-device";
  provider: {
    key: typeof LOCAL_AGENT_DEVICE_PROVIDER_KEY;
    scope: "local";
  };
  /** Stable Relay scheduling identity. Today this is the serial/UDID. */
  targetId: string;
  platform: "android" | "ios";
  identity: { kind: "device-serial"; value: string };
};

/** A managed browser target owned by this Relay workspace. */
export type LocalBrowserExecutionTargetRef = {
  schemaVersion: typeof EXECUTION_TARGET_REF_VERSION;
  kind: "local-browser";
  provider: {
    key: typeof LOCAL_BROWSER_PROVIDER_KEY;
    scope: "local";
  };
  targetId: string;
  platform: "browser";
  identity: { kind: "browser-target"; value: string };
};

/** A provider-owned mobile session. This is an identity only — it does not
 * imply that Relay has a cloud SDK, a lease, or equivalent capabilities. */
export type ProviderSessionExecutionTargetRef = {
  schemaVersion: typeof EXECUTION_TARGET_REF_VERSION;
  kind: "provider-session";
  provider: {
    key: string;
    scope: "remote";
  };
  /** Provider-stable scheduling identity. Existing local bridges use sessionId. */
  targetId: string;
  platform: "android" | "ios";
  identity: { kind: "provider-session"; value: string };
};

/**
 * A discriminated, serializable execution target reference. It deliberately
 * contains no credentials, endpoint URLs, or provider-native payloads.
 */
export type ExecutionTargetRef =
  | LocalAgentDeviceExecutionTargetRef
  | LocalBrowserExecutionTargetRef
  | ProviderSessionExecutionTargetRef;

/** Provider-driver surfaces are kept distinct from the much more detailed
 * per-target runtime readiness facts. `available` means only that a concrete
 * adapter owns an operation boundary; it never claims the device is currently
 * healthy or that a particular selector can be resolved. */
export const EXECUTION_TARGET_DRIVER_CAPABILITIES = [
  "inventory",
  "control",
  "capture",
  "recovery",
] as const;

export type ExecutionTargetDriverCapability = (typeof EXECUTION_TARGET_DRIVER_CAPABILITIES)[number];

export type ExecutionTargetDriverCapabilityAvailability =
  | {
      capability: ExecutionTargetDriverCapability;
      state: "available";
    }
  | {
      capability: ExecutionTargetDriverCapability;
      state: "unavailable";
      /** Product-safe reason. Native diagnostics belong to the attempted operation. */
      reason: "not-configured" | "provider-mismatch" | "target-kind-unsupported";
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Runtime guard for persisted or transport-supplied target references. */
export function isExecutionTargetRef(value: unknown): value is ExecutionTargetRef {
  if (!isRecord(value) || value.schemaVersion !== EXECUTION_TARGET_REF_VERSION) return false;
  if (!nonEmptyString(value.targetId) || !isRecord(value.provider) || !isRecord(value.identity)) {
    return false;
  }
  if (!nonEmptyString(value.provider.key) || !nonEmptyString(value.identity.value)) return false;
  // `targetId` is the public scheduling projection while `identity.value` is
  // the provider-scoped canonical identity. Keeping two divergent values would
  // let inventory, worker lanes, and durable evidence describe different
  // targets, so every currently supported target kind requires one value.
  if (value.targetId !== value.identity.value) return false;

  switch (value.kind) {
    case "local-device":
      return (
        (value.platform === "android" || value.platform === "ios") &&
        value.provider.key === LOCAL_AGENT_DEVICE_PROVIDER_KEY &&
        value.provider.scope === "local" &&
        value.identity.kind === "device-serial"
      );
    case "local-browser":
      return (
        value.platform === "browser" &&
        value.provider.key === LOCAL_BROWSER_PROVIDER_KEY &&
        value.provider.scope === "local" &&
        value.identity.kind === "browser-target"
      );
    case "provider-session":
      return (
        (value.platform === "android" || value.platform === "ios") &&
        value.provider.scope === "remote" &&
        value.identity.kind === "provider-session"
      );
    default:
      return false;
  }
}

/** Fail closed at a provider boundary rather than silently treating malformed
 * serialized data as a local device. */
export function assertExecutionTargetRef(value: unknown): asserts value is ExecutionTargetRef {
  if (!isExecutionTargetRef(value)) throw new Error("Invalid execution target reference");
}

/** A provider-scoped stable key suitable for maps and leases. JSON encoding
 * avoids accidental delimiter collisions in provider or target identifiers. */
export function executionTargetRefKey(target: ExecutionTargetRef): string {
  return JSON.stringify([
    target.provider.key,
    target.kind,
    target.platform,
    target.identity.kind,
    target.identity.value,
  ]);
}
