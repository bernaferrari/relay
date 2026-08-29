import { createOperationBuilders } from "./operation-builders.js";
import type { RelayOperationMap } from "./operation-map.js";

type BrowserDeviceOperationId =
  | "target.open"
  | "target.browser-device.open"
  | "target.browser-device.frame"
  | "target.browser-device.frame-binary"
  | "target.browser-device.inspect"
  | "target.browser-device.control";

const { command, query } =
  createOperationBuilders<Pick<RelayOperationMap, BrowserDeviceOperationId>>();

export const browserDeviceOperationDefinitions = [
  command("target.open", "Open managed target", "POST", "/targets/:targetId/open", {
    category: "target",
    confirmation: "confirm",
    lease: "exclusive",
    targetCapabilities: ["screenshot"],
  }),
  command(
    "target.browser-device.open",
    "Open in-app Browser Device",
    "POST",
    "/targets/:targetId/browser-device",
    { category: "target", lease: "exclusive", targetCapabilities: ["screenshot"] },
  ),
  query(
    "target.browser-device.frame",
    "Capture Browser Device frame",
    "/targets/:targetId/browser-device/frame",
    { category: "target", lease: "shared", targetCapabilities: ["screenshot"] },
  ),
  query(
    "target.browser-device.frame-binary",
    "Capture Browser Device binary frame",
    "/targets/:targetId/browser-device/frame.bin",
    { category: "target", lease: "shared", targetCapabilities: ["screenshot"] },
  ),
  query(
    "target.browser-device.inspect",
    "Inspect Browser Device labels",
    "/targets/:targetId/browser-device/inspect",
    { category: "target", lease: "shared", targetCapabilities: ["snapshot"] },
  ),
  command(
    "target.browser-device.control",
    "Control Browser Device",
    "POST",
    "/targets/:targetId/browser-device/input",
    { category: "target", lease: "exclusive", targetCapabilities: ["tap"] },
  ),
] as const;
