import type { VisualComparisonPolicy, VisualRegion } from "@relay/protocol";

/**
 * Three ignore policies stay separate:
 * 1. Identity-ignore — screen-identity matching only.
 * 2. Capture-review masks — overlay on a selected frame/step.
 * 3. VisualComparisonPolicy regions — human-authored baseline ignore list.
 *
 * Host packs still drop leftover chats, composer placeholders, and intro
 * overlays for identity matching. This module never turns identity-ignore or
 * grok.com ui-tree chrome (composer / intro / reply-body) into a visual
 * exclusion. Looks correct does not write these regions.
 */

type FrameSize = {
  index: number;
  width?: number;
  height?: number;
  stepId?: string;
};

/**
 * Ui-tree leftover-chat chrome and identity-ignore artifacts are identity-only.
 * They never become VisualComparisonPolicy regions. A later Settings frame
 * therefore cannot inherit Chat composer ignores from ui-tree inference.
 */
export function visualIgnoreRegionsFromIdentityArtifacts(
  _artifacts: readonly { kind?: string; data?: unknown }[],
  _frames: readonly FrameSize[],
): VisualRegion[] {
  return [];
}

/**
 * Visual compare uses the stored human comparison policy as-is. Identity-ignore
 * and ui-tree chrome are never merged. Reviewed policy region ids stay
 * authoritative. Looks correct does not write these regions.
 */
export function withIdentityIgnoreRegions(
  policy: VisualComparisonPolicy,
  artifacts: readonly { kind?: string; data?: unknown }[],
  frames: readonly FrameSize[],
): VisualComparisonPolicy {
  visualIgnoreRegionsFromIdentityArtifacts(artifacts, frames);
  return policy;
}
