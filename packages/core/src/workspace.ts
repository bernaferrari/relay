/**
 * Live device workspace helpers for the testing shell:
 * snapshot UI tree, screenshot, basic interactions.
 */
export {
  inferIosSnapshotGeometry,
  normalizeIosSnapshotNodes,
  normalizeScreenshotToBounds,
} from "./ios-geometry.js";
export { center } from "./device.js";
export {
  type ListedDevice,
  listAndroidDevicesFast,
  listDevices,
  bootDevice,
  requestAndroidAuthorization,
  devicePlatformForSerial,
  resolveJobDevicePlatform,
} from "./workspace-devices.js";
export {
  resetIosRunnerState,
  type TargetRuntimeRecovery,
  recoverTargetRuntime,
} from "./workspace-ios-session.js";
export {
  IOS_SEMANTIC_PROBE_INITIAL_COOLDOWN_MS,
  IOS_SEMANTIC_PROBE_MAX_COOLDOWN_MS,
  TARGET_RUNTIME_READINESS_TTL_MS,
  hasUsableSemanticAccessibility,
  invalidateTargetSemanticControl,
  recordTargetPixelCapture,
  recordTargetSemanticSnapshot,
  resetTargetRuntimeReadiness,
  targetRuntimeReadiness,
  type RuntimeReadinessCapability,
  type RuntimeReadinessTarget,
} from "./target-runtime-readiness.js";
export {
  type SnapshotPayload,
  inferSnapshotBounds,
  captureSnapshot,
  type ScreenshotPayload,
  isBlankScreenshot,
  captureScreenshot,
  normalizeIosScreenshotForCapture,
  type DeviceVideoCapture,
  type IosEvidenceCaptureUnavailableDiagnostic,
  IosEvidenceCaptureUnavailableError,
  captureDeviceVideo,
  cleanupScreenshot,
  formatSnapshotTree,
} from "./workspace-capture.js";
export {
  captureScrollableSurvey,
  captureScrollableSurveyForTarget,
  verticalScrollSeam,
  type ScrollSurveyFrame,
  type ValidatedFrozenDocumentOrigin,
  type ScrollSurveyOptions,
  type ScrollSurveyResult,
  type ScrollSurveyStopReason,
} from "./scrollable-survey.js";
export {
  type InteractPoint,
  type InteractInput,
  type InteractResult,
  canVerifyIosScreenChange,
  resolveInteractPreview,
  previewInteract,
  interactOnDevice,
  interact,
} from "./workspace-interact.js";
