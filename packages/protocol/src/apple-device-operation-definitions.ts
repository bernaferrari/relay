import { createOperationBuilders } from "./operation-builders.js";
import type { RelayOperationMap } from "./operation-map.js";

type AppleDeviceOperationId =
  | "workspace.apple-device.update"
  | "workspace.apple-live-preview.update";

const { command } = createOperationBuilders<Pick<RelayOperationMap, AppleDeviceOperationId>>();

export const appleDeviceOperationDefinitions = [
  command(
    "workspace.apple-device.update",
    "Update Apple device setup",
    "PUT",
    "/settings/devices/apple",
    { confirmation: "confirm" },
  ),
  command(
    "workspace.apple-live-preview.update",
    "Update Apple live preview backend",
    "PUT",
    "/settings/devices/apple/live-preview",
    { confirmation: "confirm" },
  ),
] as const;
