import { fail, objectParser, record, string } from "./operation-parser-primitives.js";
import type { DeviceSummary, OperationInput } from "./operation-map.js";
import { assertTargetRuntimeReadiness } from "./target-runtime-readiness-parser.js";

export const targetDevicesOutputParser = objectParser<{ devices: DeviceSummary[] }>(
  "devices response",
  (input) => {
    if (!Array.isArray(input.devices)) fail("devices", "must be an array");
    for (const item of input.devices) {
      const device = record(item, "device");
      string(device.id, "device id");
      string(device.serial, "device serial");
      string(device.name, "device name");
      if (device.viewport !== undefined) {
        const viewport = record(device.viewport, "device viewport");
        if (
          !Number.isSafeInteger(viewport.width) ||
          Number(viewport.width) <= 0 ||
          !Number.isSafeInteger(viewport.height) ||
          Number(viewport.height) <= 0
        )
          fail("device viewport", "must contain positive integer full display dimensions");
      }
      if (device.readiness !== undefined)
        assertTargetRuntimeReadiness(device.readiness, "device readiness");
    }
  },
);

export const targetDevicesInputParser = objectParser<OperationInput<"target.devices.list">>(
  "target devices input",
  (input) => {
    if (input.phase !== undefined && input.phase !== "android" && input.phase !== "ios") {
      fail("target devices phase", "must be android or ios when provided");
    }
    if (
      input.targetKind !== undefined &&
      input.targetKind !== "device" &&
      input.targetKind !== "browser"
    ) {
      fail("target devices kind", "must be device or browser when provided");
    }
    if (input.targetId !== undefined) string(input.targetId, "target devices targetId");
  },
);
