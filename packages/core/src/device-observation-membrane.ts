import type { Device } from "./device.js";

type UnknownRecord = Record<PropertyKey, unknown>;
type UnknownMethod = (...args: unknown[]) => unknown;

/**
 * Private association between the narrow, public observation value and its
 * complete adapter. The adapter is intentionally reachable only by canonical
 * helpers in `device.ts`; a public Device never carries it as a property.
 *
 * This is a capability boundary inside Relay's trusted Node process, not a
 * security sandbox. Repository code can still deliberately import private
 * source files or mutate an adapter before it is wrapped. The package export
 * and architecture checks make that exceptional choice reviewable.
 */
const sourceByObservationDevice = new WeakMap<object, object>();
const observationDeviceBySource = new WeakMap<object, Device>();

function asRecord(value: unknown): UnknownRecord | undefined {
  return value !== null && (typeof value === "object" || typeof value === "function")
    ? (value as UnknownRecord)
    : undefined;
}

function frozenRecord(entries: Record<string, unknown>): Readonly<Record<string, unknown>> {
  return Object.freeze(Object.assign(Object.create(null) as Record<string, unknown>, entries));
}

function unavailable(capability: string): UnknownMethod {
  return Object.freeze((..._args: unknown[]) => {
    throw new Error(`Device observation capability is unavailable: ${capability}`);
  });
}

/** Copy a callable into a closure without copying its owning adapter object. */
function observationMethod(source: unknown, name: string, capability: string): UnknownMethod {
  const owner = asRecord(source);
  const candidate = owner?.[name];
  if (typeof candidate !== "function" || !owner) return unavailable(capability);
  return Object.freeze((...args: unknown[]) => Reflect.apply(candidate, owner, args));
}

/**
 * The SDK's `find` command can physically click. Public Device values may
 * expose its observation form only, and runtime callers receive the same rule
 * even when they bypass the TypeScript `action: "exists"` type with a cast.
 */
function observationFind(source: unknown): UnknownMethod {
  const invoke = observationMethod(source, "find", "interactions.find");
  return Object.freeze((input: unknown) => {
    const options = asRecord(input);
    if (options?.action !== "exists") {
      throw new Error(
        'Device observation facade only permits interactions.find({ action: "exists" })',
      );
    }
    return invoke({ ...options, action: "exists" });
  });
}

/**
 * Create a fresh, frozen public Device value that contains only observation
 * capabilities. The source can be a local agent-device client, managed-browser
 * adapter, cloud provider, or named test double; it stays in the private
 * association used by canonical mutation helpers.
 */
export function createDeviceObservationFacade(source: object): Device {
  const existingFacade = observationDeviceBySource.get(source);
  if (existingFacade) return existingFacade;

  // Idempotence lets provider adapters return an already-wrapped public Device
  // without accidentally creating a facade whose private source is another
  // facade (which would lose canonical dispatch).
  if (sourceByObservationDevice.has(source)) return source as Device;

  const root = asRecord(source);
  const facade = Object.freeze(
    frozenRecord({
      devices: frozenRecord({
        list: observationMethod(root?.devices, "list", "devices.list"),
      }),
      capture: frozenRecord({
        snapshot: observationMethod(root?.capture, "snapshot", "capture.snapshot"),
        screenshot: observationMethod(root?.capture, "screenshot", "capture.screenshot"),
      }),
      interactions: frozenRecord({
        find: observationFind(root?.interactions),
      }),
      command: frozenRecord({
        wait: observationMethod(root?.command, "wait", "command.wait"),
        appState: observationMethod(root?.command, "appState", "command.appState"),
      }),
      observability: frozenRecord({
        perf: observationMethod(root?.observability, "perf", "observability.perf"),
        logs: observationMethod(root?.observability, "logs", "observability.logs"),
        network: observationMethod(root?.observability, "network", "observability.network"),
        audio: observationMethod(root?.observability, "audio", "observability.audio"),
        crashes: observationMethod(root?.observability, "crashes", "observability.crashes"),
      }),
    }),
  ) as unknown as Device;
  sourceByObservationDevice.set(facade, source);
  observationDeviceBySource.set(source, facade);
  return facade;
}

/**
 * Dispatcher-private lookup. It is intentionally not exported from a package
 * entrypoint; ordinary workflow modules only receive the observation facade.
 */
export function canonicalDeviceSource(device: Device): object | undefined {
  return sourceByObservationDevice.get(device as object);
}
