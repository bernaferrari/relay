/**
 * Snapshot, screenshot, and recorded-video capture for attached targets.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { PNG } from "pngjs";
import type { TargetRuntimeReadiness } from "@relay/protocol";
import {
  isIosAccessibilityQueryInFlightError,
  bindAndroidAppSession,
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
  IosXCTestSessionUnavailableError,
  readIosDisplayOrientation,
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
import {
  lastIosSessionOperationDiagnostic,
  withSession,
  type IosSessionOperationDiagnostic,
} from "./workspace-ios-session.js";
import { rawScreenshot } from "./workspace-android-raw.js";
import {
  beginTargetRuntimeObservation,
  hasUsableSemanticAccessibility,
  hasCurrentTargetSemanticProof,
  recordTargetPixelCapture,
  recordTargetSemanticCapture,
  targetRuntimeReadiness,
} from "./target-runtime-readiness.js";
export {
  captureDeviceVideo,
  captureIosEvidenceVideo,
  IosEvidenceCaptureUnavailableError,
} from "./workspace-capture-video.js";
export type {
  DeviceVideoCapture,
  IosEvidenceCaptureUnavailableDiagnostic,
} from "./workspace-capture-video.js";

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
  /** One bounded iOS AX attempt; observation never performs hidden repair. */
  iosSessionLifecycle?: IosSessionOperationDiagnostic;
  /** Full normalized identity lets UI and agents explain and reuse a match;
   * a digest alone is not enough to repair an older visual-only baseline. */
  screenIdentity: import("@relay/protocol").ScreenIdentityObservation;
  visualFingerprint?: string;
  proposedRows?: ProposedVisualRow[];
  /** Separate live facts for pixels, semantic control, and evidence capture. */
  readiness?: TargetRuntimeReadiness;
};

type IosSnapshotGeometryProof = {
  geometry: IosSnapshotGeometry;
  proofAt: number;
  observationEpoch?: number;
};

/**
 * This is deliberately a proof cache, not a device geometry cache. iOS can
 * return an old XCTest tree after a rotation or after pixels have advanced.
 * Rectangles are usable only while that exact semantic proof remains current.
 */
const iosSnapshotGeometryBySerial = new Map<string, IosSnapshotGeometryProof>();

function currentIosSnapshotGeometry(
  serial: string,
  observedAt = Date.now(),
): IosSnapshotGeometry | undefined {
  const cached = iosSnapshotGeometryBySerial.get(serial);
  if (!cached) return undefined;
  if (
    !hasCurrentTargetSemanticProof(
      { serial, platform: "ios" },
      { at: cached.proofAt, observationEpoch: cached.observationEpoch },
      observedAt,
    )
  ) {
    iosSnapshotGeometryBySerial.delete(serial);
    return undefined;
  }
  return cached.geometry;
}

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
  const geometry = currentIosSnapshotGeometry(serial);
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
  operation: "preview" | "snapshot",
): Promise<SnapshotNode[]> {
  return await withSession(device, () => snapshot(device, { interactiveOnly }), operation);
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
  if (isIosAccessibilityQueryInFlightError(error)) return error.message;
  const diagnosed = await diagnoseIosRunnerError(error, serial).catch(() => undefined);
  if (
    diagnosed instanceof IosRunnerSetupError ||
    diagnosed instanceof IosDeviceAttentionError ||
    diagnosed instanceof IosXCTestSessionUnavailableError
  ) {
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
> & { semanticProbeInFlight?: boolean };

async function snapshotForTarget(
  target: Awaited<ReturnType<typeof resolveRuntimeTarget>>,
  interactiveOnly: boolean,
  operation: "preview" | "snapshot",
): Promise<SnapshotCapture> {
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
        appleNodes = await snapshotThroughSdk(target.device, interactiveOnly, operation);
      } catch (error) {
        appleNodes = [];
        iosSnapshotError = error;
      }
    } else {
      appleNodes = await snapshotThroughSdk(target.device, interactiveOnly, operation);
    }
    // A root/window-only XCTest response tells us that the runner answered,
    // not that Relay can name or safely activate a control. Keep this fact in
    // lockstep with the runtime-capability proof so callers never receive an
    // `inspectable: true` snapshot while semantic control is unavailable.
    const inspectable = iosSerial
      ? hasUsableSemanticAccessibility(appleNodes)
      : appleNodes.length > 0;
    const inspectionError = inspectable
      ? undefined
      : ((await iosInspectionErrorMessage(iosSnapshotError, iosSerial)) ??
        (iosSerial && appleNodes.length > 0
          ? "Relay did not observe named accessibility controls."
          : undefined));
    const semanticProbeInFlight = isIosAccessibilityQueryInFlightError(iosSnapshotError);
    return {
      nodes: appleNodes,
      inspectable,
      source: inspectable ? "sdk" : "pixels-only",
      ...(inspectable ? {} : { bindingState: "unavailable" as const }),
      ...(inspectionError ? { inspectionError } : {}),
      ...(semanticProbeInFlight ? { semanticProbeInFlight: true } : {}),
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
    let nodes = await snapshotThroughSdk(target.device, interactiveOnly, "snapshot");
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
      await bindAndroidAppSession(target.device, foregroundApp, target.context.serial);
      nodes = await snapshotThroughSdk(target.device, interactiveOnly, "snapshot");
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
  /** Preview remains a single read-only AX attempt with distinct diagnostics. */
  iosOperation?: "preview" | "snapshot";
}): Promise<SnapshotPayload> {
  const captureStartedAt = now();
  const target = await resolveRuntimeTarget(opts?.serial, opts?.device);
  return runWithTargetContext(target.context, async () => {
    const context = target.context;
    const readinessTarget =
      context.kind === "device"
        ? { serial: context.serial, platform: context.platform }
        : undefined;
    // Stamp request order before XCTest starts. Its result can arrive after a
    // newer pixel frame, in which case the tree is evidence but not geometry
    // for that frame.
    const semanticObservationEpoch =
      context.kind === "device" && context.platform === "ios"
        ? beginTargetRuntimeObservation(readinessTarget!)
        : undefined;
    let snapshot: SnapshotCapture;
    try {
      snapshot = await snapshotForTarget(
        target,
        opts?.interactiveOnly ?? false,
        opts?.iosOperation ?? "snapshot",
      );
    } catch (error) {
      if (target.context.kind === "device" && target.context.platform === "ios") {
        const inspectionError = await iosInspectionErrorMessage(error, target.context.serial);
        snapshot = {
          nodes: [],
          inspectable: false,
          source: "pixels-only",
          bindingState: "unavailable",
          ...(inspectionError ? { inspectionError } : {}),
          ...(isIosAccessibilityQueryInFlightError(error) ? { semanticProbeInFlight: true } : {}),
        };
      } else {
        throw error;
      }
    }
    const { nodes: capturedNodes, semanticProbeInFlight, ...capture } = snapshot;
    const iosSessionLifecycle =
      context.kind === "device" && context.platform === "ios"
        ? lastIosSessionOperationDiagnostic(context.serial)
        : undefined;
    const iosGeometry =
      context.kind === "device" && context.platform === "ios"
        ? inferIosSnapshotGeometry(capturedNodes)
        : undefined;
    const nodes = iosGeometry
      ? normalizeIosSnapshotNodes(capturedNodes, iosGeometry)
      : capturedNodes;
    // Record semantic completion before any optional visual fallback. A late
    // fallback PNG must be able to invalidate this tree; recording after that
    // PNG would falsely restamp an older AX read as current.
    const semanticCapturedAt = now();
    if (readinessTarget) {
      recordTargetSemanticCapture(readinessTarget, {
        inspectable: capture.inspectable,
        nodes,
        inFlight: semanticProbeInFlight,
        at: semanticCapturedAt,
        durationMs: Math.max(0, semanticCapturedAt - captureStartedAt),
        errorMessage: capture.inspectionError,
        ...(semanticObservationEpoch !== undefined
          ? { observationEpoch: semanticObservationEpoch }
          : {}),
      });
    }
    if (context.kind === "device" && context.platform === "ios") {
      const semanticProof = readinessTarget
        ? targetRuntimeReadiness(readinessTarget, semanticCapturedAt).semanticControl.proof
        : undefined;
      if (
        iosGeometry &&
        capture.inspectable &&
        semanticProof?.at === semanticCapturedAt &&
        hasCurrentTargetSemanticProof(
          { serial: context.serial, platform: "ios" },
          {
            at: semanticProof.at,
            ...(semanticObservationEpoch !== undefined
              ? { observationEpoch: semanticObservationEpoch }
              : {}),
          },
          semanticCapturedAt,
        )
      ) {
        iosSnapshotGeometryBySerial.set(context.serial, {
          geometry: iosGeometry,
          proofAt: semanticProof.at,
          ...(semanticObservationEpoch !== undefined
            ? { observationEpoch: semanticObservationEpoch }
            : {}),
        });
      } else {
        // A root-only, delayed, or failed tree cannot lend its old coordinate
        // system to the next screenshot or interaction preview.
        iosSnapshotGeometryBySerial.delete(context.serial);
      }
    }
    const interactive = nodes.filter((n) => n.hittable || n.enabled !== false);
    const bounds = inferSnapshotBounds(
      nodes,
      target.context.kind === "device" ? target.context.platform : undefined,
    );
    const serial = targetIdentity();
    publish({ type: "snapshot.captured", at: semanticCapturedAt, serial, nodeCount: nodes.length });
    const observedIdentity = observeScreenIdentity(nodes);
    let visualFingerprint: string | undefined;
    let proposedRows: ProposedVisualRow[] | undefined;
    if (opts?.includeVisual && (capture.inspectable === false || nodes.length === 0)) {
      let shot: ScreenshotPayload | undefined;
      try {
        shot = await captureScreenshot({
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
      } finally {
        // This fallback projects pixels into the snapshot payload; it never
        // exposes the temporary file to its caller. Dispose it after the
        // base64-derived fingerprint and proposed rows have been calculated,
        // including when the visual inspection itself fails.
        if (shot) await cleanupScreenshot(shot.path).catch(() => undefined);
      }
    }
    const capturedAt = semanticCapturedAt;
    const readinessAt = now();
    const readiness = readinessTarget
      ? targetRuntimeReadiness(readinessTarget, readinessAt)
      : undefined;
    return {
      serial,
      capturedAt,
      nodes,
      interactive,
      bounds,
      screenIdentity: observedIdentity,
      ...(visualFingerprint ? { visualFingerprint } : {}),
      ...(proposedRows?.length ? { proposedRows } : {}),
      ...(readiness ? { readiness } : {}),
      ...capture,
      ...(iosSessionLifecycle ? { iosSessionLifecycle } : {}),
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
  /** Separate live facts for pixels, semantic control, and evidence capture. */
  readiness?: TargetRuntimeReadiness;
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
  const captureStartedAt = now();
  const target = await resolveRuntimeTarget(opts?.serial, opts?.device);
  // A capture hands its private temporary path to the caller only after the
  // complete payload is available. If any part of capture/normalization/
  // attachment fails first, this function retains ownership and removes the
  // directory itself. Successful callers that do not need `path` must still
  // call cleanupScreenshot after transferring the bytes to durable evidence.
  const parent = join(tmpdir(), "relay");
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const dir = await mkdtemp(join(parent, "shot-"));
  const path = join(dir, "capture.png");
  return await runWithTargetContext(target.context, async () => {
    const foregroundApp =
      target.context.kind === "device" &&
      target.context.platform === "android" &&
      target.context.serial
        ? await captureAndroidForegroundApp(target.context.serial)
        : undefined;
    const context = currentTargetContext();
    const readinessTarget =
      context.kind === "device"
        ? { serial: context.serial, platform: context.platform }
        : undefined;
    // Capture order is evidence: a screenshot requested after an AX read must
    // make its geometry stale if its pixels changed, while an older screenshot
    // that merely finishes late must not erase a newer semantic proof.
    const pixelObservationEpoch =
      context.kind === "device" && context.platform === "ios"
        ? beginTargetRuntimeObservation(readinessTarget!)
        : undefined;
    if (context.kind === "device" && context.platform === "android") {
      // Mirroring is device-scoped, not app-scoped. Going directly through adb
      // avoids the SDK's long retry path when its optional app session expires.
      rawScreenshot(path, context.serial);
    } else if (context.kind === "device" && context.platform === "ios" && context.serial) {
      try {
        await captureIosPngViaGoIos(context.serial, path);
      } catch {
        await withSession(
          target.device,
          () => target.device.capture.screenshot({ ...base(), path }),
          "screenshot",
        );
      }
    } else {
      await withSession(
        target.device,
        () => target.device.capture.screenshot({ ...base(), path }),
        "screenshot",
      );
    }
    let buf = await readFile(path);
    // Use the transport raster solely to advance the visual epoch before we
    // consult cached AX geometry. The public fingerprint below remains the
    // normalized image that people actually inspect.
    const rawVisualFingerprint = observeVisualScreenFingerprint(buf);
    const pixelCapturedAt = now();
    if (readinessTarget) {
      recordTargetPixelCapture(readinessTarget, {
        at: pixelCapturedAt,
        durationMs: Math.max(0, pixelCapturedAt - captureStartedAt),
        visualFingerprint: rawVisualFingerprint,
        ...(pixelObservationEpoch !== undefined ? { observationEpoch: pixelObservationEpoch } : {}),
      });
    }
    let semanticNodes: readonly SnapshotNode[] | undefined = opts?.semanticNodes;
    if (context.kind === "device" && context.platform === "ios" && context.serial) {
      // UIImage.pngData() drops imageOrientation. A directly supplied tree is
      // a same-operation proof; a cached tree is usable only while its exact
      // readiness proof is current. If CoreDevice cannot confirm orientation,
      // never rotate a new raster from cached AX geometry alone.
      const suppliedGeometry =
        semanticNodes && hasUsableSemanticAccessibility(semanticNodes)
          ? inferIosSnapshotGeometry([...semanticNodes])
          : undefined;
      const cachedGeometry = semanticNodes
        ? undefined
        : currentIosSnapshotGeometry(context.serial, pixelCapturedAt);
      const geometry = suppliedGeometry ?? cachedGeometry;
      const displayOrientation = geometry
        ? await readIosDisplayOrientation(context.serial).catch(() => undefined)
        : undefined;
      const normalized = normalizeIosScreenshotForCapture(buf, {
        ...(suppliedGeometry || displayOrientation ? (geometry ? { geometry } : {}) : {}),
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
          ? currentIosSnapshotGeometry(context.serial, pixelCapturedAt)
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
        semanticNodes ??= (await snapshotForTarget(target, false, "snapshot")).nodes;
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
    publish({ type: "screenshot.captured", at: pixelCapturedAt, serial, bytes: buf.byteLength });

    const proposedRows = proposeVisualRows(buf);
    const active = !opts?.ephemeral
      ? opts?.jobId
        ? { id: opts.jobId }
        : getActiveJob(serial)
      : undefined;
    const capturedAt = pixelCapturedAt;
    const readiness = readinessTarget
      ? targetRuntimeReadiness(readinessTarget, capturedAt)
      : undefined;
    const screenshot: ScreenshotPayload = {
      serial,
      capturedAt,
      mime: "image/png",
      base64,
      path,
      bytes: buf.byteLength,
      ...dimensions,
      ...(foregroundApp ? { foregroundApp } : {}),
      ...(screenMatch ? { screenMatch } : {}),
      ...(proposedRows.length ? { proposedRows } : {}),
      ...(readiness ? { readiness } : {}),
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
  }).catch(async (error: unknown) => {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
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
