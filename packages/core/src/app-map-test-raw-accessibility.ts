import type {
  AppMap,
  AppMapCompiledRawAccessibilitySource,
  AppMapCompiledRawAccessibilityVariant,
  AppMapCompiledTest,
} from "@relay/protocol";

function rawSourceKey(source: AppMapCompiledRawAccessibilitySource): string {
  const origin =
    source.origin.kind === "screen-variant"
      ? [source.origin.kind, source.origin.observationId ?? "", source.origin.capturedAt ?? ""]
      : [
          source.origin.kind,
          source.origin.surfaceId,
          source.origin.captureId,
          source.origin.viewportIndex,
          source.origin.capturedAt,
        ];
  return [
    source.screenId,
    source.variant.id,
    source.variant.targetProfileId,
    source.variant.targetId,
    source.variant.platform,
    ...origin,
    source.tree.uri,
    source.tree.id,
    source.tree.sha256,
  ].join("\u0000");
}

function sourceVariant(
  variant: AppMap["screenVariants"][string],
): AppMapCompiledRawAccessibilityVariant {
  return {
    id: variant.id,
    targetProfileId: variant.targetProfile.id,
    targetId: variant.targetProfile.targetId,
    platform: variant.targetProfile.platform,
    ...(variant.targetProfile.viewport ? { viewport: { ...variant.targetProfile.viewport } } : {}),
  };
}

/** Freeze every target/locale identity separately from its raw tree. A
 * selected runtime Variant can therefore request an exact recapture even when
 * that Variant has not captured raw accessibility evidence yet. */
export function frozenRawAccessibilityVariants(
  map: AppMap,
): NonNullable<AppMapCompiledTest["rawAccessibilityVariantsByScreenId"]> {
  const grouped = new Map<string, Map<string, AppMapCompiledRawAccessibilityVariant>>(
    Object.keys(map.screens)
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
      .map((screenId) => [screenId, new Map<string, AppMapCompiledRawAccessibilityVariant>()]),
  );
  for (const variant of Object.values(map.screenVariants).sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  )) {
    const variants = grouped.get(variant.screenId) ?? new Map();
    const frozen = sourceVariant(variant);
    variants.set(frozen.id, structuredClone(frozen));
    grouped.set(variant.screenId, variants);
  }
  return Object.fromEntries(
    [...grouped.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([screenId, variants]) => [
        screenId,
        [...variants.values()].sort((left, right) => left.id.localeCompare(right.id)),
      ]),
  );
}

export function frozenRawAccessibilitySources(
  map: AppMap,
): NonNullable<AppMapCompiledTest["rawAccessibilitySourcesByScreenId"]> {
  type RawSource = AppMapCompiledRawAccessibilitySource;
  const grouped = new Map<string, Map<string, RawSource>>(
    Object.keys(map.screens)
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
      .map((screenId) => [screenId, new Map<string, RawSource>()]),
  );
  for (const variant of Object.values(map.screenVariants).sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  )) {
    const variantSource = sourceVariant(variant);
    const sources: RawSource[] = variant.rawAccessibilityTree
      ? [
          {
            screenId: variant.screenId,
            variant: variantSource,
            origin: {
              kind: "screen-variant",
              ...(variant.rawAccessibilityTree.observationId
                ? { observationId: variant.rawAccessibilityTree.observationId }
                : {}),
              ...(variant.rawAccessibilityTree.capturedAt !== undefined
                ? { capturedAt: variant.rawAccessibilityTree.capturedAt }
                : {}),
            },
            tree: variant.rawAccessibilityTree,
          },
        ]
      : [];
    const latestSurface = [...(variant.scrollSurfaces ?? [])].sort(
      (left, right) => right.capturedAt - left.capturedAt || left.id.localeCompare(right.id),
    )[0];
    if (latestSurface) {
      sources.push(
        ...latestSurface.viewports.map((viewport) => ({
          screenId: variant.screenId,
          variant: variantSource,
          origin: {
            kind: "scroll-surface-viewport" as const,
            surfaceId: latestSurface.id,
            captureId: latestSurface.captureId,
            viewportIndex: viewport.index,
            capturedAt: viewport.capturedAt,
          },
          tree: viewport.accessibilityTree,
        })),
      );
    }
    const screenSources = grouped.get(variant.screenId) ?? new Map<string, RawSource>();
    for (const source of sources) {
      // The source identity includes the Variant/profile, not only the CAS
      // digest. A tree shared across locales must remain independently
      // inspectable until explicit selector-equivalence rules approve reuse.
      const key = rawSourceKey(source);
      if (!screenSources.has(key)) screenSources.set(key, structuredClone(source));
    }
    grouped.set(variant.screenId, screenSources);
  }
  return Object.fromEntries(
    [...grouped.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([screenId, sources]) => [
        screenId,
        [...sources.values()].sort((left, right) => {
          const leftKey = rawSourceKey(left);
          const rightKey = rawSourceKey(right);
          return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
        }),
      ]),
  );
}
