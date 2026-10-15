import type { BinaryResource } from "@relay/client";
import {
  BROWSER_DEVICE_BINARY_FRAME_CONTENT_TYPE,
  MAX_BROWSER_DEVICE_BINARY_FRAME_BYTES,
  MAX_BROWSER_DEVICE_BINARY_METADATA_BYTES,
  browserDeviceBinaryFrameMetadataSchema,
  type BrowserDeviceSession,
  type BrowserDeviceFrame,
} from "@relay/protocol";

type BinaryFrameMetadata = {
  session: BrowserDeviceSession;
  frame: Omit<BrowserDeviceFrame, "base64">;
  gap?: { afterSequence: number; currentSequence: number; dropped: number };
};

export function decodeBinaryFrame(resource: BinaryResource): {
  metadata: BinaryFrameMetadata;
  bytes: Uint8Array;
} {
  if (resource.headers.get("x-relay-browser-device-transport") !== "binary") {
    throw new Error("Live browser frame omitted its transport marker");
  }
  if (
    resource.headers.get("content-type")?.split(";", 1)[0] !==
    BROWSER_DEVICE_BINARY_FRAME_CONTENT_TYPE
  ) {
    throw new Error("Live browser frame has an unsupported content type");
  }
  if (resource.bytes.byteLength < 4) throw new Error("Live browser frame envelope is truncated");
  const metadataLength = new DataView(
    resource.bytes.buffer,
    resource.bytes.byteOffset,
    4,
  ).getUint32(0);
  if (metadataLength > MAX_BROWSER_DEVICE_BINARY_METADATA_BYTES) {
    throw new Error("Live browser frame metadata exceeds its bounded size");
  }
  const frameOffset = 4 + metadataLength;
  if (frameOffset > resource.bytes.byteLength) {
    throw new Error("Live browser frame metadata length exceeds its body");
  }
  const metadata = browserDeviceBinaryFrameMetadataSchema.parse(
    JSON.parse(new TextDecoder().decode(resource.bytes.subarray(4, frameOffset))),
  );
  const bytes = resource.bytes.subarray(frameOffset);
  if (bytes.byteLength > MAX_BROWSER_DEVICE_BINARY_FRAME_BYTES) {
    throw new Error("Live browser frame exceeds its bounded size");
  }
  if (bytes.byteLength !== metadata.frame.bytes) {
    throw new Error("Live browser frame length does not match its metadata");
  }
  return { metadata, bytes };
}
