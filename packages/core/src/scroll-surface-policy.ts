import type { ScrollSurfaceCapturePolicy } from "@relay/protocol";
import { hasProfileStableSurfaceTerm } from "./discovery-app-profiles.js";

const dynamicContent =
  /\b(import|memory|feed|history|private|account|user|chat|message|conversation)\b/iu;
const repetitiveCatalog =
  /\b(open[\s-]?source licenses?|software licenses?|acknowledgements?|credits|legal notices?)\b/iu;
const stableGenericContent =
  /\b(settings|preferences|options|terms|privacy|subscription|billing)\b/iu;

/** Product-owned surfaces: the generic nouns, plus whatever each app profile
 * names as its own stable page. */
function stableProductContent(value: string): boolean {
  return stableGenericContent.test(value) || hasProfileStableSurfaceTerm(value);
}

/** Conservative authoring recommendation. Unknown or potentially private
 * content remains a representative viewport until a person explicitly opts
 * into a full surface. The title wins over incidental shared chrome labels. */
export function recommendScrollSurfaceCapturePolicy(input: {
  title: string;
  semanticLabels?: string[];
  decidedAt: number;
}): ScrollSurfaceCapturePolicy {
  const labels = (input.semanticLabels ?? []).join(" ");
  if (dynamicContent.test(input.title)) {
    return {
      captureMode: "viewport",
      source: "recommended",
      reason: "Dynamic, private, account-specific, or user-generated content stays viewport-only.",
      decidedAt: input.decidedAt,
    };
  }
  if (repetitiveCatalog.test(input.title)) {
    return {
      captureMode: "viewport",
      source: "recommended",
      reason:
        "A representative viewport plus semantic presence covers this repetitive catalog without redundant scrolling.",
      decidedAt: input.decidedAt,
    };
  }
  if (stableProductContent(input.title)) {
    return {
      captureMode: "full-surface",
      source: "recommended",
      reason: "Stable product-owned hidden UI is relevant to coverage.",
      decidedAt: input.decidedAt,
    };
  }
  if (dynamicContent.test(labels)) {
    return {
      captureMode: "viewport",
      source: "recommended",
      reason: "Dynamic, private, account-specific, or user-generated content stays viewport-only.",
      decidedAt: input.decidedAt,
    };
  }
  if (repetitiveCatalog.test(labels)) {
    return {
      captureMode: "viewport",
      source: "recommended",
      reason:
        "A representative viewport plus semantic presence covers this repetitive catalog without redundant scrolling.",
      decidedAt: input.decidedAt,
    };
  }
  if (stableProductContent(labels)) {
    return {
      captureMode: "full-surface",
      source: "recommended",
      reason: "Stable product-owned hidden UI is relevant to coverage.",
      decidedAt: input.decidedAt,
    };
  }
  return {
    captureMode: "viewport",
    source: "default",
    reason:
      "Viewport is the conservative default until full-surface coverage is explicitly authored.",
    decidedAt: input.decidedAt,
  };
}
