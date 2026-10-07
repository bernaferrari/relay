import { PNG } from "pngjs";
import type { SnapshotNode } from "./device.js";
import { pngDimensions } from "./ios-geometry.js";
import { recordNativeViewport } from "./native-target-profile.js";

/** Called with the full normalized transport raster, before preview annotations. */
export function recordNativeScreenshotViewport(
  target: { targetId: string; platform: "android" | "ios" },
  bytes: Uint8Array,
  logicalBounds: { width: number; height: number } | undefined,
  at: number,
): void {
  if (!bytes.byteLength || isBlankScreenshot(bytes)) return;
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
  let image: PNG;
  try {
    image = PNG.sync.read(Buffer.from(bytes));
  } catch {
    return false;
  }
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const alpha = image.data[offset + 3] ?? 0;
    const red = image.data[offset] ?? 0;
    const green = image.data[offset + 1] ?? 0;
    const blue = image.data[offset + 2] ?? 0;
    if (alpha > 0 && Math.max(red, green, blue) > 4) return false;
  }
  return true;
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
