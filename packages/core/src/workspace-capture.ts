/**
 * Snapshot, screenshot, and recorded-video capture for attached targets.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { PNG } from "pngjs";
import {
  IosSnapshotInFlightError,
  type DevicePlatform,
  base,
  snapshot,
  type Device,
  type SnapshotNode,
} from "./device.js";
import { now, publish } from "./events.js";
import { attachJobFrame, getActiveJob } from "./session.js";
import { observeScreenIdentity, observeVisualScreenFingerprint } from "./screen-identity.js";
import { proposeVisualRows, type ProposedVisualRow } from "./visual-rows.js";
import {
  androidSnapshotApplication,
  androidSnapshotMatchesForeground,
  androidSnapshotNodesForForeground,
  captureAndroidForegroundApp,
  captureAndroidInspectionState,
  captureAndroidUiSnapshotWithState,
  type AndroidInspectionState,
} from "./android-ui-snapshot.js";
import { currentTargetContext, runWithTargetContext, targetIdentity } from "./target-context.js";
import {
  diagnoseIosRunnerError,
  IosDeviceAttentionError,
  IosRunnerSetupError,
  readIosDisplayOrientation,
  recordIosVideo,
} from "./ios-device-adapter.js";
import { captureIosPngViaGoIos } from "./ios-app-launch.js";
import { annotateTapPreview } from "./tap-preview.js";
import {
  inferIosSnapshotGeometry,
  normalizeIosSnapshotNodes,
  normalizeScreenshotToBounds,
  pngDimensions,
  type IosSnapshotGeometry,
} from "./ios-geometry.js";
import { resolveRuntimeTarget } from "./workspace-devices.js";
import { ensureIosRunnerPrepared, withSession } from "./workspace-ios-session.js";
import { rawScreenshot } from "./workspace-android-raw.js";

export type SnapshotPayload = {
  serial?: string;
  capturedAt: number;
  nodes: SnapshotNode[];
  interactive: SnapshotNode[];
  /** rough screen bounds from max rect extents (for overlay scaling) */
  bounds?: { width: number; height: number };
  /** False when Android's hierarchy cannot be safely aligned with mirrored pixels. */
  inspectable: boolean;
  /** Capture implementation, useful for diagnostics without leaking host details to UI logic. */
  source: "sdk" | "android-system" | "pixels-only";
  inspectionState?: AndroidInspectionState;
  foregroundApp?: string;
  treeApp?: string;
  bindingState?: "matched" | "rebound" | "unavailable";
  /** Safe, actionable iOS runner state when pixels are available but AX is not. */
  inspectionError?: string;
  /** Full normalized identity lets UI and agents explain and reuse a match;
   * a digest alone is not enough to repair an older visual-only baseline. */
  screenIdentity: import("@relay/protocol").ScreenIdentityObservation;
  visualFingerprint?: string;
  proposedRows?: ProposedVisualRow[];
};

const iosSnapshotGeometryBySerial = new Map<string, IosSnapshotGeometry>();

/**
 * An all-black PNG is a transport/display failure, not valid visual evidence.
 * Keep this deliberately conservative: dark-mode screens have text and chrome,
 * while the iPad failure mode has no illuminated pixels at all.
 */
export function isBlankScreenshot(bytes: Uint8Array): boolean {
  let image: PNG;
  try {
    image = PNG.sync.read(Buffer.from(bytes));
  } catch {
    return false;
  }
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const alpha = image.data[offset + 3] ?? 0;
    const red = image.data[offset] ?? 0;
    const green = image.data[offset + 1] ?? 0;
    const blue = image.data[offset + 2] ?? 0;
    if (alpha > 0 && Math.max(red, green, blue) > 4) return false;
  }
  return true;
}

export function iosLogicalBoundsForSerial(
  serial: string,
): { width: number; height: number } | undefined {
  const geometry = iosSnapshotGeometryBySerial.get(serial);
  if (!geometry) return undefined;
  return { width: geometry.logicalWidth, height: geometry.logicalHeight };
}

/**
 * Normalize an iOS screenshot only when we have actual orientation evidence.
 *
 * A fresh or recovering XCTest session can have neither an accessibility root
 * nor a CoreDevice display answer. In that state go-ios still returns an
 * upright raster on physical iPads. Guessing that every portrait raster is a
 * landscape transport buffer turned a correct frame sideways and poisoned
 * App Map variants. Preserve raw pixels until geometry or display orientation
 * says otherwise.
 */
export function normalizeIosScreenshotForCapture(
  bytes: Buffer,
  input: {
    geometry?: IosSnapshotGeometry;
    displayOrientation?: string;
  } = {},
): Buffer {
  if (!input.geometry && !input.displayOrientation) return bytes;
  const logical = input.geometry
    ? { width: input.geometry.logicalWidth, height: input.geometry.logicalHeight }
    : undefined;
  return normalizeScreenshotToBounds(bytes, logical, input.displayOrientation);
}

export function inferSnapshotBounds(
  nodes: SnapshotNode[],
  platform?: DevicePlatform,
): { width: number; height: number } | undefined {
  if (platform === "ios") {
    // XCTest can expose portrait-oriented Window children while its root
    // Application already describes the logical landscape viewport. Taking
    // max child extents turns a 1112×834 iPad into a fictitious 1112×1112
    // square and shifts every normalized point interaction. The application
    // root is the authoritative coordinate space used by XCTest actions.
    const application = nodes.find(
      (node) =>
        node.depth === 0 &&
        node.type === "Application" &&
        node.rect &&
        node.rect.width >= 100 &&
        node.rect.height >= 100,
    );
    if (application?.rect) {
      return {
        width: Math.round(application.rect.width),
        height: Math.round(application.rect.height),
      };
    }
  }
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

async function snapshotThroughSdk(
  device: Device,
  interactiveOnly: boolean,
): Promise<SnapshotNode[]> {
  const capture = () => withSession(device, () => snapshot(device, { interactiveOnly }));
  return await capture();
}

/**
 * iOS runner diagnostics may contain Xcode paths and raw daemon output. The
 * snapshot API exposes only errors that were converted to product-safe copy
 * (or Relay's own single-flight guard), never the original native message.
 */
export async function iosInspectionErrorMessage(
  error: unknown,
  serial: string | undefined,
): Promise<string | undefined> {
  if (!error) return undefined;
  if (error instanceof IosSnapshotInFlightError) return error.message;
  const diagnosed = await diagnoseIosRunnerError(error, serial).catch(() => undefined);
  if (diagnosed instanceof IosRunnerSetupError || diagnosed instanceof IosDeviceAttentionError) {
    return diagnosed.message;
  }
  return undefined;
}

type SnapshotCapture = Pick<
  SnapshotPayload,
  | "nodes"
  | "inspectable"
  | "source"
  | "inspectionState"
  | "foregroundApp"
  | "treeApp"
  | "bindingState"
  | "inspectionError"
>;

async function snapshotForTarget(
  target: Awaited<ReturnType<typeof resolveRuntimeTarget>>,
  interactiveOnly: boolean,
): Promise<SnapshotCapture> {
  let iosPreparationError: unknown;
  if (
    target.context.kind === "device" &&
    target.context.platform === "ios" &&
    target.context.serial
  ) {
    try {
      await ensureIosRunnerPrepared(target.device, target.context.serial);
    } catch (error) {
      // Prepare can fail while a previous runner is still usable. Still try SDK.
      iosPreparationError = error;
    }
  }
  if (
    target.context.kind !== "device" ||
    target.context.platform !== "android" ||
    !target.context.serial
  ) {
    const iosSerial =
      target.context.kind === "device" && target.context.platform === "ios"
        ? target.context.serial
        : undefined;
    let appleNodes: SnapshotNode[];
    let iosSnapshotError: unknown;
    if (iosSerial) {
      try {
        appleNodes = await withSession(target.device, () =>
          snapshotThroughSdk(target.device, interactiveOnly),
        );
      } catch (error) {
        appleNodes = [];
        iosSnapshotError = error;
      }
    } else {
      appleNodes = await snapshotThroughSdk(target.device, interactiveOnly);
    }
    const inspectable = appleNodes.length > 0;
    const inspectionError = inspectable
      ? undefined
      : await iosInspectionErrorMessage(iosSnapshotError ?? iosPreparationError, iosSerial);
    return {
      nodes: appleNodes,
      inspectable,
      source: inspectable ? "sdk" : "pixels-only",
      ...(inspectable ? {} : { bindingState: "unavailable" as const }),
      ...(inspectionError ? { inspectionError } : {}),
    };
  }

  // Android allows only one UiAutomation connection. Prefer the live SDK
  // helper session. Fallback capture never competes with that session: helper
  // first if the slot is free, stock dump only as last resort. Dump dies with
  // 137 / already-registered when the helper is warm, and returns null root
  // while Niagara is bound.
  const inspectionState = await captureAndroidInspectionState(target.context.serial);
  const foregroundApp = await captureAndroidForegroundApp(target.context.serial);
  if (inspectionState !== "active") {
    return {
      nodes: [],
      inspectable: false,
      source: "android-system",
      inspectionState,
      foregroundApp,
      bindingState: "unavailable",
    };
  }

  try {
    let nodes = await snapshotThroughSdk(target.device, interactiveOnly);
    let treeApp = androidSnapshotApplication(nodes);
    if (nodes.length > 0 && androidSnapshotMatchesForeground(nodes, foregroundApp)) {
      return {
        nodes,
        inspectable: true,
        source: "sdk",
        inspectionState,
        foregroundApp,
        treeApp,
        bindingState: "matched",
      };
    }
    if (foregroundApp && treeApp && foregroundApp !== treeApp) {
      await target.device.apps.open({
        platform: "android",
        serial: target.context.serial,
        app: foregroundApp,
        relaunch: false,
        noRecord: true,
      });
      nodes = await snapshotThroughSdk(target.device, interactiveOnly);
      treeApp = androidSnapshotApplication(nodes);
      if (nodes.length > 0 && androidSnapshotMatchesForeground(nodes, foregroundApp)) {
        return {
          nodes,
          inspectable: true,
          source: "sdk",
          inspectionState,
          foregroundApp,
          treeApp,
          bindingState: "rebound",
        };
      }
    }
  } catch {
    // SDK snapshot throws when the helper artifact is not packaged. Fall
    // through to helper (then dump only if the UiAutomation slot is free).
  }

  const snapshot = await captureAndroidUiSnapshotWithState(target.context.serial);
  const treeApp = androidSnapshotApplication(snapshot.nodes);
  const foregroundNodes = androidSnapshotNodesForForeground(snapshot.nodes, foregroundApp);
  const inspectable = snapshot.inspectionState === "active" && foregroundNodes.length > 0;
  return {
    ...snapshot,
    nodes: inspectable ? foregroundNodes : [],
    inspectable,
    source: "android-system",
    foregroundApp,
    treeApp,
    bindingState: inspectable ? "matched" : "unavailable",
  };
}

export async function captureSnapshot(opts?: {
  serial?: string;
  interactiveOnly?: boolean;
  device?: Device;
  includeVisual?: boolean;
}): Promise<SnapshotPayload> {
  const target = await resolveRuntimeTarget(opts?.serial, opts?.device);
  return runWithTargetContext(target.context, async () => {
    let snapshot: SnapshotCapture;
    try {
      snapshot = await snapshotForTarget(target, opts?.interactiveOnly ?? false);
    } catch (error) {
      if (target.context.kind === "device" && target.context.platform === "ios") {
        const inspectionError = await iosInspectionErrorMessage(error, target.context.serial);
        snapshot = {
          nodes: [],
          inspectable: false,
          source: "pixels-only",
          bindingState: "unavailable",
          ...(inspectionError ? { inspectionError } : {}),
        };
      } else {
        throw error;
      }
    }
    const { nodes: capturedNodes, ...capture } = snapshot;
    const context = target.context;
    const iosGeometry =
      context.kind === "device" && context.platform === "ios"
        ? inferIosSnapshotGeometry(capturedNodes)
        : undefined;
    const nodes = iosGeometry
      ? normalizeIosSnapshotNodes(capturedNodes, iosGeometry)
      : capturedNodes;
    if (context.kind === "device" && context.platform === "ios" && context.serial && iosGeometry) {
      iosSnapshotGeometryBySerial.set(context.serial, iosGeometry);
    }
    const interactive = nodes.filter((n) => n.hittable || n.enabled !== false);
    const bounds = inferSnapshotBounds(
      nodes,
      target.context.kind === "device" ? target.context.platform : undefined,
    );
    const serial = targetIdentity();
    publish({ type: "snapshot.captured", at: now(), serial, nodeCount: nodes.length });
    const observedIdentity = observeScreenIdentity(nodes);
    let visualFingerprint: string | undefined;
    let proposedRows: ProposedVisualRow[] | undefined;
    if (opts?.includeVisual && (capture.inspectable === false || nodes.length === 0)) {
      try {
        const shot = await captureScreenshot({
          serial,
          device: target.device,
          ephemeral: true,
          includeScreenMatch: false,
        });
        const png = Buffer.from(shot.base64, "base64");
        visualFingerprint =
          observeVisualScreenFingerprint(png) ?? shot.screenMatch?.visualFingerprint;
        const rows = proposeVisualRows(png);
        if (rows.length) proposedRows = rows;
      } catch {
        visualFingerprint = undefined;
        proposedRows = undefined;
      }
    }
    return {
      serial,
      capturedAt: now(),
      nodes,
      interactive,
      bounds,
      screenIdentity: observedIdentity,
      ...(visualFingerprint ? { visualFingerprint } : {}),
      ...(proposedRows?.length ? { proposedRows } : {}),
      ...capture,
    };
  });
}

export type ScreenshotPayload = {
  serial?: string;
  capturedAt: number;
  mime: "image/png";
  base64: string;
  path: string;
  bytes: number;
  width?: number;
  height?: number;
  foregroundApp?: string;
  screenMatch?: {
    fingerprint: string;
    visualFingerprint?: string;
    matchedScreenId: string | null;
    status: "observed" | "unavailable";
  };
  proposedRows?: ProposedVisualRow[];
  jobId?: string;
  framePath?: string;
  inspectable?: boolean;
};

type ScreenshotAttacher = (opts: {
  jobId?: string;
  base64: string;
  caption: string;
  mime?: string;
}) => Promise<{ path: string } | null>;

const screenshotAttachments = new WeakMap<ScreenshotPayload, Promise<void>>();

/** Attach an already captured raster without touching the target again.
 * Attachment is single-flight per ephemeral payload, including rejection. */
export async function attachScreenshotPayload(
  screenshot: ScreenshotPayload,
  jobId: string | undefined,
  caption: string,
  attach: ScreenshotAttacher = attachJobFrame,
): Promise<ScreenshotPayload> {
  if (screenshot.framePath) return screenshot;
  let pending = screenshotAttachments.get(screenshot);
  if (!pending) {
    pending = (async () => {
      const frame = await attach({
        jobId,
        base64: screenshot.base64,
        caption,
        mime: screenshot.mime,
      });
      if (!frame) return;
      screenshot.framePath = frame.path;
      if (jobId) screenshot.jobId = jobId;
    })();
    screenshotAttachments.set(screenshot, pending);
  }
  await pending;
  return screenshot;
}

export async function captureScreenshot(opts?: {
  serial?: string;
  device?: Device;
  caption?: string;
  jobId?: string;
  /** skip attaching to job */
  ephemeral?: boolean;
  /** skip the additional semantic snapshot when the caller only needs pixels */
  includeScreenMatch?: boolean;
  /** Fresh semantic proof supplied by the caller to avoid a second tree walk. */
  semanticNodes?: readonly SnapshotNode[];
  /** Draw a tap preview ring; does not touch the device. */
  previewTap?: { x: number; y: number };
}): Promise<ScreenshotPayload> {
  const target = await resolveRuntimeTarget(opts?.serial, opts?.device);
  return runWithTargetContext(target.context, async () => {
    const foregroundApp =
      target.context.kind === "device" &&
      target.context.platform === "android" &&
      target.context.serial
        ? await captureAndroidForegroundApp(target.context.serial)
        : undefined;
    const parent = join(tmpdir(), "relay");
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const dir = await mkdtemp(join(parent, "shot-"));
    const path = join(dir, "capture.png");
    const context = currentTargetContext();
    if (context.kind === "device" && context.platform === "android") {
      // Mirroring is device-scoped, not app-scoped. Going directly through adb
      // avoids the SDK's long retry path when its optional app session expires.
      rawScreenshot(path, context.serial);
    } else if (context.kind === "device" && context.platform === "ios" && context.serial) {
      try {
        await captureIosPngViaGoIos(context.serial, path);
      } catch {
        await withSession(target.device, () =>
          target.device.capture.screenshot({ ...base(), path }),
        );
      }
    } else {
      await withSession(target.device, () => target.device.capture.screenshot({ ...base(), path }));
    }
    let buf = await readFile(path);
    let semanticNodes: readonly SnapshotNode[] | undefined = opts?.semanticNodes;
    if (context.kind === "device" && context.platform === "ios" && context.serial) {
      // UIImage.pngData() drops imageOrientation. Bake from CoreDevice orientation:
      // portrait transport + landscape interface → one 90°; same-aspect pixels stay
      // in the AX coordinate space. Do not invent a landscape orientation when
      // the recovering XCTest session has no geometry: physical iPads often
      // already give us an upright portrait go-ios raster in that state.
      const geometry = iosSnapshotGeometryBySerial.get(context.serial);
      const displayOrientation = geometry
        ? await readIosDisplayOrientation(context.serial).catch(() => undefined)
        : undefined;
      const normalized = normalizeIosScreenshotForCapture(buf, {
        ...(geometry ? { geometry } : {}),
        ...(displayOrientation ? { displayOrientation } : {}),
      });
      if (!buf.equals(normalized)) {
        buf = Buffer.from(normalized);
        await writeFile(path, buf);
      }
    }
    const visualFingerprint = observeVisualScreenFingerprint(buf);
    if (
      opts?.previewTap &&
      Number.isFinite(opts.previewTap.x) &&
      Number.isFinite(opts.previewTap.y)
    ) {
      const logical =
        context.kind === "device" && context.platform === "ios" && context.serial
          ? iosSnapshotGeometryBySerial.get(context.serial)
          : undefined;
      buf = Buffer.from(
        annotateTapPreview(
          buf,
          opts.previewTap,
          logical ? { width: logical.logicalWidth, height: logical.logicalHeight } : undefined,
        ),
      );
      await writeFile(path, buf);
    }
    const base64 = buf.toString("base64");
    const dimensions = pngDimensions(buf);
    let screenMatch: ScreenshotPayload["screenMatch"];
    if (
      opts?.includeScreenMatch === true ||
      (opts?.includeScreenMatch !== false &&
        context.kind === "device" &&
        context.platform !== "ios")
    ) {
      try {
        semanticNodes ??= (await snapshotForTarget(target, false)).nodes;
        const identity = observeScreenIdentity(semanticNodes);
        if (identity.fingerprint || visualFingerprint) {
          screenMatch = {
            fingerprint: identity.fingerprint || visualFingerprint!,
            ...(visualFingerprint ? { visualFingerprint } : {}),
            matchedScreenId: null,
            status: "observed",
          };
        }
      } catch {
        screenMatch = visualFingerprint
          ? {
              fingerprint: visualFingerprint,
              visualFingerprint,
              matchedScreenId: null,
              status: "observed",
            }
          : undefined;
      }
    } else if (visualFingerprint) {
      screenMatch = {
        fingerprint: visualFingerprint,
        visualFingerprint,
        matchedScreenId: null,
        status: "observed",
      };
    }
    const serial = targetIdentity();
    publish({ type: "screenshot.captured", at: now(), serial, bytes: buf.byteLength });

    const proposedRows = proposeVisualRows(buf);
    const active = !opts?.ephemeral
      ? opts?.jobId
        ? { id: opts.jobId }
        : getActiveJob(serial)
      : undefined;
    const screenshot: ScreenshotPayload = {
      serial,
      capturedAt: now(),
      mime: "image/png",
      base64,
      path,
      bytes: buf.byteLength,
      ...dimensions,
      ...(foregroundApp ? { foregroundApp } : {}),
      ...(screenMatch ? { screenMatch } : {}),
      ...(proposedRows.length ? { proposedRows } : {}),
      ...(active?.id || opts?.jobId ? { jobId: active?.id ?? opts?.jobId } : {}),
    };
    if (active) {
      await attachScreenshotPayload(
        screenshot,
        active.id,
        opts?.caption ?? `screenshot · ${new Date().toISOString()}`,
      );
    }
    return screenshot;
  });
}

export type DeviceVideoCapture = {
  serial?: string;
  platform: DevicePlatform;
  mode: "recorded-video";
  path?: string;
  warning?: string;
};

/**
 * Capture an iOS review take through XCTest. It intentionally does not share
 * the Android H.264 stream path: a take is a durable video, not live preview.
 */
export async function captureDeviceVideo(input: {
  serial: string;
  action: "start" | "stop";
  path?: string;
}): Promise<DeviceVideoCapture> {
  const target = await resolveRuntimeTarget(input.serial);
  return runWithTargetContext(target.context, async () => {
    const context = currentTargetContext();
    if (context.kind !== "device" || context.platform !== "ios") {
      throw new Error("Recorded video capture is currently available for Apple devices only");
    }
    const serial = context.serial;
    if (!serial) throw new Error("Choose an iPhone or iPad before recording video");
    if (input.action === "start") {
      await ensureIosRunnerPrepared(target.device, serial);
    }
    const recorded = await withSession(target.device, () =>
      recordIosVideo(target.device, {
        udid: serial,
        action: input.action,
        ...(input.path ? { path: input.path } : {}),
      }),
    );
    return { serial, platform: context.platform, ...recorded };
  });
}

/** Remove only the private temporary directory produced by captureScreenshot. */
export async function cleanupScreenshot(path: string): Promise<void> {
  const root = resolve(tmpdir(), "relay");
  const directory = resolve(dirname(path));
  if (!directory.startsWith(`${root}/`) || !dirname(directory).startsWith(root)) return;
  await rm(directory, { recursive: true, force: true });
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
