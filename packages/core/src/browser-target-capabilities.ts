import type { TargetCapability } from "@relay/protocol";

/** Pure capability metadata shared with browser-hosted workflow clients. */
export const BROWSER_TARGET_CAPABILITIES: readonly TargetCapability[] = [
  "snapshot",
  "screenshot",
  "recording",
  "tap",
  "type",
  "scroll",
  "clipboard",
  "network",
  "logs",
];
