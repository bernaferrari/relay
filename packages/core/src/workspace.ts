/**
 * Live device workspace helpers for the testing shell:
 * snapshot UI tree, screenshot, basic interactions.
 */
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PLATFORM,
  base,
  center,
  createDevice,
  findClick,
  pressLabel,
  pressPoint,
  pressRef,
  snapshot,
  type Device,
  type SnapshotNode,
} from "./device.js";
import { now, publish } from "./events.js";

export type ListedDevice = {
  id: string;
  name: string;
  serial: string;
  kind: string | null;
  booted: boolean | null;
  platform: typeof PLATFORM;
};

export async function listDevices(): Promise<ListedDevice[]> {
  const client = createDevice();
  const devices = await client.devices.list({ platform: PLATFORM });
  const listed = devices.map((d) => {
    const serial = d.android?.serial ?? d.identifiers?.serial ?? d.id;
    return {
      id: d.id,
      name: d.name,
      serial,
      kind: d.kind ?? null,
      booted: d.booted ?? null,
      platform: PLATFORM,
    };
  });
  publish({ type: "device.list", at: now(), count: listed.length });
  return listed;
}

export function selectDevice(serial: string | null): void {
  if (serial?.trim()) {
    process.env.AGENT_DEVICE_SERIAL = serial.trim();
    process.env.ANDROID_SERIAL = serial.trim();
  } else {
    delete process.env.AGENT_DEVICE_SERIAL;
    delete process.env.ANDROID_SERIAL;
  }
  publish({ type: "device.selected", at: now(), serial: serial?.trim() || null });
}

export type SnapshotPayload = {
  serial?: string;
  capturedAt: number;
  nodes: SnapshotNode[];
  interactive: SnapshotNode[];
};

export async function captureSnapshot(opts?: {
  serial?: string;
  interactiveOnly?: boolean;
  device?: Device;
}): Promise<SnapshotPayload> {
  if (opts?.serial) selectDevice(opts.serial);
  const device = opts?.device ?? createDevice();
  const nodes = await snapshot(device, { interactiveOnly: opts?.interactiveOnly ?? false });
  const interactive = nodes.filter((n) => n.hittable || n.enabled !== false);
  publish({
    type: "snapshot.captured",
    at: now(),
    serial: opts?.serial ?? process.env.AGENT_DEVICE_SERIAL,
    nodeCount: nodes.length,
  });
  return {
    serial: process.env.AGENT_DEVICE_SERIAL,
    capturedAt: now(),
    nodes,
    interactive,
  };
}

export type ScreenshotPayload = {
  serial?: string;
  capturedAt: number;
  mime: "image/png";
  /** base64-encoded PNG */
  base64: string;
  path: string;
  bytes: number;
};

export async function captureScreenshot(opts?: {
  serial?: string;
  device?: Device;
}): Promise<ScreenshotPayload> {
  if (opts?.serial) selectDevice(opts.serial);
  const device = opts?.device ?? createDevice();
  const dir = join(tmpdir(), "grok-device");
  await mkdir(dir, { recursive: true });
  const path = join(dir, `shot-${now()}.png`);
  await device.capture.screenshot({ ...base(), path });
  const { readFile } = await import("node:fs/promises");
  const buf = await readFile(path);
  publish({
    type: "screenshot.captured",
    at: now(),
    serial: process.env.AGENT_DEVICE_SERIAL,
    bytes: buf.byteLength,
  });
  return {
    serial: process.env.AGENT_DEVICE_SERIAL,
    capturedAt: now(),
    mime: "image/png",
    base64: buf.toString("base64"),
    path,
    bytes: buf.byteLength,
  };
}

export type InteractInput =
  | { kind: "label"; label: string }
  | { kind: "point"; x: number; y: number }
  | { kind: "ref"; ref: string }
  | { kind: "find"; query: string }
  | { kind: "text-match"; match: string };

export async function interact(input: InteractInput, opts?: { serial?: string }): Promise<void> {
  if (opts?.serial) selectDevice(opts.serial);
  const device = createDevice();
  switch (input.kind) {
    case "label":
      await pressLabel(device, input.label);
      return;
    case "point":
      await pressPoint(device, input.x, input.y);
      return;
    case "ref":
      await pressRef(device, input.ref);
      return;
    case "find":
      await findClick(device, input.query);
      return;
    case "text-match": {
      const { pressMatchingText } = await import("./device.js");
      await pressMatchingText(device, input.match);
      return;
    }
  }
}

/** Compact text tree for TUI / logs. */
export function formatSnapshotTree(nodes: SnapshotNode[], limit = 80): string {
  const lines: string[] = [];
  for (const n of nodes.slice(0, limit)) {
    const label = (n.label ?? n.value ?? n.identifier ?? "").trim();
    if (!label) continue;
    const hit = n.hittable ? "●" : "○";
    const rect = n.rect
      ? ` @${Math.round(n.rect.x)},${Math.round(n.rect.y)} ${Math.round(n.rect.width)}×${Math.round(n.rect.height)}`
      : "";
    const ref = n.ref ? ` ${n.ref.startsWith("@") ? n.ref : `@${n.ref}`}` : "";
    lines.push(`${hit} ${label}${ref}${rect}`);
  }
  if (nodes.length > limit) lines.push(`… ${nodes.length - limit} more nodes`);
  return lines.join("\n");
}

export { center };
