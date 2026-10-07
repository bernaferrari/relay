import type {
  AppMap,
  AppMapCompiledRawAccessibilitySource,
  AppMapCompiledRawAccessibilityTargetProfile,
  AppMapCompiledRawAccessibilityVariant,
  AppMapCompiledTest,
} from "@relay/protocol";
import {
  appMapRuntimeTargetProfileFromSaved,
  appMapRuntimeTargetProfileKey,
} from "./app-map-runtime-target-profile.js";

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
    source.variant.androidAvdName ?? "",
    ...origin,
    source.tree.uri,
    source.tree.id,
    source.tree.sha256,
  ].join("\u0000");
}

function sourceVariant(
  variant: AppMap["screenVariants"][string],
): AppMapCompiledRawAccessibilityVariant {
  const profile = appMapRuntimeTargetProfileFromSaved(variant.targetProfile);
  return {
    id: variant.id,
    ...(variant.captureProvenance?.kind === "run" ? { captureProvenanceKind: "run" as const } : {}),
    ...(variant.captureProvenance?.locale ? { locale: variant.captureProvenance.locale } : {}),
    targetProfileId: profile.id,
    targetId: profile.targetId,
    platform: profile.platform,
    ...(profile.model ? { model: profile.model } : {}),
    ...(profile.androidAvdName ? { androidAvdName: profile.androidAvdName } : {}),
    ...(profile.osVersion ? { osVersion: profile.osVersion } : {}),
    ...(profile.viewport ? { viewport: structuredClone(profile.viewport) } : {}),
    ...(profile.browserCaseProfile
      ? { browserCaseProfile: structuredClone(profile.browserCaseProfile) }
      : {}),
    ...(profile.capabilities ? { capabilities: [...profile.capabilities] } : {}),
  };
}

function sourceTargetProfile(
  variant: AppMap["screenVariants"][string],
): AppMapCompiledRawAccessibilityTargetProfile {
  return appMapRuntimeTargetProfileFromSaved(variant.targetProfile);
}

function* consolidatedVariants(
  screen: AppMap["screens"][string],
): Generator<AppMap["screenVariants"][string]> {
  for (const record of screen.consolidations ?? []) {
    for (const captured of record.sourceVariants) {
      if (record.sourceScreens.some((source) => source.id === captured.screenId)) yield captured;
    }
    for (const source of record.sourceScreens) yield* consolidatedVariants(source);
  }
}

/** A reviewed logical screen retains its captured focus/text states. Their
 * immutable trees remain in consolidation lineage after same-profile Variant
 * merging; the current Variant's observation and preview still stay intact. */
function retainedStateTrees(map: AppMap, variant: AppMap["screenVariants"][string]) {
  const key = appMapRuntimeTargetProfileKey(sourceTargetProfile(variant));
  const captured = [...consolidatedVariants(map.screens[variant.screenId]!)].filter(
    (source) =>
      !source.refreshCapture &&
      source.organizationId === variant.organizationId &&
      source.projectId === variant.projectId &&
      source.appMapId === variant.appMapId &&
      source.captureProvenance?.kind === variant.captureProvenance?.kind &&
      source.captureProvenance?.locale === variant.captureProvenance?.locale &&
      appMapRuntimeTargetProfileKey(sourceTargetProfile(source)) === key &&
      source.rawAccessibilityTree &&
      source.evidenceIds.includes(source.rawAccessibilityTree.id) &&
      source.evidenceUris?.includes(source.rawAccessibilityTree.uri),
  );
  return [variant, ...captured].flatMap((source) =>
    source.rawAccessibilityTree ? [source.rawAccessibilityTree] : [],
  );
}

/** Freeze every distinct saved target/profile identity for the whole Test.
 * The key includes viewport: a corrupted map that reuses an ID at two shapes
 * stays visibly ambiguous instead of permitting cross-shape selector reuse. */
export function frozenRawAccessibilityTargetProfiles(
  map: AppMap,
): NonNullable<AppMapCompiledTest["rawAccessibilityTargetProfiles"]> {
  const profiles = new Map<string, AppMapCompiledRawAccessibilityTargetProfile>();
  for (const variant of Object.values(map.screenVariants).sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  )) {
    // Manual refresh is presentation history, not a newly reviewed replay
    // environment or selector source. Keep its observed profile on the map.
    if (variant.refreshCapture) continue;
    const profile = sourceTargetProfile(variant);
    const key = appMapRuntimeTargetProfileKey(profile);
    if (!profiles.has(key)) profiles.set(key, profile);
  }
  return [...profiles.values()]
    .sort((left, right) => {
      const leftKey = appMapRuntimeTargetProfileKey(left);
      const rightKey = appMapRuntimeTargetProfileKey(right);
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    })
    .map((profile) => structuredClone(profile));
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
    // Manual refresh is presentation history, not a newly reviewed replay
    // environment or selector source. Keep its observed profile on the map.
    if (variant.refreshCapture) continue;
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
    // Manual refresh is presentation history, not a newly reviewed replay
    // environment or selector source. Keep its observed profile on the map.
    if (variant.refreshCapture) continue;
    const variantSource = sourceVariant(variant);
    const sources: RawSource[] = retainedStateTrees(map, variant).map((tree) => ({
      screenId: variant.screenId,
      variant: variantSource,
      origin: {
        kind: "screen-variant",
        ...(tree.observationId ? { observationId: tree.observationId } : {}),
        ...(tree.capturedAt !== undefined ? { capturedAt: tree.capturedAt } : {}),
      },
      tree,
    }));
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
