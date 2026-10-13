import { analyzeScreenshot } from "./screenshot-analysis.js";

/** Preserve the v1 visual identity algorithm while allowing a capture owner
 * to reuse the same decoded-raster analysis for its other evidence checks. */
export function observeVisualScreenFingerprint(png: Uint8Array): string | undefined {
  return analyzeScreenshot(png).visualFingerprint;
}
