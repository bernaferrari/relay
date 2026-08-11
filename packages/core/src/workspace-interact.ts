/**
 * Semantic + point interactions shared by the mouse, CLI, and recipes.
 */
import {
  findClick,
  pressNamedControl,
  resolveNamedControl,
  type NamedControlResolution,
  pressMatchingText,
  pressPoint,
  pressRef,
  replaceText,
  swipeGesture,
  typeText,
  type Device,
  type SnapshotNode,
} from "./device.js";
import { currentTargetContext, runWithTargetContext } from "./target-context.js";
import { verifyIosScreenChanged } from "./ios-app-launch.js";
import { annotateTapPreview } from "./tap-preview.js";
import { iosLogicalBoundsForSerial } from "./workspace-capture.js";
import { resolveRuntimeTarget } from "./workspace-devices.js";
import { withSession } from "./workspace-ios-session.js";
import { rawKey, rawSwipe, rawTap } from "./workspace-android-raw.js";
import { captureScreenshot, captureSnapshot, type ScreenshotPayload } from "./workspace-capture.js";

export type InteractPoint = { x: number; y: number };

export type InteractInput =
  | { kind: "identifier"; identifier: string; point?: InteractPoint }
  | { kind: "label"; label: string; point?: InteractPoint }
  | { kind: "point"; x: number; y: number }
  | { kind: "ref"; ref: string }
  | { kind: "find"; query: string; point?: InteractPoint }
  | { kind: "text-match"; match: string; point?: InteractPoint }
  | {
      kind: "swipe";
      from: { x: number; y: number };
      to: { x: number; y: number };
      durationMs?: number;
    }
  | { kind: "key"; key: "enter" | "backspace" | "back" | "home" }
  | { kind: "type"; text: string }
  | {
      kind: "replace";
      target: {
        identifier?: string;
        ref?: string;
        label?: string;
        text?: string;
        point?: { x: number; y: number };
      };
      text: string;
    };

export type InteractResult = {
  resolution?: NamedControlResolution;
};

function optionalInteractPoint(
  point?: InteractPoint,
): { point: InteractPoint } | Record<string, never> {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return {};
  return { point: { x: point.x, y: point.y } };
}

async function namedOrMiss(
  device: Device,
  target: Parameters<typeof pressNamedControl>[1],
): Promise<InteractResult> {
  try {
    return { resolution: await pressNamedControl(device, target) };
  } catch (error) {
    if (error instanceof Error && error.name === "JobCancelledError") throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (/no unique control matched/i.test(message)) return {};
    throw error;
  }
}

export function resolveInteractPreview(
  nodes: SnapshotNode[],
  input: InteractInput,
): NamedControlResolution | undefined {
  switch (input.kind) {
    case "identifier":
      return resolveNamedControl(nodes, {
        identifier: input.identifier,
        ...optionalInteractPoint(input.point),
      });
    case "label":
      return resolveNamedControl(nodes, {
        label: input.label,
        ...optionalInteractPoint(input.point),
      });
    case "point":
      return {
        method: "point",
        point: { x: input.x, y: input.y },
        bounds: { x: input.x, y: input.y, width: 1, height: 1 },
      };
    case "find":
      return resolveNamedControl(nodes, {
        label: input.query,
        text: input.query,
        ...optionalInteractPoint(input.point),
      });
    case "text-match":
      return resolveNamedControl(nodes, {
        text: input.match,
        label: input.match,
        ...optionalInteractPoint(input.point),
      });
    case "swipe":
      return {
        method: "point",
        point: input.to,
        bounds: {
          x: Math.min(input.from.x, input.to.x),
          y: Math.min(input.from.y, input.to.y),
          width: Math.max(1, Math.abs(input.to.x - input.from.x)),
          height: Math.max(1, Math.abs(input.to.y - input.from.y)),
        },
      };
    default:
      return undefined;
  }
}

export async function previewInteract(
  input: InteractInput,
  opts?: { serial?: string },
): Promise<
  ScreenshotPayload & {
    preview: true;
    resolution?: NamedControlResolution;
  }
> {
  const shot = await captureScreenshot({
    serial: opts?.serial,
    ephemeral: true,
    includeScreenMatch: false,
  });
  let nodes: SnapshotNode[] = [];
  let inspectable = false;
  try {
    const snap = await captureSnapshot({ serial: opts?.serial });
    nodes = snap.nodes;
    inspectable = snap.inspectable !== false && snap.nodes.length > 0;
  } catch {
    inspectable = false;
  }
  const resolution = resolveInteractPreview(nodes, input);
  const fallbackPoint =
    input.kind === "point"
      ? { x: input.x, y: input.y }
      : input.kind === "swipe"
        ? input.to
        : "point" in input && input.point
          ? input.point
          : resolution?.point;
  const markPoint = resolution?.point ?? fallbackPoint;
  if (!markPoint) {
    return { ...shot, inspectable, preview: true as const };
  }
  let buf = Buffer.from(shot.base64, "base64");
  const serial = opts?.serial ?? shot.serial;
  buf = Buffer.from(
    annotateTapPreview(
      buf,
      {
        point: markPoint,
        ...(input.kind === "swipe" ? { points: [input.from, input.to] } : {}),
        ...(resolution?.bounds && resolution.bounds.width > 2 && resolution.bounds.height > 2
          ? { bounds: resolution.bounds }
          : {}),
      },
      serial ? iosLogicalBoundsForSerial(serial) : undefined,
    ),
  );
  return {
    ...shot,
    base64: buf.toString("base64"),
    bytes: buf.byteLength,
    inspectable,
    preview: true,
    ...(resolution ? { resolution } : {}),
  };
}

export async function interactOnDevice(
  device: Device,
  input: InteractInput,
): Promise<InteractResult> {
  switch (input.kind) {
    case "identifier":
      return namedOrMiss(device, {
        identifier: input.identifier,
        ...optionalInteractPoint(input.point),
      });
    case "label":
      return namedOrMiss(device, {
        label: input.label,
        ...optionalInteractPoint(input.point),
      });
    case "point":
      return {
        resolution: await pressNamedControl(device, { point: { x: input.x, y: input.y } }),
      };
    case "find": {
      const named = await namedOrMiss(device, {
        label: input.query,
        text: input.query,
        ...optionalInteractPoint(input.point),
      });
      if (named.resolution) return named;
      if (input.point && Number.isFinite(input.point.x) && Number.isFinite(input.point.y)) {
        await pressPoint(device, input.point.x, input.point.y);
        return {
          resolution: {
            method: "point",
            point: { x: input.point.x, y: input.point.y },
            bounds: { x: input.point.x, y: input.point.y, width: 1, height: 1 },
          },
        };
      }
      await findClick(device, input.query);
      return {};
    }
    case "text-match": {
      const named = await namedOrMiss(device, {
        text: input.match,
        label: input.match,
        ...optionalInteractPoint(input.point),
      });
      if (named.resolution) return named;
      if (input.point && Number.isFinite(input.point.x) && Number.isFinite(input.point.y)) {
        await pressPoint(device, input.point.x, input.point.y);
        return {
          resolution: {
            method: "point",
            point: { x: input.point.x, y: input.point.y },
            bounds: { x: input.point.x, y: input.point.y, width: 1, height: 1 },
          },
        };
      }
      await pressMatchingText(device, input.match);
      return {};
    }
    default:
      return {};
  }
}

export async function interact(
  input: InteractInput,
  opts?: { serial?: string },
): Promise<InteractResult> {
  if (input.kind === "swipe") {
    const validPoint = (point: unknown): point is InteractPoint => {
      if (!point || typeof point !== "object") return false;
      const value = point as Partial<InteractPoint>;
      return Number.isFinite(value.x) && Number.isFinite(value.y);
    };
    if (!validPoint(input.from) || !validPoint(input.to)) {
      throw new Error(
        'Swipe requires "from" and "to" points, for example {"kind":"swipe","from":{"x":540,"y":1800},"to":{"x":540,"y":650}}.',
      );
    }
    if (
      input.durationMs !== undefined &&
      (!Number.isFinite(input.durationMs) || input.durationMs < 50 || input.durationMs > 5_000)
    ) {
      throw new Error("Swipe durationMs must be between 50 and 5000.");
    }
  }
  const target = await resolveRuntimeTarget(opts?.serial);
  return runWithTargetContext(target.context, async () => {
    const context = currentTargetContext();
    if (context.kind === "device" && context.platform === "android") {
      // Direct manipulation should survive app/session changes. Semantic refs
      // still use the SDK below, but mirror gestures never need an active app.
      if (input.kind === "point") {
        rawTap(input.x, input.y, context.serial);
        return {
          resolution: {
            method: "point" as const,
            point: { x: input.x, y: input.y },
            bounds: { x: input.x, y: input.y, width: 1, height: 1 },
          },
        };
      }
      if (input.kind === "swipe") {
        rawSwipe(input.from, input.to, input.durationMs ?? 250, context.serial);
        return {};
      }
      if (input.kind === "key") {
        rawKey(input.key, context.serial);
        return {};
      }
    }
    if (context.kind === "device" && context.platform === "ios" && input.kind === "point") {
      await withSession(target.device, () =>
        verifyIosScreenChanged(context.serial, () => pressPoint(target.device, input.x, input.y)),
      );
      return {
        resolution: {
          method: "point" as const,
          point: { x: input.x, y: input.y },
          bounds: { x: input.x, y: input.y, width: 1, height: 1 },
        },
      };
    }
    try {
      return await withSession(target.device, async () => {
        const named = await interactOnDevice(target.device, input);
        if (named.resolution) return named;
        switch (input.kind) {
          case "ref":
            await pressRef(target.device, input.ref);
            return {};
          case "swipe":
            await swipeGesture(target.device, input.from, input.to, input.durationMs ?? 250);
            return {};
          case "type":
            await typeText(target.device, input.text);
            return {};
          case "replace":
            await replaceText(target.device, input.target, input.text);
            return {};
          case "identifier":
          case "label":
          case "point":
            throw new Error(
              `No unique control matched ${input.kind}. Snapshot the screen and retry with identifier, label, or an exact point.`,
            );
          default:
            return {};
        }
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const context = currentTargetContext();
      // No SDK session — raw adb works for coordinate interactions on any app.
      if (
        /no active session/i.test(msg) &&
        context.kind === "device" &&
        context.platform === "android" &&
        input.kind === "point"
      ) {
        rawTap(input.x, input.y, context.serial);
        return {
          resolution: {
            method: "point" as const,
            point: { x: input.x, y: input.y },
            bounds: { x: input.x, y: input.y, width: 1, height: 1 },
          },
        };
      }
      if (
        /no active session/i.test(msg) &&
        context.kind === "device" &&
        context.platform === "android" &&
        input.kind === "swipe"
      ) {
        rawSwipe(input.from, input.to, input.durationMs ?? 250, context.serial);
        return {};
      }
      throw err;
    }
  });
}
