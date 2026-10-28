/**
 * Text replacement entry points split out of device.ts.
 * Native text entry owns replacement and the physical iOS listener path.
 * The device facade supplies observation and target mutation plumbing.
 */
import { getExecutingJobId } from "./control.js";
import { clearAndroidTextWithAdb, moveAndroidCaretToEnd } from "./device-mutation-adapter.js";
import {
  explicitPointResolution,
  resolveSnapshotTargetPoint,
  type NamedControlResolution,
} from "./device-target-resolution.js";
import {
  base,
  controlledMutation,
  iosNonHittablePressFields,
  nativeDevice,
} from "./device-dispatch.js";
import {
  iosSnapshotFallbackPoint,
  pressNamedControl,
  pressPoint,
  snapshot,
  typeText,
  type Device,
  type SnapshotNode,
} from "./device.js";
import {
  planTextEntryFocus,
  type TextEntryFocusPlan,
  type TextEntryTarget,
} from "./text-entry-focus.js";
import { currentTargetContext, selectedPlatform, targetIdentity } from "./target-context.js";
import { isPhysicalRunnerRoute, resolveAppleControlRoute } from "./apple-control-route.js";
import { probeLiveIosRunnerListener } from "./ios-runner-listener.js";
import { typeViaLiveIosRunnerListener } from "./ios-runner-listener-command.js";
import { rememberedTargetApplication } from "./device-target-applications.js";
import type { AndroidTextEntryReceipt } from "./android-text-entry-verification.js";

export type TextEntryOutcome = {
  resolution?: NamedControlResolution;
  receipt?: AndroidTextEntryReceipt;
};

function knownFieldText(field: SnapshotNode | undefined): string | undefined {
  if (!field) return undefined;
  if ((field as { hintShowing?: boolean }).hintShowing) return "";
  return field.value ?? "";
}

/**
 * Type or replace on Android: caret on the field's text line (never a nested
 * chip), clear with select-all, then the verified paste path. Skips work the
 * live tree proves unnecessary (an empty field is not cleared, a focused field
 * is not tapped).
 */
async function enterAndroidText(
  device: Device,
  mode: "type" | "replace",
  target: TextEntryTarget | undefined,
  text: string,
): Promise<TextEntryOutcome> {
  const serial = targetIdentity();
  let plan: TextEntryFocusPlan | undefined;
  if (target) {
    plan = planTextEntryFocus(await snapshot(device, { raw: true }), target);
    if (!plan.alreadyFocused) {
      await pressPoint(device, plan.resolution.point.x, plan.resolution.point.y);
    }
  }
  const existing = knownFieldText(plan?.field);
  if (mode === "replace") {
    if (existing === undefined || existing.length > 0) {
      await clearAndroidTextWithAdb(serial, getExecutingJobId(), existing?.length);
    }
  } else if (target && existing && existing.length > 0) {
    await moveAndroidCaretToEnd(serial, getExecutingJobId());
  }
  // Refs and bounds shift once the keyboard opens; only an identifier keeps
  // the planned field recognisable to the post-entry readback.
  const knownBefore =
    plan?.field?.identifier && existing !== undefined
      ? { ...plan.field, focused: true, value: mode === "replace" ? "" : existing }
      : undefined;
  const receipt = text.length > 0 ? await typeText(device, text, knownBefore) : undefined;
  return {
    ...(plan ? { resolution: plan.resolution } : {}),
    ...(receipt ? { receipt } : {}),
  };
}

/** Type at the caret, optionally focusing a field first. */
export async function typeIntoField(
  device: Device,
  text: string,
  target?: TextEntryTarget,
): Promise<TextEntryOutcome> {
  if (currentTargetContext().kind !== "browser" && selectedPlatform() === "android") {
    return enterAndroidText(device, "type", target, text);
  }
  let resolution: NamedControlResolution | undefined;
  if (target) resolution = await pressNamedControl(device, target);
  const receipt = await typeText(device, text);
  return { ...(resolution ? { resolution } : {}), ...(receipt ? { receipt } : {}) };
}

export async function replaceText(
  device: Device,
  target: TextEntryTarget,
  text: string,
): Promise<TextEntryOutcome> {
  if (currentTargetContext().kind !== "browser" && selectedPlatform() === "android") {
    return enterAndroidText(device, "replace", target, text);
  }
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
  return fillPoint ? { resolution: explicitPointResolution(fillPoint) } : {};
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

export async function typeViaLiveIosListener(text: string): Promise<boolean> {
  if (selectedPlatform() !== "ios") return false;
  let context: ReturnType<typeof currentTargetContext>;
  try {
    context = currentTargetContext();
  } catch {
    return false;
  }
  const typeRoute = resolveAppleControlRoute(context);
  if (!isPhysicalRunnerRoute(typeRoute)) return false;
  const live = await probeLiveIosRunnerListener(typeRoute.udid);
  if (!live) return false;
  const appBundleId = await rememberedTargetApplication(context);
  await controlledMutation("type", () =>
    typeViaLiveIosRunnerListener({
      serial: typeRoute.udid,
      text,
      ...(appBundleId ? { appBundleId } : {}),
    }),
  );
  return true;
}
