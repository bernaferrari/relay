import { createOperationBuilders } from "./operation-builders.js";
import type { RelayOperationMap } from "./operation-map.js";

type BrowserDeviceOperationId =
  | "target.open"
  | "target.browser-device.open"
  | "target.browser-device.frame"
  | "target.browser-device.frame-binary"
  | "target.browser-device.inspect"
  | "target.browser-device.control"
  | "target.browser-auth.save"
  | "target.browser-auth.list"
  | "target.browser-auth.revoke"
  | "target.browser-auth.probe"
  | "target.browser-auth.health";

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
  command(
    "target.browser-auth.save",
    "Save reviewed browser sign-in state",
    "POST",
    "/targets/:targetId/browser-auth-fixtures",
    {
      category: "target",
      confirmation: "confirm",
      idempotency: "required",
      lease: "exclusive",
      minimumRole: "author",
      targetCapabilities: ["snapshot"],
    },
  ),
  query(
    "target.browser-auth.list",
    "List browser sign-in fixtures",
    "/targets/:targetId/browser-auth-fixtures",
    { category: "target", minimumRole: "viewer" },
  ),
  command(
    "target.browser-auth.revoke",
    "Revoke browser sign-in fixture",
    "POST",
    "/targets/:targetId/browser-auth-fixtures/revoke",
    {
      category: "target",
      confirmation: "confirm",
      idempotency: "inherent",
      minimumRole: "author",
    },
  ),
  command(
    "target.browser-auth.probe",
    "Probe browser sign-in health",
    "POST",
    "/targets/:targetId/browser-auth-fixtures/probe",
    {
      category: "target",
      lease: "shared",
      minimumRole: "viewer",
      targetCapabilities: ["snapshot"],
    },
  ),
  command(
    "target.browser-auth.health",
    "Summarize live sign-ins and account lanes",
    "POST",
    "/targets/:targetId/browser-auth-fixtures/health",
    {
      category: "target",
      lease: "shared",
      minimumRole: "viewer",
      targetCapabilities: ["snapshot"],
    },
  ),
] as const;
