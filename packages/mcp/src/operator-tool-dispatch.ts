import { ApiError } from "@relay/client";
import type { OperationId } from "@relay/protocol";
import { pngScreenshotRecord } from "./png-result.js";
import { relayOperatorTools, type RelayOperatorToolDescriptor } from "./operator-tools.js";

type OperationInvoker = {
  invoke(
    operationId: OperationId,
    input: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ): Promise<unknown>;
};

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function laneIdFrom(parsed: Record<string, unknown>): string | undefined {
  return typeof parsed.laneId === "string" && parsed.laneId.trim() ? parsed.laneId : undefined;
}

/** Public verbs say targetId; target operations call the same id serial. */
function controlTarget(parsed: Record<string, unknown>): Record<string, unknown> {
  const laneId = laneIdFrom(parsed);
  return {
    ...(typeof parsed.targetId === "string" ? { serial: parsed.targetId } : {}),
    ...(laneId ? { laneId } : {}),
  };
}

/** The serial `target.recover` already accepts. A browser Lane uses its managed target id. */
export function recoverSerialFromLane(
  lane: { target?: { kind?: string; serial?: string; browserTargetId?: string } } | undefined,
  laneId: string,
): string {
  if (!lane?.target) throw new Error(`Lane ${laneId} was not found.`);
  const serial = lane.target.kind === "device" ? lane.target.serial : lane.target.browserTargetId;
  if (!serial) throw new Error(`Lane ${laneId} has no recoverable target.`);
  return serial;
}

function serialFrom(input: Record<string, unknown>): string | undefined {
  if (typeof input.serial === "string" && input.serial.trim()) return input.serial;
  const targetValue = object(input.target);
  if (targetValue?.kind === "device" && typeof targetValue.targetId === "string") {
    return targetValue.targetId;
  }
  if (typeof input.deviceSerial === "string") return input.deviceSerial;
  return undefined;
}

function interactKind(parsed: Record<string, unknown>, preview = false): Record<string, unknown> {
  const base = { ...controlTarget(parsed), ...(preview ? { preview: true } : {}) };
  if (object(parsed.from) && object(parsed.to)) {
    return {
      ...base,
      kind: "swipe",
      from: parsed.from,
      to: parsed.to,
      ...(typeof parsed.durationMs === "number" ? { durationMs: parsed.durationMs } : {}),
    };
  }
  if (typeof parsed.identifier === "string") {
    return { ...base, kind: "identifier", identifier: parsed.identifier };
  }
  if (typeof parsed.label === "string") return { ...base, kind: "label", label: parsed.label };
  if (typeof parsed.text === "string") {
    return { ...base, kind: "text-match", match: parsed.text };
  }
  return { ...base, kind: "point", x: parsed.x, y: parsed.y };
}

function leaseIdFrom(result: unknown): string | undefined {
  const lease = object(object(result)?.lease) ?? object(result);
  return typeof lease?.id === "string" ? lease.id : undefined;
}

function isoTime(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === "string" && value.trim()) return value;
  return undefined;
}

function holderFromLease(lease: Record<string, unknown> | undefined): {
  owner: string;
  since: string;
} {
  const owner =
    typeof lease?.ownerId === "string" && lease.ownerId.trim() ? lease.ownerId : "another actor";
  return { owner, since: isoTime(lease?.leasedAt) ?? "unknown" };
}

function heldByError(error: ApiError, owner: string, since: string): ApiError {
  const message = `held by ${owner} since ${since}`;
  const body = object(error.body) ?? {};
  return new ApiError(error.status || 403, message, { ...body, error: message });
}

async function resolveHolder(
  error: ApiError,
  invoker: OperationInvoker,
  serial: string | undefined,
  signal: AbortSignal,
): Promise<{ owner: string; since: string }> {
  const body = object(error.body);
  const active = object(body?.activeLease);
  let owner = typeof active?.ownerId === "string" ? active.ownerId : undefined;
  let since = isoTime(active?.leasedAt);
  if ((owner && since && since !== "unknown") || !serial) {
    return { owner: owner ?? "another actor", since: since ?? "unknown" };
  }
  try {
    const listed = await invoker.invoke("lease.list", { status: "active" }, { signal });
    const leases = object(listed)?.leases;
    const match = Array.isArray(leases)
      ? leases
          .map(object)
          .find(
            (lease) =>
              lease &&
              lease.status === "leased" &&
              (lease.deviceSerial === serial || lease.deviceSerial === undefined),
          )
      : undefined;
    const holder = holderFromLease(match);
    return {
      owner: owner ?? holder.owner,
      since: since ?? holder.since,
    };
  } catch {
    return { owner: owner ?? "another actor", since: since ?? "unknown" };
  }
}

async function invokeWithAutoLease(
  invoker: OperationInvoker,
  operationId: OperationId,
  input: Record<string, unknown>,
  signal: AbortSignal,
): Promise<unknown> {
  const run = (payload: Record<string, unknown>) =>
    invoker.invoke(operationId, payload, { signal });
  try {
    return await run(input);
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    const code = object(error.body)?.code;
    const serial = serialFrom(input);
    if (code === "TARGET_CONTROL_LEASE_REQUIRED" && serial) {
      try {
        const created = await invoker.invoke(
          "lease.create",
          { poolId: "local", deviceSerial: serial },
          { signal },
        );
        const leaseId = leaseIdFrom(created);
        const retry = leaseId && typeof input.leaseId !== "string" ? { ...input, leaseId } : input;
        return await run(retry);
      } catch (leaseError) {
        if (
          leaseError instanceof ApiError &&
          leaseError.status === 403 &&
          object(leaseError.body)?.code === "TARGET_CONTROL_LEASE_CONFLICT"
        ) {
          const holder = await resolveHolder(leaseError, invoker, serial, signal);
          throw heldByError(leaseError, holder.owner, holder.since);
        }
        throw leaseError;
      }
    }
    if (error.status === 403 && code === "TARGET_CONTROL_LEASE_CONFLICT") {
      const holder = await resolveHolder(error, invoker, serial, signal);
      throw heldByError(error, holder.owner, holder.since);
    }
    throw error;
  }
}

function pngResult(result: unknown): boolean {
  return pngScreenshotRecord(result) !== undefined;
}

export function operatorResultIsPng(name: string, result: unknown): boolean {
  return (name === "relay_screenshot" || name === "relay_preview") && pngResult(result);
}

/**
 * Validate and dispatch one device verb. Auto-creates a lease on
 * TARGET_CONTROL_LEASE_REQUIRED and rewrites lease-conflict 403s to held-by copy.
 */
export async function invokeRelayOperatorTool(input: {
  name: RelayOperatorToolDescriptor["name"];
  argumentsValue: Record<string, unknown>;
  invoker: OperationInvoker;
  signal: AbortSignal;
}): Promise<unknown> {
  const descriptor = relayOperatorTools.find(({ name }) => name === input.name);
  if (!descriptor) throw new TypeError(`Unknown Relay device tool: ${input.name}`);
  const parsed = descriptor.inputSchema.parse(input.argumentsValue) as Record<string, unknown>;
  const { invoker, signal } = input;
  const call = (operationId: OperationId, payload: Record<string, unknown>) =>
    invokeWithAutoLease(invoker, operationId, payload, signal);

  switch (input.name) {
    case "relay_screenshot":
      return call("target.screenshot.capture", {
        ...controlTarget(parsed),
        ...(typeof parsed.previewX === "number" ? { previewX: parsed.previewX } : {}),
        ...(typeof parsed.previewY === "number" ? { previewY: parsed.previewY } : {}),
      });
    case "relay_preview":
      return call("target.interact", interactKind(parsed, true));
    case "relay_tap":
      return call("target.interact", interactKind(parsed));
    case "relay_type":
      return call("target.interact", {
        ...controlTarget(parsed),
        kind: "type",
        text: parsed.text,
        ...(typeof parsed.identifier === "string" || typeof parsed.label === "string"
          ? {
              target: {
                ...(typeof parsed.identifier === "string" ? { identifier: parsed.identifier } : {}),
                ...(typeof parsed.label === "string" ? { label: parsed.label } : {}),
              },
            }
          : {}),
      });
    case "relay_swipe":
      return call("target.interact", {
        ...controlTarget(parsed),
        kind: "swipe",
        from: parsed.from,
        to: parsed.to,
        ...(typeof parsed.durationMs === "number" ? { durationMs: parsed.durationMs } : {}),
      });
    case "relay_press_key":
      return call("target.interact", { ...controlTarget(parsed), kind: "key", key: parsed.key });
    case "relay_launch_app":
      return call("target.app.launch", {
        serial: parsed.targetId,
        app: parsed.app,
        ...(typeof parsed.relaunch === "boolean" ? { relaunch: parsed.relaunch } : {}),
      });
    case "relay_recover": {
      if (typeof parsed.targetId === "string") {
        return call("target.recover", { serial: parsed.targetId });
      }
      const laneId = laneIdFrom(parsed)!;
      const listed = (await invoker.invoke("lane.list", {}, { signal })) as {
        lanes?: Array<{
          id: string;
          target?: { kind?: string; serial?: string; browserTargetId?: string };
        }>;
      };
      const lane = listed.lanes?.find((item) => item.id === laneId);
      return call("target.recover", { serial: recoverSerialFromLane(lane, laneId) });
    }
    default:
      throw new TypeError(`Unknown Relay device tool: ${input.name}`);
  }
}
