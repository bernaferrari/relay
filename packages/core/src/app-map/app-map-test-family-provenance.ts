import type {
  AppMap,
  AppMapCompiledTest,
  AppMapScenarioTest,
  AppMapTestRouteVariant,
  AppMapTestStepProvenance,
  TargetProfile,
} from "@relay/protocol";
import { appMapTestViewportClass } from "./app-map-test-route-variants.js";

/** Build the inspectable provenance that is also covered by the frozen plan
 * digest. Only entities reached by the selected implementation are included. */
export function compiledTestFamilyProvenance(input: {
  map: AppMap;
  authoredTest: AppMapScenarioTest;
  selectedRouteVariant?: AppMapTestRouteVariant;
  selectedTargetProfile?: TargetProfile;
  stepProvenance: AppMapTestStepProvenance[];
}): NonNullable<AppMapCompiledTest["testFamily"]> {
  const referencedIds = new Set(input.stepProvenance.flatMap((entry) => entry.referencedEntityIds));
  const referencedConnections = Object.values(input.map.connections).filter((connection) =>
    referencedIds.has(connection.id),
  );
  const referencedScreenIds = new Set<string>(
    referencedConnections.flatMap((connection) => [
      connection.fromScreenId,
      ...(connection.destination.kind === "screen" ? [connection.destination.screenId] : []),
    ]),
  );
  for (const screenId of Object.keys(input.map.screens)) {
    if (referencedIds.has(screenId)) referencedScreenIds.add(screenId);
  }
  const logicalStateBindings = [...referencedScreenIds].sort().flatMap((screenId) => {
    const binding = input.map.screens[screenId]?.logicalStateBinding;
    return binding ? [{ screenId, ...structuredClone(binding) }] : [];
  });
  const actionIntentBindings = referencedConnections
    .sort((left, right) => left.id.localeCompare(right.id))
    .flatMap((connection) =>
      connection.actionIntentBinding
        ? [{ connectionId: connection.id, ...structuredClone(connection.actionIntentBinding) }]
        : [],
    );
  const profile = input.selectedTargetProfile;
  const viewport = profile?.browserCaseProfile?.viewport ?? profile?.viewport;
  const viewportClass = appMapTestViewportClass(viewport);
  return {
    schemaVersion: 1,
    mode: input.selectedRouteVariant ? "reviewed-route-variant" : "legacy-single-surface",
    testRevision: input.map.revision,
    logicalIntentRevision: input.authoredTest.family?.logicalIntentRevision ?? input.map.revision,
    bindingRevision: input.authoredTest.family?.bindingRevision ?? input.map.revision,
    ...(input.selectedRouteVariant
      ? {
          selectedRouteVariant: {
            id: input.selectedRouteVariant.id,
            revision: input.selectedRouteVariant.revision,
            reviewedAt: input.selectedRouteVariant.reviewedAt,
            reviewedBy: input.selectedRouteVariant.reviewedBy,
          },
        }
      : {}),
    ...(profile
      ? {
          targetSurface: {
            targetProfileId: profile.id,
            targetId: profile.targetId,
            platform: profile.platform,
            ...(viewport ? { viewport: structuredClone(viewport) } : {}),
            ...(viewportClass ? { viewportClass } : {}),
            ...(profile.browserCaseProfile
              ? { browserEngine: profile.browserCaseProfile.engine }
              : {}),
            capabilities: [...profile.capabilities].sort(),
          },
        }
      : {}),
    logicalStateBindings,
    actionIntentBindings,
  };
}
