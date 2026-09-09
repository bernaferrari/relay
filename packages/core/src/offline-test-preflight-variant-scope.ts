import type {
  AppMapCompiledRawAccessibilityTargetProfile,
  AppMapCompiledRawAccessibilityVariant,
  OfflineTestPreflightRawVariantCandidate,
  OfflineTestPreflightRawVariantScope,
  StepTarget,
} from "@relay/protocol";
import { preflightSemanticActivation } from "./device-target-resolution.js";
import type { SnapshotNode } from "./device.js";
import type { OfflineTestPreflightRawSource } from "./offline-test-preflight-raw.js";
import {
  appMapRuntimeTargetProfileKey,
  sameAppMapRuntimeTargetProfile,
} from "./app-map-runtime-target-profile.js";

type StableSelector =
  | { kind: "identifier"; identifier: string; role?: string }
  | { kind: "relation"; identifier: string; role?: string };

type RuntimeShape = Pick<
  AppMapCompiledRawAccessibilityTargetProfile,
  | "targetId"
  | "platform"
  | "model"
  | "androidAvdName"
  | "osVersion"
  | "viewport"
  | "browserCaseProfile"
  | "capabilities"
>;

export type RawVariantScopeDecision = {
  /** Sources allowed to make a selector-proof claim for the selected target. */
  compatibleSources: OfflineTestPreflightRawSource[];
  /** Sources retained as diagnostic evidence but never allowed to bless it. */
  incompatibleSources: OfflineTestPreflightRawSource[];
  scope?: OfflineTestPreflightRawVariantScope;
  state: "unscoped" | "selected" | "selection-required" | "selection-missing";
};

function normalize(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLocaleLowerCase();
  return normalized || undefined;
}

function compareVariants(
  left: AppMapCompiledRawAccessibilityVariant,
  right: AppMapCompiledRawAccessibilityVariant,
): number {
  const leftKey = variantKey(left);
  const rightKey = variantKey(right);
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function variantKey(variant: AppMapCompiledRawAccessibilityVariant): string {
  return [variant.id, appMapRuntimeTargetProfileKey(targetProfileFromVariant(variant))].join(
    "\u0000",
  );
}

function targetProfileKey(profile: AppMapCompiledRawAccessibilityTargetProfile): string {
  return appMapRuntimeTargetProfileKey(profile);
}

function compareTargetProfiles(
  left: AppMapCompiledRawAccessibilityTargetProfile,
  right: AppMapCompiledRawAccessibilityTargetProfile,
): number {
  const leftKey = targetProfileKey(left);
  const rightKey = targetProfileKey(right);
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function sameVariant(
  left: AppMapCompiledRawAccessibilityVariant,
  right: AppMapCompiledRawAccessibilityVariant,
): boolean {
  return variantKey(left) === variantKey(right);
}

function sameViewport(left: RuntimeShape, right: RuntimeShape): boolean {
  return (
    left.viewport !== undefined &&
    right.viewport !== undefined &&
    left.viewport.width === right.viewport.width &&
    left.viewport.height === right.viewport.height
  );
}

/** A stable selector can cross a mobile locale only on the same
 * device/platform and exact viewport. Browser proof additionally requires the
 * complete frozen case profile: locale, theme, auth, network, engine, and
 * emulation can all change the rendered ownership relation. */
function sameRuntimeShape(left: RuntimeShape, right: RuntimeShape): boolean {
  return (
    left.targetId === right.targetId &&
    left.platform === right.platform &&
    left.model === right.model &&
    left.androidAvdName === right.androidAvdName &&
    left.osVersion === right.osVersion &&
    JSON.stringify(left.capabilities ?? []) === JSON.stringify(right.capabilities ?? []) &&
    sameViewport(left, right) &&
    sameBrowserSelectorShape(left, right)
  );
}

function sameBrowserSelectorShape(left: RuntimeShape, right: RuntimeShape): boolean {
  if (left.platform !== "browser" && right.platform !== "browser") return true;
  if (!left.browserCaseProfile || !right.browserCaseProfile) {
    return left.browserCaseProfile === right.browserCaseProfile;
  }
  return JSON.stringify(left.browserCaseProfile) === JSON.stringify(right.browserCaseProfile);
}

function targetProfileFromVariant(
  variant: AppMapCompiledRawAccessibilityVariant,
): AppMapCompiledRawAccessibilityTargetProfile {
  return {
    id: variant.targetProfileId,
    targetId: variant.targetId,
    platform: variant.platform,
    ...(variant.model ? { model: variant.model } : {}),
    ...(variant.androidAvdName ? { androidAvdName: variant.androidAvdName } : {}),
    ...(variant.osVersion ? { osVersion: variant.osVersion } : {}),
    ...(variant.viewport ? { viewport: { ...variant.viewport } } : {}),
    ...(variant.browserCaseProfile
      ? { browserCaseProfile: structuredClone(variant.browserCaseProfile) }
      : {}),
    ...(variant.capabilities ? { capabilities: [...variant.capabilities] } : {}),
  };
}

export function variantMatchesRawTargetProfile(
  variant: AppMapCompiledRawAccessibilityVariant,
  profile: AppMapCompiledRawAccessibilityTargetProfile,
): boolean {
  return sameAppMapRuntimeTargetProfile(targetProfileFromVariant(variant), profile);
}

function stableSelector(target: StepTarget): StableSelector | undefined {
  if (target.relation) {
    const identifier = target.relation.anchor.identifier?.trim();
    return identifier
      ? {
          kind: "relation",
          identifier,
          ...(target.relation.anchor.role ? { role: target.relation.anchor.role } : {}),
        }
      : undefined;
  }
  const identifier = target.identifier?.trim();
  return identifier
    ? { kind: "identifier", identifier, ...(target.role ? { role: target.role } : {}) }
    : undefined;
}

function sourcePublishesStableSelector(
  nodes: readonly SnapshotNode[] | undefined,
  selector: StableSelector | undefined,
): boolean {
  if (!nodes || !selector) return false;
  const identifier = normalize(selector.identifier);
  const role = normalize(selector.role);
  return nodes.some(
    (node) =>
      normalize(node.identifier) === identifier &&
      (!role || normalize(node.role ?? node.type) === role),
  );
}

function variantsFromSources(
  sources: readonly OfflineTestPreflightRawSource[],
): AppMapCompiledRawAccessibilityVariant[] {
  return sources.flatMap((source) => (source.source.variant ? [source.source.variant] : []));
}

function uniqueVariants(
  variants: readonly AppMapCompiledRawAccessibilityVariant[],
): AppMapCompiledRawAccessibilityVariant[] {
  const seen = new Set<string>();
  return [...variants]
    .sort(compareVariants)
    .filter((variant) => {
      const key = variantKey(variant);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((variant) => structuredClone(variant));
}

function uniqueTargetProfiles(
  profiles: readonly AppMapCompiledRawAccessibilityTargetProfile[],
): AppMapCompiledRawAccessibilityTargetProfile[] {
  const seen = new Set<string>();
  return [...profiles]
    .sort(compareTargetProfiles)
    .filter((profile) => {
      const key = targetProfileKey(profile);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((profile) => structuredClone(profile));
}

function sourceCount(
  variant: AppMapCompiledRawAccessibilityVariant,
  sources: readonly OfflineTestPreflightRawSource[],
): number {
  return sources.filter(
    (source) => source.source.variant && sameVariant(source.source.variant, variant),
  ).length;
}

function candidate(
  variant: AppMapCompiledRawAccessibilityVariant,
  sourceCountForVariant: number,
  compatibility: OfflineTestPreflightRawVariantCandidate["compatibility"],
  reason: OfflineTestPreflightRawVariantCandidate["reason"],
): OfflineTestPreflightRawVariantCandidate {
  return {
    variant: structuredClone(variant),
    sourceCount: sourceCountForVariant,
    compatibility,
    reason,
  };
}

function sourceCanReuseStableSelector(input: {
  source: OfflineTestPreflightRawSource;
  selected: AppMapCompiledRawAccessibilityTargetProfile;
  selector: StableSelector | undefined;
}): boolean {
  const sourceVariant = input.source.source.variant;
  const selector = input.selector;
  if (
    !selector ||
    !sourceVariant ||
    !sameRuntimeShape(sourceVariant, input.selected) ||
    !sourcePublishesStableSelector(input.source.nodes, selector)
  ) {
    return false;
  }
  // Do not pass the full authored target here. A relation may carry a label
  // fallback for ordinary same-Variant use; replaying it would let a visible
  // translated label resolve a relation after the identifier itself failed.
  // Cross-Variant reuse has a narrower contract: prove the exact identifier
  // (or identifier-only relation anchor) and nothing else.
  const stableTarget: StepTarget =
    selector.kind === "relation"
      ? {
          relation: {
            kind: "following-row",
            anchor: {
              identifier: selector.identifier,
              ...(selector.role ? { role: selector.role } : {}),
            },
          },
        }
      : {
          identifier: selector.identifier,
          ...(selector.role ? { role: selector.role } : {}),
        };
  const attempt = preflightSemanticActivation([...(input.source.nodes ?? [])], stableTarget);
  return (
    attempt.status === "proven" &&
    attempt.resolution.method === (selector.kind === "relation" ? "relation" : "identifier")
  );
}

/** Scope raw proof to the runtime target profile without looking at a device
 * or mutable App Map. The caller supplies the plan-frozen Variant ledger, so
 * even a profile with no raw tree remains a visible recapture target. */
export function scopeRawSourcesToRuntimeVariant(input: {
  sources: readonly OfflineTestPreflightRawSource[];
  target: StepTarget;
  variants?: readonly AppMapCompiledRawAccessibilityVariant[];
  /** The complete compiled-Test profile ledger. Unlike `variants`, this is
   * global rather than screen-scoped and prevents an English-only screen from
   * silently choosing English when another Test screen has Portuguese. */
  targetProfiles?: readonly AppMapCompiledRawAccessibilityTargetProfile[];
  selectedTargetProfileId?: string;
}): RawVariantScopeDecision {
  const sources = [...input.sources];
  const knownVariants = uniqueVariants([
    ...(input.variants ?? []),
    ...variantsFromSources(sources),
  ]);
  // New plans freeze one global target/profile ledger. A legacy plan retains
  // the prior per-screen Variant/source fallback, but never supplies a global
  // ledger that could be mistaken for a local selector equivalence claim.
  const hasGlobalProfileLedger = Boolean(input.targetProfiles?.length);
  const scopedProfiles = uniqueTargetProfiles(
    hasGlobalProfileLedger
      ? input.targetProfiles!
      : (input.variants?.length ? knownVariants : uniqueVariants(variantsFromSources(sources))).map(
          targetProfileFromVariant,
        ),
  );
  const profileScopeFields = hasGlobalProfileLedger
    ? { targetProfileCandidates: structuredClone(scopedProfiles) }
    : {};
  const selectedTargetProfileId = input.selectedTargetProfileId?.trim();
  if (!selectedTargetProfileId) {
    if (scopedProfiles.length <= 1) {
      return {
        state: "unscoped",
        compatibleSources: sources,
        incompatibleSources: [],
      };
    }
    return {
      state: "selection-required",
      compatibleSources: [],
      incompatibleSources: sources,
      scope: {
        ...profileScopeFields,
        candidates: knownVariants.map((variant) => {
          const count = sourceCount(variant, sources);
          return candidate(
            variant,
            count,
            "incompatible",
            count ? "locale-sensitive-selector" : "no-raw-source",
          );
        }),
      },
    };
  }

  const selectedProfiles = scopedProfiles.filter(
    (profile) => profile.id === selectedTargetProfileId,
  );
  if (selectedProfiles.length !== 1) {
    return {
      state: "selection-missing",
      compatibleSources: [],
      incompatibleSources: sources,
      scope: {
        selectedTargetProfileId,
        ...profileScopeFields,
        candidates: knownVariants.map((variant) =>
          candidate(
            variant,
            sourceCount(variant, sources),
            "incompatible",
            "target-platform-or-viewport-mismatch",
          ),
        ),
      },
    };
  }
  const selectedProfile = selectedProfiles[0]!;
  const selectedVariants = knownVariants.filter((variant) =>
    variantMatchesRawTargetProfile(variant, selectedProfile),
  );
  // A run promotion is evidence for the run's locale, not a replacement for
  // the authored/default source. When several captures share one runtime
  // profile, keep the locale-neutral authored Variant as the default. A
  // localized Variant remains in the ledger and can still be selected by an
  // explicit source/profile binding.
  const selected =
    selectedVariants.find((variant) => variant.captureProvenanceKind !== "run") ??
    selectedVariants[0];

  const stable = stableSelector(input.target);
  const selectedSources = sources.filter(
    (source) =>
      source.source.variant &&
      variantMatchesRawTargetProfile(source.source.variant, selectedProfile),
  );
  const compatibleSources = sources.filter((source) => {
    const sourceVariant = source.source.variant;
    if (!sourceVariant) return false;
    if (variantMatchesRawTargetProfile(sourceVariant, selectedProfile)) return true;
    // A selected Variant that already has raw evidence must prove its own
    // selector. Cross-locale reuse exists only as a narrow bridge for a
    // selected Variant with no raw source at all; otherwise a missing stable
    // identifier in the selected tree would be hidden by another locale.
    return (
      selectedSources.length === 0 &&
      sourceCanReuseStableSelector({ source, selected: selectedProfile, selector: stable })
    );
  });
  const compatible = new Set(compatibleSources);
  const candidates = knownVariants.map((variant) => {
    const count = sourceCount(variant, sources);
    if (variantMatchesRawTargetProfile(variant, selectedProfile)) {
      return candidate(
        variant,
        count,
        "selected-variant",
        count ? "selected-runtime-variant" : "no-raw-source",
      );
    }
    const variantSources = sources.filter(
      (source) => source.source.variant && sameVariant(source.source.variant, variant),
    );
    const hasStableReuse = variantSources.some((source) => compatible.has(source));
    if (hasStableReuse) {
      return candidate(
        variant,
        count,
        stable?.kind === "relation" ? "stable-relation-equivalent" : "stable-identifier-equivalent",
        "same-target-platform-and-viewport",
      );
    }
    if (!count) return candidate(variant, count, "incompatible", "no-raw-source");
    if (!stable) return candidate(variant, count, "incompatible", "locale-sensitive-selector");
    if (selectedSources.length > 0) {
      return candidate(variant, count, "incompatible", "selected-variant-needs-own-proof");
    }
    if (!sameRuntimeShape(variant, selectedProfile)) {
      return candidate(variant, count, "incompatible", "target-platform-or-viewport-mismatch");
    }
    if (!variantSources.some((source) => sourcePublishesStableSelector(source.nodes, stable))) {
      return candidate(variant, count, "incompatible", "stable-selector-not-present");
    }
    return candidate(variant, count, "incompatible", "stable-selector-not-activatable");
  });
  return {
    state: "selected",
    compatibleSources,
    incompatibleSources: sources.filter((source) => !compatible.has(source)),
    scope: {
      selectedTargetProfileId,
      ...profileScopeFields,
      ...(hasGlobalProfileLedger
        ? { selectedTargetProfile: structuredClone(selectedProfile) }
        : {}),
      ...(selected ? { selectedVariant: structuredClone(selected) } : {}),
      candidates,
    },
  };
}

export function rawVariantLabel(variant: AppMapCompiledRawAccessibilityVariant): string {
  return `${variant.id} (profile ${variant.targetProfileId})`;
}

export function rawTargetProfileLabel(
  profile: AppMapCompiledRawAccessibilityTargetProfile,
): string {
  const viewport = profile.viewport
    ? ` @ ${profile.viewport.width}×${profile.viewport.height}`
    : "";
  return `${profile.id} (${profile.platform}:${profile.targetId}${viewport})`;
}

export function rawVariantScopeLabels(
  scope: OfflineTestPreflightRawVariantScope | undefined,
): string {
  const variantProfiles = new Set(
    scope?.candidates.map((candidate) => candidate.variant.targetProfileId),
  );
  const targetProfiles = scope?.targetProfileCandidates ?? [];
  return [
    ...(scope?.candidates.map((candidate) => rawVariantLabel(candidate.variant)) ?? []),
    ...targetProfiles
      .filter((profile) => !variantProfiles.has(profile.id))
      .map(rawTargetProfileLabel),
  ].join(", ");
}
