/**
 * Thin agent-device SDK helpers.
 * Pattern: open → snapshot/find → press → re-check. Failures throw.
 * All long waits honor job cancel/pause via control.ts.
 */
import { cooperativeCheckpoint } from "../execution/control.js";

import {
  type Device,
  type SnapshotNode,
  type DeviceSnapshotOptions,
} from "./device-capabilities.js";

export type { Device, SnapshotNode } from "./device-capabilities.js";
import {
  base,
  controlled,
  controlledMutation,
  iosNonHittablePressFields,
  nativeDevice,
} from "./device-dispatch.js";
import { type DeviceTextInputDependencies, typeDeviceText } from "./device-android-text.js";
import { typeViaLiveIosListener } from "./device-text-entry.js";
import {
  boundedAndroidTextEntrySnapshot,
  type AndroidTextEntryReceipt,
} from "../android/android-text-entry-verification.js";
export {
  androidKeyboardShifted,
  escapeAndroidShellText,
  isAndroidClipboardTransportFailure,
  isAndroidProviderTextInjectionUnavailable,
  pasteAndroidText,
} from "./device-android-text.js";
export type { AndroidTextPasteAdapter } from "./device-android-text.js";
export { base } from "./device-dispatch.js";
import { currentTargetContext, selectedPlatform } from "../target/target-context.js";
import { iosSelectorWasNotDispatched } from "../ios/ios-mutation-policy.js";
import {
  isIosSessionMissingSnapshotError,
  snapshotFromLiveIosRunnerListenerIfReady,
  tapViaLiveIosRunnerListener,
} from "../ios/ios-runner-listener-command.js";
import { probeLiveIosRunnerListener } from "../ios/ios-runner-listener.js";
import { isPhysicalRunnerRoute, resolveAppleControlRoute } from "../apple/apple-control-route.js";
import { mutateCurrentTarget } from "./device-target-mutation.js";
import {
  noteActivationTransport,
  noteCoordinateActuation,
  noteDaemonSelectorActuation,
  noteDirectActuation,
  type ActivationResolutionPath,
} from "./device-activation-transport.js";
import { sleep } from "./device-system-actions.js";
export { createDevice, resetDeviceClient, resetDeviceClients } from "./device-client-bindings.js";
import {
  clipboardCopy as copyDeviceClipboard,
  clipboardPaste as pasteDeviceClipboard,
  type ClipboardTarget,
} from "./device-clipboard.js";
export { clipboardRead, clipboardWrite } from "./device-clipboard.js";
import { rememberedTargetApplication } from "./device-target-applications.js";
export {
  rememberedTargetApplication,
  rememberTargetApplication,
} from "./device-target-applications.js";
import { captureIosSnapshot } from "../ios/ios-snapshot-flight.js";
export {
  IosMutationOutcomeUnknownError,
  lastIosMutationAttemptDiagnostic,
  runIosMutationOnce,
} from "../ios/ios-mutation-policy.js";
export type {
  IosMutationAttemptDiagnostic,
  IosMutationOperation,
} from "../ios/ios-mutation-policy.js";
export {
  IOS_SNAPSHOT_TIMEOUT_MS,
  IosSnapshotInFlightError,
  IosSnapshotRunnerWedgedError,
  IosSnapshotTimedOutError,
  isIosAccessibilityQueryInFlightError,
} from "../ios/ios-snapshot-flight.js";
export { selectedPlatform } from "../target/target-context.js";
export * from "../android/android-app-build.js";

export {
  pressResolvedControl,
  pressNamedControl,
  androidNamedPressCompletedHandoff,
} from "./device-resolved-control.js";
import {
  center,
  INTERACTIVE_SNAPSHOT_ROLES,
  resolveSnapshotTargetPoint,
} from "./device-target-resolution.js";
import type { SemanticSnapshotTarget } from "./device-target-resolution.js";
export {
  center,
  preflightSemanticActivation,
  resolveFollowingRowControl,
  resolveNamedControl,
  resolveSnapshotTargetPoint,
} from "./device-target-resolution.js";
export type {
  NamedControlMethod,
  NamedControlResolution,
  NamedControlTarget,
  SemanticActivationPreflight,
  SnapshotTargetRegion,
} from "./device-target-resolution.js";

export type DevicePlatform = "android" | "ios";
export const PLATFORM = "android" as const;

export { sleep, openUrl, screenshot, pressKey } from "./device-system-actions.js";

export async function snapshot(
  device: Device,
  opts?: DeviceSnapshotOptions,
): Promise<SnapshotNode[]> {
  const run = () =>
    device.capture.snapshot({
      ...base(),
      interactiveOnly: opts?.interactiveOnly ?? false,
      raw: opts?.raw,
    });
  let context: ReturnType<typeof currentTargetContext> | undefined;
  try {
    context = currentTargetContext();
  } catch {
    context = undefined;
  }
  const appleRoute = resolveAppleControlRoute(context);
  if (context?.kind === "device" && context.platform === "ios") {
    // Recipes already press/type through the adopted testCommand listener.
    // Recapture / observe / screen-capture must use that same usbmux path.
    // The bounded SDK probe looks at Relay’s Copy-probe session, not the
    // LISTENER_READY runner — adopt first, and do not recover-kill it.
    // Simulators have no usbmux; their live runner lease must route through
    // the SDK session below instead.
    const adopted = isPhysicalRunnerRoute(appleRoute)
      ? await snapshotFromLiveIosRunnerListenerIfReady(context, opts)
      : undefined;
    if (adopted !== undefined) return adopted;
    try {
      return await captureIosSnapshot(
        context,
        opts?.interactiveOnly ?? false,
        run,
        opts?.timeoutMs,
      );
    } catch (error) {
      if (!isIosSessionMissingSnapshotError(error)) throw error;
      throw new Error("iOS snapshot needs an active XCTest session");
    }
  }
  const result = await controlled(
    run,
    opts?.retryAttempts !== undefined ? { attempts: opts.retryAttempts } : {},
  );
  return (result.nodes ?? []) as SnapshotNode[];
}

export {
  bindAndroidAppSession,
  bootTarget,
  openApp,
  prepareDeviceRunner,
  recordDeviceVideo,
} from "./device-app-lifecycle.js";
export type {
  DeviceRecordingOptions,
  DeviceRecordingResult,
  LaunchResult,
} from "./device-app-lifecycle.js";
export {
  activationEvidenceHasPointContribution,
  activationTransportEvidence,
  activationTransportEvidenceSince,
  activationTransportHasPointContribution,
  activationTransportsSince,
  activationTransportSequence,
  noteActivationTransport,
} from "./device-activation-transport.js";
export type {
  ActivationChannel,
  ActivationOperation,
  ActivationResolutionPath,
  ActivationTransport,
  ActivationTransportEvidence,
  ActivationTransportRecord,
} from "./device-activation-transport.js";
export { accessibilityTreeQuality } from "./accessibility-tree-quality.js";
export type { AccessibilityTreeQuality } from "./accessibility-tree-quality.js";

export type RepeatedPress = {
  count?: number;
  intervalMs?: number;
  doubleTap?: boolean;
};

async function pressViaLiveIosListener(
  selectorKey: "label" | "id",
  selectorValue: string,
): Promise<boolean> {
  if (selectedPlatform() !== "ios") return false;
  let context: ReturnType<typeof currentTargetContext>;
  try {
    context = currentTargetContext();
  } catch {
    return false;
  }
  const pressRoute = resolveAppleControlRoute(context);
  if (!isPhysicalRunnerRoute(pressRoute)) return false;
  const live = await probeLiveIosRunnerListener(pressRoute.udid);
  if (!live) return false;
  const appBundleId = await rememberedTargetApplication(context);
  // One usbmux tap on the LISTENER_READY runner. Do not also dispatch through
  // the unbound SDK session — that is a second press with unknown outcome.
  const actuation = await controlledMutation("press", () =>
    tapViaLiveIosRunnerListener({
      serial: pressRoute.udid,
      selectorKey,
      selectorValue,
      ...(appBundleId ? { appBundleId } : {}),
    }),
  );
  // The runner never receives a point contribution here, but its selector
  // activation is always permitted to coordinate-activate non-hittable
  // elements — and the collision path provably tapped a re-ranked coordinate.
  noteActivationTransport({
    operation: "press",
    transport: actuation.actuation === "point" ? "snapshot-point" : "native-selector",
    channel: "listener",
    resolutionMethod: selectorKey === "id" ? "identifier" : "label",
    coordinateFallbackPermitted: true,
    ...(actuation.collisionRecovery ? { collisionRecovery: true } : {}),
  });
  return true;
}

export async function pressLabel(
  device: Device,
  label: string,
  repeated?: RepeatedPress,
  heading?: string,
): Promise<void> {
  const scopedHeading = heading?.trim();
  // Native label selectors cannot see an ancestor heading, so skip the iOS
  // listener when a heading scopes an otherwise ambiguous label.
  if (!scopedHeading && (await pressViaLiveIosListener("label", label))) return;
  const semantic = { label, ...(scopedHeading ? { heading: scopedHeading } : {}) };
  const point = resolveSnapshotTargetPoint(await snapshot(device), semantic);
  try {
    await controlledMutation("press", () =>
      nativeDevice(device).interactions.press({
        ...base(),
        selector: `label="${label.replaceAll('"', '\\"')}"`,
        ...(scopedHeading ? { heading: scopedHeading } : {}),
        ...iosNonHittablePressFields(),
        ...repeated,
      } as never),
    );
    noteDaemonSelectorActuation({
      operation: "press",
      resolutionMethod: "label",
    });
  } catch (error) {
    if (selectedPlatform() === "android" && !iosSelectorWasNotDispatched(error)) throw error;
    const fallback =
      selectedPlatform() === "ios"
        ? await iosSnapshotFallbackPoint(device, semantic, error, point)
        : (point ?? (await iosSnapshotFallbackPoint(device, semantic, error)));
    await pressPoint(device, fallback.x, fallback.y, repeated, {
      provenance: "snapshot-point",
      resolutionMethod: "label",
    });
  }
}

export async function pressIdentifier(
  device: Device,
  identifier: string,
  repeated?: RepeatedPress,
): Promise<void> {
  if (await pressViaLiveIosListener("id", identifier)) return;
  const point = resolveSnapshotTargetPoint(await snapshot(device), { identifier });
  try {
    await controlledMutation("press", () =>
      nativeDevice(device).interactions.press({
        ...base(),
        selector: `id="${identifier.replaceAll('"', '\\"')}"`,
        ...iosNonHittablePressFields(),
        ...repeated,
      } as never),
    );
    noteDaemonSelectorActuation({
      operation: "press",
      resolutionMethod: "identifier",
    });
  } catch (error) {
    if (selectedPlatform() === "android" && !iosSelectorWasNotDispatched(error)) throw error;
    const fallback =
      selectedPlatform() === "ios"
        ? await iosSnapshotFallbackPoint(device, { identifier }, error, point)
        : (point ?? (await iosSnapshotFallbackPoint(device, { identifier }, error)));
    await pressPoint(device, fallback.x, fallback.y, repeated, {
      provenance: "snapshot-point",
      resolutionMethod: "identifier",
    });
  }
}

export async function pressPoint(
  device: Device,
  x: number,
  y: number,
  repeated?: RepeatedPress,
  provenance: {
    /** Where the coordinate came from. Defaults to the caller, because a
     * coordinate without a resolution context can only be caller-supplied. */
    provenance?: "explicit-point" | "snapshot-point";
    resolutionMethod?: ActivationResolutionPath;
  } = {},
): Promise<void> {
  const transport = provenance.provenance ?? "explicit-point";
  if (selectedPlatform() === "ios" && !repeated) {
    const context = currentTargetContext();
    const pressRoute = resolveAppleControlRoute(context);
    if (isPhysicalRunnerRoute(pressRoute)) {
      const live = await probeLiveIosRunnerListener(pressRoute.udid);
      if (live) {
        const appBundleId = await rememberedTargetApplication(context);
        await controlledMutation("press", () =>
          tapViaLiveIosRunnerListener({
            serial: pressRoute.udid,
            point: { x, y },
            ...(appBundleId ? { appBundleId } : {}),
          }),
        );
        noteCoordinateActuation({
          operation: "press",
          provenance: transport,
          channel: "listener",
          ...(provenance.resolutionMethod ? { resolutionMethod: provenance.resolutionMethod } : {}),
        });
        return;
      }
    }
  }
  await controlledMutation("press", () =>
    nativeDevice(device).interactions.press({
      ...base(),
      x,
      y,
      ...repeated,
    } as never),
  );
  noteCoordinateActuation({
    operation: "press",
    provenance: transport,
    channel: "daemon",
    ...(provenance.resolutionMethod ? { resolutionMethod: provenance.resolutionMethod } : {}),
  });
}

export async function longPressTarget(
  device: Device,
  target: {
    identifier?: string;
    ref?: string;
    label?: string;
    text?: string;
    point?: { x: number; y: number };
  },
  durationMs = 700,
): Promise<void> {
  // Long-press payloads never carry the non-hittable coordinate allowance:
  // every semantic branch here is a bare native selector actuation.
  const bareSelector = (resolutionMethod: ActivationResolutionPath) =>
    noteActivationTransport({
      operation: "long-press",
      transport: "native-selector",
      channel: "daemon",
      resolutionMethod,
    });
  if (target.identifier) {
    await controlledMutation("long-press", () =>
      nativeDevice(device).interactions.longPress({
        ...base(),
        selector: `id="${target.identifier!.replaceAll('"', '\\"')}"`,
        durationMs,
      }),
    );
    bareSelector("identifier");
  } else if (target.ref) {
    await controlledMutation("long-press", () =>
      nativeDevice(device).interactions.longPress({
        ...base(),
        ref: target.ref!.startsWith("@") ? target.ref! : `@${target.ref!}`,
        durationMs,
      }),
    );
    bareSelector("ref");
  } else if (target.label) {
    const label = target.label;
    await controlledMutation("long-press", () =>
      nativeDevice(device).interactions.longPress({
        ...base(),
        selector: `label="${label.replaceAll('"', '\\"')}"`,
        durationMs,
      }),
    );
    bareSelector("label");
  } else if (target.text) {
    const text = target.text;
    await controlledMutation("long-press", () =>
      nativeDevice(device).interactions.longPress({
        ...base(),
        selector: `label*="${text.replaceAll('"', '\\"')}"`,
        durationMs,
      }),
    );
    bareSelector("text");
  } else if (target.point) {
    await controlledMutation("long-press", () =>
      nativeDevice(device).interactions.longPress({
        ...base(),
        x: target.point!.x,
        y: target.point!.y,
        durationMs,
      }),
    );
    noteCoordinateActuation({
      operation: "long-press",
      provenance: "explicit-point",
      channel: "daemon",
      resolutionMethod: "point",
    });
  } else {
    throw new Error("hold requires a target");
  }
}

async function focusClipboardTarget(device: Device, target: ClipboardTarget): Promise<void> {
  if (target.identifier) return pressIdentifier(device, target.identifier);
  if (target.ref) return pressRef(device, target.ref);
  if (target.label) return pressLabel(device, target.label);
  if (target.text) return pressText(device, target.text);
  if (target.point) return pressPoint(device, target.point.x, target.point.y);
  throw new Error("clipboard copy/paste requires an identifier, label, or text target");
}

export function clipboardPaste(
  device: Device,
  text: string,
  target: ClipboardTarget,
): Promise<string> {
  return pasteDeviceClipboard(device, text, target, focusClipboardTarget);
}

export function clipboardCopy(
  device: Device,
  target: ClipboardTarget,
  expectedText?: string,
): Promise<string> {
  return copyDeviceClipboard(device, target, expectedText, focusClipboardTarget);
}

export {
  closeApp,
  openAppSwitcher,
  rotateDevice,
  keyboardAction,
  alertAction,
  updateSetting,
  captureNetwork,
  manageLogs,
  setAndroidLockState,
  swipeGesture,
} from "./device-system-actions.js";

export async function typeText(
  device: Device,
  text: string,
  knownBefore?: SnapshotNode,
): Promise<AndroidTextEntryReceipt | undefined> {
  const dependencies: DeviceTextInputDependencies = {
    snapshot: (target) =>
      boundedAndroidTextEntrySnapshot(() =>
        snapshot(target, { raw: true, timeoutMs: 3000, retryAttempts: 1 }),
      ),
    mutateCurrentTarget,
    typeViaLiveIosListener,
  };
  return typeDeviceText(device, text, dependencies, knownBefore);
}

export async function pressRef(
  device: Device,
  ref: string,
  repeated?: RepeatedPress,
): Promise<void> {
  const normalized = ref.startsWith("@") ? ref : `@${ref}`;
  await controlledMutation("press", () =>
    nativeDevice(device).interactions.press({ ...base(), ref: normalized, ...repeated }),
  );
  // Ref presses attach no maestro fields, so no point contribution and no
  // coordinate fallback permission ever reaches the runner here.
  noteActivationTransport({
    operation: "press",
    transport: "native-selector",
    channel: "daemon",
    resolutionMethod: "ref",
  });
}

export async function pressText(
  device: Device,
  text: string,
  repeated?: RepeatedPress,
): Promise<void> {
  try {
    await controlledMutation("press", () =>
      nativeDevice(device).interactions.press({
        ...base(),
        selector: `label*="${text.replaceAll('"', '\\"')}"`,
        ...iosNonHittablePressFields(),
        ...repeated,
      } as never),
    );
    noteDaemonSelectorActuation({ operation: "press", resolutionMethod: "text" });
  } catch (error) {
    const point = await iosSnapshotFallbackPoint(device, { text }, error);
    await pressPoint(device, point.x, point.y, repeated, {
      provenance: "snapshot-point",
      resolutionMethod: "text",
    });
  }
}

export { replaceText, replaceTextValue, type TextReplacementAdapter } from "./device-text-entry.js";

export async function findClick(
  device: Device,
  query: string,
  opts?: { first?: boolean; last?: boolean },
): Promise<void> {
  try {
    await controlledMutation("press", () =>
      nativeDevice(device).interactions.find({
        ...base(),
        query,
        action: "click",
        first: opts?.first ?? true,
        last: opts?.last,
        ...iosNonHittablePressFields(),
      } as never),
    );
    // The daemon resolves the query itself; Relay contributes no geometry.
    noteDaemonSelectorActuation({ operation: "find", resolutionMethod: "text" });
  } catch (error) {
    const point = await iosSnapshotFallbackPoint(device, { text: query }, error).catch(
      async (err) => iosSnapshotFallbackPoint(device, { label: query }, err),
    );
    await pressPoint(device, point.x, point.y, undefined, {
      provenance: "snapshot-point",
      resolutionMethod: "text",
    });
  }
}

export async function exists(device: Device, query: string): Promise<boolean> {
  try {
    await controlled(() =>
      device.interactions.find({
        ...base(),
        query,
        action: "exists",
        first: true,
      }),
    );
    return true;
  } catch (err) {
    if (err instanceof Error && err.name === "JobCancelledError") throw err;
    return false;
  }
}

export async function waitFor(
  device: Device,
  selectorOrText: { selector?: string; text?: string; query?: string },
  timeoutMs = 30_000,
): Promise<void> {
  if (selectorOrText.selector) {
    const selector = selectorOrText.selector;
    await controlled(() =>
      device.command.wait({
        ...base(),
        selector,
        timeoutMs,
      }),
    );
    return;
  }
  if (selectorOrText.text) {
    const text = selectorOrText.text;
    await controlled(() =>
      device.command.wait({
        ...base(),
        text,
        timeoutMs,
      }),
    );
    return;
  }
  const query = selectorOrText.query;
  if (!query) throw new Error("waitFor requires selector, text, or query");
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    await cooperativeCheckpoint();
    if (await exists(device, query)) return;
    await sleep(400, device);
  }
  throw new Error(`Timed out waiting for: ${query}`);
}

export async function scrollDown(device: Device, amount = 0.5): Promise<void> {
  await controlledMutation("scroll", () =>
    nativeDevice(device).interactions.scroll({
      ...base(),
      direction: "down",
      amount,
    }),
  );
  noteDirectActuation("scroll", "daemon");
}

/** Scroll toward earlier content using the same SDK semantics as scrollDown. */
export async function scrollUp(device: Device, amount = 0.5): Promise<void> {
  await controlledMutation("scroll", () =>
    nativeDevice(device).interactions.scroll({
      ...base(),
      direction: "up",
      amount,
    }),
  );
  noteDirectActuation("scroll", "daemon");
}

export function nodesMatch(nodes: SnapshotNode[], substring: string): SnapshotNode | undefined {
  const q = substring.toLowerCase();
  return nodes.find((n) => {
    const blob = `${n.label ?? ""} ${n.value ?? ""}`.toLowerCase();
    return blob.includes(q);
  });
}

/** agent-device reports every Android package transition after a coordinate
 * fallback as an escaped tap. Accept one only when the authored semantic
 * control declares the exact expected destination package. */
function canUseIosSnapshotCoordinateFallback(error: unknown): boolean {
  if (selectedPlatform() !== "ios") return false;
  return iosSelectorWasNotDispatched(error);
}

export async function iosSnapshotFallbackPoint(
  device: Device,
  target: SemanticSnapshotTarget,
  error: unknown,
  knownPoint?: { x: number; y: number },
): Promise<{ x: number; y: number }> {
  if (!canUseIosSnapshotCoordinateFallback(error)) throw error;
  const point = knownPoint ?? resolveSnapshotTargetPoint(await snapshot(device), target);
  if (!point) throw error;
  return point;
}

export async function pressMatchingText(device: Device, match: string): Promise<void> {
  // Prefer the daemon-resolved selector press (one round-trip); the snapshot
  // point only serves the local fallback when the selector dispatch fails.
  const nodes = await snapshot(device);
  const point =
    resolveSnapshotTargetPoint(nodes, { text: match }) ??
    resolveSnapshotTargetPoint(nodes, { label: match });
  try {
    await controlledMutation("press", () =>
      nativeDevice(device).interactions.press({
        ...base(),
        selector: `label*="${match.replaceAll('"', '\\"')}"`,
        ...iosNonHittablePressFields(),
      } as never),
    );
    noteDaemonSelectorActuation({
      operation: "press",
      resolutionMethod: "text",
    });
    return;
  } catch (error) {
    if (error instanceof Error && error.name === "JobCancelledError") throw error;
    if (selectedPlatform() === "ios" && !canUseIosSnapshotCoordinateFallback(error)) {
      throw error;
    }
  }

  if (await exists(device, match)) {
    try {
      await findClick(device, match);
      return;
    } catch (err) {
      if (err instanceof Error && err.name === "JobCancelledError") throw err;
      // `findClick` may already have sent its own native iOS command. Only a
      // selector rejection proven to be pre-dispatch may reach the older
      // snapshot/point resolver below; an acknowledgement loss must stay a
      // terminal review boundary rather than becoming a second coordinate tap.
      if (selectedPlatform() === "ios" && !canUseIosSnapshotCoordinateFallback(err)) {
        throw err;
      }
    }
  }

  const textNode = nodesMatch(nodes, match);
  if (!textNode?.rect && !point) {
    throw new Error(`No UI node matching "${match}"`);
  }

  if (point) {
    await pressPoint(device, point.x, point.y, undefined, {
      provenance: "snapshot-point",
      resolutionMethod: "text",
    });
    return;
  }

  const { x: tx, y: ty, width: tw, height: th } = textNode!.rect!;
  // An enclosing row must span (nearly) the full viewport width. The old
  // absolute `width >= 400` only matched iPad-class geometry; a relative
  // threshold lets iPhone rows qualify while still rejecting narrow inline
  // chips. Falls back to the historical absolute floor when no viewport
  // root is present in the tree.
  const applicationWidth = nodes.find(
    (node) => (node.type ?? node.role)?.toLocaleLowerCase() === "application",
  )?.rect?.width;
  const windowWidth = nodes.find(
    (node) => (node.type ?? node.role)?.toLocaleLowerCase() === "window",
  )?.rect?.width;
  const viewportWidth = applicationWidth ?? windowWidth;
  // No viewport root: keep the historical absolute floor of 400pt.
  const minContainerWidth = viewportWidth === undefined ? 400 : Math.max(400, viewportWidth * 0.9);
  let best: { area: number; x: number; y: number; width: number; height: number } | undefined;

  for (const n of nodes) {
    const role = (n.role ?? n.type ?? "").toLocaleLowerCase();
    const interactive =
      n.hittable || (selectedPlatform() === "ios" && INTERACTIVE_SNAPSHOT_ROLES.has(role));
    if (!interactive || !n.rect) continue;
    const { x, y, width, height } = n.rect;
    if (
      x <= tx &&
      y <= ty &&
      x + width >= tx + tw &&
      y + height >= ty + th &&
      width >= minContainerWidth
    ) {
      const area = width * height;
      if (!best || area < best.area) {
        best = { area, x, y, width, height };
      }
    }
  }

  const rect = best ?? textNode!.rect!;
  const p = center(rect);
  await pressPoint(device, p.x, p.y, undefined, {
    provenance: "snapshot-point",
    resolutionMethod: "text",
  });
}

export async function anyExists(device: Device, queries: string[]): Promise<string | undefined> {
  for (const q of queries) {
    if (await exists(device, q)) return q;
  }
  return undefined;
}
