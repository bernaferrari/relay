import type { RelayClient } from "@relay/client";
import type {
  BrowserDeviceInput,
  OperationInput,
  OperationOutput,
  TargetProfile,
} from "@relay/protocol";

type TargetClient = Pick<RelayClient, "invoke">;

export async function listDevices(
  client: TargetClient,
): Promise<OperationOutput<"target.devices.list">["devices"]> {
  return (await client.invoke("target.devices.list", {})).devices;
}

export async function listAndroidDevicesFast(
  client: TargetClient,
): Promise<OperationOutput<"target.devices.list">["devices"]> {
  return (await client.invoke("target.devices.list", { phase: "android" })).devices;
}

export async function listActions(
  client: TargetClient,
): Promise<OperationOutput<"target.actions.list">["actions"]> {
  return (await client.invoke("target.actions.list", {})).actions;
}

export async function listTargets(
  client: TargetClient,
): Promise<OperationOutput<"target.list">["targets"]> {
  return (await client.invoke("target.list", {})).targets;
}

/** Target profiles have no registered operation yet, so retain the resource read. */
export async function listTargetProfiles(client: RelayClient): Promise<TargetProfile[]> {
  return (await client.resource<{ profiles: TargetProfile[] }>("/target-profiles")).profiles ?? [];
}

export async function bootDevice(
  client: TargetClient,
  input: OperationInput<"target.boot">,
): Promise<void> {
  // Simulator boot is slow; give it more headroom than the default timeout.
  await client.invoke("target.boot", input, { signal: AbortSignal.timeout(120_000) });
}

export async function authorizeDevice(
  client: TargetClient,
  input: OperationInput<"target.authorize">,
): Promise<void> {
  await client.invoke("target.authorize", input);
}

export async function saveBrowserTarget(
  client: TargetClient,
  input: OperationInput<"target.create">,
): Promise<OperationOutput<"target.create">["target"]> {
  return (await client.invoke("target.create", input)).target;
}

export async function deleteTarget(client: TargetClient, targetId: string): Promise<void> {
  await client.invoke("target.delete", { targetId });
}

export async function preflightTarget(
  client: TargetClient,
  targetId: string,
): Promise<OperationOutput<"target.preflight">["preflight"]> {
  return (await client.invoke("target.preflight", { targetId })).preflight;
}

export async function openBrowserTarget(
  client: TargetClient,
  targetId: string,
): Promise<OperationOutput<"target.open">["session"]> {
  return (await client.invoke("target.open", { targetId }, { signal: AbortSignal.timeout(30_000) }))
    .session;
}

export async function openBrowserDevice(
  client: TargetClient,
  input: OperationInput<"target.browser-device.open">,
): Promise<OperationOutput<"target.browser-device.open">["session"]> {
  return (
    await client.invoke("target.browser-device.open", input, {
      signal: AbortSignal.timeout(30_000),
    })
  ).session;
}

export async function captureBrowserDeviceFrame(
  client: TargetClient,
  targetId: string,
  afterSequence?: number,
): Promise<OperationOutput<"target.browser-device.frame">> {
  return client.invoke("target.browser-device.frame", {
    targetId,
    ...(afterSequence === undefined ? {} : { afterSequence }),
  });
}

export async function controlBrowserDevice(
  client: TargetClient,
  targetId: string,
  input: BrowserDeviceInput,
): Promise<OperationOutput<"target.browser-device.control">> {
  return client.invoke("target.browser-device.control", { targetId, input });
}
