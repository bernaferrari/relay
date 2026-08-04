import type { ScreenVariant } from "@relay/protocol";
import type { CapturedStartScreen } from "../context/recorder";

/** Project one authoritative device observation into the reusable App Map
 * variant shape. Keeping this outside the canvas component lets the blank-map
 * capture commit evidence before the workspace remounts. */
export function screenVariantForCapture(
  screenId: string,
  captured: CapturedStartScreen,
): ScreenVariant {
  const at = captured.observation.capturedAt;
  const targetId = captured.targetProfile.targetId;
  return {
    id: `variant:${screenId}:${captured.targetProfile.platform}:${targetId}`,
    ...captured.mapScope,
    screenId,
    targetProfile: structuredClone(captured.targetProfile),
    observation: {
      fingerprint: captured.observation.fingerprint,
      nodes: captured.semanticNodes.slice(0, 256).map((node) => ({
        role: typeof node.role === "string" && node.role.trim() ? node.role : "unknown",
        ...(typeof node.label === "string" ? { label: node.label } : {}),
        ...(typeof node.value === "string" ? { value: node.value } : {}),
        ...(typeof node.identifier === "string" ? { identifier: node.identifier } : {}),
        ...(typeof node.enabled === "boolean" ? { enabled: node.enabled } : {}),
        ...(typeof node.selected === "boolean" ? { selected: node.selected } : {}),
        ...(typeof node.focused === "boolean" ? { focused: node.focused } : {}),
        ...(typeof node.hittable === "boolean" ? { hittable: node.hittable } : {}),
        ...(typeof node.depth === "number" && Number.isFinite(node.depth)
          ? { depth: node.depth }
          : {}),
      })),
      volatileSignals: [],
    },
    evidenceIds: [...new Set(captured.evidenceIds)],
    evidenceUris: [...new Set(captured.evidenceUris)],
    ...(captured.evidenceUris[0] ? { screenshotUri: captured.evidenceUris[0] } : {}),
    createdAt: at,
    updatedAt: at,
  };
}
