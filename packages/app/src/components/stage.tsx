import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { useServer } from "../context/server";
import { useRecorder } from "../context/recorder";
import { ChooseDeviceEmptyState } from "./choose-device-empty-state";
import { usePlatform } from "../context/platform";
import { cn } from "../lib/cn";
import { humanError } from "../lib/human-error";
import { targetIsObservable, targetIsPhysicalIos, targetIsReady } from "../lib/target-presentation";
import { deviceReadiness } from "../lib/device-readiness";
import {
  LIVE_FALLBACK_FRAME_INTERVAL_MS,
  LIVE_IOS_FALLBACK_FRAME_INTERVAL_MS,
  LIVE_SNAPSHOT_INTERVAL_MS,
  POST_INTERACTION_SNAPSHOT_DELAY_MS,
  liveInspectionPolicy,
} from "../lib/live-inspection-policy";
import {
  accessibilityCollectionEnabled,
  accessibilityHoverEnabled,
} from "../lib/accessibility-overlay-mode";
import {
  emptyStageTitle as resolveEmptyStageTitle,
  hasIosSetupIssueText,
  iosSetupGuidanceText,
  liveImageStyleFromLayout,
  pickerNodeLabel,
  pickerNodeMetaLine,
  PHONE_SHELL,
  resolveDevicePanelState,
  resolveStageInspectionHint,
} from "../lib/stage-presentation";
import { DeviceVideoStream } from "./device-video-stream";
import { DeviceInteractionSurface } from "./device-interaction-surface";
import {
  companionFramePresentation,
  companionImageLayout,
  companionLogicalViewport,
  companionOrientationEdge,
} from "./app-map-device-companion-geometry";
import { SwipePathPreview } from "./swipe-path-preview";
import { StepPlaybackPreview } from "./step-playback-preview";
import { phoneScreen } from "../lib/ui";
import { CoordinateTapPreview, DevicePanelStatus } from "./device-stage-previews";
import { StageViewToggle, StageRecordingControls } from "./stage-chrome";
import { StageScreenFallback } from "./stage-screen-fallback";
import { StageTargetPicker } from "./stage-target-picker";
import { IosStageRuntimeStatus, iosStageRuntimeStatus } from "./ios-stage-runtime-status";
import {
  useDeviceStageRecordedEvidence,
  type DeviceStageView,
} from "../lib/use-device-stage-recorded-evidence";
import { useDeviceStageAccessibility } from "./use-device-stage-accessibility";
import { useDeviceStagePicker } from "./use-device-stage-picker";
import { useDeviceStageLiveFrame } from "../lib/use-device-stage-live-frame";
import { useDeviceStageKeyboard } from "../lib/use-device-stage-keyboard";
import { refreshLiveDeviceEvidence } from "../lib/live-device-refresh";
import { iosLiveSemanticPlane } from "../lib/ios-live-semantic-plane";
import { useDeviceStageLiveGesture } from "./use-device-stage-live-gesture";

/** Device-as-hero stage: phone bezel, frame filmstrip, snapshot rect overlays. */
export function DeviceStage(_props: {
  onExpandBoard?: () => void;
  onOpenTargets?: () => void;
  /**
   * Capture owns the recording lifecycle in the graph workspace. Keeping a
   * second switch and task field beneath the same device makes it unclear
   * which control is authoritative, so embedded stages only keep the useful
   * device utilities here.
   */
  recordingControls?: "full" | "embedded";
  /** The App Map owns the authoritative stream lifecycle while its device
   * companion is open. Keep transient frame misses in a loading state. */
  preparing?: boolean;
  onOrientation?: (orientation: "portrait" | "landscape" | "square" | "unknown") => void;
}) {
  const server = useServer();
  const rec = useRecorder();
  const platform = usePlatform();
  /** Device selection is intentional. Falling back to the first discovered
   * target made this stage say "ready" while the rest of Relay correctly
   * asked the person to choose a device. */
  const currentDevice = () => {
    const selected = server.selectedDevice();
    return selected
      ? (server.devices().find((device) => device.serial === selected) ?? null)
      : null;
  };
  const embeddedRecordingControls = () => _props.recordingControls === "embedded";

  const liveFrameSrc = useDeviceStageLiveFrame();
  const [stageView, setStageView] = createSignal<DeviceStageView>("live");
  // Pixels are an observation plane, not a signal that XCTest control is
  // ready. An attached iPad can therefore keep showing live go-ios video
  // while Relay truthfully withholds recording and input.
  const liveViewActive = () =>
    stageView() === "live" && targetIsObservable(currentDevice(), server.health() === "online");
  const liveControlActive = () =>
    liveViewActive() && targetReady() && Boolean(server.selectedLeaseId());
  // A live surface must never borrow an old recording frame. That made the
  // device look awake while it was actually locked or had switched targets.
  const frame = () => (liveViewActive() ? (server.liveFrame() ?? undefined) : undefined);
  // Live mode only paints pixels observed in this preview session. Recorded
  // evidence belongs in Recorded mode; using it as a video bootstrap made an
  // old screenshot flash while the current stream was still connecting.
  const liveSurfaceSrc = () => liveFrameSrc();
  const livePixelsAvailable = () =>
    Boolean(liveSurfaceSrc()) || (videoReady() && Boolean(liveVideoSrc()));
  const liveInteractionSurfaceAvailable = () => liveViewActive() && livePixelsAvailable();
  const {
    focusedPlanStep,
    plannedFocus,
    stepPlayback,
    recordedEvidenceSrc,
    displayImageSrc,
    displayCaption,
    focusedEvidenceHighlight,
    focusedCoordinateGuide,
    focusedSwipePreview,
    playbackBounds,
    swipePlayback,
    updateFocusedSwipePoint,
    recordedCoordinateEditable,
    recordedScreenHovered,
    setRecordedScreenHovered,
    recordedInspectionActive,
    recordedNodeOutlines,
    recordedHoverHighlight,
    updateRecordedNodeHover,
    clearRecordedNodeHover,
    chooseRecordedNode,
    recordedCoordinateDragging,
    beginRecordedCoordinateDrag,
    endRecordedCoordinateDrag,
    moveRecordedCoordinate,
  } = useDeviceStageRecordedEvidence({
    stageView,
    setStageView,
    liveSurfaceSrc,
    liveCaption: () => frame()?.caption,
  });
  const recordedAccessibilityHoverActive = () =>
    recordedInspectionActive() && accessibilityHoverEnabled(server.accessibilityMode());
  createEffect(() => {
    if (recordedAccessibilityHoverActive()) return;
    setRecordedScreenHovered(false);
    clearRecordedNodeHover();
  });
  const [frameAspect, setFrameAspect] = createSignal("9 / 19.5");
  const [frameRatio, setFrameRatio] = createSignal(9 / 19.5);
  const [liveImageRotation, setLiveImageRotation] = createSignal<"none" | "left" | "right">("none");
  const [liveImageDimensions, setLiveImageDimensions] = createSignal<
    { width: number; height: number } | undefined
  >();
  function updateFrameAspect(width: number, height: number): void {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
    setFrameAspect(`${width} / ${height}`);
    setFrameRatio(width / height);
  }
  const [videoReady, setVideoReady] = createSignal(false);
  const [videoFailed, setVideoFailed] = createSignal(false);
  const [videoAttempt, setVideoAttempt] = createSignal(0);
  // iOS has to sign and install its local runner once before Relay can ask it
  // for pixels. Keep that preflight separate from frame polling so the stage
  // never briefly promises a loading screen and then jumps to setup.
  const [iosSetupState, setIosSetupState] = createSignal<
    | "idle"
    | "checking"
    | "preparing"
    | "ready"
    | "needs-setup"
    | "developer-mode-disabled"
    | "failed"
  >("idle");
  const [iosSetupCheck, setIosSetupCheck] = createSignal(0);
  /** Local input/video invalidation lands before the next server snapshot.
   * It prevents a just-tapped screen from borrowing the old AX geometry. */
  const [semanticOverlayInvalidatedAt, setSemanticOverlayInvalidatedAt] = createSignal<
    number | undefined
  >();
  let completedIosSetupCheck = "";
  let resumedIosPreview = "";
  // transient tap feedback (positioned in % of the glass)
  const [tapFeedback, setTapFeedback] = createSignal<{ x: number; y: number } | null>(null);
  let feedbackTimer: number | undefined;
  const showTapFeedback = (displayX: number, displayY: number) => {
    setTapFeedback({ x: displayX * 100, y: displayY * 100 });
    if (feedbackTimer) clearTimeout(feedbackTimer);
    feedbackTimer = window.setTimeout(() => setTapFeedback(null), 280);
  };

  let stageEl: HTMLElement | undefined;
  let deviceScreenEl: HTMLElement | undefined;
  const {
    picker,
    close: closePicker,
    openAt: openPickerAt,
    pick,
    retarget,
    setPickerElement,
    ancestry,
    pickerNode,
    strategies,
    selectedStrategy,
    strategyId,
    setStrategyId,
    horizontalConstraint,
    setHorizontalConstraint,
    verticalConstraint,
    setVerticalConstraint,
    constrainedPoint,
    setManualPoint,
    coordinateSpace,
    setCoordinateSpace,
    elementAnchor,
    highlight: pickedHighlight,
  } = useDeviceStagePicker({
    imageRotation: liveImageRotation,
    stageElement: () => stageEl,
    showTapFeedback,
    onInteractionSuccess: () => {
      if (videoFailed()) void tickLiveFrame();
      scheduleLiveSnapshot();
    },
  });

  useDeviceStageKeyboard({
    controlActive: liveControlActive,
    screenElement: () => deviceScreenEl,
  });

  const [tabVisible, setTabVisible] = createSignal(
    typeof document !== "undefined" ? !document.hidden : true,
  );
  const onVisibility = () => setTabVisible(!document.hidden);
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibility);
    onCleanup(() => document.removeEventListener("visibilitychange", onVisibility));
  }

  let frameRequestsInFlight = 0;
  let snapInFlight = false;
  let snapQueued = false;
  let frameTimer: NodeJS.Timeout | undefined;
  let snapTimer: NodeJS.Timeout | undefined;
  let snapRefreshTimer: number | undefined;

  const iosFrameSharesSemanticSession = () =>
    targetIsPhysicalIos(currentDevice()) &&
    (server.appleDeviceSetup()?.setup.iosLivePreview?.backend ?? "go-ios-auto") ===
      "agent-device-png";
  const semanticReadiness = () => {
    const device = currentDevice();
    const snapshot = server.snapshot();
    const snapshotBelongsToDevice =
      Boolean(device) && (!snapshot?.serial || snapshot.serial === device?.serial);
    return snapshotBelongsToDevice
      ? (snapshot?.readiness?.semanticControl ?? device?.readiness?.semanticControl)
      : device?.readiness?.semanticControl;
  };
  const iosSemanticPlane = createMemo(() =>
    targetIsPhysicalIos(currentDevice())
      ? iosLiveSemanticPlane({
          readiness: semanticReadiness(),
          invalidatedAt: semanticOverlayInvalidatedAt(),
        })
      : undefined,
  );
  const semanticOverlaysEnabled = () =>
    !targetIsPhysicalIos(currentDevice()) || iosSemanticPlane()?.overlaysEnabled === true;
  const semanticAutomaticProbeAllowed = () =>
    !targetIsPhysicalIos(currentDevice()) || iosSemanticPlane()?.permitsAutomaticProbe === true;
  const invalidateIosSemanticOverlay = () => {
    if (targetIsPhysicalIos(currentDevice())) setSemanticOverlayInvalidatedAt(Date.now());
  };
  const livePaused = () =>
    !liveViewActive() ||
    !tabVisible() ||
    server.health() !== "online" ||
    picker() !== null ||
    physicalIosRecording();

  async function tickLiveFrame(): Promise<void> {
    if (livePaused() || frameRequestsInFlight >= 1) return;
    // Only the explicit agent-device PNG fallback shares XCTest with AX.
    // go-ios/MJPEG pixels remain useful even while semantic control is down.
    if (iosFrameSharesSemanticSession() && snapInFlight) return;
    frameRequestsInFlight += 1;
    try {
      await server.pollLiveFrame();
    } finally {
      frameRequestsInFlight -= 1;
      if (iosFrameSharesSemanticSession() && snapQueued) {
        snapQueued = false;
        scheduleLiveSnapshot();
      }
    }
  }
  async function tickLiveSnapshot(): Promise<void> {
    if (livePaused()) return;
    // A failed XCTest probe publishes a cooldown. It is a safety rail, not a
    // background polling schedule: pixels remain live and explicit Recover
    // owns the next repair attempt.
    if (!semanticAutomaticProbeAllowed()) return;
    if (iosFrameSharesSemanticSession() && frameRequestsInFlight > 0) {
      snapQueued = true;
      return;
    }
    if (snapInFlight) {
      snapQueued = true;
      return;
    }
    snapInFlight = true;
    try {
      await server.pollLiveSnapshot({
        // The live iPad stage only needs hittable geometry for hover, keyboard,
        // and direct interaction. Raw trees are intentionally captured through
        // the explicit Teach/Evidence paths instead.
        interactiveOnly: targetIsPhysicalIos(currentDevice()),
      });
    } finally {
      snapInFlight = false;
      if (snapQueued) {
        snapQueued = false;
        scheduleLiveSnapshot();
      }
    }
  }

  async function refreshLiveEvidence(): Promise<void> {
    await refreshLiveDeviceEvidence({
      frameSharesSemanticSession: iosFrameSharesSemanticSession(),
      pollFrame: tickLiveFrame,
      pollSnapshot: tickLiveSnapshot,
    });
  }

  function scheduleLiveSnapshot(delayMs = POST_INTERACTION_SNAPSHOT_DELAY_MS): void {
    if (snapRefreshTimer) clearTimeout(snapRefreshTimer);
    snapRefreshTimer = window.setTimeout(() => {
      snapRefreshTimer = undefined;
      const snapshot = tickLiveSnapshot();
      // Keep a slow fallback responsive to deliberate device input without
      // restoring the old permanent eight-images-per-second hot loop.
      if (usesScreenshotPreview()) {
        if (targetIsPhysicalIos(currentDevice())) void snapshot.then(() => tickLiveFrame());
        else void tickLiveFrame();
      }
    }, delayMs);
  }

  function stopLiveTimers(): void {
    if (frameTimer) {
      clearInterval(frameTimer);
      frameTimer = undefined;
    }
    if (snapTimer) {
      clearInterval(snapTimer);
      snapTimer = undefined;
    }
    if (snapRefreshTimer) {
      clearTimeout(snapRefreshTimer);
      snapRefreshTimer = undefined;
    }
    snapQueued = false;
  }

  const liveGesture = useDeviceStageLiveGesture({
    platform: () => currentDevice()?.platform,
    rotation: liveImageRotation,
    sendTouch: (action, fx, fy) => server.touchDevice(action, fx, fy),
    sendWheel: (fx, fy, scrollX, scrollY) => server.scrollDevice(fx, fy, scrollX, scrollY),
    driveSwipe: (from, to, durationMs, alreadyApplied) =>
      rec.driveSwipe(from, to, durationMs, alreadyApplied, liveImageDimensions()),
    interacting: rec.interacting,
    invalidateSemanticOverlay: invalidateIosSemanticOverlay,
    scheduleSnapshot: scheduleLiveSnapshot,
  });

  createEffect(() => {
    const selected = server.selectedDevice();
    const device = selected
      ? (server.devices().find((candidate) => candidate.serial === selected) ?? null)
      : null;
    const isReady = targetIsReady(device, server.health() === "online");
    if (!isReady || device?.platform !== "ios") {
      completedIosSetupCheck = "";
      resumedIosPreview = "";
      setIosSetupState("idle");
      return;
    }

    const readiness = deviceReadiness(device, server.health() === "online");
    if (readiness.kind === "ios-developer-mode-disabled") {
      setIosSetupState("developer-mode-disabled");
      return;
    }
    if (readiness.kind === "ios-preparing") {
      // Reading the first screen is what asks CoreDevice to activate its DDI.
      // Treat this as real preparation, not a passive state that can spin
      // forever waiting for another application to do the work.
      setIosSetupState("preparing");
      return;
    }

    const checkKey = `${device.serial}:${iosSetupCheck()}`;
    if (completedIosSetupCheck === checkKey) return;
    completedIosSetupCheck = checkKey;
    setIosSetupState("checking");

    void server
      .preflightAppleDeviceSetup()
      .then((configured) => {
        const current = currentDevice();
        // The preflight is asynchronous. Do not let a reply for an iPad that
        // was just disconnected or replaced overwrite the next device's UI.
        if (
          completedIosSetupCheck !== checkKey ||
          current?.platform !== "ios" ||
          current.serial !== device.serial
        ) {
          return;
        }
        // Saved Apple details only mean Relay can attempt preparation; the
        // runner is ready only after it returns a real screen. This avoids a
        // false "ready" state while Xcode is still signing or failing.
        setIosSetupState(configured ? "preparing" : "needs-setup");
      })
      .catch(() => {
        const current = currentDevice();
        if (
          completedIosSetupCheck === checkKey &&
          current?.platform === "ios" &&
          current.serial === device.serial
        ) {
          setIosSetupState("failed");
        }
      });
  });

  // Saving Apple details only gives Relay permission to prepare semantic
  // control. Pixels use the independent preview path and must never wait for
  // XCTest to become available.
  createEffect(() => {
    const device = currentDevice();
    if (device?.platform !== "ios" || iosSetupState() !== "preparing") {
      resumedIosPreview = "";
      return;
    }
    const resumeKey = `${device.serial}:${iosSetupCheck()}`;
    if (resumedIosPreview === resumeKey) return;
    resumedIosPreview = resumeKey;
    server.clearLiveCaptureIssue();
    if (liveViewActive()) {
      void refreshLiveEvidence();
    }
  });

  // A live picture proves preview pixels, not XCTest. Only the independent
  // semantic capability may make the iPad control plane ready.
  createEffect(() => {
    if (
      currentDevice()?.platform === "ios" &&
      iosSetupState() === "preparing" &&
      iosSemanticPlane()?.state === "current"
    ) {
      setIosSetupState("ready");
    }
  });

  createEffect(() => {
    const issue = server.liveCaptureIssue();
    if (
      currentDevice()?.platform === "ios" &&
      iosSetupState() === "preparing" &&
      issue &&
      /(runner|signing|xcode|provision|team id|bundle id|set.?up)/i.test(issue)
    ) {
      setIosSetupState("failed");
    }
  });

  createEffect(() => {
    const policy = liveInspectionPolicy(
      liveViewActive(),
      usesScreenshotPreview(),
      physicalIosRecording(),
      accessibilityCollectionEnabled(server.accessibilityMode()),
      semanticAutomaticProbeAllowed(),
    );
    if (!policy.pollSnapshot && !policy.pollFallbackFrame) return;

    // H.264 owns pixels whenever it is healthy. Accessibility inspection is
    // independent: it stays fresh for hover targets, recording semantics, and
    // physical interactions performed directly on the device.
    const physicalIos = targetIsPhysicalIos(currentDevice());
    const needsBootstrapFrame = !displayImageSrc();
    if (physicalIos && needsBootstrapFrame) void tickLiveFrame();
    if (policy.pollSnapshot) {
      void tickLiveSnapshot();
      // iOS video tells us when pixels materially change, so a permanent AX
      // poll would only compete with direct input. Android retains its cheap
      // bounded cadence; iPad semantics refresh on selection, input, visual
      // change, manual request, or explicit recovery.
      if (!physicalIos) {
        snapTimer = setInterval(() => void tickLiveSnapshot(), LIVE_SNAPSHOT_INTERVAL_MS);
      }
    }
    // The video canvas currently shares the evidence branch. A fresh process
    // has no frame yet, so capture one bootstrap image to mount the H.264
    // consumer; healthy video remains the only steady-state pixel transport.
    if (needsBootstrapFrame && !physicalIos) void tickLiveFrame();
    if (policy.pollFallbackFrame) {
      if (!physicalIos) void tickLiveFrame();
      // Android promotes to H.264 and only polls while recovering.
      // Physical iOS defaults to the go-ios stream; PNG polling is the explicit fallback.
      const frameMs =
        targetIsPhysicalIos(currentDevice()) &&
        (server.appleDeviceSetup()?.setup.iosLivePreview?.backend ?? "go-ios-auto") ===
          "agent-device-png"
          ? LIVE_IOS_FALLBACK_FRAME_INTERVAL_MS
          : LIVE_FALLBACK_FRAME_INTERVAL_MS;
      frameTimer = setInterval(() => void tickLiveFrame(), frameMs);
    }
    onCleanup(stopLiveTimers);
  });

  const {
    outlines: accessibilityOutlines,
    hoverHighlight,
    scheduleHover,
    clearHover,
  } = useDeviceStageAccessibility({
    liveViewActive,
    imageRotation: liveImageRotation,
    semanticOverlaysEnabled,
    refreshSnapshot: scheduleLiveSnapshot,
  });
  onCleanup(() => {
    if (feedbackTimer) clearTimeout(feedbackTimer);
  });
  /** The mirrored device is always interactive. Recording is an explicit
   *  start/stop action that decides whether interactions are also saved. */
  function toggleRecording(): void {
    closePicker();
    if (rec.recording()) void rec.stopRecording();
    else {
      setStageView("live");
      rec.enterRecordMode();
    }
  }

  const liveImagePresentation = createMemo(() => {
    const frame = liveImageDimensions();
    // go-ios video owns its dimensions before a PNG fallback exists. The same
    // geometry path must serve both transports, otherwise a video-only iPad
    // can render but cannot map a deliberate point correctly.
    if (!frame || stageView() !== "live" || !livePixelsAvailable()) return undefined;
    const nodes = server.snapshot()?.nodes;
    const recordedViewport = rec.recording() ? rec.take()?.sourceViewport : undefined;
    const logicalViewport = companionLogicalViewport(nodes) ?? recordedViewport;
    const pointScale = logicalViewport
      ? Math.max(frame.width, frame.height) /
        Math.max(logicalViewport.width, logicalViewport.height)
      : 1;
    return companionFramePresentation({
      frame,
      logicalViewport:
        logicalViewport && Number.isFinite(pointScale)
          ? {
              width: logicalViewport.width * pointScale,
              height: logicalViewport.height * pointScale,
            }
          : undefined,
      platform: currentDevice()?.platform,
      edge: companionOrientationEdge(nodes, logicalViewport),
    });
  });
  const liveImageLayout = createMemo(() => {
    const presentation = liveImagePresentation();
    return presentation ? companionImageLayout(presentation) : undefined;
  });
  createEffect(() => {
    const presentation = liveImagePresentation();
    if (!presentation) {
      setLiveImageRotation("none");
      _props.onOrientation?.("unknown");
      return;
    }
    setLiveImageRotation(presentation.rotation);
    updateFrameAspect(presentation.dimensions.width, presentation.dimensions.height);
    _props.onOrientation?.(presentation.orientation);
  });
  const targetReady = () => targetIsReady(currentDevice(), server.health() === "online");
  const supportsH264Stream = () => {
    const device = currentDevice();
    if (!device) return false;
    if (device.platform === "android") return true;
    if (device.platform === "ios") {
      const backend = server.appleDeviceSetup()?.setup.iosLivePreview?.backend ?? "go-ios-auto";
      return backend !== "agent-device-png";
    }
    return false;
  };
  const usesScreenshotPreview = () => !supportsH264Stream() || videoFailed();
  const physicalIosRecording = () => rec.recording() && targetIsPhysicalIos(currentDevice());
  let physicalIosRecordingWasActive = false;
  createEffect(() => {
    const active = physicalIosRecording();
    if (active) {
      // Any capture failure immediately preceding the take belongs to the old
      // preview attempt, not to the recording that now owns the runner.
      server.clearLiveCaptureIssue();
    } else if (physicalIosRecordingWasActive && liveViewActive()) {
      // Stop completes server-side before the projected session leaves the
      // recording state, so it is safe to refresh both pixels and semantics.
      void refreshLiveEvidence();
    }
    physicalIosRecordingWasActive = active;
  });
  const liveCaptureIssue = () => server.liveCaptureIssue();
  const needsIosSetup = () =>
    currentDevice()?.platform === "ios" && iosSetupState() === "needs-setup";
  const iosReadiness = () => deviceReadiness(currentDevice(), server.health() === "online");
  const developerModeDisabled = () =>
    iosReadiness().kind === "ios-developer-mode-disabled" ||
    /developer mode.*(?:disabled|turn on)|turn on developer mode/i.test(liveCaptureIssue() ?? "");
  const iosDeviceSupportPending = () => iosReadiness().kind === "ios-preparing";
  const hasIosSetupIssue = () =>
    hasIosSetupIssueText({
      developerModeDisabled: developerModeDisabled(),
      needsIosSetup: needsIosSetup(),
      platform: currentDevice()?.platform,
      liveCaptureIssue: liveCaptureIssue(),
    });
  const iosSetupGuidance = () =>
    iosSetupGuidanceText({
      readiness: iosReadiness(),
      liveCaptureIssue: liveCaptureIssue(),
      deviceName: currentDevice()?.name,
    });
  const preparingIosScreen = () =>
    targetReady() &&
    currentDevice()?.platform === "ios" &&
    iosSetupState() === "preparing" &&
    !displayImageSrc() &&
    !liveCaptureIssue();
  const checkingIosSetup = () =>
    targetReady() &&
    currentDevice()?.platform === "ios" &&
    ["idle", "checking"].includes(iosSetupState());
  const emptyStageTitle = () =>
    resolveEmptyStageTitle({
      preparing: _props.preparing,
      targetReady: targetReady(),
      developerModeDisabled: developerModeDisabled(),
      iosDeviceSupportPending: iosDeviceSupportPending(),
      checkingIosSetup: checkingIosSetup(),
      preparingIosScreen: preparingIosScreen(),
    });
  const [inspectionRecovering, setInspectionRecovering] = createSignal(false);
  const [panelRetrying, setPanelRetrying] = createSignal(false);
  const inspectionHint = createMemo(() =>
    resolveStageInspectionHint({
      stageLive: stageView() === "live",
      pixelsAvailable: livePixelsAvailable(),
      snapshot: server.snapshot(),
      physicalIos: targetIsPhysicalIos(currentDevice()),
      semanticPlane: iosSemanticPlane(),
      platform: currentDevice()?.platform,
      developerServicesAvailable: currentDevice()?.developerServicesAvailable,
      openXcodeAvailable: Boolean(platform.openXcode),
    }),
  );
  const showIosRuntimeStatus = () =>
    stageView() === "live" && targetIsPhysicalIos(currentDevice()) && livePixelsAvailable();
  const iosRuntimeStatus = createMemo(() => {
    if (!showIosRuntimeStatus()) return undefined;
    const controlIssue = server.controlIssue();
    return iosStageRuntimeStatus({
      pixelsAvailable: livePixelsAvailable(),
      semanticPlane: iosSemanticPlane() ?? iosLiveSemanticPlane({}),
      controlActive: liveControlActive(),
      controlIssue: controlIssue ? humanError(controlIssue) : undefined,
      canTakeControl: server.canTakeControlOfSelectedDevice(),
      inspectionHint: inspectionHint(),
    });
  });
  const retryInspection = async () => {
    if (inspectionRecovering()) return;
    setInspectionRecovering(true);
    try {
      const recovered = await server.recoverSelectedTarget("observe");
      if (recovered) await refreshLiveEvidence();
      // A failed recovery already produced the actionable runner state. Do
      // not immediately enqueue another snapshot: on iPad that restarts the
      // same slow XCTest preparation instead of making the existing pixels or
      // diagnostic easier to use.
    } finally {
      setInspectionRecovering(false);
    }
  };
  const takeControl = async () => {
    const controlled = await server.takeControlOfSelectedDevice();
    if (!controlled) return;
    await refreshLiveEvidence();
  };
  const devicePanelState = createMemo(() =>
    resolveDevicePanelState({
      serverOnline: server.health() === "online",
      arming: rec.arming(),
      physicalIosRecording: physicalIosRecording(),
      hasDisplayImage: livePixelsAvailable() || Boolean(displayImageSrc()),
      recordingIssue: rec.recordingIssue(),
      liveCaptureIssue: liveCaptureIssue(),
      inspectionError: server.snapshot()?.inspectionError,
      developerModeDisabled: developerModeDisabled(),
      iosSetupGuidance: iosSetupGuidance(),
      iosDeviceSupportPending: iosDeviceSupportPending(),
      checkingIosSetup: checkingIosSetup(),
      preparingIosScreen: preparingIosScreen(),
      hasIosSetupIssue: hasIosSetupIssue(),
      deviceName: currentDevice()?.name,
      platform: currentDevice()?.platform,
      openXcodeAvailable: Boolean(platform.openXcode),
      emptyStageTitle: emptyStageTitle(),
    }),
  );
  const videoIdentity = createMemo(() => {
    const serial = currentDevice()?.serial;
    const base = server.serverUrl().replace(/\/+$/, "");
    return liveViewActive() && serial && base ? `${base}|${serial}` : "";
  });
  const liveVideoSrc = createMemo(() => {
    const identity = videoIdentity();
    // Pixel observation is project-scoped and intentionally independent from
    // the exclusive control lease. A second Relay window may watch a live
    // target, but only the controller can send input through the transparent
    // interaction surface.
    if (!identity || !liveViewActive() || !tabVisible() || !supportsH264Stream()) return "";
    const separator = identity.lastIndexOf("|");
    const base = identity.slice(0, separator);
    const serial = identity.slice(separator + 1);
    return `${base}/device/stream?serial=${encodeURIComponent(serial)}&attempt=${videoAttempt()}`;
  });
  let videoRetryTimer: number | undefined;
  createEffect(() => {
    videoIdentity();
    setVideoReady(false);
    setVideoFailed(false);
  });
  async function retryScreenPreview(): Promise<void> {
    if (currentDevice()?.platform === "ios" && iosSetupState() !== "ready") {
      // Preview and semantic setup are separate. A person asking to refresh
      // the picture must not be forced through XCTest preparation first.
      server.clearLiveCaptureIssue();
      if (iosSetupState() === "needs-setup") setIosSetupCheck((check) => check + 1);
      await tickLiveFrame();
      if (semanticAutomaticProbeAllowed()) await tickLiveSnapshot();
      return;
    }
    server.clearLiveCaptureIssue();
    const serial = currentDevice()?.serial;
    // A window that lost a lease while the device was busy cannot recover by
    // polling alone. Re-selecting the same target reacquires control without
    // making the person choose the device a second time.
    if (serial) await server.setSelectedDevice(serial);
    if (serial && currentDevice()?.platform === "ios") {
      const recovered = await server.recoverSelectedTarget("observe");
      if (!recovered) return;
    }
    if (rec.recordingIssue()) {
      void rec.enterRecordMode();
      return;
    }
    void refreshLiveEvidence();
  }
  async function retryDevicePanel(): Promise<void> {
    if (panelRetrying()) return;
    setPanelRetrying(true);
    try {
      if (server.health() !== "online") {
        await server.retryConnection();
        return;
      }
      await retryScreenPreview();
    } finally {
      setPanelRetrying(false);
    }
  }
  function retryVideo(): void {
    setVideoReady(false);
    setVideoFailed(true);
    if (videoRetryTimer) clearTimeout(videoRetryTimer);
    videoRetryTimer = window.setTimeout(() => {
      setVideoAttempt((attempt) => attempt + 1);
      setVideoFailed(false);
    }, 5000);
  }
  onCleanup(() => {
    if (videoRetryTimer) clearTimeout(videoRetryTimer);
  });
  createEffect(() => {
    if (targetReady()) {
      rec.setInteracting(true);
      return;
    }
    if (!rec.recording()) rec.setInteracting(false);
  });

  return (
    <section
      ref={(el) => {
        stageEl = el;
      }}
      aria-label="Device stage"
      class={cn(
        "relative flex h-full min-h-0 flex-1 flex-col items-center justify-center overflow-hidden",
        embeddedRecordingControls() ? "px-4 py-3" : "px-6 py-5",
      )}
    >
      <Show
        when={
          !embeddedRecordingControls() &&
          (targetIsObservable(currentDevice(), server.health() === "online") ||
            recordedEvidenceSrc())
        }
      >
        <StageViewToggle
          stageView={stageView()}
          setStageView={setStageView}
          hasRecordedEvidence={Boolean(recordedEvidenceSrc())}
          liveAvailable={targetIsObservable(currentDevice(), server.health() === "online")}
          recording={rec.recording()}
          videoReady={videoReady()}
          videoFailed={videoFailed()}
        />
      </Show>
      <Show
        when={Boolean(currentDevice()) || Boolean(recordedEvidenceSrc())}
        fallback={
          <ChooseDeviceEmptyState
            purpose="live"
            scanning={server.deviceDiscoveryStatus() === "scanning"}
            offline={server.health() !== "online"}
            onChooseDevice={() => window.dispatchEvent(new CustomEvent("relay:open-device-picker"))}
          />
        }
      >
        <Show when={embeddedRecordingControls() && !devicePanelState()}>
          <div
            class="pointer-events-none absolute inset-[8%] -z-[1] rounded-full opacity-70 blur-3xl"
            style={{
              background:
                "radial-gradient(circle,color-mix(in srgb,var(--text-interactive-base) 9%,transparent),transparent 68%)",
            }}
            aria-hidden="true"
          />
        </Show>
        <Show
          when={devicePanelState()}
          fallback={
            <div
              data-device-chrome
              data-device-content={livePixelsAvailable() || displayImageSrc() ? "frame" : "status"}
              class={cn(
                PHONE_SHELL,
                "relative z-[2] shrink-0",
                frameRatio() >= 0.65
                  ? cn(
                      "h-auto w-[min(440px,calc(100%-40px))]",
                      iosRuntimeStatus() && "max-h-[calc(100%-192px)]",
                    )
                  : embeddedRecordingControls()
                    ? cn(
                        "w-auto max-w-[min(440px,calc(100%-40px))]",
                        iosRuntimeStatus()
                          ? "h-[min(760px,calc(100%-76px))]"
                          : "h-[min(790px,calc(100%-32px))]",
                      )
                    : cn(
                        "w-auto max-w-[min(440px,calc(100%-40px))]",
                        iosRuntimeStatus()
                          ? "h-[min(760px,calc(100%-192px))]"
                          : "h-[min(760px,calc(100%-148px))]",
                      ),
              )}
              style={{ "aspect-ratio": frameAspect() }}
            >
              <div class={cn(phoneScreen, "relative h-full w-full overflow-hidden rounded-3xl")}>
                {/* The workbench can preview an uncaptured plan. Embedded Live
                Device instead owns real target readiness, so it never masks a
                setup or capture state with unrelated planned-step content. */}
                <StageScreenFallback
                  arming={rec.arming()}
                  recordingIssue={rec.recordingIssue()}
                  displayImageSrc={displayImageSrc()}
                  hasDisplayPixels={
                    livePixelsAvailable() || Boolean(displayImageSrc()) || Boolean(liveVideoSrc())
                  }
                  embeddedRecordingControls={embeddedRecordingControls()}
                  plannedFocus={plannedFocus()}
                  focusedPlanStep={focusedPlanStep}
                  targetReady={targetReady()}
                  isEmptyDevices={server.isEmptyDevices()}
                  needsIosSetup={needsIosSetup()}
                  developerModeDisabled={developerModeDisabled()}
                  liveCaptureIssue={liveCaptureIssue()}
                  emptyStageTitle={emptyStageTitle()}
                  checkingIosSetup={checkingIosSetup()}
                  preparingIosScreen={preparingIosScreen()}
                  hasIosSetupIssue={hasIosSetupIssue()}
                  iosSetupGuidance={iosSetupGuidance()}
                  onRetryScreenPreview={() => {
                    void retryScreenPreview();
                  }}
                  onEnterRecordMode={() => {
                    void rec.enterRecordMode();
                  }}
                  onSwipePoint={updateFocusedSwipePoint}
                >
                  <Show keyed when={!videoFailed() && liveVideoSrc()}>
                    {(src) => (
                      <div
                        class="pointer-events-none absolute inset-0 z-[1] transition-opacity duration-hover"
                        data-device-video-ready={videoReady() ? "true" : "false"}
                        style={{ opacity: videoReady() ? 1 : 0 }}
                      >
                        <DeviceVideoStream
                          src={src}
                          requestHeaders={server.previewRequestHeaders()}
                          onReady={() => {
                            setVideoFailed(false);
                            setVideoReady(true);
                          }}
                          onFailure={retryVideo}
                          onSize={(width, height) => {
                            updateFrameAspect(width, height);
                            // A video-only preview still needs the exact
                            // rendered dimensions to normalize controller
                            // point input; do not wait for a PNG fallback.
                            setLiveImageDimensions({ width, height });
                          }}
                          onVisualFingerprint={(signal) => {
                            if (!targetIsPhysicalIos(currentDevice())) return;
                            // The stream can start after a prior XCTest proof.
                            // Treat its first observed pixels exactly like a
                            // material later frame: until a bounded fresh AX
                            // query completes, old bounds must not steer the
                            // visible surface.
                            const semanticProofAt = semanticReadiness()?.proof?.at;
                            if (
                              semanticProofAt !== undefined &&
                              semanticProofAt > signal.observedAt
                            ) {
                              return;
                            }
                            setSemanticOverlayInvalidatedAt(signal.observedAt);
                            // One event-driven compact query may prove the
                            // new screen. The capability cooldown inside
                            // tickLiveSnapshot blocks retry loops.
                            scheduleLiveSnapshot();
                          }}
                        />
                      </div>
                    )}
                  </Show>
                  <img
                    class={cn(
                      "block h-full w-full touch-none overscroll-contain select-none object-contain outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-strong-focus",
                      stageView() === "live" && "pointer-events-none",
                      rec.recording()
                        ? "cursor-crosshair"
                        : liveControlActive() && "cursor-pointer",
                      recordedCoordinateEditable() && "cursor-crosshair",
                      recordedAccessibilityHoverActive() && "cursor-pointer",
                    )}
                    ref={(element) => {
                      if (stageView() !== "live") deviceScreenEl = element;
                    }}
                    alt={displayCaption() || "Recorded device evidence"}
                    aria-label="Interactive device screen"
                    data-live-frame={stageView() === "live" && liveFrameSrc() ? "true" : undefined}
                    src={displayImageSrc()}
                    style={liveImageStyleFromLayout(liveImageLayout())}
                    draggable={false}
                    tabindex={stageView() === "live" ? -1 : 0}
                    onClick={() => {
                      if (stageView() === "recorded" && recordedAccessibilityHoverActive()) {
                        chooseRecordedNode();
                      }
                    }}
                    onLoad={(e) => {
                      const img = e.currentTarget;
                      if (img.naturalWidth && img.naturalHeight) {
                        if (stageView() === "live" && liveFrameSrc()) {
                          setLiveImageDimensions({
                            width: img.naturalWidth,
                            height: img.naturalHeight,
                          });
                        } else {
                          updateFrameAspect(img.naturalWidth, img.naturalHeight);
                        }
                      }
                    }}
                    onPointerDown={(e) => {
                      if (
                        stageView() === "recorded" &&
                        recordedCoordinateEditable() &&
                        e.button === 0
                      ) {
                        e.preventDefault();
                        e.currentTarget.focus({ preventScroll: true });
                        beginRecordedCoordinateDrag(e.pointerId);
                        e.currentTarget.setPointerCapture(e.pointerId);
                        moveRecordedCoordinate(e.currentTarget, e.clientX, e.clientY);
                      }
                    }}
                    onPointerMove={(e) => {
                      if (recordedCoordinateDragging(e.pointerId)) {
                        moveRecordedCoordinate(e.currentTarget, e.clientX, e.clientY);
                      }
                    }}
                    onPointerUp={(e) => {
                      if (recordedCoordinateDragging(e.pointerId)) {
                        moveRecordedCoordinate(e.currentTarget, e.clientX, e.clientY);
                        endRecordedCoordinateDrag(e.pointerId);
                        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                          e.currentTarget.releasePointerCapture(e.pointerId);
                        }
                      }
                    }}
                    onPointerCancel={(e) => {
                      endRecordedCoordinateDrag(e.pointerId);
                    }}
                    onLostPointerCapture={(e) => {
                      endRecordedCoordinateDrag(e.pointerId);
                    }}
                    onMouseMove={(e) => {
                      if (stageView() === "recorded") {
                        setRecordedScreenHovered(
                          recordedInspectionActive() && server.accessibilityMode() === "always",
                        );
                        if (recordedAccessibilityHoverActive()) {
                          updateRecordedNodeHover(e.currentTarget, e.clientX, e.clientY);
                        } else {
                          clearRecordedNodeHover();
                        }
                      }
                    }}
                    onMouseLeave={() => {
                      setRecordedScreenHovered(false);
                      clearRecordedNodeHover();
                    }}
                  />
                  <Show when={stageView() === "live"}>
                    <DeviceInteractionSurface
                      sourceDimensions={liveImageDimensions}
                      rotation={liveImageRotation}
                      disabled={() => !liveInteractionSurfaceAvailable()}
                      viewOnly={() => !liveControlActive()}
                      elementRef={(element) => {
                        deviceScreenEl = element;
                      }}
                      onGesture={liveGesture.onGesture}
                      onTap={({ point, source }) => {
                        const applied =
                          source === "pointer"
                            ? liveGesture.completedTransport()
                            : Promise.resolve(false);
                        showTapFeedback(point.displayed.x, point.displayed.y);
                        invalidateIosSemanticOverlay();
                        void applied.then((live) =>
                          rec
                            .driveTap(point.logical.x, point.logical.y, live, liveImageDimensions())
                            .then(() => {
                              if (rec.interacting()) scheduleLiveSnapshot();
                            }),
                        );
                      }}
                      onSwipe={({ start, end, durationMs }) => {
                        invalidateIosSemanticOverlay();
                        void liveGesture.completedTransport().then((live) =>
                          rec
                            .driveSwipe(
                              start.logical,
                              end.logical,
                              Math.max(80, Math.min(durationMs, 800)),
                              live,
                              liveImageDimensions(),
                            )
                            .then(() => {
                              if (rec.interacting()) scheduleLiveSnapshot();
                            }),
                        );
                      }}
                      onWheel={({ point, deltaX, deltaY }) => {
                        liveGesture.queueWheel(point.logical, deltaX, deltaY);
                      }}
                      onInspect={({ event }) => {
                        if (event.currentTarget instanceof HTMLElement) {
                          openPickerAt(event.currentTarget, event.clientX, event.clientY);
                        }
                      }}
                      onHover={({ event }) => {
                        if (liveControlActive() && event.currentTarget instanceof HTMLElement) {
                          scheduleHover(event.currentTarget, event.clientX, event.clientY);
                        }
                      }}
                      onLeave={clearHover}
                    />
                  </Show>
                  <Show
                    when={
                      stageView() === "recorded" &&
                      server.accessibilityMode() === "always" &&
                      recordedScreenHovered()
                    }
                  >
                    <For each={recordedNodeOutlines()}>
                      {(highlight) => (
                        <i
                          class="pointer-events-none absolute z-[2] rounded-sm border border-[color-mix(in_srgb,var(--text-interactive-base)_34%,transparent)]"
                          style={highlight}
                          data-recorded-node-outline
                          aria-hidden="true"
                        />
                      )}
                    </For>
                  </Show>
                  <Show
                    when={recordedAccessibilityHoverActive() ? recordedHoverHighlight() : undefined}
                  >
                    {(highlight) => (
                      <i
                        class="pointer-events-none absolute z-[3] rounded border-[1.5px] border-[var(--text-interactive-base)] bg-[color-mix(in_srgb,var(--text-interactive-base)_12%,transparent)] shadow-[0_0_0_1px_rgb(255_255_255/16%)]"
                        style={highlight()}
                        aria-hidden="true"
                      />
                    )}
                  </Show>
                  <Show when={focusedEvidenceHighlight()}>
                    {(highlight) => (
                      <div
                        class="pointer-events-none absolute z-[3] rounded border-[1.5px] border-[var(--text-interactive-base)] bg-[color-mix(in_srgb,var(--text-interactive-base)_18%,transparent)] shadow-[0_0_0_999px_rgb(4_7_14/30%)]"
                        style={highlight()}
                        aria-hidden="true"
                      />
                    )}
                  </Show>
                  <Show when={!stepPlayback() && focusedCoordinateGuide()}>
                    {(guide) => <CoordinateTapPreview guide={guide()} />}
                  </Show>
                  <Show when={focusedSwipePreview()}>
                    {(swipe) => (
                      <SwipePathPreview
                        from={swipe().from}
                        to={swipe().to}
                        bounds={swipe().bounds}
                        onPoint={updateFocusedSwipePoint}
                        previewToken={swipePlayback()?.token}
                        previewDurationMs={swipePlayback()?.step.durationMs}
                      />
                    )}
                  </Show>
                  {stepPlayback() && playbackBounds() && (
                    <StepPlaybackPreview step={stepPlayback()!.step} bounds={playbackBounds()!} />
                  )}
                  <Show when={server.accessibilityMode() === "always" && !picker()}>
                    <div
                      class="pointer-events-none absolute inset-0 z-[3] overflow-hidden rounded-3xl"
                      aria-hidden="true"
                    >
                      <For each={accessibilityOutlines()}>
                        {(outline) => (
                          <i
                            class="absolute rounded-sm border border-[color-mix(in_srgb,var(--border-interactive-base)_46%,transparent)] bg-[color-mix(in_srgb,var(--surface-brand-base)_4%,transparent)]"
                            style={outline}
                          />
                        )}
                      </For>
                    </div>
                  </Show>
                  <Show
                    when={
                      accessibilityHoverEnabled(server.accessibilityMode()) &&
                      !picker() &&
                      hoverHighlight()
                    }
                  >
                    {(h) => (
                      <div
                        class="pointer-events-none absolute inset-0 z-[4] overflow-hidden rounded-3xl"
                        aria-hidden="true"
                      >
                        <div
                          class="absolute rounded border-[1.5px] border-border-interactive-base bg-surface-brand-base/[0.12]"
                          style={h().rect}
                        />
                      </div>
                    )}
                  </Show>
                  <Show when={pickedHighlight()}>
                    {(h) => (
                      <div
                        class="pointer-events-none absolute z-[5] rounded border-[1.6px] border-border-interactive-base bg-surface-brand-base/[0.18]"
                        aria-hidden="true"
                        style={h()}
                      />
                    )}
                  </Show>

                  <div
                    ref={(element) => {
                      liveGesture.setTrail(element);
                    }}
                    class="pointer-events-none absolute inset-0 z-[6] opacity-0 transition-opacity duration-hover ease-out motion-reduce:transition-none"
                    aria-hidden="true"
                  >
                    <svg
                      class="absolute inset-0 h-full w-full"
                      viewBox="0 0 100 100"
                      preserveAspectRatio="none"
                    >
                      <line
                        ref={(element) => {
                          liveGesture.setTrailLine(element);
                        }}
                        class="stroke-[var(--text-interactive-base)] opacity-80"
                        stroke-width="2"
                        stroke-linecap="round"
                        vector-effect="non-scaling-stroke"
                      />
                    </svg>
                    <i
                      ref={(element) => {
                        liveGesture.setTrailHead(element);
                      }}
                      class="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--text-interactive-base)] shadow-[0_0_0_2px_rgb(255_255_255/88%),0_2px_8px_rgb(0_0_0/35%)]"
                    />
                  </div>

                  {/* tap confirmation ring */}
                  <Show when={tapFeedback()}>
                    {(fb) => (
                      <div
                        class="pointer-events-none absolute z-[6] origin-center rounded-full border-[1.5px] border-border-interactive-base bg-surface-brand-base/20 motion-safe:animate-ping"
                        aria-hidden="true"
                        style={{
                          left: `calc(${fb().x}% - 10px)`,
                          top: `calc(${fb().y}% - 10px)`,
                          width: "20px",
                          height: "20px",
                        }}
                      />
                    )}
                  </Show>
                </StageScreenFallback>
              </div>
              <Show
                when={
                  accessibilityHoverEnabled(server.accessibilityMode()) &&
                  !picker() &&
                  hoverHighlight()
                }
              >
                {(h) => (
                  <div
                    class={cn(
                      "pointer-events-none absolute z-[8] max-w-[72%] overflow-hidden rounded-md bg-surface-brand-base px-1.5 py-0.5 font-mono text-caption leading-snug text-ellipsis whitespace-nowrap text-text-on-brand-base shadow-sm",
                      h().chip.below ? "translate-y-1" : "-translate-y-[calc(100%+4px)]",
                    )}
                    style={{
                      left: h().chip.left,
                      top: h().chip.below ? h().chip.bottom : h().chip.top,
                    }}
                    aria-hidden="true"
                  >
                    {h().chip.text}
                  </div>
                )}
              </Show>
            </div>
          }
        >
          {(state) => (
            <DevicePanelStatus
              state={state()}
              busy={panelRetrying()}
              onOpenXcode={() => void platform.openXcode?.()}
              onOpenSettings={() =>
                window.dispatchEvent(
                  new CustomEvent("relay:open-settings", { detail: { section: "devices" } }),
                )
              }
              onRetry={() => {
                void retryDevicePanel();
              }}
            />
          )}
        </Show>
      </Show>

      <Show when={iosRuntimeStatus()}>
        {(status) => (
          <IosStageRuntimeStatus
            status={status()}
            busyForAction={(action) =>
              action.kind === "take-control"
                ? server.takingControlOfSelectedDevice()
                : action.kind === "reconnect" && action.source === "control"
                  ? panelRetrying()
                  : action.kind === "reconnect" && action.source === "labels"
                    ? inspectionRecovering()
                    : false
            }
            onAction={(action) => {
              switch (action.kind) {
                case "take-control":
                  void takeControl();
                  break;
                case "open-xcode":
                  void platform.openXcode?.();
                  break;
                case "refresh-labels":
                  void tickLiveSnapshot();
                  break;
                case "reconnect":
                  if (action.source === "control") void retryDevicePanel();
                  else void retryInspection();
                  break;
              }
            }}
          />
        )}
      </Show>

      <Show when={picker() && liveControlActive() && (pickerNode() || rec.recording())}>
        <StageTargetPicker
          picker={() => picker()!}
          setPickerEl={setPickerElement}
          nodeLabel={pickerNodeLabel(pickerNode())}
          metaLine={pickerNodeMetaLine(pickerNode())}
          ancestryLength={ancestry().length}
          strategies={strategies()}
          selectedStrategy={selectedStrategy()}
          strategyId={strategyId()}
          setStrategyId={setStrategyId}
          horizontalConstraint={horizontalConstraint()}
          verticalConstraint={verticalConstraint()}
          setHorizontalConstraint={setHorizontalConstraint}
          setVerticalConstraint={setVerticalConstraint}
          constrainedPoint={constrainedPoint()}
          setManualPoint={setManualPoint}
          hasPickerNodeRect={Boolean(pickerNode()?.rect)}
          canAnchorToElement={Boolean(elementAnchor())}
          coordinateSpace={coordinateSpace()}
          setCoordinateSpace={setCoordinateSpace}
          onClose={closePicker}
          onRetarget={retarget}
          onAddStep={(strategy) => {
            void pick(strategy, "select");
          }}
          onTapDevice={(strategy) => {
            void pick(strategy, "tap");
          }}
        />
      </Show>

      <Show when={targetReady() && !embeddedRecordingControls()}>
        <StageRecordingControls
          stageView={stageView()}
          recording={rec.recording()}
          recordingGroup={rec.recordingGroup()}
          setRecordingGroup={rec.setRecordingGroup}
          startNextRecordingGroup={rec.startNextRecordingGroup}
          selectedLeaseId={server.selectedLeaseId()}
          busyCapture={server.busyCapture()}
          frameCount={server.frames().length}
          onToggleRecording={toggleRecording}
          onCaptureScreenshot={() => {
            void server.captureUiScreenshot();
          }}
          onCopyScreenshot={() => {
            void server.copyUiScreenshot();
          }}
          onClearFrames={() => server.clearFrames()}
        />
      </Show>
    </section>
  );
}
