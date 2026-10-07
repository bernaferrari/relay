import { observedIosApplication } from "./recorded-entrance-proof.js";
/**
 * Snapshot, screenshot, and recorded-video capture for attached targets.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describePixelsOnlySnapshotChrome, type TargetRuntimeReadiness } from "@relay/protocol";
import {
  isIosAccessibilityQueryInFlightError,
  bindAndroidAppSession,
  type DevicePlatform,
  base,
  rememberedTargetApplication,
  snapshot,
  type Device,
  type SnapshotNode,
} from "./device.js";
import {
  isAndroidSnapshotOwnershipUnreleased,
  iosInspectionErrorMessage,
} from "./workspace-inspection-errors.js";
export {
  isAndroidSnapshotOwnershipUnreleased,
  iosInspectionErrorMessage,
} from "./workspace-inspection-errors.js";
import { now, publish } from "./events.js";
import { attachJobFrame, getActiveJob } from "./session.js";
import { observeScreenIdentityForHost, observeVisualScreenFingerprint } from "./screen-identity.js";
import { proposeVisualRows, type ProposedVisualRow } from "./visual-rows.js";
import {
  androidSnapshotApplication,
  androidSnapshotMatchesForeground,
  androidSnapshotNodesForForeground,
  captureAndroidForegroundApp,
  captureAndroidInspectionState,
  captureAndroidUiSnapshotWithState,
  type AndroidInspectionState,
  type AndroidSnapshotBackend,
} from "./android-ui-snapshot.js";
import { currentTargetContext, runWithTargetContext, targetIdentity } from "./target-context.js";
import { readIosDisplayOrientation } from "./ios-device-adapter.js";
import { captureIosPngViaGoIos } from "./ios-app-launch.js";
import { annotateTapPreview, tapPreviewLogicalBounds } from "./tap-preview.js";
import {
  inferIosSnapshotGeometry,
  normalizeIosSnapshotNodes,
  normalizeScreenshotToBounds,
  pngDimensions,
  type IosSnapshotGeometry,
} from "./ios-geometry.js";
import { resolveRuntimeTarget, type RuntimeTargetOverlay } from "./workspace-devices.js";
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
import {
  formatSnapshotTree,
  recordNativeScreenshotViewport,
  screenshotIncludesFollowOnTree,
} from "./workspace-capture-presentation.js";
export {
  formatSnapshotTree,
  isBlankScreenshot,
  screenshotIncludesFollowOnTree,
} from "./workspace-capture-presentation.js";
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
  catalogNodes?: SnapshotNode[];
  interactive: SnapshotNode[];
  /** rough screen bounds from max rect extents (for overlay scaling) */
  bounds?: { width: number; height: number };
  /** False when Android's hierarchy cannot be safely aligned with mirrored pixels. */
  inspectable: boolean;
  /** Capture implementation, useful for diagnostics without leaking host details to UI logic. */
  source: "sdk" | "android-system" | "pixels-only";
  /** Helper APK vs stock dump when Android degraded off the live SDK session. */
  androidTreeBackend?: AndroidSnapshotBackend;
  inspectionState?: AndroidInspectionState;
  foregroundApp?: string;
  /** Product chrome when pixels or last launch can name the frame. */
  app?: string;
  header?: string;
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

type SelectorCaptureOptions = {
  includeIdentifiers?: readonly string[];
  includeLabels?: readonly string[];
  separateRequestedSelectorEvidence?: boolean;
};

async function snapshotThroughSdk(
  device: Device,
  interactiveOnly: boolean,
  operation: "preview" | "snapshot",
  selectors?: SelectorCaptureOptions,
): Promise<SnapshotNode[]> {
  return await withSession(
    device,
    () => snapshot(device, { interactiveOnly, ...selectors }),
    operation,
  );
}

type SnapshotCapture = Pick<
  SnapshotPayload,
  | "nodes"
  | "inspectable"
  | "source"
  | "androidTreeBackend"
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
  selectors?: SelectorCaptureOptions,
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
        appleNodes = await snapshotThroughSdk(target.device, interactiveOnly, operation, selectors);
      } catch (error) {
        appleNodes = [];
        iosSnapshotError = error;
      }
    } else {
      appleNodes = await snapshotThroughSdk(target.device, interactiveOnly, operation, selectors);
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
    const rememberedApp = iosSerial ? await rememberedTargetApplication(target.context) : undefined;
    const treeApp =
      iosSerial && selectors?.separateRequestedSelectorEvidence
        ? observedIosApplication(appleNodes)
        : undefined;
    return {
      nodes: appleNodes,
      inspectable,
      source: inspectable ? "sdk" : "pixels-only",
      ...(inspectable ? {} : { bindingState: "unavailable" as const }),
      ...(inspectionError ? { inspectionError } : {}),
      ...(semanticProbeInFlight ? { semanticProbeInFlight: true } : {}),
      ...(rememberedApp ? { foregroundApp: rememberedApp } : {}),
      ...(treeApp ? { treeApp } : {}),
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
        androidTreeBackend: "helper",
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
          androidTreeBackend: "helper",
          inspectionState,
          foregroundApp,
          treeApp,
          bindingState: "rebound",
        };
      }
    }
  } catch (error) {
    if (isAndroidSnapshotOwnershipUnreleased(error)) {
      return {
        nodes: [],
        inspectable: false,
        source: "android-system",
        androidTreeBackend: "helper",
        inspectionState,
        foregroundApp,
        bindingState: "unavailable",
      };
    }
    // SDK snapshot throws when the helper artifact is not packaged. Fall
    // through to helper (then dump only if the UiAutomation slot is free).
  }

  const snapshot = await captureAndroidUiSnapshotWithState(target.context.serial);
  const treeApp = androidSnapshotApplication(snapshot.nodes);
  const foregroundNodes = androidSnapshotNodesForForeground(snapshot.nodes, foregroundApp);
  const inspectable = snapshot.inspectionState === "active" && foregroundNodes.length > 0;
  return {
    nodes: inspectable ? foregroundNodes : [],
    inspectable,
    source: "android-system",
    inspectionState: snapshot.inspectionState,
    ...(snapshot.treeBackend ? { androidTreeBackend: snapshot.treeBackend } : {}),
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
  overlay?: RuntimeTargetOverlay;
  /** Preview remains a single read-only AX attempt with distinct diagnostics. */
  iosOperation?: "preview" | "snapshot";
  includeIdentifiers?: readonly string[];
  includeLabels?: readonly string[];
  separateRequestedSelectorEvidence?: boolean;
}): Promise<SnapshotPayload> {
  const captureStartedAt = now();
  const target = await resolveRuntimeTarget(opts?.serial, opts?.device, opts?.overlay);
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
        opts,
      );
    } catch (error) {
      if (target.context.kind === "device" && target.context.platform === "ios") {
        const inspectionError = await iosInspectionErrorMessage(error, target.context.serial);
        const rememberedApp = await rememberedTargetApplication(target.context);
        snapshot = {
          nodes: [],
          inspectable: false,
          source: "pixels-only",
          bindingState: "unavailable",
          ...(inspectionError ? { inspectionError } : {}),
          ...(isIosAccessibilityQueryInFlightError(error) ? { semanticProbeInFlight: true } : {}),
          ...(rememberedApp ? { foregroundApp: rememberedApp } : {}),
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
        ...(capture.foregroundApp ? { foregroundApp: capture.foregroundApp } : {}),
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
    const catalogNodes = opts?.separateRequestedSelectorEvidence
      ? nodes.filter((node) => node.recordingSelectorSupplemental !== true)
      : undefined;
    const observedIdentity = observeScreenIdentityForHost(catalogNodes ?? nodes, {
      browserTargetId: context.kind === "browser" ? context.targetId : opts?.serial,
    });
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
    const pixelsChrome = describePixelsOnlySnapshotChrome({
      foregroundApp: capture.foregroundApp,
      visualFingerprint,
    });
    return {
      serial,
      capturedAt,
      nodes,
      ...(catalogNodes ? { catalogNodes } : {}),
      interactive,
      bounds,
      screenIdentity: observedIdentity,
      ...(visualFingerprint ? { visualFingerprint } : {}),
      ...(proposedRows?.length ? { proposedRows } : {}),
      ...(readiness ? { readiness } : {}),
      ...capture,
      ...(pixelsChrome.app ? { app: pixelsChrome.app } : {}),
      ...(pixelsChrome.header ? { header: pixelsChrome.header } : {}),
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

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").trim();
}

/** Prefer the go-ios pixel failure over agent-device's browser "open first" copy. */
export function iosPixelsUnavailableMessage(goIosError: unknown, sdkError?: unknown): string {
  const goIos = errorText(goIosError).slice(0, 400);
  const sdk = sdkError ? errorText(sdkError) : "";
  if (/tunnel|ios 17|rsd|instruments/i.test(goIos)) {
    return `iOS pixels need an active go-ios tunnel (iOS 17+). ${goIos} Do not run target.open on a physical iPad.`;
  }
  if (/no active session|run open first/i.test(sdk)) {
    return `iOS screenshot failed via go-ios (${goIos}). XCTest is also down — that is not a failed screenshot. Do not run target.open on a physical iPad.`;
  }
  return `iOS screenshot failed via go-ios: ${goIos}`;
}

export async function captureScreenshot(opts?: {
  serial?: string;
  device?: Device;
  caption?: string;
  jobId?: string;
  /** skip attaching to job */
  ephemeral?: boolean;
  /** Opt-in follow-on semantic snapshot after pixels. Default is pixels only
   * on every platform so a hung tree cannot stall the raster. */
  includeScreenMatch?: boolean;
  /** Fresh semantic proof supplied by the caller to avoid a second tree walk. */
  semanticNodes?: readonly SnapshotNode[];
  /** Draw a tap preview ring; does not touch the device. */
  previewTap?: { x: number; y: number };
  /** Saved who-and-where: capture pixels under the Lane's exact fixture
   * overlay instead of an anonymous context (the wrong-account guard). */
  overlay?: RuntimeTargetOverlay;
}): Promise<ScreenshotPayload> {
  const captureStartedAt = now();
  const target = await resolveRuntimeTarget(opts?.serial, opts?.device, opts?.overlay);
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
      target.context.kind === "device" && target.context.serial
        ? target.context.platform === "android"
          ? await captureAndroidForegroundApp(target.context.serial)
          : target.context.platform === "ios"
            ? await rememberedTargetApplication(target.context)
            : undefined
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
      } catch (goIosError) {
        try {
          await withSession(
            target.device,
            () => target.device.capture.screenshot({ ...base(), path }),
            "screenshot",
          );
        } catch (sdkError) {
          throw new Error(iosPixelsUnavailableMessage(goIosError, sdkError));
        }
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
    if (context.kind === "device")
      recordNativeScreenshotViewport(
        { targetId: context.serial, platform: context.platform },
        buf,
        context.platform === "ios" ? iosLogicalBoundsForSerial(context.serial) : undefined,
        pixelCapturedAt,
      );
    if (
      opts?.previewTap &&
      Number.isFinite(opts.previewTap.x) &&
      Number.isFinite(opts.previewTap.y)
    ) {
      const geometry =
        context.kind === "device" && context.platform === "ios" && context.serial
          ? currentIosSnapshotGeometry(context.serial, pixelCapturedAt)
          : undefined;
      const logical = geometry
        ? tapPreviewLogicalBounds(buf, {
            width: geometry.logicalWidth,
            height: geometry.logicalHeight,
          })
        : undefined;
      buf = Buffer.from(annotateTapPreview(buf, opts.previewTap, logical));
      await writeFile(path, buf);
    }
    const base64 = buf.toString("base64");
    const dimensions = pngDimensions(buf);
    let screenMatch: ScreenshotPayload["screenMatch"];
    if (screenshotIncludesFollowOnTree(opts?.includeScreenMatch)) {
      try {
        semanticNodes ??= (await snapshotForTarget(target, false, "snapshot")).nodes;
        const identity = observeScreenIdentityForHost(semanticNodes, {
          browserTargetId: context.kind === "browser" ? context.targetId : opts?.serial,
        });
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
