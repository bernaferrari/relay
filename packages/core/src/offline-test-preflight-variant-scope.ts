import type {
  AppMapCompiledRawAccessibilityVariant,
  OfflineTestPreflightRawVariantCandidate,
  OfflineTestPreflightRawVariantScope,
  StepTarget,
} from "@relay/protocol";
import { preflightSemanticActivation } from "./device-target-resolution.js";
import type { SnapshotNode } from "./device.js";
import type { OfflineTestPreflightRawSource } from "./offline-test-preflight-raw.js";

type StableSelector =
  | { kind: "identifier"; identifier: string; role?: string }
  | { kind: "relation"; identifier: string; role?: string };

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
  const leftKey = [left.id, left.targetProfileId, left.targetId, left.platform].join("\u0000");
  const rightKey = [right.id, right.targetProfileId, right.targetId, right.platform].join("\u0000");
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function variantKey(variant: AppMapCompiledRawAccessibilityVariant): string {
  return [variant.id, variant.targetProfileId, variant.targetId, variant.platform].join("\u0000");
}

function sameVariant(
  left: AppMapCompiledRawAccessibilityVariant,
  right: AppMapCompiledRawAccessibilityVariant,
): boolean {
  return variantKey(left) === variantKey(right);
}

function sameViewport(
  left: AppMapCompiledRawAccessibilityVariant,
  right: AppMapCompiledRawAccessibilityVariant,
): boolean {
  return (
    left.viewport !== undefined &&
    right.viewport !== undefined &&
    left.viewport.width === right.viewport.width &&
    left.viewport.height === right.viewport.height
  );
}

/** A stable selector can cross a locale only on the same device/platform and
 * exact viewport. Copy, broad text, and an absent viewport are intentionally
 * not enough: responsive layout or a different app target can change the
 * ownership relation even when the label happens to match. */
function sameRuntimeShape(
  left: AppMapCompiledRawAccessibilityVariant,
  right: AppMapCompiledRawAccessibilityVariant,
): boolean {
  return (
    left.targetId === right.targetId &&
    left.platform === right.platform &&
    sameViewport(left, right)
  );
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
  selected: AppMapCompiledRawAccessibilityVariant;
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
  selectedTargetProfileId?: string;
}): RawVariantScopeDecision {
  const sources = [...input.sources];
  const knownVariants = uniqueVariants([
    ...(input.variants ?? []),
    ...variantsFromSources(sources),
  ]);
  // New plans freeze every Variant, including one that has no raw tree yet.
  // That complete ledger, not only the sources that happen to exist today,
  // decides whether a locale/profile choice is required. Legacy plans have no
  // ledger, so their source identities remain the safest available fallback.
  const scopedProfiles = (
    input.variants?.length ? knownVariants : uniqueVariants(variantsFromSources(sources))
  ).map((variant) => variant.targetProfileId);
  const selectedTargetProfileId = input.selectedTargetProfileId?.trim();
  if (!selectedTargetProfileId) {
    if (new Set(scopedProfiles).size <= 1) {
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

  const selected = knownVariants.find(
    (variant) => variant.targetProfileId === selectedTargetProfileId,
  );
  if (!selected) {
    return {
      state: "selection-missing",
      compatibleSources: [],
      incompatibleSources: sources,
      scope: {
        selectedTargetProfileId,
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

  const stable = stableSelector(input.target);
  const selectedSources = sources.filter(
    (source) => source.source.variant && sameVariant(source.source.variant, selected),
  );
  const compatibleSources = sources.filter((source) => {
    const sourceVariant = source.source.variant;
    if (!sourceVariant) return false;
    if (sameVariant(sourceVariant, selected)) return true;
    // A selected Variant that already has raw evidence must prove its own
    // selector. Cross-locale reuse exists only as a narrow bridge for a
    // selected Variant with no raw source at all; otherwise a missing stable
    // identifier in the selected tree would be hidden by another locale.
    return (
      selectedSources.length === 0 &&
      sourceCanReuseStableSelector({ source, selected, selector: stable })
    );
  });
  const compatible = new Set(compatibleSources);
  const candidates = knownVariants.map((variant) => {
    const count = sourceCount(variant, sources);
    if (sameVariant(variant, selected)) {
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
    if (!sameRuntimeShape(variant, selected)) {
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
      selectedVariant: structuredClone(selected),
      candidates,
    },
  };
}

export function rawVariantLabel(variant: AppMapCompiledRawAccessibilityVariant): string {
  return `${variant.id} (profile ${variant.targetProfileId})`;
}
