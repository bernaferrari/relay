import { createOperationBuilders } from "./operation-builders.js";
import type { RelayOperationMap } from "./operation-map.js";

type TargetDeviceControlOperationId = "target.prompt" | "target.network.set" | "target.display.set";

const { command } =
  createOperationBuilders<Pick<RelayOperationMap, TargetDeviceControlOperationId>>();

export const targetDeviceControlOperationDefinitions = [
  command(
    "target.prompt",
    "Type and send a prompt, then wait for the reply",
    "POST",
    "/device/prompt",
    {
      category: "target",
      targetCapabilities: ["tap", "snapshot"],
      lease: "exclusive",
    },
  ),
  command("target.network.set", "Change Android radios for offline QA", "POST", "/device/network", {
    category: "target",
    targetCapabilities: ["tap"],
    lease: "exclusive",
    idempotency: "inherent",
  }),
  command(
    "target.display.set",
    "Wake or keep an Android display awake",
    "POST",
    "/device/display",
    {
      category: "target",
      targetCapabilities: ["tap"],
      lease: "exclusive",
      idempotency: "inherent",
    },
  ),
] as const;
