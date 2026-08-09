export const ACCESSIBILITY_OVERLAY_MODES = ["always", "hover", "hidden", "off"] as const;

export type AccessibilityOverlayMode = (typeof ACCESSIBILITY_OVERLAY_MODES)[number];

export const ACCESSIBILITY_OVERLAY_MODE_LABELS: Record<AccessibilityOverlayMode, string> = {
  always: "Always",
  hover: "On hover",
  hidden: "Hidden",
  off: "Off",
};

export const ACCESSIBILITY_OVERLAY_MODE_DESCRIPTIONS: Record<AccessibilityOverlayMode, string> = {
  always: "Show every detected element and strengthen the one under the pointer.",
  hover: "Collect element data and reveal only the element under the pointer.",
  hidden: "Keep element data available for recording without drawing it over the device.",
  off: "Use pixels only. Relay stops collecting accessibility snapshots and clears the current tree.",
};

export function parseAccessibilityOverlayMode(
  value: string | null | undefined,
): AccessibilityOverlayMode {
  return ACCESSIBILITY_OVERLAY_MODES.includes(value as AccessibilityOverlayMode)
    ? (value as AccessibilityOverlayMode)
    : "hover";
}

export function accessibilityCollectionEnabled(mode: AccessibilityOverlayMode): boolean {
  return mode !== "off";
}

export function accessibilityHoverEnabled(mode: AccessibilityOverlayMode): boolean {
  return mode === "always" || mode === "hover";
}

export function nextAccessibilityOverlayMode(
  mode: AccessibilityOverlayMode,
): AccessibilityOverlayMode {
  const index = ACCESSIBILITY_OVERLAY_MODES.indexOf(mode);
  return ACCESSIBILITY_OVERLAY_MODES[(index + 1) % ACCESSIBILITY_OVERLAY_MODES.length]!;
}
