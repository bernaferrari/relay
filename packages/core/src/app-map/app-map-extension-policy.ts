import type {
  AppMap,
  AppMapNativeRouteCompanion,
  AppMapScenarioTest,
  RouteVariantPlatform,
} from "@relay/protocol";

export type NativeRouteCompanionResolver = (input: {
  map: AppMap;
  test: AppMapScenarioTest;
}) => readonly AppMapNativeRouteCompanion[] | undefined;

export type AppMapPlatformResolver = (map: AppMap) => RouteVariantPlatform | undefined;

const nativeRouteCompanionResolvers: NativeRouteCompanionResolver[] = [];
const appMapPlatformResolvers: AppMapPlatformResolver[] = [];

/** Register product-owned same-intent native route companions. */
export function registerNativeRouteCompanionResolver(
  resolver: NativeRouteCompanionResolver,
): () => void {
  nativeRouteCompanionResolvers.push(resolver);
  return () => {
    const index = nativeRouteCompanionResolvers.indexOf(resolver);
    if (index >= 0) nativeRouteCompanionResolvers.splice(index, 1);
  };
}

/** Explicit Test metadata wins; registered product policy is only a fallback. */
export function resolveNativeRouteCompanions(
  map: AppMap,
  test: AppMapScenarioTest,
): readonly AppMapNativeRouteCompanion[] {
  if (test.nativeRouteCompanions?.length) return test.nativeRouteCompanions;
  for (const resolver of nativeRouteCompanionResolvers) {
    const companions = resolver({ map, test });
    if (companions !== undefined) return companions;
  }
  return [];
}

/** Register product-owned map/platform identity for legacy maps that predate target evidence. */
export function registerAppMapPlatformResolver(resolver: AppMapPlatformResolver): () => void {
  appMapPlatformResolvers.push(resolver);
  return () => {
    const index = appMapPlatformResolvers.indexOf(resolver);
    if (index >= 0) appMapPlatformResolvers.splice(index, 1);
  };
}

export function resolveRegisteredAppMapPlatform(map: AppMap): RouteVariantPlatform | undefined {
  for (const resolver of appMapPlatformResolvers) {
    const platform = resolver(map);
    if (platform !== undefined) return platform;
  }
  return undefined;
}
