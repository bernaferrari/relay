import { fail, objectParser, string } from "./operation-parser-primitives.js";
import type { OperationInput } from "./operation-map.js";

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
