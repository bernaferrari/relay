/**
 * Text replacement entry points split out of device.ts.
 * Pure code motion: replaceText / replaceTextValue and their Android
 * focused-field clearing helper live here so device.ts stays within its
 * source budget. All platform plumbing remains owned by device.ts.
 */
import { getExecutingJobId } from "./control.js";
import { clearAndroidTextWithAdb } from "./device-mutation-adapter.js";
import { resolveSnapshotTargetPoint } from "./device-target-resolution.js";
import {
  base,
  controlledMutation,
  iosNonHittablePressFields,
  nativeDevice,
} from "./device-dispatch.js";
import {
  iosSnapshotFallbackPoint,
  snapshot,
  typeText,
  type Device,
} from "./device.js";
import { selectedPlatform, targetIdentity } from "./target-context.js";

export async function replaceText(
  device: Device,
  target: {
    identifier?: string;
    ref?: string;
    label?: string;
    text?: string;
    point?: { x: number; y: number };
  },
  text: string,
): Promise<void> {
  const interactionTarget = target.identifier
    ? { selector: `id="${target.identifier.replaceAll('"', '\\"')}"` }
    : target.ref
      ? { ref: target.ref.startsWith("@") ? target.ref : `@${target.ref}` }
      : target.label
        ? { selector: `label="${target.label.replaceAll('"', '\\"')}"` }
        : target.text
          ? { selector: `label*="${target.text.replaceAll('"', '\\"')}"` }
          : target.point
            ? { x: target.point.x, y: target.point.y }
            : undefined;
  if (!interactionTarget) throw new Error("replace text requires a target");

  // Android's accessibility fill is not consistently a replacement operation.
  // Compose fields in particular may preserve the existing value and append the
  // new text, even though the command succeeds. Make replacement deterministic
  // at the input boundary: focus the target, clear it with native key events,
  // then use the normal exact-text path for the new value.
  if (selectedPlatform() === "android") {
    await controlledMutation("press", () =>
      nativeDevice(device).interactions.press({ ...base(), ...interactionTarget }),
    );
    await clearAndroidFocusedText(targetIdentity());
    if (text.length > 0) await typeText(device, text);
    return;
  }
  // The selector fill carries the same non-hittable coordination fields a
  // press does: the runner can fall back to the snapshot-derived coordinate
  // in one round-trip instead of paying a second full traversal here.
  const resolveFillPoint = async (): Promise<{ x: number; y: number } | undefined> => {
    if (target.point) return target.point;
    try {
      const nodes = await snapshot(device);
      return (
        resolveSnapshotTargetPoint(nodes, target) ??
        (target.label || target.text
          ? resolveSnapshotTargetPoint(nodes, { label: target.label, text: target.text })
          : undefined)
      );
    } catch {
      return undefined;
    }
  };
  const fillPoint = await resolveFillPoint();
  await replaceTextValue(text, {
    fill: async (value) => {
      try {
        await controlledMutation("fill", () =>
          nativeDevice(device).interactions.fill({
            ...base(),
            ...interactionTarget,
            ...iosNonHittablePressFields(fillPoint),
            text: value,
          }),
        );
      } catch (error) {
        const point = await iosSnapshotFallbackPoint(device, target, error, fillPoint);
        await controlledMutation("fill", () =>
          nativeDevice(device).interactions.fill({
            ...base(),
            x: point.x,
            y: point.y,
            text: value,
          }),
        );
      }
    },
    type: async (value) => {
      await controlledMutation("type", () =>
        nativeDevice(device).interactions.type({ ...base(), text: value }),
      );
    },
  });
}

async function clearAndroidFocusedText(serial: string): Promise<void> {
  // Android's MOVE_END is line-aware: on a multiline Compose field it lands at
  // the end of the current line, which leaves later lines behind. Move to the
  // beginning of the current line, walk to the top, then move to the beginning
  // of the whole value before deleting forward.
  await clearAndroidTextWithAdb(serial, getExecutingJobId());
}

export type TextReplacementAdapter = {
  fill: (text: string) => Promise<void>;
  type: (text: string) => Promise<void>;
};

/**
 * Replace a field even when the desired value is empty.
 *
 * agent-device deliberately rejects an empty fill at its public boundary.
 * Replacing with one harmless character and deleting it uses the same native
 * text events a person produces and avoids platform-specific select-all logic.
 */
export async function replaceTextValue(
  text: string,
  adapter: TextReplacementAdapter,
): Promise<void> {
  if (text.length > 0) {
    await adapter.fill(text);
    return;
  }
  await adapter.fill("x");
  await adapter.type("\b");
}

