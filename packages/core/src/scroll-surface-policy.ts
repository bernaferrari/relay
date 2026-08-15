import type { ScrollSurfaceCapturePolicy } from "@relay/protocol";

const dynamicContent =
  /\b(import|memory|feed|history|private|account|user|chat|message|conversation)\b/iu;
const stableProductContent =
  /\b(settings|preferences|options|terms|privacy|subscription|billing|supergrok)\b/iu;

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
  if (stableProductContent.test(input.title)) {
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
  if (stableProductContent.test(labels)) {
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
