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
  type SnapshotPayload,
  inferSnapshotBounds,
  captureSnapshot,
  type ScreenshotPayload,
  captureScreenshot,
  type DeviceVideoCapture,
  captureDeviceVideo,
  cleanupScreenshot,
  formatSnapshotTree,
} from "./workspace-capture.js";
export {
  type InteractPoint,
  type InteractInput,
  type InteractResult,
  resolveInteractPreview,
  previewInteract,
  interactOnDevice,
  interact,
} from "./workspace-interact.js";
