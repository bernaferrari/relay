/**
 * Semantic + point interactions shared by the mouse, CLI, and recipes.
 */
import {
  findClick,
  pressNamedControl,
  type NamedControlResolution,
  pressMatchingText,
  pressKey,
  pressPoint,
  pressRef,
  replaceText,
  swipeGesture,
  typeText,
  type Device,
  lastIosMutationAttemptDiagnostic,
  type IosMutationAttemptDiagnostic,
  type SnapshotNode,
} from "./device.js";
import {
  explicitPointResolution,
  resolveNamedControlOutcome,
  resolveSnapshotTargetRevealDirection,
  snapshotLabelMatches,
  snapshotTextMatches,
  type NamedControlTarget,
} from "./device-target-resolution.js";
import { currentTargetContext, runWithTargetContext } from "./target-context.js";
import { verifyIosScreenChanged } from "./ios-app-launch.js";
import {
  annotateTapPreview,
  tapPreviewLogicalBounds,
} from "./tap-preview.js";
import { iosLogicalBoundsForSerial } from "./workspace-capture.js";
import { resolveRuntimeTarget } from "./workspace-devices.js";
import {
  lastIosSessionOperationDiagnostic,
  withSession,
  type IosSessionOperationDiagnostic,
} from "./workspace-ios-session.js";
import { rawKey, rawSwipe, rawTap } from "./workspace-android-raw.js";
import { captureScreenshot, captureSnapshot, type ScreenshotPayload } from "./workspace-capture.js";
import { invalidateTargetSemanticControl } from "./target-runtime-readiness.js";
import { IosXCTestSessionUnavailableError, diagnoseIosRunnerError } from "./ios-device-adapter.js";

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
  iosSessionLifecycle?: IosSessionOperationDiagnostic;
  /** One native iOS command is a user-visible fact, not an internal retry. */
  iosMutation?: IosMutationAttemptDiagnostic;
};

function attachIosSessionLifecycle(
  result: InteractResult,
  serial: string,
  previousMutationSequence: number | null,
): InteractResult {
  const lifecycle = lastIosSessionOperationDiagnostic(serial);
  const mutation = lastIosMutationAttemptDiagnostic(serial);
  return {
    ...result,
    ...(lifecycle ? { iosSessionLifecycle: lifecycle } : {}),
    ...(mutation && mutation.sequence !== previousMutationSequence
      ? { iosMutation: mutation }
      : {}),
  };
}

/**
 * Named iOS taps (identifier, label, find, text-match) are visually verified
 * by default through interact(): pixels must change or the tap fails with the
 * typed unchanged-screen error. Point taps keep their own always-on proof and
 * non-iOS/non-tap kinds are never verified. Callers that cannot tolerate a
 * verification failure opt out with verifyIosScreenChange === false.
 */
export function canVerifyIosScreenChange(input: InteractInput): boolean {
  return (
    input.kind === "identifier" ||
    input.kind === "label" ||
    input.kind === "find" ||
    input.kind === "text-match"
  );
}

/**
 * A visual verifier has no access to the caller's recipe/session context.
 * Give it the resolved command verbatim so a failed iOS transition can retain
 * an evidence package that an agent or person can replay without guessing.
 */
function iosVisualRepairFor(input: InteractInput) {
  const label = (() => {
    switch (input.kind) {
      case "point":
        return `Tap (${input.x}, ${input.y})`;
      case "identifier":
        return `Identifier “${input.identifier}”`;
      case "label":
        return `Label “${input.label}”`;
      case "find":
        return `Find “${input.query}”`;
      case "text-match":
        return `Text match “${input.match}”`;
      default:
        return `iOS ${input.kind} interaction`;
    }
  })();
  return {
    interaction: {
      label,
      input: structuredClone(input) as Record<string, unknown>,
    },
  };
}

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

function namedPreviewTarget(input: InteractInput): NamedControlTarget | undefined {
  switch (input.kind) {
    case "identifier":
      return { identifier: input.identifier };
    case "label":
      return { label: input.label };
    case "find":
      return { label: input.query, text: input.query };
    case "text-match":
      return { text: input.match, label: input.match };
    default:
      return undefined;
  }
}

function previewControlLabel(input: InteractInput): string {
  switch (input.kind) {
    case "identifier":
      return `Identifier “${input.identifier}”`;
    case "label":
      return `Label “${input.label}”`;
    case "find":
      return `Find “${input.query}”`;
    case "text-match":
      return `Text match “${input.match}”`;
    default:
      return "Control";
  }
}

function previewUnusableControlError(
  input: InteractInput,
  reason: "offscreen" | "unhittable",
): Error {
  const why = reason === "offscreen" ? "is off-screen" : "is not hittable";
  return new Error(
    `${previewControlLabel(input)} ${why} and will not tap. Scroll it into view or preview an explicit point.`,
  );
}

function previewNodeMatchesNamedTarget(
  node: SnapshotNode,
  target: NamedControlTarget,
  method: NamedControlResolution["method"],
): boolean {
  if (method === "identifier" && target.identifier) {
    return (
      node.identifier?.trim().toLocaleLowerCase() === target.identifier.trim().toLocaleLowerCase()
    );
  }
  if (method === "label" && target.label) {
    return snapshotLabelMatches(target.label, node.label);
  }
  if (method === "text" && target.text) {
    return [node.label, node.value, node.identifier].some((value) =>
      snapshotTextMatches(target.text!, value),
    );
  }
  if (target.identifier) {
    return (
      node.identifier?.trim().toLocaleLowerCase() === target.identifier.trim().toLocaleLowerCase()
    );
  }
  if (target.label) return snapshotLabelMatches(target.label, node.label);
  if (target.text) {
    return [node.label, node.value, node.identifier].some((value) =>
      snapshotTextMatches(target.text!, value),
    );
  }
  return false;
}

function previewMatchedNode(
  nodes: SnapshotNode[],
  target: NamedControlTarget,
  resolution: NamedControlResolution,
): SnapshotNode | undefined {
  const byBounds = nodes.find(
    (node) =>
      node.rect &&
      node.rect.x === resolution.bounds.x &&
      node.rect.y === resolution.bounds.y &&
      node.rect.width === resolution.bounds.width &&
      node.rect.height === resolution.bounds.height,
  );
  if (byBounds) return byBounds;
  return nodes.find((node) => previewNodeMatchesNamedTarget(node, target, resolution.method));
}

function resolveNamedInteractPreview(
  nodes: SnapshotNode[],
  input: InteractInput,
  target: NamedControlTarget,
): NamedControlResolution | undefined {
  // A preview mark on an off-screen or unhittable control will not tap.
  const userPoint =
    "point" in input && input.point ? explicitPointResolution(input.point) : undefined;
  const outcome = resolveNamedControlOutcome(nodes, target);
  if (outcome.status === "resolved") {
    const node = previewMatchedNode(nodes, target, outcome.resolution);
    const offscreen =
      node?.visibleToUser === false ||
      resolveSnapshotTargetRevealDirection(nodes, target) !== undefined;
    const unhittable = node?.hittable === false;
    if (offscreen || unhittable) {
      if (userPoint) return userPoint;
      throw previewUnusableControlError(
        input,
        unhittable && !offscreen ? "unhittable" : "offscreen",
      );
    }
    return outcome.resolution;
  }
  if (outcome.status === "offscreen" || outcome.status === "unhittable") {
    if (userPoint) return userPoint;
    throw previewUnusableControlError(input, outcome.status);
  }
  return userPoint;
}

export function resolveInteractPreview(
  nodes: SnapshotNode[],
  input: InteractInput,
): NamedControlResolution | undefined {
  switch (input.kind) {
    case "identifier":
    case "label":
    case "find":
    case "text-match":
      return resolveNamedInteractPreview(nodes, input, namedPreviewTarget(input)!);
    case "point":
      return {
        method: "point",
        point: { x: input.x, y: input.y },
        bounds: { x: input.x, y: input.y, width: 1, height: 1 },
      };
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
    iosSessionLifecycle?: IosSessionOperationDiagnostic;
  }
> {
  const shot = await captureScreenshot({
    serial: opts?.serial,
    ephemeral: true,
    includeScreenMatch: false,
  });
  let nodes: SnapshotNode[] = [];
  let inspectable = false;
  let iosSessionLifecycle: IosSessionOperationDiagnostic | undefined;
  try {
    const snap = await captureSnapshot({ serial: opts?.serial, iosOperation: "preview" });
    nodes = snap.nodes;
    inspectable = snap.inspectable !== false && snap.nodes.length > 0;
    iosSessionLifecycle = snap.iosSessionLifecycle;
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
    return {
      ...shot,
      inspectable,
      preview: true as const,
      ...(iosSessionLifecycle ? { iosSessionLifecycle } : {}),
    };
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
      serial ? tapPreviewLogicalBounds(buf, iosLogicalBoundsForSerial(serial)) : undefined,
    ),
  );
  return {
    ...shot,
    base64: buf.toString("base64"),
    bytes: buf.byteLength,
    inspectable,
    preview: true,
    ...(iosSessionLifecycle ? { iosSessionLifecycle } : {}),
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
  opts?: { serial?: string; verifyIosScreenChange?: boolean; device?: Device },
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
  const target = await resolveRuntimeTarget(opts?.serial, opts?.device);
  return runWithTargetContext(target.context, async () => {
    const context = currentTargetContext();
    const previousIosMutationSequence =
      context.kind === "device" && context.platform === "ios"
        ? (lastIosMutationAttemptDiagnostic(context.serial)?.sequence ?? null)
        : null;
    // Pixels can update at preview rate. Accessibility geometry cannot: after
    // any committed input the last tree remains useful historical evidence,
    // but it must render stale until a deliberate snapshot proves the new UI.
    const afterInput = <T>(result: T): T => {
      if (context.kind === "device" && context.platform === "android") {
        // iOS advances the same fence in runIosMutationOnce, precisely when
        // XCTest acknowledges its one native command. Keeping it there avoids
        // fencing after selector misses or outcome-unknown attempts.
        invalidateTargetSemanticControl(
          { serial: context.serial, platform: context.platform },
          "input-changed",
        );
      }
      return result;
    };
    if (context.kind === "device" && context.platform === "android") {
      // Direct manipulation should survive app/session changes. Semantic refs
      // still use the SDK below, but mirror gestures never need an active app.
      if (input.kind === "point") {
        rawTap(input.x, input.y, context.serial);
        return afterInput({
          resolution: {
            method: "point" as const,
            point: { x: input.x, y: input.y },
            bounds: { x: input.x, y: input.y, width: 1, height: 1 },
          },
        });
      }
      if (input.kind === "swipe") {
        rawSwipe(input.from, input.to, input.durationMs ?? 250, context.serial);
        return afterInput({});
      }
      if (input.kind === "key") {
        rawKey(input.key, context.serial);
        return afterInput({});
      }
    }
    if (context.kind === "device" && context.platform === "ios" && input.kind === "point") {
      await withSession(
        target.device,
        () =>
          verifyIosScreenChanged(
            context.serial,
            () => pressPoint(target.device, input.x, input.y),
            {
              repair: iosVisualRepairFor(input),
            },
          ),
        "interaction",
      );
      return afterInput(
        attachIosSessionLifecycle(
          {
            resolution: {
              method: "point" as const,
              point: { x: input.x, y: input.y },
              bounds: { x: input.x, y: input.y, width: 1, height: 1 },
            },
          },
          context.serial,
          previousIosMutationSequence,
        ),
      );
    }
    // Visual transition proof is now the default for named iOS taps: a
    // stale selector that leaves pixels untouched must surface as the typed
    // tap-did-not-change error instead of a silent no-op. Callers opt out
    // explicitly with verifyIosScreenChange === false.
    if (
      context.kind === "device" &&
      context.platform === "ios" &&
      opts?.verifyIosScreenChange !== false &&
      canVerifyIosScreenChange(input)
    ) {
      let result: InteractResult | undefined;
      await withSession(
        target.device,
        () =>
          verifyIosScreenChanged(
            context.serial,
            async () => {
              result = await interactOnDevice(target.device, input);
              if (!result.resolution) {
                throw new Error(
                  "No unique control matched this iOS accessibility target. Use a visible point instead.",
                );
              }
            },
            { repair: iosVisualRepairFor(input) },
          ),
        "interaction",
      );
      return afterInput(
        attachIosSessionLifecycle(result!, context.serial, previousIosMutationSequence),
      );
    }
    try {
      const result = await withSession(
        target.device,
        async () => {
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
            case "key":
              if (input.key === "back" || input.key === "home") {
                await pressKey(target.device, input.key);
                return {};
              }
              throw new Error(
                `iOS key ${input.key} needs an explicit keyboard action; use a semantic control or type text instead.`,
              );
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
        },
        "interaction",
      );
      const withLifecycle =
        context.kind === "device" && context.platform === "ios"
          ? attachIosSessionLifecycle(result, context.serial, previousIosMutationSequence)
          : result;
      return afterInput(withLifecycle);
    } catch (err) {
      // A native iOS command that failed mid-flight is wrapped in an
      // outcome-unknown boundary; classify its underlying cause, not the
      // wrapper, so a lost runner still reports the actionable class.
      const underlying =
        err instanceof Error && err.name === "IosMutationOutcomeUnknownError" && "cause" in err
          ? (err.cause ?? err)
          : err;
      const msg = underlying instanceof Error ? underlying.message : String(underlying);
      const context = currentTargetContext();
      if (
        /no active session/i.test(msg) &&
        context.kind === "device" &&
        context.platform === "android" &&
        input.kind === "point"
      ) {
        rawTap(input.x, input.y, context.serial);
        return afterInput({
          resolution: {
            method: "point" as const,
            point: { x: input.x, y: input.y },
            bounds: { x: input.x, y: input.y, width: 1, height: 1 },
          },
        });
      }
      if (
        /no active session/i.test(msg) &&
        context.kind === "device" &&
        context.platform === "android" &&
        input.kind === "swipe"
      ) {
        rawSwipe(input.from, input.to, input.durationMs ?? 250, context.serial);
        return afterInput({});
      }
      // A bare "no active session" on iOS is the SDK's generic symptom for a
      // missing XCTest runner, not proof of a physical-device fault. Classify
      // it so Reconnect and the stage diagnostics see the actionable class,
      // enriched with any fresh runner-log diagnostic.
      if (
        /no active session/i.test(msg) &&
        context.kind === "device" &&
        context.platform === "ios"
      ) {
        const diagnosed = await diagnoseIosRunnerError(
          new IosXCTestSessionUnavailableError(msg),
          context.serial,
        );
        throw diagnosed;
      }
      throw err;
    }
  });
}
