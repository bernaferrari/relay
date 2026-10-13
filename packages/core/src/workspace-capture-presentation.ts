import { analyzeScreenshot, type ScreenshotAnalysis } from "./screenshot-analysis.js";
import type { SnapshotNode } from "./device.js";
import { pngDimensions } from "./ios-geometry.js";
import { recordNativeViewport } from "./native-target-profile.js";

/** Called with the full normalized transport raster, before preview annotations. */
export function recordNativeScreenshotViewport(
  target: { targetId: string; platform: "android" | "ios" },
  bytes: Uint8Array,
  logicalBounds: { width: number; height: number } | undefined,
  at: number,
  analysis?: ScreenshotAnalysis,
): void {
  if (!bytes.byteLength || (analysis?.blank ?? isBlankScreenshot(bytes))) return;
  const viewport =
    target.platform === "android" ? pngDimensions(Buffer.from(bytes)) : logicalBounds;
  if (viewport?.width && viewport.height) recordNativeViewport(target, viewport, at);
}

/**
 * An all-black PNG is a transport/display failure, not valid visual evidence.
 * Keep this deliberately conservative: dark-mode screens have text and chrome,
 * while the iPad failure mode has no illuminated pixels at all.
 */
export function isBlankScreenshot(bytes: Uint8Array): boolean {
  return analyzeScreenshot(bytes).blank;
}
/** Follow-on AX after a raster is opt-in. Android used to snapshot by default,
 * which let a hung tree stall the PNG; recipe callers already pass false. */
export function screenshotIncludesFollowOnTree(includeScreenMatch?: boolean): boolean {
  return includeScreenMatch === true;
}
export function formatSnapshotTree(nodes: SnapshotNode[], limit = 80): string {
  const lines: string[] = [];
  for (const n of nodes.slice(0, limit)) {
    const label = (n.label ?? n.value ?? n.identifier ?? "").trim();
    if (!label) continue;
    const hit = n.hittable ? "●" : "○";
    const rect = n.rect
      ? ` @${Math.round(n.rect.x)},${Math.round(n.rect.y)} ${Math.round(n.rect.width)}×${Math.round(n.rect.height)}`
      : "";
    const ref = n.ref ? ` ${n.ref.startsWith("@") ? n.ref : `@${n.ref}`}` : "";
    lines.push(`${hit} ${label}${ref}${rect}`);
  }
  if (nodes.length > limit) lines.push(`… ${nodes.length - limit} more nodes`);
  return lines.join("\n");
}
