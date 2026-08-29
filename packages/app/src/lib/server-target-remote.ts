import type { BinaryResource, RelayClient } from "@relay/client";
import type {
  BrowserDeviceBinaryFrameMetadata,
  BrowserDeviceInput,
  OperationInput,
  OperationOutput,
  TargetProfile,
} from "@relay/protocol";
import {
  BROWSER_DEVICE_BINARY_FRAME_CONTENT_TYPE,
  MAX_BROWSER_DEVICE_BINARY_FRAME_BYTES,
  MAX_BROWSER_DEVICE_BINARY_METADATA_BYTES,
  browserDeviceBinaryFrameMetadataSchema,
} from "@relay/protocol";

type TargetClient = Pick<RelayClient, "invoke"> & Partial<Pick<RelayClient, "binaryResource">>;

export type BrowserDeviceFrameTransport = "binary" | "json-fallback";
export type BrowserDeviceFrameResult = OperationOutput<"target.browser-device.frame"> & {
  transport: BrowserDeviceFrameTransport;
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8_192) {
    const chunk = bytes.subarray(offset, Math.min(offset + 8_192, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function decodeMetadata(bytes: Uint8Array): BrowserDeviceBinaryFrameMetadata {
  if (bytes.byteLength > MAX_BROWSER_DEVICE_BINARY_METADATA_BYTES) {
    throw new Error("Binary Browser Device frame metadata exceeds its bounded size");
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("Binary Browser Device frame metadata is not valid JSON");
  }
  return browserDeviceBinaryFrameMetadataSchema.parse(value);
}

function decodeBinaryEnvelope(resource: BinaryResource): {
  metadata: BrowserDeviceBinaryFrameMetadata;
  frameBytes: Uint8Array;
} {
  if (resource.headers.get("x-relay-browser-device-transport") !== "binary") {
    throw new Error("Binary Browser Device response omitted its transport marker");
  }
  if (
    resource.headers.get("content-type")?.split(";", 1)[0] !==
    BROWSER_DEVICE_BINARY_FRAME_CONTENT_TYPE
  ) {
    throw new Error("Binary Browser Device response has an unsupported content type");
  }
  if (resource.bytes.byteLength < 4) throw new Error("Binary Browser Device envelope is truncated");
  const metadataLength = new DataView(
    resource.bytes.buffer,
    resource.bytes.byteOffset,
    4,
  ).getUint32(0);
  if (metadataLength > MAX_BROWSER_DEVICE_BINARY_METADATA_BYTES) {
    throw new Error("Binary Browser Device frame metadata exceeds its bounded size");
  }
  const frameOffset = 4 + metadataLength;
  if (frameOffset > resource.bytes.byteLength) {
    throw new Error("Binary Browser Device envelope metadata length exceeds its body");
  }
  const metadata = decodeMetadata(resource.bytes.subarray(4, frameOffset));
  const frameBytes = resource.bytes.subarray(frameOffset);
  if (frameBytes.byteLength > MAX_BROWSER_DEVICE_BINARY_FRAME_BYTES) {
    throw new Error("Binary Browser Device frame exceeds its bounded size");
  }
  return { metadata, frameBytes };
}

function canUseJsonFallback(error: unknown): boolean {
  return (
    error instanceof Error &&
    "status" in error &&
    [404, 405, 406, 415, 501].includes((error as { status?: unknown }).status as number)
  );
}

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
): Promise<BrowserDeviceFrameResult> {
  if (client.binaryResource) {
    const query = afterSequence === undefined ? "" : `?afterSequence=${afterSequence}`;
    try {
      const resource: BinaryResource = await client.binaryResource(
        `/targets/${encodeURIComponent(targetId)}/browser-device/frame.bin${query}`,
        {},
        4 + MAX_BROWSER_DEVICE_BINARY_METADATA_BYTES + MAX_BROWSER_DEVICE_BINARY_FRAME_BYTES,
      );
      const { metadata, frameBytes } = decodeBinaryEnvelope(resource);
      if (frameBytes.byteLength !== metadata.frame.bytes) {
        throw new Error(
          `Binary Browser Device frame length mismatch: expected ${metadata.frame.bytes}, received ${frameBytes.byteLength}`,
        );
      }
      return {
        session: metadata.session,
        frame: { ...metadata.frame, base64: bytesToBase64(frameBytes) },
        ...(metadata.gap ? { gap: metadata.gap } : {}),
        transport: "binary",
      };
    } catch (error) {
      if (!canUseJsonFallback(error)) throw error;
    }
  }
  return {
    ...(await client.invoke("target.browser-device.frame", {
      targetId,
      ...(afterSequence === undefined ? {} : { afterSequence }),
    })),
    transport: "json-fallback",
  };
}

export async function inspectBrowserDevice(
  client: TargetClient,
  targetId: string,
  input: Pick<BrowserDeviceInput, "sessionId" | "pageId" | "expectedSequence">,
): Promise<OperationOutput<"target.browser-device.inspect">> {
  return client.invoke("target.browser-device.inspect", { targetId, ...input });
}

export async function controlBrowserDevice(
  client: TargetClient,
  targetId: string,
  input: BrowserDeviceInput,
): Promise<OperationOutput<"target.browser-device.control">> {
  return client.invoke("target.browser-device.control", { targetId, input });
}
