/**
 * Live device workspace helpers for the testing shell:
 * snapshot UI tree, screenshot, basic interactions.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import {
  PLATFORM,
  base,
  center,
  createDevice,
  findClick,
  pressLabel,
  pressMatchingText,
  pressPoint,
  pressRef,
  snapshot,
  type Device,
  type SnapshotNode,
} from "./device.js";
import { getExecutingJobId, hardStopDeviceSession } from "./control.js";
import { now, publish } from "./events.js";
import { attachJobFrame, getActiveJob } from "./session.js";

/**
 * Recover from session binding conflicts by releasing the stale binding
 * and retrying. Does NOT auto-open any app — each recipe opens its own.
 */
async function withSession<T>(device: Device, op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/already bound/i.test(msg) && !getExecutingJobId()) {
      await hardStopDeviceSession().catch(() => undefined);
      return await op();
    }
    throw err;
  }
}

/**
 * Raw adb screencap — captures the current device screen regardless of which
 * app is showing. Bypasses the SDK's session requirement entirely.
 * Used as a fallback when the SDK reports "No active session".
 */
function rawScreenshot(path: string): void {
  const serial = process.env.AGENT_DEVICE_SERIAL?.trim() || process.env.ANDROID_SERIAL?.trim();
  const args = serial
    ? ["-s", serial, "exec-out", "screencap", "-p"]
    : ["exec-out", "screencap", "-p"];
  const buf = execFileSync("adb", args, { maxBuffer: 20 * 1024 * 1024 });
  writeFileSync(path, buf);
}

/** Raw adb input tap — works without a session, on any app. */
function rawTap(x: number, y: number): void {
  const serial = process.env.AGENT_DEVICE_SERIAL?.trim() || process.env.ANDROID_SERIAL?.trim();
  const args = serial
    ? ["-s", serial, "shell", "input", "tap", String(x), String(y)]
    : ["shell", "input", "tap", String(x), String(y)];
  execFileSync("adb", args, { timeout: 5000 });
}

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
  /** rough screen bounds from max rect extents (for overlay scaling) */
  bounds?: { width: number; height: number };
};

function inferBounds(nodes: SnapshotNode[]): { width: number; height: number } | undefined {
  let maxX = 0;
  let maxY = 0;
  for (const n of nodes) {
    if (!n.rect) continue;
    maxX = Math.max(maxX, n.rect.x + n.rect.width);
    maxY = Math.max(maxY, n.rect.y + n.rect.height);
  }
  if (maxX < 100 || maxY < 100) return undefined;
  return { width: Math.round(maxX), height: Math.round(maxY) };
}

export async function captureSnapshot(opts?: {
  serial?: string;
  interactiveOnly?: boolean;
  device?: Device;
}): Promise<SnapshotPayload> {
  if (opts?.serial) selectDevice(opts.serial);
  const device = opts?.device ?? createDevice();
  const nodes = await withSession(device, () =>
    snapshot(device, { interactiveOnly: opts?.interactiveOnly ?? false }),
  );
  const interactive = nodes.filter((n) => n.hittable || n.enabled !== false);
  const bounds = inferBounds(nodes);
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
    bounds,
  };
}

export type ScreenshotPayload = {
  serial?: string;
  capturedAt: number;
  mime: "image/png";
  base64: string;
  path: string;
  bytes: number;
  jobId?: string;
  framePath?: string;
};

export async function captureScreenshot(opts?: {
  serial?: string;
  device?: Device;
  caption?: string;
  jobId?: string;
  /** skip attaching to job */
  ephemeral?: boolean;
}): Promise<ScreenshotPayload> {
  if (opts?.serial) selectDevice(opts.serial);
  const device = opts?.device ?? createDevice();
  const dir = join(tmpdir(), "grok-device");
  await mkdir(dir, { recursive: true });
  const path = join(dir, `shot-${now()}.png`);
  try {
    await withSession(device, () => device.capture.screenshot({ ...base(), path }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/no active session/i.test(msg)) {
      // No SDK session — fall back to raw adb screencap (works on any app)
      rawScreenshot(path);
    } else {
      throw err;
    }
  }
  const buf = await readFile(path);
  const base64 = buf.toString("base64");
  publish({
    type: "screenshot.captured",
    at: now(),
    serial: process.env.AGENT_DEVICE_SERIAL,
    bytes: buf.byteLength,
  });

  let framePath: string | undefined;
  let jobId = opts?.jobId;
  if (!opts?.ephemeral) {
    const active = opts?.jobId ? { id: opts.jobId } : getActiveJob();
    if (active) {
      const frame = await attachJobFrame({
        jobId: active.id,
        base64,
        caption: opts?.caption ?? `screenshot · ${new Date().toISOString()}`,
      });
      framePath = frame?.path;
      jobId = active.id;
    }
  }

  return {
    serial: process.env.AGENT_DEVICE_SERIAL,
    capturedAt: now(),
    mime: "image/png",
    base64,
    path,
    bytes: buf.byteLength,
    jobId,
    framePath,
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
  try {
    await withSession(device, async () => {
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
        case "text-match":
          await pressMatchingText(device, input.match);
          return;
      }
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // No SDK session — raw adb tap works for coordinate taps on any app
    if (/no active session/i.test(msg) && input.kind === "point") {
      rawTap(input.x, input.y);
      return;
    }
    throw err;
  }
}

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
