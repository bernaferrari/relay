import type { AppMap, CombineCampaign } from "@relay/protocol";
import {
  digestAppMapTestExecutionValue,
  parseAppMapCombineCellExecutionIntent,
  readPersistedRun,
} from "@relay/core";

/** Keep the originally frozen recipe namespace after runtime-only validation.
 * Current authored content, profiles and CAS references are still compiled
 * and compared against the complete frozen intent. A missing activity range
 * never proves that a revision was only a validation projection. */
export function mapForFrozenCampaignCompilation(
  map: AppMap,
  campaign: Pick<CombineCampaign, "appMapId" | "sourceRevision" | "lineage">,
  frozenUpdatedAt = map.updatedAt,
): AppMap {
  const revision = campaign.sourceRevision;
  if (
    map.id !== campaign.appMapId ||
    !Number.isSafeInteger(revision) ||
    revision < 0 ||
    revision >= map.revision ||
    campaign.lineage.some((entry) => entry.causalRepairProposalIds?.length)
  )
    return map;
  const events = Object.values(map.activity)
    .filter((event) => event.afterRevision > revision)
    .sort((left, right) => left.beforeRevision - right.beforeRevision);
  let expected = revision;
  for (const event of events) {
    if (
      event.beforeRevision !== expected ||
      event.afterRevision !== expected + 1 ||
      event.afterRevision > map.revision ||
      event.eventType !== "test.validated" ||
      event.organizationId !== map.organizationId ||
      event.projectId !== map.projectId ||
      event.appMapId !== map.id ||
      event.subject.kind !== "test" ||
      !map.tests[event.subject.id] ||
      !event.id.startsWith("test-validated-") ||
      event.touched?.length !== 1 ||
      event.touched[0] !== `test:${event.subject.id}:validation`
    )
      return map;
    expected = event.afterRevision;
  }
  return expected === map.revision
    ? {
        ...map,
        revision,
        updatedAt: frozenUpdatedAt,
        // This is an ephemeral compiler view, not a stored Map rewrite. Runtime
        // events beyond its frozen namespace have already been validated above.
        activity: Object.fromEntries(
          Object.entries(map.activity).filter(([, event]) => event.afterRevision <= revision),
        ),
      }
    : map;
}

/** The compiled Test root's timestamps come directly from its source Map
 * (app-map-test-compile-support.asRecipe). Recover that stamp only from a
 * matching parser-validated immutable completed case; scheduling timestamps
 * and the current Map cannot establish its frozen compilation owner. */
export async function resolveFrozenCampaignCompilationMap(
  map: AppMap,
  campaign: CombineCampaign,
): Promise<AppMap> {
  if (mapForFrozenCampaignCompilation(map, campaign) === map) return map;
  const stamps = new Set<number>();
  for (const item of campaign.cases) {
    if (!item.runId) continue;
    const run = await readPersistedRun(item.runId);
    if (!run?.finishedAt || run.projectId !== map.projectId || run.batchId !== campaign.id)
      continue;
    const artifact = run.artifacts.find(
      (entry) => entry.kind === "app-map-combine-cell-execution-intent",
    );
    const intent = parseAppMapCombineCellExecutionIntent(artifact?.data);
    if (
      !intent ||
      intent.digest !== item.outerIntentDigest ||
      digestAppMapTestExecutionValue(intent.child) !== item.childIntentDigest ||
      intent.wrapper.recipeGraphDigest !== item.wrapperGraphDigest ||
      digestAppMapTestExecutionValue(intent.staticInputs) !== item.staticInputDigest ||
      intent.cell.cellId !== item.cellId ||
      intent.cell.testId !== item.testId ||
      intent.selectedRuntimeTargetProfile.id !== item.targetProfileId ||
      intent.child.sourcePlan.appMapId !== map.id ||
      intent.child.sourcePlan.appMapRevision !== campaign.sourceRevision ||
      intent.nativeCompanion
    )
      continue;
    const root = intent.child.recipeGraph[intent.child.sourcePlan.rootRecipeId];
    if (
      !root ||
      root.createdAt !== map.createdAt ||
      root.updatedAt < map.createdAt ||
      root.updatedAt > map.updatedAt
    )
      return map;
    stamps.add(root.updatedAt);
  }
  if (stamps.size !== 1) return map;
  return mapForFrozenCampaignCompilation(map, campaign, [...stamps][0]!);
}
