import type { AppMapCompiledTest, ScreenIdentityObservation } from "@relay/protocol";
import { loadFrozenRawAccessibilityEvidence } from "./frozen-raw-accessibility.js";
import type { RecipeStep } from "./recipes.js";
import { observeScreenIdentity, type ObserveScreenIdentityOptions } from "./screen-identity.js";
import { nativeWorkspaceIdentityNodes } from "./screen-identity-native-workspace.js";
import { nativeHomeIdentityNodes } from "./screen-identity-native-home.js";
import type { SnapshotNode } from "./device.js";

/** Compact taught observations cannot reapply geometric masks. Preserve exact
 * retained full semantics; strict Imagine states still need their model proof. */
export function matchesRecordedUnmaskedScreen(
  nodes: readonly SnapshotNode[],
  options: ObserveScreenIdentityOptions,
  expected: ReadonlySet<string>,
  exactNativeWorkspace: boolean,
): boolean {
  if (!options.ignoreRegions?.length) return false;
  const full = observeScreenIdentity(nodes).fingerprint;
  if (exactNativeWorkspace)
    return Boolean(
      expected.has(full) &&
      nativeHomeIdentityNodes(nodes, options.policy?.nativeImagineWorkspace?.packageName ?? ""),
    );
  return (
    expected.has(full) ||
    expected.has(observeScreenIdentity(nodes, { ...options, ignoreRegions: [] }).fingerprint)
  );
}

/** Reapply a reviewed native workspace policy to the immutable raw evidence
 * frozen with this Test. Missing provenance, incompatible targets or damaged
 * evidence add no identity proof. Never read a mutable map or a live device. */
export async function frozenScreenIdentityObservations(
  plan: AppMapCompiledTest,
  step: Extract<RecipeStep, { kind: "expect-screen" }>,
  options: ObserveScreenIdentityOptions,
  dependencies: Parameters<typeof loadFrozenRawAccessibilityEvidence>[1] = {},
): Promise<ScreenIdentityObservation[]> {
  if (!options.policy?.nativeImagineWorkspace) return [];
  const sources = plan.rawAccessibilitySourcesByScreenId?.[step.screenId];
  const profile = plan.runtimeTargetProfile;
  if (!sources?.length || !profile || profile.platform !== "android") return [];
  const evidence = await loadFrozenRawAccessibilityEvidence(
    { ...plan, rawAccessibilitySourcesByScreenId: { [step.screenId]: sources } },
    dependencies,
  );
  if (evidence.rawEvidenceStatusByScreenId?.[step.screenId]) return [];
  const expected = new Set([
    step.fingerprint,
    ...(step.aliases ?? []),
    ...(step.observations ?? []).map((observation) => observation.fingerprint),
  ]);
  const result: ScreenIdentityObservation[] = [];
  for (const item of evidence.rawSourcesByScreenId?.[step.screenId] ?? []) {
    const variant = item.source.variant;
    if (
      !item.nodes ||
      !variant ||
      variant.targetProfileId !== profile.id ||
      variant.targetId !== profile.targetId ||
      variant.platform !== profile.platform
    )
      continue;
    if (
      profile.viewport &&
      (!variant.viewport ||
        profile.viewport.width !== variant.viewport.width ||
        profile.viewport.height !== variant.viewport.height)
    )
      continue;
    const baseline = observeScreenIdentity(item.nodes);
    const ignoredBaseline = observeScreenIdentity(item.nodes, {
      ignoreRegions: step.ignoreRegions,
    });
    const hosted = observeScreenIdentity(item.nodes, options);
    if (
      ![baseline, ignoredBaseline, hosted].some((observation) =>
        expected.has(observation.fingerprint),
      )
    )
      continue;
    if (nativeWorkspaceIdentityNodes(item.nodes, options.policy) === item.nodes) continue;
    result.push(hosted);
  }
  return result;
}
